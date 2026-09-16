import test from 'node:test';
import assert from 'node:assert/strict';
import {triageWork} from '../shared/work-triage.js';
import {createBundle,appendMemory} from './core.mjs';
import {previewWorklog,importWorklog} from './worklog.mjs';
const detail='每次切换项目时先读取最新保存的目标、架构和错误记录，再继续本次工作。';
const entry=(id,extra={})=>({id,kind:'fact',title:'读取项目上下文',detail,origin:'observation',status:'new',source:{speaker:{kind:'agent',id:'合成 AI'},text:'不同会话中的原始观察 '+id},...extra});
const archive=()=>{const a=createBundle('合成检查','');appendMemory(a,{kind:'fact',title:'读取项目上下文',detail,source:'先前原始依据',reviewed:true});return a;};
test('跨会话相同正文提示对照，不改来源、旧记忆或原文；仍可由用户保存两个来源',()=>{
 const a=archive(),entries=[entry('new')],before=JSON.stringify({a,entries});
 const result=triageWork(entries,a);assert.equal(result.rows[0].related[0].match,'same');assert.deepEqual(result.recommendedIds,[]);assert.equal(JSON.stringify({a,entries}),before);
 const w={format:'project-memory-worklog',version:'0.1',project_id:a.bundle.project.id,session:{id:'other-session',agent:'合成 AI'},entries:entries.map(({status,...e})=>e)};
 assert.equal(previewWorklog(a,w).entries[0].status,'new');
 const saved=importWorklog(a,{worklog:w,selected_ids:['new'],reviewed:true});assert.equal(saved.added,1);assert.equal(saved.archive.bundle.memories.length,2);assert.equal(JSON.stringify({a,entries}),before);
});
test('相似正文包含否定或数字变化仍只提示比较，不判定重复或冲突',()=>{
 const a=archive();const r=triageWork([entry('changed',{detail:detail.replace('先读取','不要读取')})],a);
 assert.equal(r.rows[0].related[0].match,'similar');assert.equal(r.rows[0].receipt,'new');assert.deepEqual(r.recommendedIds,[]);
});
test('同批相近记录和历史记录可对照，不用短标题或不同实体类型判断重复',()=>{
 const a=archive();a.bundle.memories[0].lifecycle='superseded';
 const r=triageWork([entry('first'),entry('second'),entry('other',{kind:'task'}),entry('short',{detail:'已完成'})],a);
 assert.equal(r.rows[0].related[0].lifecycle,'superseded');assert.ok(r.rows[1].related.some(x=>x.from==='batch'));assert.equal(r.rows[2].related.length,0);assert.equal(r.rows[3].related.length,0);
});
test('AI 观察不自动当建议，推断及待确认决定保持建议标注',()=>{
 const empty=createBundle('空项目','');const r=triageWork([entry('o'),entry('i',{origin:'inference',detail:'可能的后续方案'}),entry('d',{kind:'decision',detail:'选择某个候选方案'})],empty);
 assert.deepEqual(r.rows.map(x=>x.suggestion),[false,true,true]);assert.deepEqual(r.recommendedIds,['o','i','d']);
});
test('修改表述或原始依据中的疑似隐私均标记，仅返回类别；恢复修改后重新判断',()=>{
 const a=createBundle('空项目',''),e=entry('a');
 const r=triageWork([e],a,{a:{detail:'联系 synthetic@example.com'}});assert.deepEqual(r.rows[0].privacy,['邮箱地址']);assert.deepEqual(r.recommendedIds,[]);assert.ok(!JSON.stringify(r).includes('synthetic@'));
 assert.deepEqual(triageWork([e],a).recommendedIds,['a']);
 const s=triageWork([entry('s',{source:{speaker:{kind:'agent',id:'合成 AI'},text:'联系 synthetic@example.com'}})],a);assert.equal(s.counts.privacy,1);
});
test('一键选择排除错误与关联缺失、完成声明、编号冲突和已导入项',()=>{
 const a=createBundle('空项目','');const r=triageWork([
 entry('done',{stage:'completed'}),entry('conflict',{status:'conflict',detail:'另一个结果'}),entry('duplicate',{status:'duplicate',detail:'已导入记录'}),entry('error',{mistake:'疑似错误',detail:'待核查问题'}),entry('parent',{correction_entry_id:'done',detail:'纠正的前置尝试'}),entry('top',{correction_entry_id:'parent',detail:'更上层的尝试'}),entry('safe',{detail:'独立的新记录'})
 ],a);assert.deepEqual(r.recommendedIds,['safe']);assert.equal(r.counts.similar,1);
});
