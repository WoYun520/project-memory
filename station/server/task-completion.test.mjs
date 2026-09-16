import test from 'node:test';import assert from 'node:assert/strict';
import {createBundle,appendMemory,compile} from './core.mjs';import {previewWorklog,importWorklog} from './worklog.mjs';import {nextTaskSuggestions} from '../shared/next-task.js';
const setup=()=>{const a=createBundle('完成关联合成',''),task=appendMemory(a,{kind:'task',title:'增加手机滑动',detail:'增加手机四向滑动，保留键盘操作',source:'AI 建议：可以增加滑动控制',origin:'inference',reviewed:true,recorder:{kind:'agent',id:'AI'},speaker:{kind:'agent',id:'AI'}});return{a,task};};
const work=(a,task,extra={})=>({format:'project-memory-worklog',version:'0.1',project_id:a.bundle.project.id,session:{id:'completion-fixture',agent:'Codex',actor:{kind:'agent',id:'Codex'}},entries:[{id:'result',kind:'fact',title:'手机滑动已实现',detail:'实现四向滑动并保留键盘',origin:'observation',source:{speaker:{kind:'agent',id:'Codex'},text:'合成 AI 工作观察：增加了四向滑动与原有键盘输入。'},completion:{task_id:task.id,stage:'completed',reason:'本次结果覆盖四向滑动与保留键盘的要求'},...extra}]});
const save=(a,w,choices={})=>importWorklog(a,{worklog:w,selected_ids:['result'],reviewed:true,task_completions:choices});
test('AI提议默认不关闭；用户选择后停止推荐，原任务、来源与未核验状态保留',()=>{
 const {a,task}=setup(),w=work(a,task),original=JSON.stringify(a);const plan=previewWorklog(a,w);assert.equal(plan.entries[0].completion_target.id,task.id);
 const plain=save(a,w);assert.ok(nextTaskSuggestions(plain.archive.bundle.memories).some(s=>s.id===task.id));assert.deepEqual(plain.task_updates,[]);
 const result=save(a,w,{result:w.entries[0].completion}),r=result.archive,state=r.bundle.memories.find(m=>m.id===result.task_updates[0]);
 assert.equal(state.data.subject_id,task.id);assert.equal(state.data.stage,'awaiting_validation');assert.equal(state.verification.status,'unverified');assert.equal(state.approval,undefined);assert.ok(!nextTaskSuggestions(r.bundle.memories).some(s=>s.id===task.id));
 assert.deepEqual(r.bundle.memories.find(m=>m.id===task.id),task);assert.equal(JSON.stringify(a),original);assert.ok(Object.values(r.snapshots).includes(w.entries[0].source.text));assert.ok(r.bundle.evidence.some(e=>e.locator.tool==='memory-station-task-review'));assert.equal(state.evidence.length,2);assert.match(compile(r),/不代表独立核查/);
 const retry=save(r,w,{result:w.entries[0].completion});assert.equal(retry.added,0);assert.deepEqual(retry.archive,r);assert.deepEqual(retry.task_updates,[]);
});
test('部分完成仍推荐；无AI关联声明的工作记录也可由用户选择关联',()=>{
 const {a,task}=setup(),w=work(a,task);delete w.entries[0].completion;
 const r=save(a,w,{result:{task_id:task.id,stage:'in_progress',reason:'完成滑动，仍需检查原键盘行为'}});
 assert.ok(nextTaskSuggestions(r.archive.bundle.memories).some(s=>s.id===task.id));assert.equal(r.archive.bundle.memories.at(-1).data.stage,'in_progress');
});
test('跨项目、非任务、已关闭目标和AI代替用户操作拒绝，失败不写入',()=>{
 const {a,task}=setup(),w=work(a,task),before=JSON.stringify(a),other=setup();
 assert.throws(()=>save(a,w,{result:{...w.entries[0].completion,task_id:other.task.id}}),/原待办/);
 assert.throws(()=>importWorklog(a,{worklog:w,selected_ids:['result'],reviewed:true,reviewer:{kind:'agent',id:'AI'},task_completions:{result:w.entries[0].completion}}),/只有用户/);
 assert.throws(()=>save(a,w,{unknown:w.entries[0].completion}),/已选中/);
 assert.throws(()=>save(a,w,{result:{...w.entries[0].completion,reason:''}}),/关联理由/);
 assert.throws(()=>save(a,w,{result:{...w.entries[0].completion,stage:'cancelled'}}),/完成程度/);
 assert.equal(JSON.stringify(a),before);
 const closed=save(a,w,{result:w.entries[0].completion}).archive;const newer=structuredClone(w);newer.session.id='later';assert.equal(previewWorklog(closed,newer).entries[0].completion_target.available,false);assert.throws(()=>save(closed,newer,{result:w.entries[0].completion}),/已完成/);assert.equal(save(closed,newer).added,1);
});
test('一批重复关联或与已有状态冲突会拒绝；推断和旧记忆更新不能用于关闭',()=>{
 const {a,task}=setup(),w=work(a,task),c=w.entries[0].completion;
 w.entries.push({...w.entries[0],id:'second'});assert.throws(()=>importWorklog(a,{worklog:w,selected_ids:['result','second'],reviewed:true,task_completions:{result:c,second:c}}),/同一批/);
 assert.throws(()=>save(a,work(a,task,{origin:'inference'})),/推断/);
 const bad=work(a,task);bad.entries[0].completion.reason='password: synthetic-value';assert.throws(()=>save(a,bad));
});
test('候选不止前三条，取消选择不处理，已有状态与完成关联不能重复写入同一待办',()=>{
 const {a,task}=setup();for(let i=0;i<4;i++)appendMemory(a,{kind:'task',title:'其他任务'+i,detail:'不同任务'+i,source:'合成任务',reviewed:true});
 const w=work(a,task);assert.equal(previewWorklog(a,w).completion_targets.length,5);
 const state={id:'state',kind:'state',title:'部分完成',detail:'只做一部分',origin:'observation',source:{speaker:{kind:'agent',id:'AI'},text:'合成工作观察：只完成一部分'},task_id:task.id,stage:'in_progress'};w.entries.push(state);
 assert.throws(()=>importWorklog(a,{worklog:w,selected_ids:['result','state'],reviewed:true,task_completions:{result:w.entries[0].completion}}),/同一批/);
 const selectedState=importWorklog(a,{worklog:w,selected_ids:['state'],reviewed:true});assert.ok(nextTaskSuggestions(selectedState.archive.bundle.memories,{limit:Infinity}).some(t=>t.id===task.id));
});
