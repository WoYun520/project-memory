import test from 'node:test';
import assert from 'node:assert/strict';
import {appendMemory, compile, createBundle, reviewMemory, validateArchive} from './core.mjs';
import {previewContext, renderContext} from './context.mjs';

const make = () => createBundle('虚构交接项目', '帮助接手者理解既有目标。');
const add = (archive, overrides = {}) => appendMemory(archive, {
  kind: 'fact', title: '虚构记录', detail: '仅供开发核查的合成内容。', source: '合成资料原文，第一行。\n第二行保持原样。', reviewed: true, ...overrides,
});
const options = memoryIds => ({mode: 'focused', task: '处理首页布局', memoryIds});

test('手动空选择仍保留当前目标与要求，不把待确认要求变成生效约束', () => {
  const archive = make();
  const requirement = add(archive, {kind: 'constraint', title: '用户边界', detail: '只操作合成资料。', confirmed: true});
  const proposed = add(archive, {kind: 'constraint', title: '可考虑的要求', detail: '考虑使用简洁配色。', inference: true});
  const unrelated = add(archive, {title: '无关说明'});
  const before = JSON.stringify(archive);
  const preview = previewContext(archive, options([]));
  assert.deepEqual(new Set(preview.memoryIds), new Set([archive.bundle.memories[0].id, requirement.id, proposed.id]));
  assert.ok(!preview.memoryIds.includes(unrelated.id));
  assert.equal(preview.omittedCount, 1);
  assert.equal(preview.selectionMethod, 'manual_with_required_and_dependencies');
  assert.ok(preview.reasons.every(item => item.reasonCodes.includes('required')));
  const markdown = renderContext(archive, options([]));
  assert.match(markdown, /这是待确认建议，不能作为生效指令/);
  assert.match(markdown, /尚未核验/);
  assert.equal(JSON.stringify(archive), before);
  assert.equal(archive.bundle.memories.find(m => m.id === proposed.id).data.stage, 'proposed');
});

test('闭包保留错误与纠正、冲突双方、修订前后和关联进度，来源逐字保留', () => {
  const archive = make();
  const correction = add(archive, {kind: 'attempt', title: '纠正操作', detail: '恢复合成按钮排列。', conditions: '虚构桌面布局', result: '布局恢复', outcome: 'succeeded'});
  const error = add(archive, {kind: 'attempt', title: '过去的布局错误', detail: '改变按钮排列。', conditions: '虚构窄屏布局', result: '按钮相互遮挡', outcome: 'failed', mistake: '疑似没有考虑宽度', correction_id: correction.id});
  const old = add(archive, {kind: 'decision', title: '旧布局建议', detail: '使用单列。'});
  const target = add(archive, {kind: 'decision', title: '当前首页建议', detail: '考虑两列。', replaces: old.id});
  const conflicting = add(archive, {kind: 'decision', title: '另一种建议', detail: '仍考虑单列。'});
  target.related_ids = [error.id];
  reviewMemory(archive, target.id, 'conflict', conflicting.id);
  reviewMemory(archive, error.id, 'stale');
  const state = add(archive, {kind: 'state', title: '建议实施进度', detail: '还在比较。', subject_id: target.id});
  const other = add(archive, {title: '无关说明', detail: '有关合成字体的记录。'});
  const before = JSON.stringify(archive);
  const preview = previewContext(archive, options([target.id]));
  for (const memory of [old, target, conflicting, error, correction, state]) assert.ok(preview.memoryIds.includes(memory.id), memory.claim);
  assert.ok(!preview.memoryIds.includes(other.id));
  assert.ok(preview.reasons.find(item => item.memoryId === correction.id).reasonCodes.includes('dependency'));
  const markdown = renderContext(archive, options([target.id]), {readonlyTest: true});
  assert.match(markdown, /存在冲突/);
  assert.match(markdown, /需要复核/);
  assert.match(markdown, /生命周期：superseded/);
  assert.match(markdown, /suspected/);
  assert.match(markdown, /本次为只读测试/);
  for (const id of preview.evidenceIds) {
    const source = archive.bundle.evidence.find(e => e.id === id);
    assert.ok(markdown.includes(archive.snapshots[source.snapshot.path].split('\n').map(line => '> ' + line).join('\n')));
    assert.ok(markdown.includes(source.snapshot.sha256));
  }
  assert.equal(JSON.stringify(archive), before);
});

