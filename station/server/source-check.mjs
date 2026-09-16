import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {sourceTargets,sourceLabels} from '../shared/source-check.js';
import {documentPath} from './workspace.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure=()=>Error('来源检查暂时无法完成。请检查项目位置和文件读取权限，再重试；已有原文未更改。');
export function runSourceWorker(binding,targets,projectId,{timeoutMs=12000,workerURL=new URL('./source-check-worker.mjs',import.meta.url)}={}){
 return new Promise((resolve,reject)=>{
  const worker=new Worker(workerURL,{workerData:{binding,targets,projectId}});let done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);void worker.terminate();error?reject(failure()):resolve(value);};
  const timer=setTimeout(()=>finish(true),timeoutMs);
  worker.once('message',value=>finish(!Array.isArray(value?.rows),value?.rows));
  worker.once('error',()=>finish(true));worker.once('exit',()=>{if(!done)finish(true);});
 });
}

// Derived observations live outside the archive; reading a report never reads project files.
export function createSourceChecks({directory,workspace,loadArchive,run=runSourceWorker}){
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 if(fs.lstatSync(directory).isSymbolicLink())throw Error('来源检查设置目录无效。');
 const pending=new Set();
 const file=id=>{if(!/^[a-f0-9-]{36}$/.test(id))throw Error('项目编号无效。');return path.join(directory,id+'.json');};
 function state(a){const binding=workspace.getStoredBinding(a.bundle.project.id);return {binding,key:hash([a,binding])};}
 function get(a,{afterCheck=false}={}){
  const targets=sourceTargets(a),base={count:targets.length,report:null};
  try{
   const current=state(a);base.connected=!!current.binding;
   if(pending.has(a.bundle.project.id)&&!afterCheck)return {...base,checking:true};
   const target=file(a.bundle.project.id),stat=fs.lstatSync(target);
   if(stat.isSymbolicLink()||!stat.isFile()||stat.size>1_000_000)throw failure();
   const saved=JSON.parse(fs.readFileSync(target,'utf8'));
   if(saved.key!==current.key)return base;
   const r=saved.report;
   if(!r||r.revision!==a.revision||!Number.isFinite(Date.parse(r.checkedAt))||(r.outcome!==undefined&&!['complete','failed','not_connected','no_sources'].includes(r.outcome))||!Array.isArray(r.rows)||r.rows.length!==targets.length||r.rows.some((row,i)=>row.evidenceId!==targets[i].evidenceId||JSON.stringify(row.memoryIds)!==JSON.stringify(targets[i].memoryIds)||!Object.hasOwn(sourceLabels,row.status)||typeof row.path!=='string'||(row.path!==''&&row.path!==targets[i].path)))throw failure();
   return {...base,report:{revision:r.revision,checkedAt:r.checkedAt,...(r.outcome?{outcome:r.outcome}:{}),rows:r.rows.map(row=>({evidenceId:row.evidenceId,path:row.path,memoryIds:row.memoryIds,status:row.status}))}};
  }catch(e){return {...base,...(e.code==='ENOENT'?{}:{error:'上次来源检查不可用，请重新检查。'})};}
 }
 return {get,async check(id,revision,{forHandoff=false}={}){
  const a=loadArchive(id);if(a.revision!==revision)throw Error('记忆已更新，请刷新页面后再检查。');
  const initial=state(a);if(!initial.binding&&!forHandoff)throw Error('请先连接这个项目的文件夹。');
  if(pending.has(id)||pending.size>=2)throw Error('已有来源检查正在运行，请稍后重试。');
  pending.add(id);
  try{
   const targets=sourceTargets(a);let rows,outcome='complete';
   const unavailable=()=>targets.map(t=>({evidenceId:t.evidenceId,path:documentPath(t.path)?t.path:'',memoryIds:t.memoryIds,status:'unavailable'}));
   if(forHandoff&&!targets.length){rows=[];outcome='no_sources';}
   else if(forHandoff&&!initial.binding){rows=unavailable();outcome='not_connected';}
   else try{rows=await run(initial.binding,targets,id);}catch(e){if(!forHandoff)throw e;rows=unavailable();outcome='failed';}
   if(state(loadArchive(id)).key!==initial.key)throw Error('记忆或项目位置在检查期间发生变化，请重新检查。');
   const report={revision:a.revision,checkedAt:new Date().toISOString(),...(forHandoff?{outcome}:{}),rows},target=file(id),temp=target+'.'+randomUUID()+'.tmp';
   try{fs.writeFileSync(temp,JSON.stringify({key:initial.key,report}),{flag:'wx',mode:0o600});fs.renameSync(temp,target);}finally{fs.rmSync(temp,{force:true});}
   const result=get(a,{afterCheck:true});if(!result.report)throw failure();return result;
  }finally{pending.delete(id);}
 }};
}
