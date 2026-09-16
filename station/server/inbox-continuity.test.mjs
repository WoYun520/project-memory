import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createBundle, hash} from './core.mjs';
import {createInbox} from './inbox.mjs';
import {importWorklog} from './worklog.mjs';

// All requests and failure fixtures belong to a disposable service and data directory.
async function station(t) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-continuity-'));
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  let child, closed;
  async function stop() {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    if (closed) await closed;
  }
  async function start() {
    child = spawn(process.execPath, [fileURLToPath(new URL('./index.mjs', import.meta.url))], {
      env: {...process.env, MEMORY_STATION_DATA_DIR: data, MEMORY_STATION_PORT: String(port), MEMORY_STATION_EMPTY: '1'},
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    closed = once(child, 'close');
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('合成服务启动超时')), 10000);
      child.stdout.on('data', chunk => {
        if (chunk.toString().includes('记忆站：http')) { clearTimeout(timer); resolve(); }
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(Error(`合成服务退出 ${code}: ${stderr}`)); });
    });
  }
  t.after(async () => { await stop(); fs.rmSync(data, {recursive: true, force: true}); });
  await start();
  async function request(route, input) {
    const response = await fetch(`http://127.0.0.1:${port}/api${route}`, {
      method: input === undefined ? 'GET' : 'POST',
      headers: {'Content-Type': 'application/json', 'X-Memory-Station': '1'},
      ...(input === undefined ? {} : {body: JSON.stringify(input)}),
      signal: AbortSignal.timeout(10000),
    });
    return {status: response.status, value: await response.json()};
  }
  async function project(name = '合成收件连续性测试') {
    const result = await request('/projects', {name, goal: '', reviewed: true});
    assert.equal(result.status, 201);
    return result.value;
  }
  return {data, request, project, restart: async () => { await stop(); await start(); }};
}

function worklog(archive, session = 'synthetic-session') {
  return {
    format: 'project-memory-worklog', version: '0.1', project_id: archive.bundle.project.id,
    session: {id: session, agent: '合成审计 AI'},
    entries: [{id: 'one', kind: 'fact', title: '合成记录', detail: '仅用于隔离验证。', origin: 'observation',
      source: {speaker: {kind: 'agent', id: '合成审计 AI'}, text: '合成依据，未读取真实项目。'}}],
  };
}
const projectPath = (f, archive) => path.join(f.data, archive.bundle.project.id, 'project.json');
const draftPath = (f, archive) => path.join(f.data, 'inbox', archive.bundle.project.id + '.json');
const stage = (f, work) => f.request(`/projects/${work.project_id}/work-stage`, {worklog: work, sourceReviewed: true});
const importInput = (archive, draft) => ({worklog: draft.worklog, draftId: draft.id, selected_ids: ['one'], reviewed: true,
  revision: archive.revision, andHandoff: true, handoffReviewed: true});

test('HTTP 并发重试只接收同一批一次；不同 AI 提交不覆盖，重启后保留原回执', async t => {
  const f = await station(t), a = await f.project(), work = worklog(a), before = fs.readFileSync(projectPath(f, a));
  const same = await Promise.all(Array.from({length: 12}, () => stage(f, work)));
  assert.ok(same.every(result => result.status === 200));
  assert.equal(new Set(same.map(result => result.value.id)).size, 1);
  const original = fs.readFileSync(draftPath(f, a));
  const different = await Promise.all(Array.from({length: 8}, (_, i) => stage(f, worklog(a, 'other-ai-' + i))));
  for (const result of different) { assert.equal(result.status, 400); assert.match(result.value.error, /已有.*等待检查.*不会覆盖/); }
  assert.deepEqual(fs.readFileSync(draftPath(f, a)), original);
  assert.deepEqual(fs.readFileSync(projectPath(f, a)), before);
  await f.restart();
  assert.deepEqual((await stage(f, work)).value, same[0].value);
  assert.deepEqual(fs.readFileSync(draftPath(f, a)), original);
  assert.deepEqual(fs.readFileSync(projectPath(f, a)), before);
  const b = await f.project('第二个合成项目'), c = await f.project('第三个合成项目');
  const isolated = await Promise.all([stage(f, worklog(b, 'second-ai')), stage(f, worklog(c, 'third-ai'))]);
  assert.ok(isolated.every(result => result.status === 200));
  assert.notEqual(isolated[0].value.id, isolated[1].value.id);
});

