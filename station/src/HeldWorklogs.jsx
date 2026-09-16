import React,{useEffect,useRef,useState} from 'react';
import {api} from './ui.jsx';
import {actorLabel} from '../shared/attribution.js';

export default function HeldWorklogs({projectId,revision,pending,inboxError,onReceive}){
 const [drafts,setDrafts]=useState(null),[error,setError]=useState(''),[busyId,setBusyId]=useState(''),[retry,setRetry]=useState(0);
 const generation=useRef(0),request=useRef(0),restoring=useRef(false);
 useEffect(()=>{generation.current++;setDrafts(null);setError('');return()=>{generation.current++;};},[projectId]);
 useEffect(()=>{let live=true;async function refresh(){const current=++request.current;try{const result=await api(`/projects/${projectId}/inbox-held`);if(live&&current===request.current){setDrafts(result.drafts);setError('');}}catch(e){if(live&&current===request.current)setError(e.message);}}refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')refresh();},4000);return()=>{live=false;clearInterval(timer);};},[projectId,revision,pending,retry]);
 async function restore(draftId){
  if(restoring.current||pending||inboxError)return;
  const current=generation.current;restoring.current=true;request.current++;setBusyId(draftId);setError('');
  try{const result=await api(`/projects/${projectId}/inbox-restore`,{draftId});if(current!==generation.current)return;if(!result.restored||!result.draft)throw Error('尚未确认恢复成功，请重新读取暂存记录。');request.current++;setDrafts(previous=>previous?.filter(draft=>draft.id!==draftId)||[]);await onReceive();}
  catch(e){if(current===generation.current)setError(e.message);}
  finally{restoring.current=false;if(current===generation.current)setBusyId('');}
 }
 return <details className="held-worklogs"><summary>暂存记录{drafts?`（${drafts.length} 批）`:''}</summary>
  <p className="muted">整批原文留在本机，未写入记忆，也不会进入交接。恢复只会回到待检查，仍由你选择是否保存。</p>
  {pending&&<p className="held-pending" role="status">当前有新批次等待检查，请先处理新批，再恢复旧批；不会覆盖新记录。</p>}
  {inboxError&&<p className="error" role="alert">暂时无法核对新记录，请先重新核对连接，再恢复暂存记录。</p>}
  {!drafts&&!error&&<p className="muted">正在读取暂存记录…</p>}
  {drafts?.length===0&&<p className="muted">还没有暂存的记录。</p>}
  {drafts?.map(draft=><article className="held-worklog" key={draft.id}><div><strong>{draft.count} 条记录 · {actorLabel(draft.session?.actor??{kind:'agent',id:draft.session?.agent||'未注明'})}</strong><small>收到于 {draft.receivedAt?new Date(draft.receivedAt).toLocaleString('zh-CN'):'未记录时间'}</small><p>{draft.titles?.slice(0,3).join('、')||'本批未提供标题'}{draft.titles?.length>3?' 等':''}</p></div><button disabled={!!busyId||pending||!!inboxError} onClick={()=>restore(draft.id)}>{busyId===draft.id?'正在恢复…':'恢复到待检查'}</button></article>)}
  {error&&<div role="alert" className="error"><p>{error}</p><button disabled={!!busyId} onClick={()=>setRetry(value=>value+1)}>重新读取暂存记录</button></div>}
 </details>;
}
