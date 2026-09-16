import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {previewWorklog} from './worklog.mjs';
import {hash} from './core.mjs';

// Production stores only checked drafts, separately from formal project memory.
export function createInbox({limit=20,directory,loadArchive}={}) {
 const drafts=new Map(),held=new Map(),validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
 if(directory){if(typeof loadArchive!=='function')throw Error('持久草稿需要项目读取器。');fs.mkdirSync(directory,{recursive:true,mode:0o700});if(!fs.lstatSync(directory).isDirectory())throw Error('草稿目录无效。');}
 const file=id=>{if(!validId(id))throw Error('项目编号无效。');return path.join(directory,id+'.json');};
 const remove=id=>{if(directory){try{fs.unlinkSync(file(id));}catch(e){if(e.code!=='ENOENT')throw e;}}else drafts.delete(id);};
 function checkedDraft(draft,projectId,label='草稿'){
  try{
   if(!draft||!validId(draft.id)||!Number.isFinite(Date.parse(draft.receivedAt))||draft.worklog?.project_id!==projectId||draft.fingerprint!==hash(JSON.stringify(draft.worklog)))throw Error('invalid');
   const archive=loadArchive?loadArchive(projectId):{bundle:{project:{id:projectId}}};previewWorklog(archive,draft.worklog);
   return archive;
  }catch{throw Error(`本机${label}校验未通过，已保留原文件；不会自动导入或覆盖。`);}
 }
 function readDraft(target,projectId,label='草稿'){
  let draft;
  try{const stat=fs.lstatSync(target);if(!stat.isFile()||stat.size>350000)throw Error('invalid');draft=JSON.parse(fs.readFileSync(target,'utf8'));}
  catch(e){if(e.code==='ENOENT')return null;throw Error(`本机${label}文件无法读取，已保留原文件；不会覆盖，请先检查。`);}
  return draft;
 }
 function get(projectId){
  const draft=directory?readDraft(file(projectId),projectId):drafts.get(projectId);
  if(!draft)return null;
  const archive=checkedDraft(draft,projectId);
  // A durable project receipt is authoritative, even if cleanup is temporarily denied.
  if(archive.inbox_receipts?.some(r=>r.id===draft.id)){try{remove(projectId);}catch{}return null;}
  return structuredClone(draft);
 }
 function heldDirectory(projectId,create=false){
  if(!validId(projectId))throw Error('项目编号无效。');
  const root=path.join(directory,'held'),target=path.join(root,projectId);
  for(const part of [root,target]){
   try{if(create)fs.mkdirSync(part,{recursive:true,mode:0o700});if(!fs.lstatSync(part).isDirectory())throw Error('invalid');}
   catch(e){if(!create&&e.code==='ENOENT')return null;throw Error('本机暂存目录无法使用，原草稿已保留；请检查后重试。');}
  }
  return target;
 }
 function readHeld(projectId,draftId){
  if(!validId(projectId)||!validId(draftId))throw Error('项目或草稿编号无效。');
  if(!directory){const draft=held.get(projectId)?.get(draftId);if(!draft)return null;checkedDraft(draft,projectId,'暂存草稿');return structuredClone(draft);}
  const target=heldDirectory(projectId);if(!target)return null;
  const draft=readDraft(path.join(target,draftId+'.json'),projectId,'暂存草稿');
  if(draft&&draft.id!==draftId)throw Error('本机暂存草稿编号不匹配，已保留原文件；不会覆盖。');
  if(draft)checkedDraft(draft,projectId,'暂存草稿');
  return draft;
 }
 const heldResult=draft=>({held:true,id:draft.id,count:draft.worklog.entries.length});
 function put(projectId,draft){
  if(!directory){drafts.set(projectId,structuredClone(draft));return;}
  const target=file(projectId),tmp=target+'.'+randomUUID()+'.tmp';let fd;
  try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(draft));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,target);}
  catch(e){if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch{}throw e;}
 }
 return {
  get,
  hold(projectId,draftId){
   // Retrying an older hold must never move a newer pending batch.
   const previous=readHeld(projectId,draftId);if(previous)return heldResult(previous);
   const draft=get(projectId);if(!draft||draft.id!==draftId)throw Error('待检查记录已变化或不存在，请刷新后重新检查；不会暂存其他批次。');
   if(directory){
    const target=path.join(heldDirectory(projectId,true),draftId+'.json');
    try{fs.renameSync(file(projectId),target);}catch{throw Error('暂存未完成，原草稿已保留在待检查区；请检查本机文件权限后重试。');}
   }else{
    if(!held.has(projectId))held.set(projectId,new Map());held.get(projectId).set(draftId,structuredClone(draft));drafts.delete(projectId);
   }
   return heldResult(draft);
  },
  listHeld(projectId){
   if(!validId(projectId))throw Error('项目编号无效。');
   let ids;
   if(directory){
    const target=heldDirectory(projectId);if(!target)return [];
    try{ids=fs.readdirSync(target).filter(name=>/^[a-f0-9-]{36}\.json$/.test(name)).map(name=>name.slice(0,-5));}
    catch{throw Error('暂存记录暂时无法读取，原文件已保留；请检查后重试。');}
   }else ids=[...(held.get(projectId)?.keys()||[])];
   return ids.map(id=>readHeld(projectId,id)).filter(Boolean).map(draft=>({id:draft.id,receivedAt:draft.receivedAt,
    session:structuredClone(draft.worklog.session),count:draft.worklog.entries.length,titles:draft.worklog.entries.map(entry=>entry.title)}))
    .sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)||a.id.localeCompare(b.id));
  },
  restore(projectId,draftId){
   if(!validId(projectId)||!validId(draftId))throw Error('项目或草稿编号无效。');
   if(get(projectId))throw Error('已有一批记录等待检查，请先处理或暂存；不会覆盖原草稿。');
   const draft=readHeld(projectId,draftId);if(!draft)throw Error('这批暂存记录不存在，可能已经恢复；请刷新后检查。');
   if(directory){
    const source=path.join(heldDirectory(projectId),draftId+'.json');
    try{fs.renameSync(source,file(projectId));}catch{throw Error('恢复未完成，原草稿仍在暂存区；请检查本机文件权限后重试。');}
   }else{drafts.set(projectId,structuredClone(draft));held.get(projectId).delete(draftId);}
   return {restored:true,draft:structuredClone(draft)};
  },
  stage(archive,input){
   if(input.sourceReviewed!==true)throw Error('提交前请在本机排除凭据和隐私。');
   const plan=previewWorklog(archive,input.worklog),projectId=archive.bundle.project.id;
   const fingerprint=hash(JSON.stringify(input.worklog)),previous=get(projectId);
   if(previous){if(previous.fingerprint===fingerprint)return previous;throw Error('已有一批记录等待检查，请先处理；不会覆盖原草稿。');}
   const count=directory?fs.readdirSync(directory).filter(p=>/^[a-f0-9-]{36}\.json$/.test(p)).length:drafts.size;
   if(count>=limit)throw Error('待检查项目过多，请先处理已有草稿。');
   if(plan.entries.every(e=>e.status==='duplicate'))return {alreadyImported:true};
   const draft={id:randomUUID(),fingerprint,receivedAt:new Date().toISOString(),worklog:structuredClone(input.worklog)};
   put(projectId,draft);return structuredClone(draft);
  },
  assert(projectId,id,worklog){const draft=get(projectId);if(!draft||draft.id!==id||draft.fingerprint!==hash(JSON.stringify(worklog)))throw Error('待检查记录已变化或不存在，请重新收取。');},
  consume(projectId,id){const draft=get(projectId);if(draft?.id===id)remove(projectId);}
 };
}