test('提交前文件写入失败保留正式档案和草稿，重启修复阻碍后可重试同一批', async t => {
  const f = await station(t), a = await f.project(), work = worklog(a), staged = await stage(f, work), draft = staged.value;
  const before = fs.readFileSync(projectPath(f, a)), pendingBefore = fs.readFileSync(draftPath(f, a));
  const blockedHistory = path.join(f.data, a.bundle.project.id, 'history');
  fs.writeFileSync(blockedHistory, '合成写入故障：历史目录被普通文件占用。');
  const failed = await f.request(`/projects/${work.project_id}/work-import`, importInput(a, draft));
  assert.equal(failed.status, 400);
  assert.deepEqual(fs.readFileSync(projectPath(f, a)), before);
  assert.deepEqual(fs.readFileSync(draftPath(f, a)), pendingBefore);
  await f.restart();
  assert.deepEqual((await f.request(`/projects/${work.project_id}/inbox`)).value.draft, draft);
  fs.unlinkSync(blockedHistory);
  const retried = await f.request(`/projects/${work.project_id}/work-import`, importInput(a, draft));
  assert.equal(retried.status, 200);
  assert.equal(retried.value.added, 1);
  assert.equal(retried.value.archive.revision, a.revision + 1);
  assert.equal(retried.value.archive.bundle.memories.length, 1);
  assert.equal((await f.request(`/projects/${work.project_id}/inbox`)).value.draft, null);
  assert.equal((await stage(f, work)).value.alreadyImported, true);
});

test('损坏草稿在 HTTP 与总览中明确报错，重启和新提交均保留原文件及正式记忆', async t => {
  const f = await station(t), a = await f.project(), work = worklog(a);
  await stage(f, work);
  const before = fs.readFileSync(projectPath(f, a)), corrupt = '{"synthetic-interrupted-draft":';
  fs.writeFileSync(draftPath(f, a), corrupt);
  for (let attempt = 0; attempt < 2; attempt++) {
    const inbox = await f.request(`/projects/${work.project_id}/inbox`);
    assert.equal(inbox.status, 400);
    assert.match(inbox.value.error, /无法读取.*保留原文件.*不会覆盖/);
    const retry = await stage(f, worklog(a, 'next-ai'));
    assert.equal(retry.status, 400);
    assert.match(retry.value.error, /保留原文件/);
    const overview = await f.request('/overview');
    assert.equal(overview.status, 200);
    assert.match(overview.value.projects.find(p => p.id === work.project_id).inbox.error, /原文件已保留/);
    assert.deepEqual(fs.readFileSync(projectPath(f, a)), before);
    assert.equal(fs.readFileSync(draftPath(f, a), 'utf8'), corrupt);
    if (attempt === 0) await f.restart();
  }
});

test('旧交接文件异常在正式提交前拒绝，保留档案与草稿，修复后同批重试成功', async t => {
  const f = await station(t), a = await f.project(), work = worklog(a), staged = await stage(f, work);
  const before = fs.readFileSync(projectPath(f, a)), pendingBefore = fs.readFileSync(draftPath(f, a));
  const handoff = path.join(f.data, a.bundle.project.id, 'handoff.md');
  fs.mkdirSync(handoff);
  const failed = await f.request(`/projects/${work.project_id}/work-import`, importInput(a, staged.value));
  assert.equal(failed.status, 400);
  assert.match(failed.value.error, /旧交接文件无法更新.*尚未保存/);
  assert.doesNotMatch(failed.value.error, /EISDIR|rename|\/var\//);
  assert.deepEqual(fs.readFileSync(projectPath(f, a)), before);
  assert.deepEqual(fs.readFileSync(draftPath(f, a)), pendingBefore);
  assert.deepEqual((await f.request(`/projects/${work.project_id}/inbox`)).value.draft, staged.value);
  fs.rmdirSync(handoff);
  const retried = await f.request(`/projects/${work.project_id}/work-import`, importInput(a, staged.value));
  assert.equal(retried.status, 200);
  assert.equal(retried.value.added, 1);
  assert.equal(retried.value.archive.revision, a.revision + 1);
  assert.equal(retried.value.archive.bundle.memories.length, 1);
  assert.equal((await f.request(`/projects/${work.project_id}/inbox`)).value.draft, null);
  assert.ok(fs.readFileSync(handoff, 'utf8').includes('合成记录'));
});

function diskInbox(t, archive) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-held-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  return {directory, loadArchive: () => archive};
}

