import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createBundle} from './core.mjs';import {importWorklog} from './worklog.mjs';import {createBridge} from './bridge.mjs';import {briefMemory} from './recall.mjs';
test('实际提交格式保存任务限定，继续带回原要求，新任务仅保留历史并保留原文',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task-context-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let a=createBundle('任务边界合成','制作贪吃蛇');const id=a.bundle.project.id;
 const b=createBridge({directory:dir,stationRoot:path.resolve('.'),port:4180,loadArchive:()=>a,inbox:{get:()=>null}});
 const first=b.prepare(id,{target:'claude',revision:a.revision,taskMode:'new',task:'检查手机，不改代码'}).ticket;
 const w={format:'project-memory-worklog',version:'0.1',project_id:id,session:{id:'synthetic-task-context',agent:'AI',actor:{kind:'agent',id:'AI'}},entries:[{id:'one',kind:'constraint',title:'本次不改代码',detail:'仅完成手机检查',origin:'observation',source:{speaker:{kind:'agent',id:'AI'},text:'AI 合成工作观察：本次只检查手机操作。'},applicability:{kind:'task',task:'检查手机',task_id:first.taskThreadId}}]};
 a=importWorklog(a,{worklog:w,selected_ids:['one'],reviewed:true}).archive;
 const original=JSON.stringify(a.snapshots),m=a.bundle.memories.find(m=>m.kind==='constraint');assert.equal(m.approval,undefined);
 const second=b.prepare(id,{target:'codex',revision:a.revision,taskMode:'continue',continuesTicketId:first.id,task:first.task}).ticket;
 const current=b.context(id,second.id).context;
 assert.ok(current.indexOf(m.id)>current.indexOf('关联本任务的临时要求'));assert.ok(current.indexOf(m.id)<current.indexOf('其他任务或无法确定归属'));
 const third=b.prepare(id,{target:'codex',revision:a.revision,taskMode:'new',task:'开始修复手机操作'}).ticket;
 const fresh=b.context(id,third.id).context;assert.ok(fresh.indexOf(m.id)>fresh.indexOf('其他任务或无法确定归属'));assert.match(fresh,/不作为本次限制/);
 assert.equal(JSON.stringify(a.snapshots),original);assert.ok(Object.values(a.snapshots).includes(w.entries[0].source.text));
 const unscoped=briefMemory(a);assert.match(unscoped,/本次不改代码/);
 w.entries[0].applicability.task_id='../bad';assert.throws(()=>importWorklog(a,{worklog:w,selected_ids:['one'],reviewed:true}));
});
