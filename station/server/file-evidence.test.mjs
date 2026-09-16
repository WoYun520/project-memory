import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createBundle,hash,validateArchive} from './core.mjs';
import {createWorkspaceConnector} from './workspace.mjs';
import {createInbox} from './inbox.mjs';
import {createFileAttachments,readFileEvidence} from './file-evidence.mjs';
import {importWorklog,previewWorklog} from './worklog.mjs';
import {sourceTargets} from '../shared/source-check.js';
import {compareSources} from './source-check-worker.mjs';
import {renderContext} from './context.mjs';
import {parseWorklogText,fileAttachmentReceipt} from '../shared/worklog.js';
import {triageWork} from '../shared/work-triage.js';

function setup(t){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'file-evidence-')),root=path.join(base,'project');fs.mkdirSync(root);
 let archive=createBundle('文件原文合成项目','附带相关文件');const id=archive.bundle.project.id;
 const workspace=createWorkspaceConnector({directory:path.join(base,'links')}),inbox=createInbox({directory:path.join(base,'inbox'),loadArchive:()=>archive});
 const put=(name,text)=>{const p=path.join(root,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);return p;};
 workspace.bind(id,root);const config={workspace,inbox,loadArchive:()=>archive},service=createFileAttachments(config);
 const work=(extras={})=>({format:'project-memory-worklog',version:'0.1',project_id:id,session:{id:'synthetic-work',agent:'Codex',actor:{kind:'agent',id:'Codex'}},entries:[{id:'result',kind:'fact',title:'说明文档已更新',detail:'本次修改说明文档，实际运行仍待核对。',origin:'observation',source:{speaker:{kind:'agent',id:'Codex'},text:'AI 本轮观察，未声明用户验收。'},file_paths:['README.md'],...extras}]});
 const save=(w,ids=w.entries.map(e=>e.id))=>{archive=importWorklog(archive,{worklog:w,selected_ids:ids,reviewed:true,reviewer:{kind:'agent',id:'Codex synthetic review'}}).archive;return archive;};
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));return {base,root,id,workspace,inbox,put,work,save,service,config,get archive(){return archive;}};
}

test('one claim keeps AI report and exact file snapshot separately; save preserves history and connects source checks and handoff',async t=>{
 const x=setup(t),raw='\uFEFF # 说明文档已更新\r\n仅是一份设计说明。\r\n';x.put('README.md',raw);x.put('docs/unselected.md','不应读取的文件');
 const before=JSON.stringify(x.archive),w=x.work(),enriched=await x.service.enrich(x.id,w);
 assert.equal(JSON.stringify(x.archive),before);assert.equal(w.entries[0].file_evidence,undefined);assert.deepEqual(enriched.entries[0].source,w.entries[0].source);
 const file=enriched.entries[0].file_evidence[0];assert.equal(file.text,raw);assert.equal(file.file.content_sha256,hash(raw));assert.equal(file.speaker.kind,'tool');assert.equal(file.redacted,false);
 assert.equal(parseWorklogText(JSON.stringify(enriched)).entries.length,1);assert.match(fileAttachmentReceipt(enriched),/已附 1 份，未附 0 份/);
 const old=structuredClone(x.archive),a=x.save(enriched),m=a.bundle.memories.at(-1),e=a.bundle.evidence.at(-1);
 assert.equal(a.bundle.memories.length,old.bundle.memories.length+1);assert.equal(m.evidence.length,2);assert.equal(m.evidence.at(-1).relation,'context');assert.equal(e.kind,'file');assert.equal(a.snapshots[e.snapshot.path],raw);assert.equal(m.by.id,'Codex');assert.equal(m.verification.status,'unverified');assert.equal(m.approval,undefined);assert.equal(e.privacy.reviewed_by.kind,'agent');
 for(const [p,body]of Object.entries(old.snapshots))assert.equal(a.snapshots[p],body);assert.equal(validateArchive(a),true);
 assert.deepEqual(sourceTargets(a)[0].memoryIds,[m.id]);x.put('README.md','更新后的文件，旧快照不可被替换。');assert.equal(compareSources(x.workspace.getStoredBinding(x.id),sourceTargets(a),x.id)[0].status,'changed');assert.equal(a.snapshots[e.snapshot.path],raw);
 for(const mode of ['full','focused']){const text=renderContext(a,{mode,task:'说明文档已更新'});assert.match(text,/AI 本轮观察/);assert.match(text,/仅是一份设计说明/);assert.match(text,/README.md/);}
});

