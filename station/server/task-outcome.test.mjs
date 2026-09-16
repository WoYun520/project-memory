import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {createBundle,validateArchive,compile,appendMemory} from './core.mjs';import {createInbox} from './inbox.mjs';import {createBridge} from './bridge.mjs';import {importWorklog} from './worklog.mjs';import {applyTaskOutcome} from './task-outcome.mjs';import {briefMemory} from './recall.mjs';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task-outcome-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let archive=createBundle('合成收尾项目','');const id=archive.bundle.project.id;
 const memory=appendMemory(archive,{kind:'task',title:'合成待办',detail:'检查暂停',source:'合成任务要求',reviewed:true});
 const inbox=createInbox({loadArchive:()=>archive}),bridge=createBridge({directory:root,stationRoot:path.resolve('.'),port:4199,loadArchive:()=>archive,inbox});
 const ticket=bridge.prepare(id,{revision:0,target:'codex',task:'检查暂停',taskMode:'new',taskMemoryId:memory.id}).ticket;bridge.receipt(id,ticket.id,{revision:0,taskReceived:true});
 const worklog={format:'project-memory-worklog',version:'0.1',project_id:id,session:{id:'batch',agent:'Codex AI',actor:{kind:'agent',id:'Codex AI'},handoff_id:ticket.id},entries:[{id:'one',kind:'fact',title:'合成结果',detail:'检查已结束',origin:'observation',source:{speaker:{kind:'agent',id:'Codex AI'},text:'原始工具观察'}}]};
 archive=importWorklog(archive,{worklog,reviewed:true,associate_task:true,selected_ids:['one'],reviewer:{kind:'human',id:'local-user'}},{association:bridge.workAssociation(id,worklog)}).archive;
 const input={ticket_id:ticket.id,stage:'completed',next:'',confirmed:true,reviewer:{kind:'human',id:'local-user'}};
 return {id,bridge,input,ticket:bridge.outcomeTicket(id,ticket.id),worklog,get archive(){return archive;},set(a){archive=a;}};
}
test('任务完成保留原文、核验与来源，只增加可追溯进度；默认保存不完成',t=>{
 const f=fixture(t),before=JSON.stringify(f.archive);assert.equal(f.archive.task_outcomes,undefined);
 const result=applyTaskOutcome(f.archive,f.input,f.ticket);assert.equal(JSON.stringify(f.archive),before);assert.deepEqual(result.archive.bundle,f.archive.bundle);assert.deepEqual(result.archive.snapshots,f.archive.snapshots);assert.deepEqual(result.archive.work_imports,f.archive.work_imports);assert.equal(result.task_outcome.by.kind,'human');assert.equal(result.task_outcome.stage,'completed');validateArchive(result.archive);
 f.set(result.archive);assert.equal(f.bridge.status(f.id).activeTask.outcome.stage,'completed');assert.equal(f.bridge.status(f.id).suggestions.length,0);assert.equal(f.bridge.finishReminder(f.id,f.ticket.id).available,false);assert.match(compile(f.archive),/用户标记完成/);assert.match(briefMemory(f.archive),/不代表结果已核验/);
 assert.equal(applyTaskOutcome(f.archive,f.input,f.ticket).changed,false);
});
test('已完成任务不能继续旧交接，明确重新继续会保留历史并带出剩余事项',t=>{
 const f=fixture(t);f.set(applyTaskOutcome(f.archive,f.input,f.ticket).archive);
 const next={revision:0,target:'codex',task:f.ticket.task,taskMemoryId:f.ticket.taskMemoryId,taskMode:'continue',continuesTicketId:f.ticket.id};
 assert.throws(()=>f.bridge.prepare(f.id,next),/已标记完成/);
 f.set(applyTaskOutcome(f.archive,{...f.input,stage:'in_progress',next:'继续检查手机'},f.ticket).archive);
 assert.equal(f.archive.task_outcomes.length,2);assert.equal(f.archive.task_outcomes[0].stage,'completed');assert.equal(f.bridge.status(f.id).suggestions.length,1);assert.match(briefMemory(f.archive),/继续检查手机/);
 const ticket=f.bridge.prepare(f.id,next).ticket;assert.equal(ticket.taskThreadId,f.ticket.taskThreadId);
 assert.throws(()=>f.bridge.outcomeTicket(f.id,f.ticket.id),/更新交接/);
});
test('未确认、AI身份、跨项目、无回执、无结果与隐私不改任务',t=>{
 const f=fixture(t),before=JSON.stringify(f.archive);
 for(const change of [{confirmed:false},{reviewer:{kind:'agent',id:'Codex'}},{ticket_id:randomUUID()},{stage:'finished'},{next:'尚有未完成事项'},{stage:'in_progress',next:'password=synthetic-value'}])assert.throws(()=>applyTaskOutcome(f.archive,{...f.input,...change},f.ticket));
 for(const ticket of [{...f.ticket,projectId:randomUUID()},{...f.ticket,receipt:null},{...f.ticket,taskThreadId:randomUUID()}])assert.throws(()=>applyTaskOutcome(f.archive,f.input,ticket));
 assert.equal(JSON.stringify(f.archive),before);
});
test('收尾不能改变不同任务的状态，也不能伪造结果引用',t=>{
 const f=fixture(t),other=f.bridge.prepare(f.id,{revision:0,target:'codex',task:'另一个任务',taskMode:'new'}).ticket;
 f.set(applyTaskOutcome(f.archive,f.input,f.ticket).archive);assert.equal(f.bridge.status(f.id).activeTask.id,other.id);assert.equal(f.bridge.status(f.id).activeTask.outcome,null);
 const broken=structuredClone(f.archive);broken.task_outcomes[0].result_ids=[randomUUID()];assert.throws(()=>validateArchive(broken),/对应的已保存结果/);
 broken.task_outcomes[0].result_ids=[f.archive.work_imports[0].memory_id];broken.task_outcomes[0].by.kind='agent';assert.throws(()=>validateArchive(broken),/校验失败/);
});
test('旧待办已有结束声明时仍拦截继续，只有用户重新继续才解除',t=>{
 const f=fixture(t);appendMemory(f.archive,{kind:'state',title:'旧待办等待验证',detail:'旧记录声明已结束待验证',source:'合成旧记录',subject_id:f.ticket.taskMemoryId,stage:'awaiting_validation',reviewed:true});
 const input={revision:0,target:'codex',task:f.ticket.task,taskMemoryId:f.ticket.taskMemoryId,taskMode:'continue',continuesTicketId:f.ticket.id};
 assert.throws(()=>f.bridge.prepare(f.id,input),/已标记完成/);
 f.set(applyTaskOutcome(f.archive,{...f.input,stage:'in_progress',next:'重新核对'},f.ticket).archive);
 assert.equal(f.bridge.prepare(f.id,input).ticket.taskThreadId,f.ticket.taskThreadId);
});
