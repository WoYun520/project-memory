import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createBundle} from './core.mjs';
import {createInbox} from './inbox.mjs';
import {createBridge} from './bridge.mjs';
import {runBridge} from '../bridge.mjs';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'handoff-bridge-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const a=createBundle('切换演示','制作只显示三项待办的页面。'),b=createBundle('另一个项目',''),id=a.bundle.project.id;
 const loadArchive=projectId=>{const found=[a,b].find(item=>item.bundle.project.id===projectId);if(!found)throw Error('项目不存在');return found;};
 const inbox=createInbox({directory:path.join(root,'inbox'),loadArchive}),directory=path.join(root,'tickets');
 const config={directory,stationRoot:path.resolve('.'),port:4180,loadArchive,inbox,workspace:{get:()=>({binding:null})}};
 return {root,a,b,id,inbox,directory,config,bridge:createBridge(config)};
}
const worklog=id=>({format:'project-memory-worklog',version:'0.1',project_id:id,session:{id:'bridge-work',agent:'Claude Code',actor:{kind:'agent',id:'Claude Code'}},entries:[{id:'new-result',kind:'fact',title:'新的观察',detail:'完成合成项目说明。',origin:'observation',source:{speaker:{kind:'agent',id:'Claude Code'},text:'这段是合成 AI 工作观察，不是用户确认。'}}]});
const prepare=f=>f.bridge.prepare(f.id,{target:'claude',revision:f.a.revision});

