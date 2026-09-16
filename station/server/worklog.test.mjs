import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createBundle,validateArchive,compile} from './core.mjs';
import {previewWorklog,importWorklog} from './worklog.mjs';
import {parseWorklogText} from '../shared/worklog.js';
import {createInbox} from './inbox.mjs';
const make=()=>createBundle('测试项目','工作记录测试');
const entry=(id,extra={})=>({id,kind:'fact',title:'工作结果 '+id,detail:'合成测试观察',origin:'observation',source:{speaker:{kind:'agent',id:'测试 AI'},text:'  合成原始记录\n保留换行\n'},...extra});
const work=(a,entries)=>({format:'project-memory-worklog',version:'0.1',project_id:a.bundle.project.id,session:{id:'work-session-1',agent:'测试 AI'},entries});
const save=(a,w,ids=w.entries.map(e=>e.id),extra={})=>importWorklog(a,{worklog:w,selected_ids:ids,reviewed:true,...extra});
test('预览不写入；所选项批量保存，编辑主张不覆盖原始依据，不选项不保存',()=>{
 const a=make(),before=JSON.stringify(a),w=work(a,[entry('a'),entry('b')]);assert.equal(previewWorklog(a,w).entries.length,2);assert.equal(JSON.stringify(a),before);
 const r=save(a,w,['a'],{edits:{a:{detail:'经预览调整的表述'}},reviewer:{kind:'agent',id:'核对 AI'}});assert.equal(JSON.stringify(a),before);assert.equal(r.added,1);assert.equal(r.archive.bundle.evidence.at(-1).privacy.reviewed_by.kind,'agent');assert.ok(!r.archive.bundle.evidence.at(-1).note.includes('用户在预览'));assert.ok(r.archive.bundle.evidence.at(-1).note.includes('不表示用户确认'));assert.equal(r.archive.bundle.memories.at(-1).data.statement,'经预览调整的表述');assert.equal(Object.values(r.archive.snapshots).at(-1),w.entries[0].source.text);assert.equal(r.archive.work_imports.length,1);assert.ok(!JSON.stringify(r.archive).includes('工作结果 b'));
});
test('AI 批准字段拒绝；完成、错误和建议不自动变成已核验或用户确认',()=>{
 const a=make();assert.throws(()=>previewWorklog(a,work(a,[entry('bad',{confirmed:true})])),/格式/);
 const w=work(a,[entry('done',{kind:'state',stage:'completed',check_note:'AI 报告测试通过'}),entry('choice',{kind:'decision'}),entry('error',{kind:'attempt',conditions:'测试条件',result:'失败',outcome:'failed',mistake:'可能改错配置'})]);const r=save(a,w).archive;
 for(const m of r.bundle.memories.slice(-3)){assert.equal(m.verification.status,'unverified');assert.equal(m.approval,undefined);}
 assert.equal(r.bundle.memories.at(-3).data.stage,'awaiting_validation');assert.equal(r.bundle.memories.at(-2).data.stage,'proposed');assert.equal(r.bundle.memories.at(-1).data.mistake.status,'suspected');assert.ok(compile(r).includes('报告的核查说明（未核验）'));
});
test('重试与备份恢复保留去重；相同编号不同内容拒绝覆盖',()=>{
 const a=make(),w=work(a,[entry('a')]);const first=save(a,w).archive,restored=JSON.parse(JSON.stringify(first));assert.equal(validateArchive(restored),true);
 const retry=save(restored,w);assert.equal(retry.added,0);assert.equal(retry.skipped,1);assert.equal(retry.archive.bundle.memories.length,first.bundle.memories.length);
 const changed=structuredClone(w);changed.entries[0].detail='新内容';assert.equal(previewWorklog(restored,changed).entries[0].status,'conflict');assert.throws(()=>save(restored,changed),/编号/);
});
test('跨项目、隐私、重复编号拒绝；后条失败整批不写入',()=>{
 const a=make(),before=JSON.stringify(a);assert.throws(()=>previewWorklog(a,{...work(a,[entry('a')]),project_id:'other'}),/其他项目/);assert.throws(()=>previewWorklog(a,work(a,[entry('a'),entry('a')])),/重复/);
 assert.throws(()=>parseWorklogText(JSON.stringify(work(a,[entry('secret',{detail:'password: synthetic-test-value'})]))),/隐私/);
 assert.throws(()=>save(a,work(a,[entry('a'),entry('b',{source:{speaker:{kind:'agent',id:'  '},text:'检查记录'}})])),/有效/);assert.equal(JSON.stringify(a),before);
});
test('同批错误先于纠正可关联；未选纠正或循环拒绝',()=>{
 const a=make(),attempt=(id,extra={})=>entry(id,{kind:'attempt',conditions:'测试环境',result:'观察结果',outcome:'partial',...extra});
 const w=work(a,[attempt('error',{mistake:'怀疑错误',correction_entry_id:'fix'}),attempt('fix')]);assert.throws(()=>save(a,w,['error']),/同时选中/);
 const r=save(a,w).archive,error=r.bundle.memories.find(m=>m.data.mistake),fix=r.bundle.memories.find(m=>m.id===error.data.mistake.correction_attempt_id);assert.equal(fix.claim,'工作结果 fix');assert.equal(error.data.mistake.status,'suspected');
 w.entries[1].mistake='另一个怀疑';w.entries[1].correction_entry_id='error';assert.throws(()=>previewWorklog(a,w),/循环/);
});
test('不能借编辑覆盖原始来源或核查状态；无确认不保存',()=>{
 const a=make(),w=work(a,[entry('a')]);assert.throws(()=>save(a,w,['a'],{edits:{a:{checked:true}}}),/只允许/);assert.throws(()=>save(a,w,['a'],{reviewed:false}),/检查/);
 const bad=save(a,w).archive;bad.work_imports[0].memory_id='missing';assert.throws(()=>validateArchive(bad),/索引/);
});
test('文件来源结构化保留相对路径、内容标识和工具声明，编辑主张不覆盖定位或原文',()=>{
 const a=make(),text='\uFEFF原文件片段\r\n仍是计划，不代表完成。\r\n';
 const source={speaker:{kind:'tool',id:'合成文件读取器'},text,redacted:true,file:{path:'docs/plan.md',content_sha256:'a'.repeat(64),selector:'开头片段'}};
 const w=work(a,[entry('file',{source})]);
 assert.equal(parseWorklogText(JSON.stringify(w)).entries[0].source.file.path,'docs/plan.md');
 const result=save(a,w,['file'],{edits:{file:{title:'重新表述的主张',detail:'预览调整后的说明'}}}).archive;
 const evidence=result.bundle.evidence.at(-1),memory=result.bundle.memories.at(-1);
 assert.equal(evidence.kind,'file');assert.equal(evidence.locator.repository,a.bundle.project.id);assert.equal(evidence.locator.path,'docs/plan.md');
 assert.equal(evidence.locator.content_sha256,'a'.repeat(64));assert.equal(evidence.locator.selector,'开头片段');assert.equal(evidence.locator.speaker.kind,'tool');
 assert.equal(result.snapshots[evidence.snapshot.path],text);assert.equal(memory.verification.status,'unverified');assert.equal(memory.approval,undefined);
 assert.match(evidence.note,/未重新读取项目文件/);assert.match(evidence.note,/未认证工具身份/);assert.ok(!evidence.note.includes('手动提供的依据'));
 assert.equal(previewWorklog(result,w).entries[0].status,'duplicate');assert.equal(validateArchive(result),true);
});
test('文件来源拒绝绝对路径、越界路径、伪造用户身份和隐私元数据',()=>{
 const a=make(),source={speaker:{kind:'tool',id:'合成文件读取器'},text:'干净的原文',file:{path:'docs/plan.md',content_sha256:'a'.repeat(64)}};
 for(const p of ['/Users/synthetic/docs/plan.md','../plan.md','docs/../plan.md','docs//plan.md','docs\\plan.md','C:/plan.md','.env']){
  const w=work(a,[entry('file',{source:{...source,file:{...source.file,path:p}}})]);
  assert.throws(()=>previewWorklog(a,w),/相对路径|格式/);assert.throws(()=>parseWorklogText(JSON.stringify(w)),/相对路径/);
 }
 assert.throws(()=>previewWorklog(a,work(a,[entry('file',{source:{...source,speaker:{kind:'human',id:'local-user'}},origin:'human_statement'})])),/工具观察/);
 assert.throws(()=>previewWorklog(a,work(a,[entry('file',{source:{...source,file:{...source.file,content_sha256:'not-a-hash'}}})])),/格式/);
 assert.throws(()=>previewWorklog(a,work(a,[entry('file',{source:{...source,file:{...source.file,selector:'password: synthetic-secret-value'}}})])),/隐私/);
});
test('工具整理者按工具身份保存；旧草稿字节、指纹与重试语义不变，拒绝借身份声明用户确认',t=>{
 const a=make(),legacy=work(a,[entry('legacy')]),original=JSON.stringify(legacy),legacySaved=save(a,legacy).archive;
 assert.equal(legacySaved.bundle.memories.at(-1).by.kind,'agent');
 assert.equal(parseWorklogText(original).session.actor,undefined);assert.equal(JSON.stringify(legacy),original);
 assert.equal(previewWorklog(legacySaved,parseWorklogText(original)).entries[0].status,'duplicate');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'worklog-legacy-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const config={directory,loadArchive:()=>a},box=createInbox(config),queued=box.stage(a,{worklog:legacy,sourceReviewed:true}),filename=path.join(directory,a.bundle.project.id+'.json'),bytes=fs.readFileSync(filename,'utf8');
 const reopened=createInbox(config);assert.deepEqual(reopened.get(a.bundle.project.id),queued);assert.equal(reopened.stage(a,{worklog:parseWorklogText(original),sourceReviewed:true}).fingerprint,queued.fingerprint);assert.equal(fs.readFileSync(filename,'utf8'),bytes);
 const tool=work(a,[entry('tool',{kind:'constraint',source:{speaker:{kind:'tool',id:'文件读取器'},text:'工具读取到的限制说明'}})]);
 tool.session={id:'tool-session',agent:'兼容名称',actor:{kind:'tool',id:'文件读取器'}};
 const result=save(a,tool).archive,record=result.bundle.memories.at(-1);
 assert.deepEqual(record.by,{kind:'tool',id:'文件读取器'});assert.equal(record.verification.status,'unverified');assert.equal(record.approval,undefined);assert.equal(record.data.stage,'proposed');
 assert.match(result.bundle.evidence.at(-1).note,/由工具/);assert.match(record.verification.unknowns[0],/工具工作记录/);
 for(const actor of [{kind:'human',id:'local-user'},{kind:'tool',id:' '},{kind:'agent',id:'AI',confirmed:true}]){
  const invalid={...tool,session:{...tool.session,actor}};
  assert.throws(()=>previewWorklog(a,invalid),/格式|整理者身份/);assert.throws(()=>parseWorklogText(JSON.stringify(invalid)),/整理者身份/);
 }
 assert.equal(fs.readFileSync(filename,'utf8'),bytes);assert.equal(JSON.stringify(legacy),original);
});