test('从纠正或旧版本反向进入时仍携带原始错误和最新替代记录', () => {
  const archive = make();
  const correction = add(archive, {kind: 'attempt', title: '纠正尝试', conditions: '虚构条件', result: '观察待核查'});
  const original = add(archive, {kind: 'attempt', title: '原始失败', conditions: '虚构条件', result: '未成功', mistake: '疑似错误', correction_id: correction.id});
  const old = add(archive, {kind: 'fact', title: '旧记录'});
  const next = add(archive, {kind: 'fact', title: '修订记录', replaces: old.id});
  next.related_ids = [original.id];
  const preview = previewContext(archive, options([correction.id]));
  for (const record of [original, old, next]) assert.ok(preview.memoryIds.includes(record.id));
  const task = add(archive, {kind: 'task', title: '关联任务'});
  task.data.goal_id = archive.bundle.memories[0].id;
  const taskPreview = previewContext(archive, options([task.id]));
  assert.ok(taskPreview.memoryIds.includes(task.data.goal_id));
});

test('核查、批准和原因专用依据也带入；Git 等定位和来源不可用保持明确', () => {
  const archive = make();
  const donor = add(archive, {title: '核查资料载体', source: '独立核查的合成原文。'});
  const extra = archive.bundle.evidence.find(e => e.id === donor.evidence[0].evidence_id);
  extra.kind = 'git';
  extra.locator = {repository: 'synthetic-repository', commit: 'synthetic-revision', path: 'layout.txt'};
  const approved = add(archive, {kind: 'decision', title: '合成选择', confirmed: true, checked: true, checkNote: '检查了合成记录', checker: {kind: 'tool', id: 'local-check'}});
  approved.verification.checks[0].evidence_ids = [extra.id];
  approved.approval.evidence_ids = [extra.id];
  const unavailable = structuredClone(extra);
  unavailable.id = 'unavailable-source';
  unavailable.availability = 'unavailable';
  delete unavailable.snapshot;
  archive.bundle.evidence.push(unavailable);
  const attempt = add(archive, {kind: 'attempt', title: '原因待定', conditions: '虚构环境', result: '原因尚不清楚'});
  attempt.data.cause = {status: 'suspected', explanation: '可能与排列有关', evidence_ids: [unavailable.id]};
  approved.related_ids = [attempt.id];
  assert.equal(validateArchive(archive), true);
  const preview = previewContext(archive, options([approved.id]));
  assert.ok(!preview.memoryIds.includes(donor.id));
  assert.ok(preview.evidenceIds.includes(extra.id));
  assert.ok(preview.evidenceIds.includes(unavailable.id));
  const markdown = renderContext(archive, options([approved.id]));
  assert.ok(markdown.includes('独立核查的合成原文。'));
  assert.ok(markdown.includes('synthetic-revision'));
  assert.ok(markdown.includes('layout.txt'));
  assert.match(markdown, /核查人：工具（local-check）/);
  assert.match(markdown, /来源不可用；未补写原文/);
  assert.match(markdown, /不等于用户确认/);
});

test('按中文文字匹配可解释且稳定，保留未核查项与待确认生命周期', () => {
  const archive = make();
  const chosen = add(archive, {title: '首页布局', detail: '首页目前只有合成内容。', speaker: {kind: 'agent', id: 'Synthetic-Agent'}, origin: 'inference'});
  chosen.lifecycle = 'proposed';
  chosen.verification.unknowns = ['移动界面尚未核查', '没有用户验收依据'];
  const other = add(archive, {title: '归档整理', detail: '清点虚构附件。'});
  const input = {mode: 'focused', task: '完善首页布局'};
  const first = previewContext(archive, input);
  assert.deepEqual(first, previewContext(archive, input));
  assert.ok(first.memoryIds.includes(chosen.id));
  assert.ok(!first.memoryIds.includes(other.id));
  assert.ok(first.reasons.find(item => item.memoryId === chosen.id).matchedTerms.includes('首页'));
  assert.equal(first.selectionMethod, 'keyword_and_recent');
  const markdown = renderContext(archive, input);
  assert.match(markdown, /生命周期：proposed/);
  assert.match(markdown, /来源：AI（Synthetic-Agent）/);
  assert.match(markdown, /整理或推断，不能视为用户原话/);
  assert.match(markdown, /移动界面尚未核查/);
  assert.match(markdown, /没有用户验收依据/);
  assert.ok(first.approximateLength > 0);
  assert.equal(first.lengthUnit, 'characters');
});

