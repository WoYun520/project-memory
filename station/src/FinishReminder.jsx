import React,{useEffect,useRef,useState} from 'react';
import {api} from './ui.jsx';
export default function FinishReminder({projectId,ticketId,disabled,onInbox,onRepair}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[manual,setManual]=useState(false);
 const alive=useRef(false),request=useRef(0),lock=useRef(false),key=useRef('');
 async function refresh(){const seq=++request.current;try{const r=await api(`/projects/${projectId}/bridge/${ticketId}/finish-reminder`);if(!alive.current||seq!==request.current)return null;const next=[r.ticketId,r.revision,r.reason].join(':');if(next!==key.current){key.current=next;setMessage('');setManual(false);}setData(r);setError('');return r;}catch(e){if(alive.current&&seq===request.current){setData(null);setError('暂时无法核对收尾状态：'+e.message);setMessage('');setManual(false);}return null;}}
 useEffect(()=>{alive.current=true;let timer;async function poll(){if(!lock.current)await refresh();if(alive.current)timer=setTimeout(poll,4000);}poll();return()=>{alive.current=false;request.current++;clearTimeout(timer);};},[projectId,ticketId]);
 async function copy(){if(lock.current||disabled)return;lock.current=true;setBusy(true);try{const r=await refresh();if(!r?.available||!alive.current)return;try{await navigator.clipboard.writeText(r.prompt);if(alive.current){setManual(false);setMessage('已复制收尾提醒。请发回原来的AI会话；尚未发送，也不表示结果已返回。');}}catch{if(alive.current){setManual(true);setMessage('自动复制未成功，请手动复制下方提醒，发回原来的AI会话。');}}}finally{lock.current=false;if(alive.current)setBusy(false);}}
 if(data&&!data.available&&['saved','unread','changed','no_task'].includes(data.reason))return null;
 return <section className="finish-reminder" aria-label="收尾提醒"><h3>这次工作有结果了吗？</h3><p>{error||data?.message||'正在核对返回记录…'}</p>
 {error&&<button disabled={busy||disabled} onClick={refresh}>重新检查收尾状态</button>}
 {data?.available&&<><button disabled={busy||disabled} onClick={copy}>{busy?'正在核对…':'复制收尾提醒'}</button><p className="muted">发回执行这项任务的同一会话。提醒只整理已有工作，不要求重新做一遍。</p></>}
 {data&&['pending','held'].includes(data.reason)&&<button disabled={disabled||busy} onClick={onInbox}>查看新记录</button>}
 {data?.reason==='unlinked'&&<button disabled={disabled||busy} onClick={onRepair}>核对未归类记录</button>}
 {message&&<p role="status">{message}</p>}
 {data?.available&&data.prompt&&<details open={manual}><summary>查看完整提醒 / 手动复制</summary><textarea aria-label="收尾提醒完整内容" readOnly rows={7} value={data.prompt} onFocus={e=>e.target.select()}/></details>}
 </section>;
}
