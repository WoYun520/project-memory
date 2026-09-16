import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createBundle} from './core.mjs';
import {createInbox} from './inbox.mjs';
import {createGrokWork} from './grok-work.mjs';

function setup(t,options={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'grok-work-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const archive=createBundle('合成项目','保留原始依据与项目目标');archive.revision=3;
 const other=createBundle('另一个合成项目','');other.revision=1;
 const archives=new Map([[archive.bundle.project.id,archive],[other.bundle.project.id,other]]);
 const calls=[];let cancellations=0;
 const inbox=createInbox();
 const dependencies={directory,loadArchive:projectId=>{const value=archives.get(projectId);if(!value)throw Error('Missing');return structuredClone(value);},inbox,
  detect:async()=>({available:true,version:'1.0.30',executable:process.execPath,message:'就绪'}),
  launch:args=>{calls.push(args);return {cancel(){cancellations++;}};},...options};
 const work=createGrokWork(dependencies);
 return {directory,archive,other,archives,inbox,calls,work,dependencies,cancellations:()=>cancellations};
}

test('启动携带当时最新完整记忆与明确未确认提示，不发送未保存草稿',async t=>{
 const f=setup(t),projectId=f.archive.bundle.project.id,baseline=JSON.stringify(f.archive);
 const run=await f.work.start(projectId,{task:'整理下一步方案'});
 assert.equal(run.status,'running');assert.equal(run.mode,'read');assert.equal(run.revision,3);
 const prompt=fs.readFileSync(f.calls[0].promptFile,'utf8');
 assert.match(prompt,/未记录用户确认/);assert.match(prompt,/没有文件、终端、网络/);assert.match(prompt,/本次已保存版本：3/);
 assert.equal(JSON.stringify(f.archive),baseline);assert.equal(f.inbox.get(projectId),null);
});

test('正常结果自动送入AI建议草稿，原答逐字保留，不批准或写正式记忆',async t=>{
 const f=setup(t),projectId=f.archive.bundle.project.id,before=JSON.stringify(f.archive);
 const run=await f.work.start(projectId,{task:'整理下一步方案'});
 f.calls[0].onFinish({status:'completed',text:'建议先整理页面结构。这是方案，尚未实施。'});
 const done=f.work.get(projectId,run.id),draft=f.inbox.get(projectId);
 assert.equal(done.status,'completed');assert.equal(done.draft.status,'queued');
 assert.equal(draft.worklog.entries[0].source.text,done.answer);
 assert.equal(draft.worklog.entries[0].origin,'inference');
 assert.equal(draft.worklog.entries[0].source.speaker.kind,'agent');
 assert.equal(draft.worklog.entries[0].confirmed,undefined);assert.equal(JSON.stringify(f.archive),before);
});

test('已有草稿时保留两份结果，重启后可重试投递且不会重复生成',async t=>{
 const f=setup(t),projectId=f.archive.bundle.project.id;
 const one=await f.work.start(projectId,{task:'第一项建议'});
 f.calls[0].onFinish({status:'completed',text:'第一份建议，尚未实施。'});
 const previous=JSON.stringify(f.inbox.get(projectId));
 const two=await f.work.start(projectId,{task:'第二项建议'});
 f.calls[1].onFinish({status:'completed',text:'第二份建议，尚未实施。'});
 assert.equal(f.work.get(projectId,two.id).draft.status,'waiting');assert.equal(JSON.stringify(f.inbox.get(projectId)),previous);
 const recovered=createGrokWork(f.dependencies);
 assert.equal(recovered.get(projectId,two.id).answer,'第二份建议，尚未实施。');
 f.inbox.consume(projectId,f.inbox.get(projectId).id);
 assert.equal(recovered.retryDraft(projectId,two.id).draft.status,'queued');
 const staged=f.inbox.get(projectId).id;
 recovered.retryDraft(projectId,two.id);assert.equal(f.inbox.get(projectId).id,staged);
 assert.equal(recovered.get(projectId,one.id).status,'completed');
});

test('跨项目与并发启动被拒绝；停止后迟到完成不能回收草稿',async t=>{
 const f=setup(t),projectId=f.archive.bundle.project.id;
 const run=await f.work.start(projectId,{task:'整理方案'});
 await assert.rejects(f.work.start(f.other.bundle.project.id,{task:'整理'}),/正在进行/);
 assert.throws(()=>f.work.get(f.other.bundle.project.id,run.id),/没有找到/);
 f.work.cancel(projectId,run.id);assert.equal(f.cancellations(),1);
 f.calls[0].onFinish({status:'completed',text:'不应保存这份迟到结果。'});
 assert.equal(f.work.get(projectId,run.id).status,'cancelled');assert.equal(f.inbox.get(projectId),null);
});

test('空结果、失败与疑似隐私不保存原答，不进入草稿',async t=>{
 const f=setup(t),projectId=f.archive.bundle.project.id;
 for(const result of [{status:'failed',message:'无法连接'},{status:'completed',text:''},{status:'completed',text:'合成检查值 password = fake-test-value'}]){
  const run=await f.work.start(projectId,{task:'整理方案'});f.calls.at(-1).onFinish(result);
  const stored=f.work.get(projectId,run.id);
  assert.equal(stored.status,'failed');assert.equal(stored.answer,undefined);assert.equal(f.inbox.get(projectId),null);
  assert.ok(!fs.readFileSync(path.join(f.directory,run.id,'run.json'),'utf8').includes('fake-test-value'));
 }
});

test('重启将进行中任务标为中断，不启动进程或猜测完成',async t=>{
 const f=setup(t),projectId=f.archive.bundle.project.id;
 const run=await f.work.start(projectId,{task:'整理方案'});
 const recovered=createGrokWork(f.dependencies);
 assert.equal(recovered.get(projectId,run.id).status,'interrupted');assert.equal(f.calls.length,1);
 assert.equal(f.inbox.get(projectId),null);
});

test('修改模式、隐私任务与旧版本启动在执行前拒绝，异步探测也受启动锁保护',async t=>{
 let release;const waiting=new Promise(resolve=>release=resolve);
 const f=setup(t,{detect:async()=>{await waiting;return {available:true,executable:process.execPath};}}),projectId=f.archive.bundle.project.id;
 await assert.rejects(f.work.start(projectId,{task:'修改',mode:'edit'}),/暂不开放/);
 await assert.rejects(f.work.start(projectId,{task:'合成检查 password = fake-test-value'}),/隐私/);
 await assert.rejects(f.work.start(projectId,{task:'整理',revision:2}),/更新/);
 const pending=f.work.start(projectId,{task:'整理'});
 await assert.rejects(f.work.start(projectId,{task:'再次启动'}),/正在进行/);
 release();await pending;assert.equal(f.calls.length,1);
});

test('工作后项目更新时保留原开工版本并提示，长回答分段仍可完整还原',async t=>{
 const f=setup(t),projectId=f.archive.bundle.project.id,run=await f.work.start(projectId,{task:'整理方案'});
 f.archive.revision=4;
 const answer='方案草稿🙂'.repeat(1600);
 f.calls[0].onFinish({status:'completed',text:answer});
 const done=f.work.get(projectId,run.id),draft=f.inbox.get(projectId);
 assert.match(done.draft.message,/版本 3/);assert.equal(done.revision,3);
 assert.equal(draft.worklog.entries.map(e=>e.source.text).join(''),answer);
 assert.ok(draft.worklog.entries.every(e=>e.source.redacted));
});

test('提示文件准备失败释放名额，后续仍可正常开始',async t=>{
 const f=setup(t),projectId=f.archive.bundle.project.id,original=fs.writeFileSync;
 fs.writeFileSync=function(file,...args){if(String(file).endsWith('prompt.txt'))throw Error('synthetic disk failure');return original.call(this,file,...args);};
 let run;try{run=await f.work.start(projectId,{task:'准备失败'});}finally{fs.writeFileSync=original;}
 assert.equal(run.status,'failed');assert.equal(f.calls.length,0);
 const next=await f.work.start(projectId,{task:'恢复后继续'});assert.equal(next.status,'running');assert.equal(f.calls.length,1);
});

test('取消时即使工作状态写入失败，也会实际终止进程',async t=>{
 const f=setup(t),projectId=f.archive.bundle.project.id,run=await f.work.start(projectId,{task:'整理方案'}),original=fs.renameSync;
 fs.renameSync=function(){throw Error('synthetic disk failure');};
 let cancelled;try{cancelled=f.work.cancel(projectId,run.id);}finally{fs.renameSync=original;}
 assert.equal(f.cancellations(),1);assert.equal(cancelled.status,'cancelled');assert.match(cancelled.message,/写入失败/);
 f.calls[0].onFinish({status:'completed',text:'迟到的输出'});assert.equal(f.inbox.get(projectId),null);
});
