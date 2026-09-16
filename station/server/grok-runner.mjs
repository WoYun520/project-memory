import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn, execFile} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';
import {promisify} from 'node:util';

const runFile = promisify(execFile);
const DEFAULT_TIMEOUT = 10 * 60_000;
const MAX_TEXT = 64 * 1024;
const MAX_LINE = 256 * 1024;
const MAX_STREAM = 8 * 1024 * 1024;
const DENIED = ['Bash', 'Read', 'Grep', 'Edit', 'Write', 'MCPTool', 'WebSearch', 'WebFetch'];
// Grok's parse_comma_list treats an empty --tools value as no restriction.
// Use a known tool, then remove it and the MCP meta-tools explicitly. Unknown
// names such as "none" may trigger Grok's full-toolset fallback. Confirmed on
// Grok 1.0.30: all three available_commands updates advertised tools: [].
// Upstream: xai-grok-pager/src/headless/cli.rs:133 and
// xai-grok-agent/src/builder.rs:837-915 (xai-org/grok-build).
const EMPTY_TOOL_ALLOWLIST = 'read_file';
const EMPTY_TOOL_DENYLIST = 'read_file,search_tool,use_tool';
const MESSAGES = {
  EDIT_NOT_SUPPORTED: '当前接入只根据已提供的记忆整理方案，尚未开放修改项目。',
  INVALID_REQUEST: 'Grok 运行参数无效。',
  GROK_NOT_FOUND: '未找到可运行的 Grok Build。',
  START_FAILED: 'Grok 未能启动，请在原终端检查其运行状态。',
  AUTH_REQUIRED: 'Grok 登录状态不可用，请在原终端完成登录后重试。',
  PERMISSION_DENIED: 'Grok 的本次操作被权限规则阻止。',
  CONNECTION_FAILED: 'Grok 连接未完成，请稍后重试。',
  CLI_FAILED: 'Grok 本次运行未完成。',
  INVALID_STREAM: 'Grok 返回了无法识别的结果格式。',
  TOOLS_NOT_DISABLED: 'Grok 仍提供本次未允许的工具，运行已经停止。',
  TOOLS_UNVERIFIED: '未能确认 Grok 已禁用工具，结果没有被接纳。',
  TOOL_NOT_ALLOWED: 'Grok 尝试调用本次未允许的工具，运行已经停止。',
  OUTPUT_LIMIT: 'Grok 返回内容超过本次限制，运行已经停止。',
  INCOMPLETE_RESPONSE: 'Grok 没有返回完整方案，请重试或缩小任务。',
  TIMED_OUT: 'Grok 本次运行超时，已停止。',
  CANCELLED: '已停止本次 Grok 运行。',
};

/** Discovery reads executable metadata only; no login files or session history. */
export async function detectGrok({env = process.env} = {}) {
  const candidates = [];
  if (typeof env.MEMORY_STATION_GROK_BIN === 'string') candidates.push(env.MEMORY_STATION_GROK_BIN);
  for (const directory of String(env.PATH || '').split(path.delimiter)) {
    if (path.isAbsolute(directory)) candidates.push(path.join(directory, 'grok'));
  }
  candidates.push(path.join(env.HOME || os.homedir(), '.local', 'bin', 'grok'));
  for (const candidate of new Set(candidates)) {
    if (!path.isAbsolute(candidate)) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (!fs.statSync(candidate).isFile()) continue;
      const {stdout} = await runFile(candidate, ['--version'], {env, timeout: 5000, maxBuffer: 4096, windowsHide: true});
      const match = stdout.trim().match(/^grok\s+(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)(?:\s|$)/i);
      if (!match) continue;
      return {available: true, executable: candidate, version: match[1], message: '已找到 Grok Build，可用已保存记忆整理方案。'};
    } catch { /* Try the next executable without exposing process diagnostics. */ }
  }
  return {available: false, executable: null, version: null, message: MESSAGES.GROK_NOT_FOUND};
}