test('关联完成只在所选条目保存后移出推荐，原任务和 Evidence 原样保留',async()=>{
 const {appendMemory}=await import('./core.mjs'),{nextTaskSuggestions}=await import('../shared/next-task.js');
 const a=make(),target=appendMemory(a,{kind:'task',title:'暂停功能',detail:'增加暂停功能',source:'合成待办',reviewed:true}),before=JSON.stringify(a);
 const w=work(a,[entry('done',{kind:'state',stage:'completed',task_id:target.id}),entry('ordinary')]);
 assert.equal(previewWorklog(a,w).entries[0].task_title,'暂停功能');assert.equal(nextTaskSuggestions(a.bundle.memories).length,1);
 const unselected=save(a,w,['ordinary']).archive;assert.equal(nextTaskSuggestions(unselected.bundle.memories).length,1);
 const result=save(a,w,['done']).archive,completion=result.bundle.memories.at(-1);
 assert.equal(completion.data.subject_id,target.id);assert.equal(completion.data.stage,'awaiting_validation');assert.equal(completion.verification.status,'unverified');assert.equal(completion.approval,undefined);
 assert.equal(nextTaskSuggestions(result.bundle.memories).length,0);
 assert.deepEqual(result.bundle.memories.find(m=>m.id===target.id),target);
 for(const [file,content]of Object.entries(a.snapshots))assert.equal(result.snapshots[file],content);
 assert.equal(JSON.stringify(a),before);assert.equal(save(result,w,['done']).added,0);
 const reopen=work(result,[entry('resume',{kind:'state',stage:'in_progress',task_id:target.id})]);
 assert.equal(nextTaskSuggestions(save(result,reopen).archive.bundle.memories).length,1);
});

test('拒绝跨项目、非任务、错误类型、无阶段关联；普通完成文字不关闭任务',async()=>{
 const {appendMemory}=await import('./core.mjs'),{nextTaskSuggestions}=await import('../shared/next-task.js');
 const a=make(),target=appendMemory(a,{kind:'task',title:'待办',detail:'增加暂停',source:'合成记录',reviewed:true});
 for(const extra of [{kind:'fact',task_id:target.id,stage:'completed'},{kind:'state',task_id:target.id},{kind:'state',task_id:a.bundle.project.id,stage:'completed'},{kind:'state',task_id:a.bundle.memories[0].id,stage:'completed'},{kind:'state',task_id:make().bundle.project.id,stage:'completed'}])assert.throws(()=>previewWorklog(a,work(a,[entry('bad',extra)])));
 const r=save(a,work(a,[entry('words',{detail:'增加暂停已经完成'}),entry('global',{kind:'state',stage:'completed'})])).archive;
 assert.equal(nextTaskSuggestions(r.bundle.memories).length,1);
});