test('same pending request reuses captured bytes across restart; saved request retries without rereading changed files',async t=>{
 const x=setup(t);x.put('README.md','第一份原文');const w=x.work(),first=await x.service.enrich(x.id,w),draft=x.inbox.stage(x.archive,{worklog:first,sourceReviewed:true});
 x.put('README.md','后来才改变的文件');const noRead=createFileAttachments({...x.config,read:()=>{throw Error('should not read');}});
 const retry=await noRead.enrich(x.id,w);assert.deepEqual(retry,first);assert.equal(x.inbox.stage(x.archive,{worklog:retry,sourceReviewed:true}).id,draft.id);
 x.save(retry);x.inbox.consume(x.id,draft.id);const savedRetry=await noRead.enrich(x.id,w);assert.equal(previewWorklog(x.archive,savedRetry).entries[0].status,'duplicate');assert.equal(x.inbox.stage(x.archive,{worklog:savedRetry,sourceReviewed:true}).alreadyImported,true);
 const altered=structuredClone(first);altered.entries[0].file_evidence[0].text='试图覆盖原快照';assert.equal(previewWorklog(x.archive,altered).entries[0].status,'conflict');await assert.rejects(x.service.enrich(x.id,altered),/已有不同内容/);
 const next=structuredClone(w);next.session.id='new-work';assert.equal((await x.service.enrich(x.id,next)).entries[0].file_evidence[0].text,'后来才改变的文件');
});

test('full-file privacy scan before excerpt; failures attach notes without content while safe selected source survives',async t=>{
 const x=setup(t);x.put('README.md','安全原文');x.put('docs/risk.md','正常开头\n'.repeat(1200)+'password: synthetic-sensitive-fixture');x.put('docs/large.md','x'.repeat(65537));
 const w=x.work({file_paths:['README.md','docs/risk.md','docs/large.md','docs/missing.md']}),enriched=await x.service.enrich(x.id,w);assert.equal(enriched.entries[0].file_evidence.length,1);assert.equal(enriched.entries[0].file_notes.length,3);
 const draft=x.inbox.stage(x.archive,{worklog:enriched,sourceReviewed:true});assert.doesNotMatch(JSON.stringify(draft),/synthetic-sensitive-fixture|正常开头/);assert.doesNotMatch(fs.readFileSync(path.join(x.base,'inbox',x.id+'.json'),'utf8'),/synthetic-sensitive-fixture/);
 assert.match(fileAttachmentReceipt(enriched),/已附 1 份，未附 3 份/);assert.equal(x.archive.bundle.evidence.filter(e=>e.kind==='file').length,0);
 const triage=triageWork(previewWorklog(x.archive,enriched).entries,x.archive);assert.equal(triage.counts.attention,1);assert.deepEqual(triage.recommendedIds,[]);
});

test('symlinks never import outside data; truncated evidence retains full-file baseline; worker timeout returns no result',async t=>{
 const x=setup(t);const outside=path.join(x.base,'outside.md');fs.writeFileSync(outside,'outside sentinel');fs.mkdirSync(path.join(x.root,'docs'));fs.symlinkSync(outside,path.join(x.root,'docs/linked.md'));
 const raw='测试段落'.repeat(1400);x.put('README.md',raw);const enriched=await x.service.enrich(x.id,x.work({file_paths:['README.md','docs/linked.md']})),e=enriched.entries[0];
 assert.equal(e.file_evidence.length,1);assert.equal(e.file_notes.length,1);assert.doesNotMatch(JSON.stringify(enriched),/outside sentinel/);assert.equal(e.file_evidence[0].redacted,true);assert.equal(e.file_evidence[0].file.content_sha256,hash(raw));assert.ok(e.file_evidence[0].text.length<raw.length);
 assert.deepEqual(await readFileEvidence(x.workspace.getStoredBinding(x.id),['README.md'],{timeoutMs:0}),[]);
});

