import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createBundle} from './core.mjs';
import {importWorklog} from './worklog.mjs';
import {createWorkspaceConnector} from './workspace.mjs';
import {createSourceChecks,runSourceWorker} from './source-check.mjs';
import {sourceTargets} from '../shared/source-check.js';
import {compareSources} from './source-check-worker.mjs';
import {renderContext} from './context.mjs';
import {runCLI} from '../memory.mjs';

function setup(t){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'source-check-')),root=path.join(base,'project');fs.mkdirSync(root);
 const workspace=createWorkspaceConnector({directory:path.join(base,'links')});
 let archive=createBundle('来源检查 · 合成项目','减少错误交接');const id=archive.bundle.project.id;
 const put=(name,value)=>{fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),value);};
 workspace.bind(id,root);
 const add=name=>{const worklog=workspace.preview(id,[name]).worklog;archive=importWorklog(archive,{worklog,selected_ids:[worklog.entries[0].id],reviewed:true,reviewer:{kind:'agent',id:'合成核查'}}).archive;archive.revision++;};
 const config={directory:path.join(base,'checks'),workspace,loadArchive:()=>archive},service=createSourceChecks(config);
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));return {base,root,put,workspace,id,add,service,config,get archive(){return archive;}};
}

test('changed content differs from timestamps; read report survives restart and never rewrites memory or snapshots',async t=>{
 const x=setup(t);x.put('README.md','初始文档\n');x.add('README.md');const before=JSON.stringify(x.archive);
 const first=await x.service.check(x.id,x.archive.revision);assert.equal(first.report.rows[0].status,'same');
 fs.utimesSync(path.join(x.root,'README.md'),new Date(),new Date());assert.equal((await x.service.check(x.id,x.archive.revision)).report.rows[0].status,'same');
 x.put('README.md','后来改为新方案\n');const r=(await x.service.check(x.id,x.archive.revision)).report;assert.equal(r.rows[0].status,'changed');
 assert.equal(JSON.stringify(x.archive),before);assert.ok(!JSON.stringify(r).includes('后来改为新方案'));assert.ok(!JSON.stringify(r).includes(x.root));
 assert.deepEqual(createSourceChecks(x.config).get(x.archive).report,r);
 assert.equal(fs.statSync(path.join(x.config.directory,x.id+'.json')).mode&0o777,0o600);
 for(const mode of ['full','focused']){const text=renderContext(x.archive,{mode,task:'继续'},{sourceCheck:r});assert.match(text,/原文已变化/);assert.match(text,/不表示用户确认/);assert.match(text,/初始文档/);assert.ok(text.indexOf('文件来源检查')<text.indexOf('当前项目情况'));}
 // A new snapshot does not erase an older source still used by an accepted claim.
 x.add('README.md');assert.equal(x.service.get(x.archive).report,null);
 assert.deepEqual((await x.service.check(x.id,x.archive.revision)).report.rows.map(r=>r.status),['changed','same']);
});

test('missing, linked, oversized, or private sources stay unknown and leak neither contents nor raw errors',async t=>{
 const x=setup(t);x.put('README.md','原文');x.add('README.md');const file=path.join(x.root,'README.md');
 for(const change of [()=>fs.unlinkSync(file),()=>fs.symlinkSync('/etc/hosts',file),()=>{fs.unlinkSync(file);x.put('README.md','x'.repeat(65537));},()=>x.put('README.md','安全开头\n'.repeat(1200)+'password: synthetic-sensitive-check')]){
  change();const r=(await x.service.check(x.id,x.archive.revision)).report;assert.equal(r.rows[0].status,'unavailable');assert.doesNotMatch(JSON.stringify(r),/synthetic-sensitive|\/etc\/hosts|password/);
 }
});

test('only referenced active file evidence is considered; unsupported paths and absent hashes are not read',t=>{
 const x=setup(t);x.put('README.md','原文');x.add('README.md');
 const targets=sourceTargets(x.archive),binding=x.workspace.getStoredBinding(x.id);
 const bad=[{...targets[0],path:'../outside.md'},{...targets[0],path:'docs/private.md'},{...targets[0],baseline:''},{...targets[0],repository:'other-project'}];
 const rows=compareSources(binding,bad,x.id);assert.deepEqual(rows.map(r=>r.status),['unsupported','unsupported','no_baseline','unsupported']);assert.equal(rows[0].path,'');
 x.archive.bundle.memories.at(-1).lifecycle='superseded';assert.equal(sourceTargets(x.archive).length,0);
 assert.deepEqual(compareSources({directory:'/missing/project'},[],x.id),[]);
});

test('changed binding, revision and damaged report invalidate observations without altering archive',async t=>{
 const x=setup(t);x.put('README.md','原文');x.add('README.md');await x.service.check(x.id,x.archive.revision);
 const before=JSON.stringify(x.archive),other=path.join(x.base,'other');fs.mkdirSync(other);x.workspace.bind(x.id,other);assert.equal(x.service.get(x.archive).report,null);
 await assert.rejects(x.service.check(x.id,x.archive.revision-1),/记忆已更新/);
 fs.writeFileSync(path.join(x.config.directory,x.id+'.json'),'broken');assert.equal(x.service.get(x.archive).report,null);assert.equal(fs.readFileSync(path.join(x.config.directory,x.id+'.json'),'utf8'),'broken');
 assert.equal(JSON.stringify(x.archive),before);
});

test('changing archive during an in-flight check rejects stale results; overlapping check is bounded',async t=>{
 const x=setup(t);x.put('README.md','原文');x.add('README.md');let release;
 const service=createSourceChecks({...x.config,run:()=>new Promise(resolve=>{release=resolve;})});
 const pending=service.check(x.id,x.archive.revision);
 await assert.rejects(service.check(x.id,x.archive.revision),/正在运行/);
 x.archive.revision++;release([]);await assert.rejects(pending,/检查期间发生变化/);assert.equal(service.get(x.archive).report,null);
});

test('blocked worker times out while the main event loop remains responsive',async()=>{
 const workerURL=new URL('data:text/javascript,while(true){}');let ticked=false;
 setTimeout(()=>{ticked=true;},5);
 await assert.rejects(runSourceWorker({},[],'synthetic',{workerURL,timeoutMs:80}),/暂时无法完成/);assert.equal(ticked,true);
});

test('CLI includes matching derived report but not a report from a different saved version',async t=>{
 const x=setup(t);x.put('README.md','原文');x.add('README.md');x.put('README.md','变化');const result=await x.service.check(x.id,x.archive.revision);
 const request=async({pathname})=>pathname.endsWith('/source-check')?result:x.archive;
 assert.match((await runCLI(['context',x.id],{request,env:{}})).output,/原文已变化/);
 result.report.revision++;assert.doesNotMatch((await runCLI(['context',x.id],{request,env:{}})).output,/文件来源检查/);
});