test('交接只持久化版本和路由信息，重启可继续复制且复用待收件票据',t=>{
 const f=fixture(t),before=JSON.stringify(f.a),first=prepare(f);
 assert.match(first.prompt,/bridge\.mjs' read/);assert.equal(first.ticket.receipt,null);assert.equal(first.reused,false);
 const state=JSON.parse(fs.readFileSync(path.join(f.directory,f.id+'.json')));
 assert.deepEqual(Object.keys(state.tickets[0]).sort(),['id','projectId','target','revision','createdAt','receipt'].sort());
 assert.doesNotMatch(JSON.stringify(state),/制作只显示三项待办|snapshots|context|工作观察/);
 const restarted=createBridge(f.config),status=restarted.status(f.id);
 assert.equal(status.latest.id,first.ticket.id);assert.equal(status.latestPrompt,first.prompt);
 assert.equal(restarted.prepare(f.id,{target:'claude',revision:f.a.revision}).reused,true);
 assert.equal(JSON.stringify(f.a),before);assert.equal(fs.readdirSync(f.directory).length,1);
});

test('待检查批次阻止准备，准备后到达的新记录也阻止读取和回执',t=>{
 const f=fixture(t),ticket=prepare(f).ticket;
 f.inbox.stage(f.a,{worklog:worklog(f.id),sourceReviewed:true});
 assert.equal(f.bridge.status(f.id).pendingCount,1);assert.equal(f.bridge.status(f.id).latest.blockedByPending,true);
 assert.throws(()=>prepare(f),/等待检查/);
 assert.throws(()=>f.bridge.context(f.id,ticket.id),/新记录等待检查/);
 assert.throws(()=>f.bridge.receipt(f.id,ticket.id,{revision:f.a.revision}),/新记录等待检查/);
 assert.equal(f.bridge.status(f.id).latest.receipt,null);assert.equal(f.inbox.get(f.id).worklog.entries.length,1);
});

test('跨项目和非法路径不能取票据，过期版本不能读取旧上下文或登记回执',t=>{
 const f=fixture(t),ticket=prepare(f).ticket;
 assert.throws(()=>f.bridge.context(f.b.bundle.project.id,ticket.id),error=>error.statusCode===404);
 assert.throws(()=>f.bridge.receipt(f.b.bundle.project.id,ticket.id,{revision:f.a.revision}),error=>error.statusCode===404);
 assert.throws(()=>f.bridge.context(f.id,'../outside'),error=>error.statusCode===400);
 f.a.revision++;
 assert.equal(f.bridge.status(f.id).latest.stale,true);
 assert.throws(()=>f.bridge.prepare(f.id,{target:'claude',revision:ticket.revision}),/版本已变化/);
 assert.throws(()=>f.bridge.context(f.id,ticket.id),/版本已过期/);
 assert.throws(()=>f.bridge.receipt(f.id,ticket.id,{revision:ticket.revision}),/版本已过期/);
 const fresh=prepare(f).ticket;assert.notEqual(fresh.id,ticket.id);assert.equal(fresh.receipt,null);
});

test('回执必须匹配票据版本，新交接不继承旧票据的收件结果',t=>{
 const f=fixture(t),first=prepare(f).ticket;
 for(const revision of [-1,0.5,Number.MAX_SAFE_INTEGER+1,999])assert.throws(()=>f.bridge.receipt(f.id,first.id,{revision}),/版本/);
 assert.throws(()=>f.bridge.receipt(f.id,first.id,{revision:f.a.revision,confirmed:true}),/版本/);
 const received=f.bridge.receipt(f.id,first.id,{revision:f.a.revision}).ticket;
 assert.match(received.receipt.source,/不代表模型理解、身份认证或用户验收/);
 assert.deepEqual(f.bridge.receipt(f.id,first.id,{revision:f.a.revision}).ticket.receipt,received.receipt);
 const next=prepare(f);assert.notEqual(next.ticket.id,first.id);assert.equal(next.ticket.receipt,null);
 f.bridge.receipt(f.id,first.id,{revision:f.a.revision});
 assert.equal(f.bridge.status(f.id).latest.id,next.ticket.id);assert.equal(f.bridge.status(f.id).latest.receipt,null);
});

test('完整交接保留原始依据，隐私内容不输出，不写快照或正式档案',t=>{
 const f=fixture(t),first=prepare(f).ticket,before=JSON.stringify(f.a),snapshots=structuredClone(f.a.snapshots);
 const context=f.bridge.context(f.id,first.id).context;
 for(const original of Object.values(snapshots))assert.ok(context.includes(original));
 assert.match(context,/submit-work\.mjs/);assert.match(context,/session\.actor\.id.*实际工作的 AI/);
 assert.match(context,/尚未核验|未记录用户确认/);assert.equal(JSON.stringify(f.a),before);
 const source=Object.keys(f.a.snapshots)[0];f.a.snapshots[source]='synthetic@example.com';
 assert.throws(()=>f.bridge.context(f.id,first.id),/隐私/);
 assert.equal(f.bridge.status(f.id).latest.receipt,null);
 assert.doesNotMatch(fs.readFileSync(path.join(f.directory,f.id+'.json'),'utf8'),/synthetic/);
});

test('交接存储拒绝损坏、快捷链接和额外字段，保留原文件',t=>{
 const f=fixture(t);prepare(f);const file=path.join(f.directory,f.id+'.json');
 const state=JSON.parse(fs.readFileSync(file));state.tickets[0].context='不允许的快照';fs.writeFileSync(file,JSON.stringify(state));
 const bytes=fs.readFileSync(file);assert.throws(()=>f.bridge.status(f.id),/校验失败/);assert.ok(fs.readFileSync(file).equals(bytes));
 const outside=path.join(f.root,'outside.json');fs.renameSync(file,outside);fs.symlinkSync(outside,file);
 assert.throws(()=>prepare(f),/无法读取/);assert.ok(fs.readFileSync(outside).equals(bytes));
});

test('CLI 完整输出后才发回执，回执失败不伪造成功',async t=>{
 const f=fixture(t),ticket=prepare(f).ticket,events=[];
 const run=fetchImpl=>runBridge(['read',f.id,ticket.id],{env:{MEMORY_STATION_PORT:'4280'},read:async args=>{events.push('get');assert.equal(args.port,4280);assert.equal(args.pathname,`/api/projects/${f.id}/bridge/${ticket.id}/context`);return f.bridge.context(f.id,ticket.id);},write:async output=>{events.push(output.includes('本次工具读取回执已送达')?'ack':'output');},fetchImpl});
 const result=await run(async(url,options)=>{
  events.push('post');assert.ok(url.startsWith('http://127.0.0.1:4280/'));assert.equal(options.redirect,'error');assert.equal(options.headers['X-Memory-Station'],'1');
  assert.deepEqual(JSON.parse(options.body),{revision:f.a.revision});return {ok:true,json:async()=>f.bridge.receipt(f.id,ticket.id,JSON.parse(options.body))};
 });
 assert.deepEqual(events,['get','output','post','ack']);assert.equal(result.receiptRecorded,true);
 events.length=0;const failure=await run(async()=>{events.push('post');return {ok:false,json:async()=>({error:'服务不可用'})};});
 assert.deepEqual(events,['get','output','post','output']);assert.equal(failure.receiptRecorded,false);
});

test('CLI 拒绝跨项目和隐私响应；读取或输出失败时不发回执',async t=>{
 const f=fixture(t),ticket=prepare(f).ticket,base=f.bridge.context(f.id,ticket.id),args=['read',f.id,ticket.id];let calls=0,writes=0;
 const run=(payload,write=async()=>{writes++;})=>runBridge(args,{env:{},read:async()=>payload,fetchImpl:async()=>{calls++;assert.fail('不应发送回执');},write});
 await assert.rejects(()=>run({...base,projectId:f.b.bundle.project.id}),/不一致/);
 await assert.rejects(()=>run({...base,context:'synthetic@example.com'}),/隐私/);
 assert.equal(writes,0);
 await assert.rejects(()=>run(base,async()=>{throw Error('输出管道已关闭');}),/输出管道/);assert.equal(calls,0);
 await assert.rejects(()=>runBridge(args,{read:async()=>{throw Error('这份交接已过期');},fetchImpl:async()=>{calls++;}}),/已过期/);
 assert.equal(calls,0);
});

test('本次任务绑定独立交接编号，修改任务不复用旧票据，原始档案不变',t=>{
 const f=fixture(t),before=JSON.stringify(f.a);
 const first=f.bridge.prepare(f.id,{target:'claude',revision:f.a.revision,task:'增加暂停按钮'});
 assert.equal(f.bridge.prepare(f.id,{target:'claude',revision:f.a.revision,task:'增加暂停按钮'}).ticket.id,first.ticket.id);
 const next=f.bridge.prepare(f.id,{target:'claude',revision:f.a.revision,task:'保留方向键，增加重新开始'});
 assert.notEqual(next.ticket.id,first.ticket.id);
 assert.match(f.bridge.context(f.id,next.ticket.id).context,/用户在记忆站选择的本次任务\n保留方向键，增加重新开始/);
 assert.match(f.bridge.launchPrompt(f.id,next.ticket.id,'claude'),/保留方向键，增加重新开始/);
 assert.throws(()=>f.bridge.launchPrompt(f.id,next.ticket.id,'codex'),/目标或本次任务不一致/);
 f.bridge.receipt(f.id,first.ticket.id,{revision:f.a.revision,taskReceived:true});
 assert.equal(f.bridge.status(f.id,next.ticket.id).latest.receipt,null);
 const restarted=createBridge(f.config);
 assert.equal(restarted.status(f.id,first.ticket.id).latest.receipt.taskReceived,true);
 assert.equal(JSON.stringify(f.a),before);
 f.a.revision++;
 assert.throws(()=>f.bridge.launchPrompt(f.id,next.ticket.id,'claude'),/过期/);
});

test('隐私和无效任务在写票据前拒绝，不把普通读取回执当成收到任务',t=>{
 const f=fixture(t);
 for(const task of ['',null,'x'.repeat(2001),'password=synthetic-secret','bad\0text'])assert.throws(()=>f.bridge.prepare(f.id,{target:'codex',revision:f.a.revision,task}));
 assert.deepEqual(fs.readdirSync(f.directory),[]);
 const old=prepare(f).ticket;
 assert.throws(()=>f.bridge.receipt(f.id,old.id,{revision:f.a.revision,taskReceived:true}),/不一致/);
 const ticket=f.bridge.prepare(f.id,{target:'codex',revision:f.a.revision,task:'只读说明当前进度'}).ticket;
 assert.equal(f.bridge.receipt(f.id,ticket.id,{revision:f.a.revision}).ticket.receipt.taskReceived,undefined);
 assert.equal(f.bridge.receipt(f.id,ticket.id,{revision:f.a.revision,taskReceived:true}).ticket.receipt.taskReceived,true);
});

test('CLI 将任务与记忆完整输出后，才登记同一票据的任务回执',async t=>{
 const f=fixture(t),ticket=f.bridge.prepare(f.id,{target:'claude',revision:f.a.revision,task:'检查暂停后的计分是否停止'}).ticket;
 let output=false;
 await runBridge(['read',f.id,ticket.id],{read:async()=>f.bridge.context(f.id,ticket.id),write:async text=>{if(text.includes('用户在记忆站选择的本次任务')){assert.match(text,/检查暂停后的计分是否停止/);output=true;}},fetchImpl:async(url,options)=>{
  assert.equal(output,true);assert.deepEqual(JSON.parse(options.body),{revision:f.a.revision,taskReceived:true});return {ok:true,json:async()=>f.bridge.receipt(f.id,ticket.id,JSON.parse(options.body))};
 }});
 assert.equal(f.bridge.status(f.id,ticket.id).latest.receipt.taskReceived,true);
});
test('只关联仍适用且文字一致的原任务，交接向 AI 提供回传所需编号',async t=>{
 const {appendMemory}=await import('./core.mjs');const f=fixture(t);
 const task=appendMemory(f.a,{kind:'task',title:'暂停',detail:'增加暂停按钮',source:'合成任务',reviewed:true});
 const linked=f.bridge.prepare(f.id,{target:'claude',revision:f.a.revision,task:'增加暂停按钮',taskMemoryId:task.id});
 assert.equal(linked.ticket.taskMemoryId,task.id);assert.match(f.bridge.context(f.id,linked.ticket.id).context,new RegExp('原任务编号：'+task.id));
 assert.throws(()=>f.bridge.prepare(f.id,{target:'claude',revision:f.a.revision,task:'改成新任务',taskMemoryId:task.id}),/已有变化/);
 assert.throws(()=>f.bridge.prepare(f.id,{target:'claude',revision:f.a.revision,task:'增加暂停按钮',taskMemoryId:f.b.bundle.project.id}),/已有变化/);
 const free=f.bridge.prepare(f.id,{target:'claude',revision:f.a.revision,task:'增加暂停按钮'});assert.notEqual(free.ticket.id,linked.ticket.id);assert.equal(free.ticket.taskMemoryId,undefined);
 appendMemory(f.a,{kind:'state',title:'完成报告',detail:'合成完成观察',source:'合成结果',stage:'awaiting_validation',subject_id:task.id,reviewed:true});
 assert.throws(()=>f.bridge.prepare(f.id,{target:'claude',revision:f.a.revision,task:'增加暂停按钮',taskMemoryId:task.id}),/已有变化/);
});

test('新任务有独立编号，跨AI继续沿用编号、刷新版本，不继承读取回执',t=>{
 const f=fixture(t),before=JSON.stringify(f.a);
 const first=f.bridge.prepare(f.id,{target:'claude',revision:f.a.revision,task:'检查手机，不改代码',taskMode:'new'}).ticket;
 f.bridge.receipt(f.id,first.id,{revision:f.a.revision,taskReceived:true});
 f.a.revision++;
 const second=createBridge(f.config).prepare(f.id,{target:'codex',revision:f.a.revision,task:first.task,taskMode:'continue',continuesTicketId:first.id}).ticket;
 assert.equal(second.taskThreadId,first.taskThreadId);assert.equal(second.continuesTicketId,first.id);assert.equal(second.receipt,null);assert.equal(second.revision,f.a.revision);
 const third=f.bridge.prepare(f.id,{target:'other',revision:f.a.revision,task:first.task,taskMode:'new'}).ticket;
 assert.notEqual(third.taskThreadId,first.taskThreadId);assert.equal(third.continuesTicketId,undefined);
 const restored=JSON.parse(before);restored.revision++;assert.deepEqual(f.a,restored);
});

test('继续任务拒绝修改目标、旧分支、跨项目及非法模式；验证阶段不写票据',t=>{
 const f=fixture(t),first=f.bridge.prepare(f.id,{target:'other',revision:f.a.revision,task:'只检查',taskMode:'new'}).ticket;
 const base={target:'codex',revision:f.a.revision,task:first.task,taskMode:'continue',continuesTicketId:first.id};
 const bytes=()=>fs.readFileSync(path.join(f.directory,f.id+'.json'),'utf8'),before=bytes();
 assert.throws(()=>f.bridge.prepare(f.id,{...base,task:'开始修复'}),/修改目标/);
 assert.throws(()=>f.bridge.prepare(f.id,{...base,taskMode:'new'}),/新任务不能/);
 assert.throws(()=>f.bridge.prepare(f.id,{...base,taskMode:'unknown'}),/请选择/);
 assert.throws(()=>f.bridge.prepare(f.b.bundle.project.id,base),/没有找到/);
 f.bridge.prepare(f.id,base,{validateOnly:true});assert.equal(bytes(),before);
 f.bridge.prepare(f.id,{target:'other',revision:f.a.revision,task:'新工作',taskMode:'new'});
 assert.throws(()=>f.bridge.prepare(f.id,base),/当前任务已变化/);
});

test('旧交接可显式继续但不猜历史临时要求归属',t=>{
 const f=fixture(t),old=f.bridge.prepare(f.id,{target:'claude',revision:f.a.revision,task:'旧任务'}).ticket;
 const next=f.bridge.prepare(f.id,{target:'codex',revision:f.a.revision,task:old.task,taskMode:'continue',continuesTicketId:old.id}).ticket;
 assert.equal(next.taskThreadId,old.id);assert.match(f.bridge.context(f.id,next.id).context,/没有编号的旧记录不得按文字相似自动归入/);
});
