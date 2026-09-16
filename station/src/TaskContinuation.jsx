import React,{useEffect,useRef,useState} from 'react';
import {api,Icon} from './ui.jsx';
import {checkedTask} from '../shared/next-task.js';
import {sourceCheckSummary} from '../shared/source-check.js';

const labels={codex:'Codex',claude:'Claude Code',grok:'Grok 终端',other:'其他 AI'};
export default function TaskContinuation({initialSelection=null,projectId,target,sourceReview=null,onReceive,onSetup,onBusyChange=()=>{}}){
 const [status,setStatus]=useState(null),[task,setTask]=useState(sourceReview?.task||''),[suggestion,setSuggestion]=useState(null),[ticket,setTicket]=useState(null),[prompt,setPrompt]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pollError,setPollError]=useState(''),[notice,setNotice]=useState(''),[opened,setOpened]=useState(false),[retry,setRetry]=useState(0);
 const [workSession,setWorkSession]=useState(null),[savedWorkParent,setSavedWorkParent]=useState(null);
 const [taskMode,setTaskMode]=useState(sourceReview?'new':null),[parent,setParent]=useState(null);
 const lock=useRef(false),alive=useRef(true),currentTicket=useRef(null),initialized=useRef(!!sourceReview),generation=useRef(0);
 const [sourceCheck,setSourceCheck]=useState(null),[checkingSources,setCheckingSources]=useState(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
 useEffect(()=>{generation.current++;currentTicket.current=null;setTicket(null);setPrompt('');setNotice('');setOpened(false);setError('');setSourceCheck(null);},[target]);
 useEffect(()=>{let live=true,timer;
  async function poll(){const id=currentTicket.current,epoch=generation.current;
   try{const r=await api(`/projects/${projectId}/bridge${id?'/'+id+'/status':''}`);if(!live||epoch!==generation.current)return;
    setStatus(r);setPollError('');if(id&&r.latest?.id===id)setTicket(r.latest);
    if(!initialized.current){initialized.current=true;
     if(initialSelection?.mode==='continue'){
      const previous=initialSelection.workSessionId?(await api(`/projects/${projectId}/bridge/${initialSelection.parentTicketId}/status`)).latest:r.activeTask;
      if(!live||epoch!==generation.current)return;
      if(previous?.id===initialSelection.parentTicketId&&previous.outcome?.stage!=='completed'){setTask(previous.task);setParent(previous);setTaskMode('continue');setWorkSession(initialSelection.workSessionId||null);if(initialSelection.workSessionId)setSavedWorkParent(previous);}
      else setNotice('上次任务已变化，请重新选择接着做或开始新任务。');
     }else if(initialSelection?.mode==='new'||!r.activeTask)setTaskMode('new');
    }
   }catch(e){if(live&&epoch===generation.current)setPollError('暂时无法核对交接状态：'+e.message);}
   finally{if(live)timer=setTimeout(poll,3000);}
  }poll();return()=>{live=false;clearTimeout(timer);};
 },[projectId,retry]);
 useEffect(()=>{if(suggestion&&status&&!status.suggestions?.some(s=>s.id===suggestion.id&&s.text===suggestion.text)){edit('');setNotice('原来的候选任务已更新或已记录完成，请填写新的任务。');}},[status,suggestion]);
 const pending=status?.pendingCount>0,stale=ticket&&(ticket.stale||ticket.revision!==status?.revision),label=labels[target];
 let taskError='';try{checkedTask(task);}catch(e){taskError=e.message;}
 function edit(value,source=null){initialized.current=true;generation.current++;currentTicket.current=null;setTicket(null);setPrompt('');setOpened(false);setNotice('');setError('');setTask(value);setSuggestion(source);setSourceCheck(null);}
 function chooseMode(mode){
  if(busy)return;setWorkSession(null);
  if(mode==='continue'){
   const last=savedWorkParent||status?.activeTask;if(!last?.task||last.outcome?.stage==='completed')return;
   edit(last.task);setParent(last);setTaskMode('continue');if(savedWorkParent)setWorkSession(initialSelection.workSessionId);
  }else{edit('');setParent(null);setTaskMode('new');}
 }
 const parentChanged=!workSession&&taskMode==='continue'&&parent&&status?.activeTask?.id!==parent.id&&status?.activeTask?.id!==ticket?.id;
 async function copy(value){try{await navigator.clipboard.writeText(value);return true;}catch{return false;}}
 async function start(){
  if(lock.current||!status||pending||pollError||taskError||!taskMode||parentChanged)return;
  lock.current=true;setBusy(true);setCheckingSources(true);setSourceCheck(null);setPrompt('');setTicket(null);currentTicket.current=null;setOpened(false);onBusyChange(true);setError('');setNotice('');const epoch=++generation.current;
  const live=()=>alive.current&&epoch===generation.current;
  try{
   const r=await api(`/projects/${projectId}/bridge/prepare`,{target,revision:status.revision,task:checkedTask(task),taskMode,...(taskMode==='continue'?{continuesTicketId:parent.id,...(workSession?{resumeWorkSession:workSession}:{}),...(parent.taskMemoryId?{taskMemoryId:parent.taskMemoryId}:{}),...(parent.sourceReviewId?{sourceReviewId:parent.sourceReviewId}:{})}:{...(suggestion?.id?{taskMemoryId:suggestion.id}:{}),...(sourceReview?{sourceReviewId:sourceReview.id}:{})})});
   if(!live())return;currentTicket.current=r.ticket.id;setTicket(r.ticket);setPrompt(r.prompt);setOpened(false);setSourceCheck(r.sourceCheck);setCheckingSources(false);
   if(target==='claude'){
    const result=await api(`/projects/${projectId}/claude/open`,{ticketId:r.ticket.id});
    if(live()){setOpened(result.dispatched===true);setNotice(result.message);}
   }else{
    const copied=await copy(r.prompt);if(!live())return;
    if(!copied){setNotice('自动复制未成功，请手动复制下方完整说明并发送。');return;}
    setNotice('任务和记忆读取说明已一起复制。请在目标 AI 的新任务中粘贴并发送，不用另写提示词。');
    if(target==='codex'){
     try{const result=await api('/desktop-ai/open',{target,projectId,ticketId:r.ticket.id});if(live()){setOpened(result.dispatched===true);setNotice('已复制并请求打开 Codex 项目。请在新任务中粘贴并发送，随后在那里继续工作。');}}
     catch(e){if(live())setNotice('完整说明已复制。未能打开项目，请手动打开目标 AI 并粘贴发送。'+e.message);}
    }
   }
  }catch(e){if(live())setError(e.message);}
  finally{lock.current=false;if(alive.current){setBusy(false);setCheckingSources(false);onBusyChange(false);}}
 }
 const received=!pollError&&!pending&&!stale&&ticket?.receipt;
 return <section className="task-continuation" aria-label="带任务切换 AI">
  {!sourceReview&&<div className="task-mode-choices" role="group" aria-label="选择继续还是新任务"><button disabled={busy||!(savedWorkParent||status?.activeTask)?.task||(savedWorkParent||status?.activeTask)?.outcome?.stage==='completed'} aria-pressed={taskMode==='continue'} onClick={()=>chooseMode('continue')}><strong>接着做</strong><small>{savedWorkParent?'继续本批结果对应的任务':status?.activeTask?.task?'沿用上次选择的任务，换一个 AI 继续':'还没有交接过具体任务'}</small></button><button disabled={busy} aria-pressed={taskMode==='new'} onClick={()=>chooseMode('new')}><strong>开始新任务</strong><small>填写新目标，不沿用旧任务的临时限制</small></button></div>}
  {!taskMode&&<p className="muted">先选接着做，或开始一件新的事。</p>}
  {parentChanged&&<p role="alert" className="error">当前任务已变化，请重新选择接着做或开始新任务。</p>}
  {taskMode&&<>
  <label className="field"><span>{taskMode==='continue'?'继续这项任务':'接下来做什么'}</span><textarea aria-label="接下来做什么" rows={3} maxLength={2000} disabled={busy} readOnly={taskMode==='continue'} value={task} onChange={e=>edit(e.target.value)} placeholder="例如：给贪吃蛇加一个暂停按钮，保留现有操作方式。"/></label>
  {taskMode==='continue'?<p className="muted">继续同一任务会沿用任务编号，并核对相关临时要求。要改变目标，请选择“开始新任务”；这不会把旧任务标成完成。</p>:sourceReview?<p className="muted">核对任务已填好，新旧原文和相关记忆会一起带上。可以直接开始，也可调整任务。</p>:suggestion?<p className="muted">{suggestion.source} · {suggestion.note}。点击下方按钮，才会把这段文字作为本次任务交出去。</p>:<p className="muted">写一句这次想完成的事。历史背景会一起带上，不必重新介绍项目。</p>}
  {taskMode==='new'&&status?.suggestions?.length>0&&<details><summary>选择其他已记录的下一步</summary><div className="task-suggestions">{status.suggestions.map(s=><button key={s.id} disabled={busy} onClick={()=>edit(s.text,s)}>{s.text}<small>{s.source}</small></button>)}</div></details>}
  {task&&taskError&&<p className="error" role="alert">{taskError}</p>}
  <div className="task-actions"><button className="primary" disabled={busy||!status||!!pollError||pending||!!taskError||!!received||parentChanged} onClick={start}>{busy?'正在准备…':pending?'先检查新记录':received?'本次交接已有读取回执':target==='claude'?'带着任务，用 Claude Code 接着做':target==='codex'?'复制任务并打开 Codex':'复制任务，交给 '+label}<Icon name="arrow" size={16}/></button>{pending&&<button onClick={onReceive}>查看新记录</button>}</div>
  <p className="muted">{target==='claude'?'会带任务启动终端。登录和项目授权仍在 Claude Code 中完成。':'复制内容已经包含本次任务和读取记忆的指令，粘贴发送一次即可。'}</p>
  {notice&&<p role="status" className="start-notice">{notice}</p>}
  {checkingSources&&<p role="status">正在检查已保存的文件来源，随后准备交接。若文件读不到，会明确注明未检查。</p>}
  {sourceCheck&&<div className="source-handoff-notice" role="status"><strong>{sourceCheckSummary(sourceCheck)}</strong><p>检查时间：{new Date(sourceCheck.checkedAt).toLocaleString('zh-CN')}。下一位 AI 会收到这次观察与相关编号；不会因此自动修改你的要求或覆盖旧依据。</p></div>}
  {ticket&&<ol className="continuation-steps" aria-label="本次任务交接状态">
   <li><strong>{opened?'已请求打开 '+label:'尚未确认打开 '+label}</strong><span>打开窗口不等于 AI 已接到任务。</span></li>
   <li><strong>{pollError?'读取状态暂时未知':pending?'有新记录，请先处理':stale?'记忆版本已更新，请重新交接':received?'已读取本次交接的记忆':'等待目标 AI 读取记忆'}</strong><span>交接版本 {ticket.revision}，只查看这个交接编号的回执。</span></li>
   <li><strong>{received?.taskReceived?'读取工具已收到本次任务':'等待本次任务的读取回执'}</strong><span>回执表示记忆和任务已由工具输出，不代表 AI 已开始执行、理解正确或用户验收。</span></li>
  </ol>}
  {prompt&&<details open={!!error||notice.startsWith('自动复制')}><summary>完整说明 / 手动接续</summary><textarea aria-label="任务和记忆完整说明" readOnly rows={6} value={prompt} onFocus={e=>e.target.select()}/><button disabled={busy||pending||stale||!!pollError} onClick={async()=>{const ok=await copy(prompt);setNotice(ok?'完整说明已复制，粘贴到目标 AI 的新任务并发送即可。':'请手动复制上方完整说明。');}}>复制完整说明</button></details>}
  </>}
  {(error||pollError)&&<div className="error" role="alert"><p>{error||pollError}</p><button disabled={busy} onClick={()=>setRetry(v=>v+1)}>重新检查状态</button><button disabled={busy} onClick={onSetup}>查看接续设置</button></div>}
 </section>;
}
