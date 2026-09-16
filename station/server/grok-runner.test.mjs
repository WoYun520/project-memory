import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {detectGrok, startGrok} from './grok-runner.mjs';

function fixture(t, options = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-grok-unit-'));
  t.after(() => fs.rmSync(cwd, {recursive: true, force: true}));
  const promptFile = path.join(cwd, 'prompt.txt');
  fs.writeFileSync(promptFile, 'Synthetic, privacy-checked project memory.');
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.signals = [];
  child.kill = signal => { child.signals.push(signal); if (!options.ignoreKill) queueMicrotask(() => child.emit('close', null)); };
  let resolve;
  const finished = new Promise(done => { resolve = done; });
  const events = [];
  const results = [];
  let launch;
  const handle = startGrok({
    executable: '/synthetic/grok', cwd, promptFile,
    onEvent: value => events.push(value),
    onFinish: value => { results.push(value); resolve(value); },
    spawnImpl: (executable, args, config) => { launch = {executable, args, config}; return child; },
    killGraceMs: 10,
    ...options,
  });
  const send = value => child.stdout.write(JSON.stringify(value) + '\n');
  const ready = () => send({type: 'available_commands', tools: [], commands: ['local-menu-only']});
  const end = (stopReason = 'end_turn', exitCode = 0) => { send({type: 'end', stopReason}); child.emit('close', exitCode); };
  return {cwd, promptFile, child, handle, events, results, finished, launch, send, ready, end};
}

test('headless invocation has no tools or shell and does not resume the user terminal', async t => {
  const f = fixture(t);
  const {args, config} = f.launch;
  assert.equal(args[args.indexOf('--tools') + 1], 'read_file');
  assert.equal(args[args.indexOf('--disallowed-tools') + 1], 'read_file,search_tool,use_tool');
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
  for (const flag of ['--no-subagents', '--disable-web-search', '--no-leader', '--no-memory', '--no-auto-update', '--verbatim']) assert.ok(args.includes(flag));
  for (const forbidden of ['--always-approve', 'bypassPermissions', '--continue', '--resume', '--sandbox']) assert.ok(!args.includes(forbidden));
  for (const deny of ['Bash', 'Read', 'Grep', 'Edit', 'Write', 'MCPTool', 'WebSearch', 'WebFetch']) {
    assert.ok(args.some((value, i) => value === '--deny' && args[i + 1] === deny));
  }
  assert.equal(config.shell, false);
  assert.deepEqual(config.stdio, ['ignore', 'pipe', 'pipe']);
  f.ready(); f.send({type: 'text', data: '仅根据已提供的记忆整理。'}); f.end();
  assert.equal((await f.finished).status, 'completed');
});

test('only public text survives thought, usage, signatures, metadata, and raw output', async t => {
  const f = fixture(t);
  f.ready();
  for (const type of ['thought', 'usage', 'plan', 'user_message_chunk', 'unknown-future-event']) {
    f.send({type, data: 'PRIVATE_INTERNAL', signature: 'PRIVATE_SIGNATURE', content: 'RAW_OUTPUT'});
  }
  const bytes = Buffer.from(JSON.stringify({type: 'text', data: '方案草稿：保留原始依据。'}) + '\n');
  for (let i = 0; i < bytes.length; i += 2) f.child.stdout.write(bytes.subarray(i, i + 2));
  f.child.stderr.write('debug raw log PRIVATE_INTERNAL\n');
  f.end();
  const result = await f.finished;
  assert.equal(result.text, '方案草稿：保留原始依据。');
  assert.doesNotMatch(JSON.stringify([f.events, result]), /PRIVATE|RAW_OUTPUT|signature/);
  assert.equal(result.status, 'completed');
});

test('a nonempty tool list stops the run even when it later becomes empty', async t => {
  const f = fixture(t);
  f.send({type: 'available_commands', tools: ['read_file'], commands: []});
  f.ready(); f.send({type: 'text', data: 'must not surface'});
  const result = await f.finished;
  assert.equal(result.errorCode, 'TOOLS_NOT_DISABLED');
  assert.equal(result.text, '');
  assert.ok(f.child.signals.includes('SIGTERM'));
});

test('missing tool verification or missing tools field is never silently accepted', async t => {
  for (const value of [{type: 'text', data: 'unverified'}, {type: 'available_commands', commands: []}]) {
    const f = fixture(t);
    f.send(value);
    const result = await f.finished;
    assert.equal(result.status, 'failed');
    assert.ok(['TOOLS_UNVERIFIED', 'TOOLS_NOT_DISABLED'].includes(result.errorCode));
    assert.equal(result.text, '');
  }
});

test('tool events are blocked without returning their raw arguments, output, or title', async t => {
  const f = fixture(t);
  f.ready();
  f.send({type: 'tool_call', toolCallId: 'PRIVATE_ID', title: 'PRIVATE_TITLE', rawInput: {password: 'SYNTHETIC_PRIVATE'}, rawOutput: 'PRIVATE_OUTPUT', content: [{text: 'PRIVATE_TEXT'}]});
  const result = await f.finished;
  assert.equal(result.errorCode, 'TOOL_NOT_ALLOWED');
  assert.doesNotMatch(JSON.stringify([f.events, result]), /PRIVATE|password|rawInput|rawOutput/);
  assert.deepEqual(f.events.find(value => value.type === 'tool'), {type: 'tool', id: 'blocked-tool', title: '未允许的工具调用', status: 'blocked'});
});