function failureCategory(value) {
  const text = String(value || '').slice(0, 8192).toLowerCase();
  if (/not signed in|not authenticated|authentication failed|unauthorized|please (?:run .*login|log in)|login required/.test(text)) return 'AUTH_REQUIRED';
  if (/permission denied|operation not permitted|tool.*(?:denied|not allowed)|cancelled.*permission/.test(text)) return 'PERMISSION_DENIED';
  if (/connection refused|failed to connect|network (?:error|unreachable)|connection.*timed out/.test(text)) return 'CONNECTION_FAILED';
  return null;
}

function validPaths(executable, cwd, promptFile) {
  if (![executable, cwd, promptFile].every(value => typeof value === 'string' && path.isAbsolute(value) && !value.includes('\0'))) return false;
  try {
    const root = fs.realpathSync(cwd);
    const file = fs.realpathSync(promptFile);
    return fs.statSync(root).isDirectory() && fs.statSync(file).isFile()
      && !fs.lstatSync(promptFile).isSymbolicLink() && file.startsWith(root + path.sep)
      && fs.statSync(file).size <= 1024 * 1024;
  } catch { return false; }
}

/**
 * The caller supplies a privacy-checked, self-contained prompt in an isolated job
 * directory. "read" means reading that supplied text, not filesystem access.
 * No shell, file tools, MCP, web, subagents, or implicit session continuation.
 * This is a tool restriction; it does not claim OS-level process isolation.
 * Events and completion contain public answer text plus fixed status messages.
 */