test('正式提交回执优先于清理权限错误，重启仍不把已处理批次误报为待检查或损坏', t => {
  const a = createBundle('合成清理权限测试', ''), config = diskInbox(t, a), work = worklog(a);
  const box = createInbox(config), draft = box.stage(a, {worklog: work, sourceReviewed: true});
  const target = path.join(config.directory, work.project_id + '.json'), before = fs.readFileSync(target);
  const committed = importWorklog(a, {worklog: work, selected_ids: ['one'], reviewed: true}).archive;
  committed.inbox_receipts = [{id: draft.id, at: new Date().toISOString()}];
  config.loadArchive = () => committed;
  const unlink = fs.unlinkSync;
  const denied = t.mock.method(fs, 'unlinkSync', filename => {
    if (filename === target) throw Object.assign(Error('合成清理拒绝'), {code: 'EACCES'});
    return unlink(filename);
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const reopened = createInbox(config);
    assert.equal(reopened.get(work.project_id), null);
    assert.doesNotThrow(() => reopened.consume(work.project_id, draft.id));
    assert.deepEqual(fs.readFileSync(target), before);
  }
  denied.mock.restore();
  assert.equal(createInbox(config).get(work.project_id), null);
  assert.equal(fs.existsSync(target), false);
});

for (const persistent of [false, true]) test(`${persistent ? '持久' : '内存'}暂存可恢复且不改正式记忆；旧操作重试不会移动新批次`, t => {
  const a = createBundle('合成可逆暂存测试', ''), before = JSON.stringify(a), config = persistent ? diskInbox(t, a) : {};
  let box = createInbox(config);
  const first = box.stage(a, {worklog: worklog(a, 'first-ai'), sourceReviewed: true}), id = a.bundle.project.id;
  const original = persistent ? fs.readFileSync(path.join(config.directory, id + '.json')) : null;
  const heldResult = box.hold(id, first.id);
  assert.deepEqual(heldResult, {held: true, id: first.id, count: 1});
  assert.equal(box.get(id), null);
  const summary = box.listHeld(id)[0];
  assert.deepEqual(Object.keys(summary).sort(), ['count', 'id', 'receivedAt', 'session', 'titles']);
  assert.deepEqual(summary, {id: first.id, receivedAt: first.receivedAt, session: first.worklog.session, count: 1, titles: ['合成记录']});
  summary.session.agent = '修改返回副本';
  assert.equal(box.listHeld(id)[0].session.agent, '合成审计 AI');
  if (persistent) {
    const heldFile = path.join(config.directory, 'held', id, first.id + '.json');
    assert.deepEqual(fs.readFileSync(heldFile), original);
    assert.equal(fs.statSync(heldFile).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(path.join(config.directory, id + '.json')), false);
    box = createInbox(config);
    assert.deepEqual(box.listHeld(id)[0].session, first.worklog.session);
  }
  assert.deepEqual(box.hold(id, first.id), heldResult);
  const newer = box.stage(a, {worklog: worklog(a, 'newer-ai'), sourceReviewed: true});
  assert.deepEqual(box.hold(id, first.id), heldResult);
  assert.deepEqual(box.get(id), newer);
  assert.throws(() => box.hold(id, randomUUID()), /变化或不存在/);
  assert.throws(() => box.restore(id, first.id), /已有.*不会覆盖/);
  assert.deepEqual(box.get(id), newer);
  box.hold(id, newer.id);
  assert.equal(box.listHeld(id).length, 2);
  const restored = box.restore(id, first.id);
  assert.deepEqual(restored, {restored: true, draft: first});
  assert.deepEqual(box.get(id), first);
  assert.deepEqual(box.listHeld(id).map(draft => draft.id), [newer.id]);
  assert.throws(() => box.restore(id, first.id), /已有.*不会覆盖/);
  if (persistent) assert.deepEqual(fs.readFileSync(path.join(config.directory, id + '.json')), original);
  assert.equal(JSON.stringify(a), before);
});

test('暂存和恢复的原子移动失败保留源文件，重试不变更原文、编号和接收时间', t => {
  const a = createBundle('合成移动故障测试', ''), config = diskInbox(t, a), box = createInbox(config), id = a.bundle.project.id;
  const draft = box.stage(a, {worklog: worklog(a), sourceReviewed: true});
  const pendingFile = path.join(config.directory, id + '.json'), heldFile = path.join(config.directory, 'held', id, draft.id + '.json');
  const bytes = fs.readFileSync(pendingFile), rename = fs.renameSync;
  let blockedSource = pendingFile;
  const denied = t.mock.method(fs, 'renameSync', (source, target) => {
    if (source === blockedSource) throw Object.assign(Error('合成移动拒绝'), {code: 'EACCES'});
    return rename(source, target);
  });
  assert.throws(() => box.hold(id, draft.id), /暂存未完成.*已保留在待检查区/);
  assert.deepEqual(fs.readFileSync(pendingFile), bytes);
  assert.equal(fs.existsSync(heldFile), false);
  blockedSource = null;
  box.hold(id, draft.id);
  blockedSource = heldFile;
  assert.throws(() => box.restore(id, draft.id), /恢复未完成.*仍在暂存区/);
  assert.deepEqual(fs.readFileSync(heldFile), bytes);
  assert.equal(fs.existsSync(pendingFile), false);
  denied.mock.restore();
  assert.deepEqual(createInbox(config).restore(id, draft.id).draft, draft);
  assert.deepEqual(fs.readFileSync(pendingFile), bytes);
});

test('暂存区重新校验完整性与隐私，坏文件不会恢复或覆盖，项目之间互相隔离', t => {
  const a = createBundle('合成暂存校验测试', ''), other = createBundle('另一合成项目', ''), config = diskInbox(t, a);
  const box = createInbox(config), draft = box.stage(a, {worklog: worklog(a), sourceReviewed: true}), id = a.bundle.project.id;
  box.hold(id, draft.id);
  const filename = path.join(config.directory, 'held', id, draft.id + '.json'), original = fs.readFileSync(filename, 'utf8');
  assert.deepEqual(box.listHeld(other.bundle.project.id), []);
  assert.throws(() => box.restore(other.bundle.project.id, draft.id), /不存在/);
  for (const bad of ['incomplete', JSON.stringify({...draft, worklog: {...draft.worklog, entries: []}})]) {
    fs.writeFileSync(filename, bad);
    assert.throws(() => createInbox(config).listHeld(id), /暂存草稿.*无法读取|暂存草稿.*校验/);
    assert.throws(() => box.restore(id, draft.id), /暂存草稿.*无法读取|暂存草稿.*校验/);
    assert.equal(fs.readFileSync(filename, 'utf8'), bad);
    assert.equal(box.get(id), null);
  }
  const unsafe = JSON.parse(original);
  unsafe.worklog.entries[0].source.text = 'password: synthetic-only';
  unsafe.fingerprint = hash(JSON.stringify(unsafe.worklog));
  const unsafeBytes = JSON.stringify(unsafe);
  fs.writeFileSync(filename, unsafeBytes);
  assert.throws(() => box.listHeld(id), /校验未通过/);
  assert.throws(() => box.restore(id, draft.id), /校验未通过/);
  assert.equal(fs.readFileSync(filename, 'utf8'), unsafeBytes);
  assert.equal(box.get(id), null);
  fs.writeFileSync(filename, original);
  assert.deepEqual(box.restore(id, draft.id).draft, draft);
});

test('HTTP 冲突或已被另一页面保存的整批记录可暂存退出，恢复与旧请求重试不覆盖后来批次', async t => {
  const f = await station(t), a = await f.project(), work = worklog(a), id = work.project_id;
  const firstSave = await f.request(`/projects/${id}/work-import`, {worklog: work, selected_ids: ['one'], reviewed: true, revision: a.revision});
  assert.equal(firstSave.status, 200);
  work.entries[0].detail = '同编号但不同的合成内容。';
  const conflict = await stage(f, work);
  const preview = await f.request(`/projects/${id}/work-preview`, {worklog: work, revision: firstSave.value.archive.revision});
  assert.equal(preview.value.entries[0].status, 'conflict');
  const before = fs.readFileSync(projectPath(f, a)), originalDraft = fs.readFileSync(draftPath(f, a));
  const held = await f.request(`/projects/${id}/inbox-hold`, {draftId: conflict.value.id});
  assert.deepEqual(held, {status: 200, value: {held: true, id: conflict.value.id, count: 1}});
  assert.equal((await f.request(`/projects/${id}/inbox`)).value.draft, null);
  const heldList = await f.request(`/projects/${id}/inbox-held`);
  assert.equal(heldList.status, 200);
  assert.equal(heldList.value.drafts.length, 1);
  assert.deepEqual(Object.keys(heldList.value.drafts[0]).sort(), ['count', 'id', 'receivedAt', 'session', 'titles']);
  const newer = await stage(f, worklog(a, 'later-ai'));
  assert.equal(newer.status, 200);
  assert.deepEqual(await f.request(`/projects/${id}/inbox-hold`, {draftId: conflict.value.id}), held);
  assert.deepEqual((await f.request(`/projects/${id}/inbox`)).value.draft, newer.value);
  const blocked = await f.request(`/projects/${id}/inbox-restore`, {draftId: conflict.value.id});
  assert.equal(blocked.status, 400);
  assert.match(blocked.value.error, /已有.*不会覆盖/);
  assert.equal((await f.request(`/projects/${id}/inbox-hold`, {draftId: newer.value.id})).status, 200);
  await f.restart();
  const restored = await f.request(`/projects/${id}/inbox-restore`, {draftId: conflict.value.id});
  assert.deepEqual(restored, {status: 200, value: {restored: true, draft: conflict.value}});
  assert.deepEqual(fs.readFileSync(draftPath(f, a)), originalDraft);
  assert.deepEqual(fs.readFileSync(projectPath(f, a)), before);

  const b = await f.project('合成双页面重复批次'), duplicateWork = worklog(b), bid = duplicateWork.project_id;
  const duplicate = await stage(f, duplicateWork);
  const manual = await f.request(`/projects/${bid}/work-import`, {worklog: duplicateWork, selected_ids: ['one'], reviewed: true, revision: b.revision});
  assert.equal(manual.status, 200);
  const duplicatePreview = await f.request(`/projects/${bid}/work-preview`, {worklog: duplicateWork, revision: manual.value.archive.revision});
  assert.equal(duplicatePreview.value.entries[0].status, 'duplicate');
  const duplicateBefore = fs.readFileSync(projectPath(f, b));
  assert.equal((await f.request(`/projects/${bid}/inbox-hold`, {draftId: duplicate.value.id})).status, 200);
  assert.equal((await f.request(`/projects/${bid}/inbox`)).value.draft, null);
  assert.equal((await f.request(`/projects/${bid}/inbox-held`)).value.drafts[0].id, duplicate.value.id);
  assert.deepEqual(fs.readFileSync(projectPath(f, b)), duplicateBefore);
});

test('正式提交后的交接附件生成失败仍报告保存成功，修复附件后只需重新生成交接', async t => {
  const f = await station(t), a = await f.project(), work = worklog(a), staged = await stage(f, work), id = work.project_id;
  const guide = path.join(f.data, id, 'agent-guide.md');
  fs.mkdirSync(guide);
  const result = await f.request(`/projects/${id}/work-import`, importInput(a, staged.value));
  assert.equal(result.status, 200);
  assert.equal(result.value.added, 1);
  assert.match(result.value.handoffError, /记录已保存.*交接文件生成失败/);
  assert.equal(result.value.archive.revision, a.revision + 1);
  assert.equal((await f.request(`/projects/${id}/inbox`)).value.draft, null);
  const committed = fs.readFileSync(projectPath(f, a));
  fs.rmdirSync(guide);
  const handoff = await f.request(`/projects/${id}/handoff`, {revision: result.value.archive.revision, reviewed: true});
  assert.equal(handoff.status, 200);
  assert.equal(handoff.value.revision, result.value.archive.revision);
  assert.deepEqual(fs.readFileSync(projectPath(f, a)), committed);
  assert.ok(fs.statSync(guide).isFile());
});
