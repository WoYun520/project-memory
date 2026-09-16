import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createBundle} from './core.mjs';
import {createWorkspaceConnector} from './workspace.mjs';
import {importWorklog} from './worklog.mjs';
import {createSourceReviews,reviewMarkdown} from './source-review.mjs';
import {createSourceChecks} from './source-check.mjs';
import {createBridge} from './bridge.mjs';
import {prepareHandoff} from './prepare-handoff.mjs';
import {readFileEvidence} from './file-evidence.mjs';

function fixture(t){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'source-review-')),root=path.join(base,'project');fs.mkdirSync(root);const file=path.join(root,'README.md');
 fs.writeFileSync(file,'旧原文：支持键盘操作。\r\n');let a=createBundle('对照合成项目','接续核对'),pending=null;
 const id=a.bundle.project.id,workspace=createWorkspaceConnector({directory:path.join(base,'links')});workspace.bind(id,root);
 const w=workspace.preview(id,['README.md']).worklog;a=importWorklog(a,{worklog:w,selected_ids:[w.entries[0].id],reviewed:true,reviewer:{kind:'agent',id:'Synthetic QA'}}).archive;a.revision=1;
 const loadArchive=()=>a,inbox={get:()=>pending},config={directory:path.join(base,'reviews'),workspace,loadArchive,inbox},sourceReviews=createSourceReviews(config),sourceChecks=createSourceChecks({directory:path.join(base,'checks'),workspace,loadArchive});
 const bridgeConfig={directory:path.join(base,'bridges'),stationRoot:path.resolve('.'),port:4180,workspace,loadArchive,inbox,sourceReviews,sourceReport:a=>sourceChecks.get(a).report},bridge=createBridge(bridgeConfig),dependencies={bridge,sourceChecks,sourceReviews};
 const input={revision:1,evidenceId:a.bundle.evidence.at(-1).id};fs.writeFileSync(file,'新原文：增加触屏操作计划，尚未实现。\n');
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));return {base,root,file,a,id,config,input,sourceReviews,sourceChecks,bridge,bridgeConfig,dependencies,preview:()=>sourceReviews.preview(id,input),prepare:r=>prepareHandoff(dependencies,id,{revision:1,target:'other',task:r.task,sourceReviewId:r.id}),setPending(v){pending=v;}};
}

test('preview preserves old Evidence and captures current text separately; restart and handoff include both and affected IDs without asserting approval',async t=>{
 const f=fixture(t),before=JSON.stringify(f.a),r=await f.preview();assert.equal(r.status,'changed');assert.match(r.old.text,/旧原文/);assert.match(r.current.text,/新原文/);assert.equal(r.memories[0].id,f.a.bundle.memories.at(-1).id);assert.match(r.task,/不修改业务代码/);assert.match(reviewMarkdown(r),/尚未存为正式记忆/);
 assert.equal(JSON.stringify(f.a),before);assert.equal(fs.statSync(path.join(f.config.directory,f.id+'-'+r.id+'.json')).mode&0o777,0o600);
 const restored=createSourceReviews(f.config).get(f.id,r.id);assert.equal(restored.current.text,r.current.text);
 const prepared=await f.prepare(r);assert.equal(prepared.ticket.sourceReviewId,r.id);assert.equal(prepared.ticket.receipt,null);
 const newBridge=createBridge(f.bridgeConfig);const context=newBridge.context(f.id,prepared.ticket.id).context;
 for(const text of ['旧原文','新原文','尚未存为正式记忆',r.memories[0].id,'不正式保存','file_paths'])assert.ok(context.includes(text));assert.equal(JSON.stringify(f.a),before);
 fs.renameSync(f.root,f.root+'-moved');assert.equal(newBridge.context(f.id,prepared.ticket.id).context.includes('新原文'),true);assert.equal(newBridge.status(f.id,prepared.ticket.id).latest.id,prepared.ticket.id);
});

test('prepared comparison identity distinguishes tickets, normal handoff never receives unrelated preview',async t=>{
 const f=fixture(t),r=await f.preview(),p=await f.prepare(r);assert.equal((await f.prepare(r)).ticket.id,p.ticket.id);
 const r2=await f.preview(),next=await f.prepare(r2);assert.notEqual(next.ticket.id,p.ticket.id);
 const normal=await prepareHandoff(f.dependencies,f.id,{revision:1,target:'other',task:'普通任务'});assert.notEqual(normal.ticket.id,next.ticket.id);assert.doesNotMatch(f.bridge.context(f.id,normal.ticket.id).context,/新原文/);
 for(const target of ['codex','claude']){const result=await prepareHandoff(f.dependencies,f.id,{revision:1,target,task:r.task,sourceReviewId:r.id});assert.match(f.bridge.launchPrompt(f.id,result.ticket.id,target),/核对 README.md/);assert.match(f.bridge.context(f.id,result.ticket.id).context,/增加触屏操作计划/);}
});

