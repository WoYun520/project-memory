import {Worker} from 'node:worker_threads';
import {hash} from './core.mjs';
import {documentPath} from './workspace.mjs';
import {previewWorklog,worklogRequestFingerprint} from './worklog.mjs';

export function readFileEvidence(binding,paths,{timeoutMs=6000}={}){
 return new Promise(resolve=>{
  const worker=new Worker(new URL('./file-evidence-worker.mjs',import.meta.url),{workerData:{binding,paths}});let done=false;
  const finish=value=>{if(done)return;done=true;clearTimeout(timer);void worker.terminate();resolve(value);};
  const timer=setTimeout(()=>finish([]),timeoutMs);
  worker.once('message',value=>finish(Array.isArray(value?.files)?value.files:[]));worker.once('error',()=>finish([]));worker.once('exit',()=>finish([]));
 });
}

export function createFileAttachments({workspace,loadArchive,inbox,read=readFileEvidence}){
 const pending=new Set();
 return {async enrich(id,work){
  const archive=loadArchive(id),plan=previewWorklog(archive,work);
  // Legacy submissions retain the existing conflict-review and holding workflow.
  if(!work.entries.some(e=>e.file_paths))return work;
  const requestOnly=!work.entries.some(e=>e.file_evidence||e.file_notes);
  const previous=inbox.get(id);
  if(previous){
   if(hash(JSON.stringify(previous.worklog))===hash(JSON.stringify(work))||(requestOnly&&worklogRequestFingerprint(previous.worklog)===worklogRequestFingerprint(work)))return previous.worklog;
   throw Error('已有一批记录等待检查，请先处理；不会覆盖原草稿。');
  }
  if(plan.entries.some(e=>e.status==='conflict'))throw Error('相同工作编号已有不同内容，请核对原记录，不会重新读取文件。');
  const fresh=new Set(plan.entries.filter(e=>e.status==='new').map(e=>e.id));
  const wanted=work.entries.filter(e=>fresh.has(e.id)&&e.file_paths&&!e.file_evidence&&!e.file_notes);
  if(!wanted.length)return work;
  const paths=[...new Set(wanted.flatMap(e=>e.file_paths))];
  if(paths.length>8||paths.some(p=>!documentPath(p)))throw Error('每批最多附带 8 份允许的项目说明文件，不读取代码、隐藏文件、敏感文件或越界路径。');
  if(pending.has(id)||pending.size>=2)throw Error('正在接收附带文件，请稍后重试同一批记录。');
  const binding=workspace.getStoredBinding(id),key=hash(JSON.stringify([archive,binding]));pending.add(id);
  try{
   let files=[];try{if(binding)files=await read(binding,paths);}catch{}
   if(hash(JSON.stringify([loadArchive(id),workspace.getStoredBinding(id)]))!==key)throw Error('读取期间记忆或文件夹连接发生变化，请重试同一批记录。');
   if(inbox.get(id))throw Error('已有另一批新记录送达，请先处理；不会覆盖。');
   const enriched=structuredClone(work);
   for(const entry of enriched.entries.filter(e=>wanted.some(w=>w.id===e.id))){
    const sources=[],notes=[];
    for(const p of entry.file_paths){const captured=files.find(f=>f.path===p)?.source;if(captured)sources.push(captured);else notes.push(`${p}：${binding?'未能安全读取，没有附上原文':'尚未连接项目文件夹，没有读取原文'}。`);}
    if(sources.length)entry.file_evidence=sources;if(notes.length)entry.file_notes=notes;
   }
   previewWorklog(archive,enriched);return enriched;
  }finally{pending.delete(id);}
 }};
}