test('edit mode is explicitly unsupported and never launches a process', async t => {
  const f = fixture(t, {mode: 'edit'});
  assert.equal(f.launch, undefined);
  assert.equal((await f.finished).errorCode, 'EDIT_NOT_SUPPORTED');
});

test('prompt path must be a regular contained file', async t => {
  const f = fixture(t, {promptFile: '/not-the-job-directory/prompt.txt'});
  assert.equal(f.launch, undefined);
  assert.equal((await f.finished).errorCode, 'INVALID_REQUEST');
});

test('cancel stops only the started process and finishes once', async t => {
  const f = fixture(t);
  f.ready();
  f.handle.cancel(); f.handle.cancel();
  const result = await f.finished;
  f.child.emit('error', new Error('PRIVATE_PROCESS_ERROR'));
  f.child.emit('close', 0);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.errorCode, 'CANCELLED');
  assert.equal(f.results.length, 1);
  assert.equal(f.child.signals.filter(value => value === 'SIGTERM').length, 1);
});

test('timeout escalates to kill and remains distinguishable from user cancellation', async t => {
  const hold = setTimeout(() => {}, 200);
  t.after(() => clearTimeout(hold));
  const f = fixture(t, {timeoutMs: 10, ignoreKill: true});
  const result = await f.finished;
  assert.equal(result.status, 'timed_out');
  assert.equal(result.errorCode, 'TIMED_OUT');
  assert.deepEqual(f.child.signals, ['SIGTERM', 'SIGKILL']);
});

test('oversized public text or unterminated JSON lines stop with bounded output', async t => {
  const f = fixture(t);
  f.ready(); f.send({type: 'text', data: 'a'.repeat(70_000)});
  assert.equal((await f.finished).errorCode, 'OUTPUT_LIMIT');
  assert.equal(f.events.filter(value => value.type === 'text').length, 0);
  const g = fixture(t);
  g.child.stdout.write('x'.repeat(270_000));
  assert.equal((await g.finished).errorCode, 'OUTPUT_LIMIT');
});

test('exit zero without completed final marker does not count as success', async t => {
  for (const stopReason of ['max_tokens', 'cancelled', undefined]) {
    const f = fixture(t);
    f.ready(); f.send({type: 'text', data: 'partial'});
    if (stopReason) f.send({type: 'end', stopReason});
    f.child.emit('close', 0);
    assert.equal((await f.finished).errorCode, 'INCOMPLETE_RESPONSE');
  }
});

test('process, authentication, and malformed stream failures disclose fixed messages only', async t => {
  const f = fixture(t);
  f.send({type: 'error', message: 'Not authenticated: PRIVATE_DETAILS'});
  f.child.emit('close', 1);
  const auth = await f.finished;
  assert.equal(auth.errorCode, 'AUTH_REQUIRED');
  assert.doesNotMatch(JSON.stringify(auth), /PRIVATE_DETAILS/);
  const g = fixture(t);
  g.child.emit('error', Object.assign(new Error('PRIVATE_PATH'), {code: 'ENOENT'}));
  assert.equal((await g.finished).errorCode, 'GROK_NOT_FOUND');
  const h = fixture(t);
  h.child.stdout.write('PRIVATE_BROKEN_JSON\n');
  assert.equal((await h.finished).errorCode, 'INVALID_STREAM');
  assert.doesNotMatch(JSON.stringify(h.events), /PRIVATE_BROKEN_JSON/);
});

test('nonfatal CLI diagnostics do not erase a completed zero-exit response', async t => {
  const f = fixture(t);
  f.ready(); f.child.stderr.write('background operation not permitted');
  f.send({type: 'text', data: '公开方案'}); f.end();
  assert.equal((await f.finished).status, 'completed');
  const g = fixture(t);
  g.ready(); g.send({type: 'text', data: 'partial'});
  g.send({type: 'error', message: 'synthetic provider failure'}); g.end();
  assert.equal((await g.finished).status, 'failed');
});

test('discovery reads only the executable version and returns no raw diagnostics', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-grok-version-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const executable = path.join(directory, 'grok');
  fs.writeFileSync(executable, `#!${process.execPath}\nprocess.stdout.write('grok 9.8.7 (synthetic) [stable]\\n');\n`, {mode: 0o700});
  const found = await detectGrok({env: {HOME: directory, PATH: directory}});
  assert.equal(found.available, true);
  assert.equal(found.version, '9.8.7');
  assert.equal(found.executable, executable);
  const missing = await detectGrok({env: {HOME: directory, PATH: '/missing/synthetic/directory'}});
  assert.deepEqual({...missing, message: ''}, {available: false, executable: null, version: null, message: ''});
});