test('无匹配时明确使用最近记录，不编造任务相关性或缺失历史', () => {
  const archive = make();
  const records = [];
  for (let i = 0; i < 8; i++) {
    const record = add(archive, {title: `合成资料 ${i}`});
    record.as_of = record.recorded_at = `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`;
    records.push(record);
  }
  const input = {mode: 'focused', task: '调查 zebra'};
  const before = JSON.stringify(archive);
  const preview = previewContext(archive, input);
  assert.equal(preview.selectionMethod, 'recent_fallback');
  assert.deepEqual(preview.memoryIds, [archive.bundle.memories[0].id, ...records.slice(3).map(m => m.id)]);
  assert.equal(preview.omittedCount, 3);
  assert.ok(preview.warnings.some(warning => warning.includes('没有找到任务文字匹配')));
  assert.match(renderContext(archive, input), /未带上的内容不能据此认定为不存在/);
  assert.equal(JSON.stringify(archive), before);
});

test('完整模式沿用现有交接，拒绝凭据、坏编号与无效任务且不改动项目', () => {
  const archive = make();
  add(archive, {title: '历史合成条目'});
  const stripTime = text => text.replace(/生成时间：[^\n]+/, '生成时间：');
  assert.equal(stripTime(renderContext(archive, {mode: 'full', task: '继续'})), stripTime(compile(archive, '继续')));
  assert.equal(previewContext(archive, {mode: 'full'}).omittedCount, 0);
  const before = JSON.stringify(archive);
  for (const options of [
    {task: ''}, {task: 'x'.repeat(2001)}, {task: 12}, {mode: 'guess'}, {memoryIds: ['missing']}, {memoryIds: 'bad'},
    {task: 'password: synthetic-not-a-real-credential'},
  ]) assert.throws(() => previewContext(archive, options));
  assert.equal(JSON.stringify(archive), before);
  archive.snapshots[Object.keys(archive.snapshots)[0]] += '\nchanged';
  assert.throws(() => renderContext(archive, {mode: 'focused'}), /改动/);
});

test('完整和聚焦交接逐条区分用户来源、人工确认范围与独立核查未知', () => {
  const archive = make();
  const humanProposal = add(archive, {kind: 'constraint', title: '用户陈述中的候选要求', detail: '考虑保留合成首页。', source: '用户：可以保留这个建议，具体做法再讨论。'});
  const checked = add(archive, {kind: 'fact', title: '已有工具观察', recorder: {kind: 'agent', id: 'Synthetic-Agent'}, checker: {kind: 'tool', id: 'Synthetic-Tool'}, checked: true, checkNote: '检查了合成结果。'});
  const approved = add(archive, {kind: 'decision', title: '范围明确的选择', detail: '选用合成页面。', reason: '用于合成展示。', confirmed: true, source: '用户：确认选择合成页面，其他范围没有确认。'});
  approved.approval.fields = ['/data/choice'];
  const historical = add(archive, {title: '历史人工陈述'});reviewMemory(archive, historical.id, 'archive');
  approved.related_ids = [historical.id];
  const before = JSON.stringify(archive);
  const memoryBlock = (markdown, id) => markdown.split(`编号：${id}\n`)[1].split(/\n#{2,3} /)[0];
  for (const mode of ['full', 'focused']) {
    const input = {mode, task: '处理首页布局', memoryIds: [humanProposal.id, checked.id, approved.id]};
    const preview = previewContext(archive, input),out = renderContext(archive, input);
    for (const memory of archive.bundle.memories) {
      assert.ok(preview.memoryIds.includes(memory.id));
      const block = memoryBlock(out, memory.id);
      if (!memory.approval) assert.match(block,/^用户确认：未记录用户确认。$/m);
    }
    const proposalBlock = memoryBlock(out, humanProposal.id);
    assert.match(proposalBlock,/来源性质：用户陈述/);
    assert.match(proposalBlock,/生命周期：accepted（已收入档案，不表示用户采纳、确认或核验）/);
    assert.match(proposalBlock,/这是待确认建议，不能作为生效指令/);
    const approvedBlock = memoryBlock(out, approved.id);
    assert.match(approvedBlock,/用户确认：已记录用户确认/);
    assert.match(approvedBlock,/确认范围：\/data\/choice；确认依据：/);
    assert.match(approvedBlock,/档案核查状态：unverified/);
    assert.match(approvedBlock,/独立核查：未记录独立核查依据/);
    const checkedBlock = memoryBlock(out, checked.id);
    assert.match(checkedBlock,/核查人：工具（Synthetic-Tool）/);
    assert.match(checkedBlock,/独立核查：现有字段未记录核查独立性/);
    for (const source of archive.bundle.evidence) assert.ok(out.includes(archive.snapshots[source.snapshot.path].split('\n').map(line => '> ' + line).join('\n')));
    assert.equal(JSON.stringify(archive), before);
  }
});
