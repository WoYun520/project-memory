import test from 'node:test';
import assert from 'node:assert/strict';
import {createBundle,appendMemory,compile,reviewMemory} from './core.mjs';
import {renderContext} from './context.mjs';
import {currentProject} from '../shared/current-project.js';
const add=(a,f)=>appendMemory(a,{kind:'constraint',title:'合成要求',detail:'合成要求文字',source:'合成用户依据',confirmed:true,reviewed:true,...(!f.kind||['constraint','decision'].includes(f.kind)?{applicability:{kind:'project'}}:{}),...f});
test('new confirmed requirement replaces keyboard-only while implementation remains not started',()=>{
 const a=createBundle('合成需求变更','制作小游戏');
 const old=add(a,{title:'只支持键盘',detail:'只支持键盘操作。'}),snapshot=JSON.stringify(a.snapshots);
 const next=add(a,{title:'增加触屏操作',detail:'增加触屏操作，继续保留键盘。',changeReason:'需要在手机上使用',replaces:old.id});
 const state=add(a,{kind:'state',confirmed:false,title:'触屏尚未开始',detail:'尚未修改游戏实现。',subject_id:next.id,stage:'not_started'});
 const before=JSON.stringify(a),x=currentProject(a.bundle.memories);
 assert.ok(x.current.some(i=>i.memory.id===next.id));assert.ok(!x.current.some(i=>i.memory.id===old.id));
 assert.equal(x.current.find(i=>i.memory.id===next.id).implementation.memory.id,state.id);
 assert.equal(x.current.find(i=>i.memory.id===next.id).implementation.text,'已记录：尚未开始');
 assert.equal(x.changes[0].previous[0].id,old.id);assert.equal(x.changes[0].reason,'需要在手机上使用');
 assert.equal(x.completed.length,0);
 for(const text of [compile(a),renderContext(a,{mode:'focused',task:'继续',memoryIds:[]})]){
  assert.ok(text.indexOf('## 当前项目情况')<text.indexOf('## 当前记录'));
  assert.match(text,/需要在手机上使用/);assert.match(text,/已记录：尚未开始/);
  for(const id of [old.id,next.id,state.id])assert.ok(text.includes(id));
 }
 assert.equal(JSON.stringify(a),before);
 for(const [k,v]of Object.entries(JSON.parse(snapshot)))assert.equal(a.snapshots[k],v);
});
test('AI proposal cannot displace confirmed requirement and failed change preserves archive',()=>{
 const a=createBundle('合成要求','');const old=add(a,{}),before=JSON.stringify(a);
 assert.throws(()=>add(a,{confirmed:false,inference:true,replaces:old.id}),/未确认的新建议不能替代/);
 assert.equal(JSON.stringify(a),before);
 const proposed=add(a,{confirmed:false,inference:true,title:'AI 建议触屏'}),x=currentProject(a.bundle.memories);
 assert.ok(x.current.some(i=>i.memory.id===old.id));assert.ok(!x.current.some(i=>i.memory.id===proposed.id));assert.ok(x.uncertain.some(i=>i.memory.id===proposed.id));
});
test('missing implementation stays unknown; partial approval, stale, due and conflict do not become current instructions',()=>{
 const a=createBundle('合成边界','');const m=add(a,{});
 assert.match(currentProject(a.bundle.memories).current[0].implementation.text,/不能判断是否实现/);
 m.approval.fields=['/claim'];assert.equal(currentProject(a.bundle.memories).current.length,0);
 m.approval.fields=['/data'];m.freshness.review_after='2020-01-01T00:00:00.000Z';assert.equal(currentProject(a.bundle.memories).current.length,0);
 delete m.freshness.review_after;reviewMemory(a,m.id,'stale');assert.equal(currentProject(a.bundle.memories).current.length,0);
 m.freshness.status='unknown';const other=add(a,{title:'相反要求'});reviewMemory(a,m.id,'conflict',other.id);assert.equal(currentProject(a.bundle.memories).current.length,0);
});
test('completion is linked and awaiting validation stays distinct from verified completion, reopened state wins',()=>{
 const a=createBundle('合成任务','');const task=add(a,{kind:'task',confirmed:false,title:'实现触屏'});
 const done=add(a,{kind:'state',confirmed:false,title:'触屏完成声明',subject_id:task.id,stage:'awaiting_validation'});
 let x=currentProject(a.bundle.memories);assert.equal(x.openTasks.length,0);assert.equal(x.completed[0].target.id,task.id);assert.match(x.completed[0].text,/等待核验/);
 const reopen=add(a,{kind:'state',confirmed:false,title:'继续修复触屏',subject_id:task.id,stage:'in_progress'});reopen.recorded_at=done.recorded_at;
 x=currentProject(a.bundle.memories);assert.equal(x.completed.length,0);assert.equal(x.openTasks.length,1);
});