test('invalid and private paths, forged human file source, excess files and oversized batches fail before persistence',async t=>{
 const x=setup(t);let reads=0;const service=createFileAttachments({...x.config,read:async()=>{reads++;return [];}});
 for(const p of ['../README.md','/README.md','.env','docs/private.md','src/app.js','docs/../README.md','docs\\plan.md'])await assert.rejects(service.enrich(x.id,x.work({file_paths:[p]})));
 await assert.rejects(service.enrich(x.id,x.work({file_paths:['README.md','README.md']})));
 const over=x.work();over.entries=[0,1,2].map(i=>({...over.entries[0],id:String(i),file_paths:[0,1,2].map(j=>`docs/file${i}${j}.md`)}));await assert.rejects(service.enrich(x.id,over),/最多附带 8/);
 const forged=x.work({file_evidence:[{speaker:{kind:'human',id:'local-user'},text:'不可伪造确认',file:{path:'README.md',content_sha256:'a'.repeat(64)}}]});await assert.rejects(service.enrich(x.id,forged),/工具观察/);
 await assert.rejects(service.enrich(x.id,x.work({detail:'x'.repeat(300001)})),/300 KB/);assert.equal(reads,0);assert.equal(x.inbox.get(x.id),null);
});

test('no paths leaves legacy untouched; missing binding or unavailable reader records unknown without falsely adding sources',async t=>{
 const x=setup(t),w=x.work();delete w.entries[0].file_paths;let reads=0;const service=createFileAttachments({...x.config,read:async()=>{reads++;return [];}});
 assert.deepEqual(await service.enrich(x.id,w),w);assert.equal(reads,0);
 let enriched=await service.enrich(x.id,x.work());assert.equal(enriched.entries[0].file_evidence,undefined);assert.match(enriched.entries[0].file_notes[0],/未能安全读取/);
 x.workspace.unbind(x.id);enriched=await service.enrich(x.id,x.work());assert.match(enriched.entries[0].file_notes[0],/尚未连接/);assert.equal(reads,1);
});

test('in-flight project changes and competing drafts reject capture without overwriting; overlap bounded',async t=>{
 const x=setup(t);let release;const service=createFileAttachments({...x.config,read:()=>new Promise(resolve=>{release=resolve;})});
 const first=service.enrich(x.id,x.work());await assert.rejects(service.enrich(x.id,x.work()),/正在接收/);x.archive.revision++;release([]);await assert.rejects(first,/发生变化/);assert.equal(x.inbox.get(x.id),null);
 const second=service.enrich(x.id,x.work()),other=x.work();other.session.id='other';delete other.entries[0].file_paths;const draft=x.inbox.stage(x.archive,{worklog:other,sourceReviewed:true});release([]);await assert.rejects(second,/另一批/);assert.equal(x.inbox.get(x.id).id,draft.id);
 await assert.rejects(service.enrich(x.id,x.work()),/已有一批/);assert.equal(x.inbox.get(x.id).id,draft.id);
});

test('saving a subset excludes unchecked file contents; editing a claim never edits attached text',async t=>{
 const x=setup(t);x.put('README.md','selected evidence');x.put('docs/later.md','unchecked sentinel');const w=x.work();w.entries.push({...w.entries[0],id:'later',title:'不保存这条',file_paths:['docs/later.md']});
 const enriched=await x.service.enrich(x.id,w),a=importWorklog(x.archive,{worklog:enriched,selected_ids:['result'],reviewed:true,reviewer:{kind:'agent',id:'Synthetic QA'},edits:{result:{detail:'调整后的说明'}}}).archive;
 assert.doesNotMatch(JSON.stringify(a),/unchecked sentinel|不保存这条/);assert.equal(a.bundle.memories.at(-1).data.statement,'调整后的说明');assert.equal(Object.values(a.snapshots).at(-1),'selected evidence');assert.equal(x.archive.bundle.evidence.filter(e=>e.kind==='file').length,0);
});