test('file changed after preview, unavailable file, private file or stale project blocks new ticket creation without altering old snapshot',async t=>{
 const f=fixture(t),r=await f.preview(),before=JSON.stringify(f.a);fs.writeFileSync(f.file,'再次变化');await assert.rejects(f.prepare(r),/再次变化/);assert.equal(f.bridge.status(f.id).latest,null);
 fs.unlinkSync(f.file);await assert.rejects(f.prepare(r),/未能安全读取/);assert.equal(f.bridge.status(f.id).latest,null);
 fs.writeFileSync(f.file,'普通开头\n'.repeat(1300)+'password: synthetic-test-only-value');await assert.rejects(f.preview(),/未能安全读取/);assert.equal(fs.readdirSync(f.config.directory).length,1);assert.doesNotMatch(fs.readFileSync(path.join(f.config.directory,f.id+'-'+r.id+'.json'),'utf8'),/synthetic-test-only-value/);
 assert.equal(JSON.stringify(f.a),before);f.a.revision++;assert.throws(()=>f.sourceReviews.get(f.id,r.id),/版本已更新/);await assert.rejects(f.prepare(r),/版本已变化/);
});

test('preview validates Evidence, privacy and scope before reading; unbound or rebound source cannot use stale preview',async t=>{
 const f=fixture(t);let reads=0;const service=createSourceReviews({...f.config,read:async(...args)=>{reads++;return readFileEvidence(...args);}});
 await assert.rejects(service.preview(f.id,{...f.input,path:'/arbitrary/file'}),/请选择/);
 await assert.rejects(service.preview(f.id,{...f.input,evidenceId:f.id}),/没有可比较/);assert.equal(reads,0);
 const r=await service.preview(f.id,f.input),other=path.join(f.base,'other');fs.mkdirSync(other);f.config.workspace.bind(f.id,other);assert.throws(()=>service.get(f.id,r.id),/连接已变化/);
 f.config.workspace.unbind(f.id);await assert.rejects(service.preview(f.id,f.input),/先连接/);assert.equal(reads,1);
});

test('pending draft, overlapping read and in-flight changes are rejected without premature handoff or lost drafts',async t=>{
 const f=fixture(t),r=await f.preview();f.setPending({worklog:{entries:[{}]}});await assert.rejects(f.prepare(r),/等待检查/);assert.equal(f.bridge.status(f.id).latest,null);f.setPending(null);
 let release;const service=createSourceReviews({...f.config,read:()=>new Promise(resolve=>{release=resolve;})});const p=service.preview(f.id,f.input);await assert.rejects(service.preview(f.id,f.input),/正在读取/);
 f.a.revision++;release(await readFileEvidence(f.config.workspace.getStoredBinding(f.id),['README.md']));await assert.rejects(p,/版本已更新/);
 f.a.revision--;const current=service.assertCurrent(f.id,r.id);f.setPending({worklog:{entries:[{}]}});release(await readFileEvidence(f.config.workspace.getStoredBinding(f.id),['README.md']));await assert.rejects(current,/新记录送达/);
});

test('excerpt equality is not full-file equality; same content is explicitly reported',async t=>{
 const f=fixture(t),body='A'.repeat(4500);fs.writeFileSync(f.file,body+'old');const w=f.config.workspace.preview(f.id,['README.md']).worklog;
 const a=importWorklog(f.a,{worklog:w,selected_ids:[w.entries[0].id],reviewed:true,reviewer:{kind:'agent',id:'Synthetic QA'}}).archive;const config={...f.config,loadArchive:()=>a},service=createSourceReviews(config),input={revision:1,evidenceId:a.bundle.evidence.at(-1).id};
 fs.writeFileSync(f.file,body+'new');const r=await service.preview(f.id,input);assert.equal(r.status,'changed');assert.equal(r.old.text,r.current.text);assert.match(reviewMarkdown(r),/差异也可能在未展示部分/);
 fs.writeFileSync(f.file,body+'old');assert.equal((await service.preview(f.id,input)).status,'same');
});

test('corrupt and cross-project previews fail closed; missing current text never persists a fabricated comparison',async t=>{
 const f=fixture(t),r=await f.preview(),file=path.join(f.config.directory,f.id+'-'+r.id+'.json');
 assert.throws(()=>f.sourceReviews.get(createBundle('另一个项目','').bundle.project.id,r.id),/不可用/);
 const raw=fs.readFileSync(file,'utf8');fs.writeFileSync(file,raw.replace('新原文','伪造原文'));assert.throws(()=>f.sourceReviews.get(f.id,r.id),/校验失败/);assert.match(fs.readFileSync(file,'utf8'),/伪造原文/);
 const broken=createSourceReviews({...f.config,read:async()=>[]});await assert.rejects(broken.preview(f.id,f.input),/未能安全读取/);assert.equal(fs.readdirSync(f.config.directory).length,1);
});
