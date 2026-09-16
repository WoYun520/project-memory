import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inspectMemory} from './recall.mjs';
import {createBundle} from './core.mjs';
import {createWorkspaceConnector} from './workspace.mjs';
import {createSourceChecks,runSourceWorker} from './source-check.mjs';
import {createBridge} from './bridge.mjs';
import {importWorklog} from './worklog.mjs';
import {prepareHandoff} from './prepare-handoff.mjs';
import {sourceCheckSummary} from '../shared/source-check.js';

function fixture(t,{empty=false,run=runSourceWorker}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'auto-source-')),project=path.join(root,'project');fs.mkdirSync(project);
 let archive=createBundle('自动交接合成项目','继续合成任务'),pending=null;
 const id=archive.bundle.project.id,workspace=createWorkspaceConnector({directory:path.join(root,'links')});workspace.bind(id,project);
 fs.writeFileSync(path.join(project,'README.md'),'Synthetic original content.');
 if(!empty){const worklog=workspace.preview(id,['README.md']).worklog;archive=importWorklog(archive,{reviewed:true,reviewer:{kind:'agent',id:'synthetic-checker'},worklog,selected_ids:[worklog.entries[0].id]}).archive;}
 archive.revision=1;
 const loadArchive=()=>archive,config={directory:path.join(root,'checks'),workspace,loadArchive,run},sourceChecks=createSourceChecks(config);
 const bridge=createBridge({directory:path.join(root,'bridge'),stationRoot:path.resolve('.'),port:4180,loadArchive,workspace,inbox:{get:()=>pending},sourceReport:a=>sourceChecks.get(a).report});
 const dependencies={bridge,sourceChecks};
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 return {root,project,id,archive,workspace,config,bridge,sourceChecks,dependencies,input:{revision:1,target:'other',task:'继续合成任务'},setPending(value){pending=value;},prepare(input){return prepareHandoff(dependencies,id,input||this.input);}};
}

test('prepare automatically checks changed sources and carries reminders and preserved original evidence to next AI',async t=>{
 const f=fixture(t),before=JSON.stringify(f.archive);
 await f.sourceChecks.check(f.id,1);fs.writeFileSync(path.join(f.project,'README.md'),'Synthetic updated content.');
 const result=await f.prepare();assert.equal(result.sourceCheck.rows[0].status,'changed');
 const text=f.bridge.context(f.id,result.ticket.id).context;
 assert.match(text,/原文已变化/);assert.match(text,/inspect/);assert.match(JSON.stringify(inspectMemory(f.archive,{revision:1,ids:f.archive.bundle.memories.filter(m=>m.evidence.length).map(m=>m.id).slice(0,6)})),/Synthetic original content/);assert.doesNotMatch(text,/Synthetic updated content/);assert.match(text,/不表示用户确认/);
 assert.equal(JSON.stringify(f.archive),before);assert.equal(result.ticket.receipt,null);
});

test('same content continues normally and status/context polling never rechecks project files',async t=>{
 let checks=0;const f=fixture(t,{run:async(...args)=>{checks++;return runSourceWorker(...args);}});
 const result=await f.prepare();assert.equal(checks,1);assert.equal(result.sourceCheck.rows[0].status,'same');
 // Directory inspection would fail after the project moved; reading saved context still succeeds.
 fs.renameSync(f.project,f.project+'-moved');
 f.bridge.status(f.id);f.bridge.context(f.id,result.ticket.id);f.sourceChecks.get(f.archive);assert.equal(checks,1);
});

test('timeout or worker failure replaces an earlier pass with explicit unknown while continuing the handoff',async t=>{
 let failed=false;const f=fixture(t,{run:(...args)=>{if(failed)throw Error('synthetic private error must not escape');return runSourceWorker(...args);}});
 await f.prepare();failed=true;
 const next=await f.prepare();assert.equal(next.sourceCheck.outcome,'failed');assert.equal(next.sourceCheck.rows[0].status,'unavailable');
 const text=f.bridge.context(f.id,next.ticket.id).context;assert.match(text,/本次来源检查未完成/);assert.doesNotMatch(text,/检查时与原文一致|synthetic private error/);
 assert.equal(createSourceChecks(f.config).get(f.archive).report.outcome,'failed');
});

test('no evidence or missing folder produces an explicit not-checked result without attempting a file read',async t=>{
 const never=()=>{assert.fail('No source files may be opened');};
 const empty=fixture(t,{empty:true,run:never}),r=await empty.prepare();assert.equal(r.sourceCheck.outcome,'no_sources');assert.match(sourceCheckSummary(r.sourceCheck),/未检查文件变化/);
 const unbound=fixture(t,{run:never});unbound.workspace.unbind(unbound.id);const next=await unbound.prepare();assert.equal(next.sourceCheck.outcome,'not_connected');assert.equal(next.sourceCheck.rows[0].status,'unavailable');
 assert.match(unbound.bridge.context(unbound.id,next.ticket.id).context,/尚未连接项目文件夹/);
});

test('invalid tasks, stale versions and pending drafts reject before any source check',async t=>{
 const f=fixture(t,{run:()=>assert.fail('Rejected requests cannot read files')});
 await assert.rejects(f.prepare({...f.input,revision:0}),/版本已变化/);
 await assert.rejects(f.prepare({...f.input,task:''}));
 f.setPending({worklog:{entries:[{}]}});await assert.rejects(f.prepare(),/等待检查/);
 assert.equal(f.sourceChecks.get(f.archive).report,null);
});

test('draft arriving while sources are checked prevents delivering a ready handoff',async t=>{
 let release;const f=fixture(t,{run:()=>new Promise(resolve=>{release=resolve;})});
 const request=f.prepare();f.setPending({worklog:{entries:[{}]}});
 const targets=(await import('../shared/source-check.js')).sourceTargets(f.archive);
 release(targets.map(x=>({evidenceId:x.evidenceId,path:x.path,memoryIds:x.memoryIds,status:'same'})));
 await assert.rejects(request,/新记录等待检查/);
 assert.equal(f.bridge.status(f.id).latest.receipt,null);
});

test('new saved revision or changed binding during automatic check is never silently handed off',async t=>{
 for(const change of ['revision','binding']){
  let release;const f=fixture(t,{run:()=>new Promise(resolve=>{release=resolve;})});
  const request=f.prepare();if(change==='revision')f.archive.revision++;else f.workspace.unbind(f.id);release([]);
  await assert.rejects(request,/检查期间发生变化/);assert.equal(f.sourceChecks.get(f.archive).report,null);
 }
});

test('a new in-flight check hides an earlier pass from readers until its new result is available',async t=>{
 let release,wait=false;const f=fixture(t,{run:(...args)=>wait?new Promise(resolve=>{release=resolve;}):runSourceWorker(...args)});
 await f.prepare();wait=true;const next=f.prepare();
 assert.equal(f.sourceChecks.get(f.archive).checking,true);assert.equal(f.sourceChecks.get(f.archive).report,null);
 const targets=(await import('../shared/source-check.js')).sourceTargets(f.archive);
 release(targets.map(x=>({evidenceId:x.evidenceId,path:x.path,memoryIds:x.memoryIds,status:'unavailable'})));
 const result=await next;assert.equal(result.sourceCheck.rows[0].status,'unavailable');
});