export function startGrok({executable, cwd, promptFile, mode = 'read', onEvent = () => {}, onFinish = () => {}, spawnImpl = spawn, timeoutMs = DEFAULT_TIMEOUT, killGraceMs = 1500} = {}) {
  let child;
  let finished = false;
  let stopping = null;
  let timeout;
  let killTimer;
  let text = '';
  let textBytes = 0;
  let bytes = 0;
  let line = '';
  let toolsVerified = false;
  let terminal = null;
  let failure = null;
  let failedEvent = false;
  const decoder = new StringDecoder('utf8');
  const emit = event => { try { onEvent(event); } catch { /* UI callbacks cannot widen a run. */ } };
  const finish = (status, errorCode, exitCode = null) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    clearTimeout(killTimer);
    line = '';
    const result = {status, text, ...(errorCode ? {errorCode, message: MESSAGES[errorCode] || MESSAGES.CLI_FAILED} : {}), exitCode};
    emit({type: 'status', status, message: result.message || 'Grok 方案已完成，仍需检查后保存。'});
    try { onFinish(result); } catch { /* Completion remains terminal. */ }
  };
  const signal = name => {
    if (!child) return;
    try {
      if (spawnImpl === spawn && process.platform !== 'win32' && child.pid > 0) process.kill(-child.pid, name);
      else child.kill(name);
    } catch { /* Already exited. */ }
  };
  const stop = (status, code) => {
    if (finished || stopping) return;
    stopping = {status, code};
    signal('SIGTERM');
    killTimer = setTimeout(() => { signal('SIGKILL'); finish(status, code); }, Math.max(10, Math.min(5000, Number(killGraceMs) || 1500)));
    killTimer.unref?.();
    if (!child) queueMicrotask(() => finish(status, code));
  };
  const fail = code => stop('failed', code);
  const event = value => {
    if (!value || typeof value !== 'object' || stopping || finished) return;
    // Never traverse generic message/content fields: they may carry private
    // reasoning, echoed prompts, signatures, raw tool arguments, or tool output.
    if (value.type === 'available_commands') {
      if (!Array.isArray(value.tools) || value.tools.length !== 0) return fail('TOOLS_NOT_DISABLED');
      toolsVerified = true;
      return;
    }
    if (value.type === 'tool_call' || value.type === 'tool_call_update' || value.type === 'tool_call_delta_chunk') {
      emit({type: 'tool', id: 'blocked-tool', title: '未允许的工具调用', status: 'blocked'});
      return fail('TOOL_NOT_ALLOWED');
    }
    if (value.type === 'text') {
      if (!toolsVerified) return fail('TOOLS_UNVERIFIED');
      if (typeof value.data !== 'string') return fail('INVALID_STREAM');
      const size = Buffer.byteLength(value.data);
      if (textBytes + size > MAX_TEXT) return fail('OUTPUT_LIMIT');
      textBytes += size;
      text += value.data;
      emit({type: 'text', text: value.data});
      return;
    }
    if (value.type === 'error') { failedEvent = true; failure = failureCategory(value.message) || 'CLI_FAILED'; return; }
    if (value.type === 'max_turns_reached') { failedEvent = true; failure = 'INCOMPLETE_RESPONSE'; return; }
    if (value.type === 'end') terminal = value.stopReason;
    // thought, usage, menus, metadata, and unknown future events are discarded.
  };
  const parseLine = raw => {
    if (!raw.trim() || stopping || finished) return;
    try { event(JSON.parse(raw)); } catch { fail('INVALID_STREAM'); }
  };
  const consume = chunk => {
    if (finished || stopping) return;
    bytes += chunk.length;
    if (bytes > MAX_STREAM) return fail('OUTPUT_LIMIT');
    line += decoder.write(chunk);
    let newline;
    while ((newline = line.indexOf('\n')) >= 0) {
      const next = line.slice(0, newline);
      line = line.slice(newline + 1);
      if (Buffer.byteLength(next) > MAX_LINE) return fail('OUTPUT_LIMIT');
      parseLine(next);
      if (stopping) { line = ''; return; }
    }
    if (Buffer.byteLength(line) > MAX_LINE) fail('OUTPUT_LIMIT');
  };
  const invalid = mode === 'edit' ? 'EDIT_NOT_SUPPORTED'
    : mode !== 'read' || !validPaths(executable, cwd, promptFile) ? 'INVALID_REQUEST' : null;
  if (invalid) {
    queueMicrotask(() => finish('failed', invalid));
    return {cancel() { /* Nothing was launched. */ }};
  }
  const args = ['--cwd', cwd, '--prompt-file', promptFile, '--output-format', 'streaming-json',
    '--permission-mode', 'dontAsk', '--tools', EMPTY_TOOL_ALLOWLIST,
    '--disallowed-tools', EMPTY_TOOL_DENYLIST, '--verbatim', '--no-plan', '--no-subagents',
    '--disable-web-search', '--no-leader', '--no-memory', '--no-auto-update', '--max-turns', '2',
    ...DENIED.flatMap(rule => ['--deny', rule])];
  try {
    child = spawnImpl(executable, args, {cwd, shell: false, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    emit({type: 'status', status: 'running', message: 'Grok 正在根据本次提供的记忆整理方案。'});
    child.stdout.on('data', consume);
    child.stderr.on('data', chunk => {
      // Inspect only for a fixed error category. Do not retain any stderr body.
      failure ||= failureCategory(chunk.toString('utf8'));
    });
    child.on('error', error => {
      if (stopping) return finish(stopping.status, stopping.code);
      finish('failed', error?.code === 'ENOENT' ? 'GROK_NOT_FOUND' : 'START_FAILED');
    });
    child.on('close', code => {
      if (finished) return;
      if (stopping) { signal('SIGKILL'); return finish(stopping.status, stopping.code, code); }
      line += decoder.end();
      if (line) parseLine(line);
      if (stopping) return finish(stopping.status, stopping.code, code);
      if (code !== 0 || failedEvent) return finish('failed', failure || 'CLI_FAILED', code);
      if (!toolsVerified) return finish('failed', 'TOOLS_UNVERIFIED', code);
      if (terminal !== 'end_turn' || !text.trim()) return finish('failed', 'INCOMPLETE_RESPONSE', code);
      // CLI background diagnostics can mention non-fatal auth/permission errors;
      // a complete zero-exit answer takes precedence over stderr categories.
      finish('completed', null, code);
    });
    timeout = setTimeout(() => stop('timed_out', 'TIMED_OUT'), Math.max(10, Math.min(30 * 60_000, Number(timeoutMs) || DEFAULT_TIMEOUT)));
    timeout.unref?.();
  } catch { queueMicrotask(() => finish('failed', 'START_FAILED')); }
  return {cancel() { stop('cancelled', 'CANCELLED'); }};
}
