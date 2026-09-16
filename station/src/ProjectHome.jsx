import {TaskOutcomeControl} from './TaskOutcomeChoice.jsx';
import FinishReminder from './FinishReminder.jsx';
import React,{useEffect,useState} from 'react';
import {api} from './ui.jsx';
import {taskWorkGroups} from '../shared/work-association.js';
import {latestTaskStates,taskIsClosed} from '../shared/next-task.js';
import './project-home.css';

export default function ProjectHome({archive,inboxDraft,inboxError,disabled,onReceive,onConnect,onDetail,onRefresh,onRepair,onInbox,onTaskOutcome}){
 const id=archive.bundle.project.id;
 const [bridge,setBridge]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let live=true,timer;async function poll(){try{const r=await api(`/projects/${id}/bridge`);if(live){setBridge(r);setError('');}}catch{if(live)setError('暂时无法核对最新进度，请重试。');}if(live)timer=setTimeout(poll,4000);}poll();return()=>{live=false;clearTimeout(timer);};},[id,archive.revision,retry]);
 const pending=Math.max(inboxDraft?.worklog?.entries?.length||0,bridge?.pendingCount||0);
 const outdated=bridge&&bridge.revision!==archive.revision;
 const unavailable=disabled||!bridge||!!error||!!inboxError||outdated;
 const last=bridge?.activeTask;
 const closed=last?.outcome?last.outcome.stage==='completed':last?.taskMemoryId&&taskIsClosed(latestTaskStates(archive.bundle.memories).get(last.taskMemoryId));
 const canContinue=last&&!closed;
 const groups=taskWorkGroups(archive),currentGroup=groups.find(g=>g.id===last?.taskThreadId);
 const taskRecords=currentGroup?.records||[];
 const unlinked=(archive.work_imports||[]).filter(r=>!r.task_link&&archive.bundle.memories.some(m=>m.id===r.memory_id&&m.lifecycle==='accepted')).length;
 const labels={codex:'Codex',claude:'Claude Code',grok:'Grok',other:'其他 AI'};
 const recent=archive.bundle.memories.filter(m=>m.lifecycle==='accepted'&&['fact','state','attempt'].includes(m.kind)).map((m,i)=>({m,i})).sort((a,b)=>b.m.recorded_at.localeCompare(a.m.recorded_at)||b.i-a.i).slice(0,3).map(x=>x.m);
 function connect(target,mode){onConnect({target,mode,parentTicketId:mode==='continue'?last.id:null});}
 return <section className="project-home" aria-label="项目下一步">
  <div className="project-home-context"><span className="eyebrow">上次做到哪了</span><h2>{closed?(last?.outcome?'上次任务已完成':'原任务已结束或等待核验'):last?.task||'从这个项目的第一件事开始'}</h2><p className="muted">{closed?(last?.outcome?'已移入下方任务历史；完成是用户记录的进度，不代表结果已核验。':'原记录声明任务结束或等待核验，不能视为用户确认。'):last?'上次选择的任务，不代表仍在执行或已经完成。':'还没有选择过交接任务。写一句目标，就可以带着已有记忆开始。'}</p>
   {last?.outcome?.stage==='in_progress'&&<p className="task-next-note"><strong>还有没做完的：</strong>{last.outcome.next||'继续原任务，具体剩余内容尚未填写。'}</p>}
   {!closed&&<section className="task-progress-card" aria-label="本任务接续进度"><h3>这件事接到哪一步了</h3>{unavailable?<p>正在核对或暂时无法确认最新进度，请以刷新后的状态为准。</p>:bridge.taskProgress?.length?<ol>{bridge.taskProgress.map(step=><li key={step.id}><strong>{labels[step.target]} · {step.pendingCount?'收到 '+step.pendingCount+' 条，等待检查':step.savedCount?'已保存 '+step.savedCount+' 条结果':step.taskReceived?'已有任务读取回执，尚无关联结果':'等待读取任务'}</strong><small>{new Date(step.createdAt).toLocaleString('zh-CN')} · 交接版本 {step.revision}{step.manualCount?' · 含手动补归属':''}</small></li>)}</ol>:<p>还没有具体任务交接。</p>}<p className="muted">读取不代表已开始工作，保存不代表内容正确或任务完成。</p>{pending>0&&!bridge?.taskProgress?.some(t=>t.pendingCount)&&<p>另有 {pending} 条新记录，尚未确认属于这次任务，请先检查。</p>}</section>}
   {!closed&&<div className="home-recent"><h3>本任务返回的已保存记录</h3>{taskRecords.length?<ul>{taskRecords.map(m=><li key={m.id}><button onClick={()=>onDetail(m)}>{m.claim}</button></li>)}</ul>:<p>尚无明确对上本任务的已保存结果。下方最近记录不自动算作本任务结果。</p>}<p className="muted">归类依据是交接编号；是否完成、还差什么仍以记录内容和依据为准。</p>{groups.some(g=>g!==currentGroup)&&<details><summary>其他任务返回的结果</summary>{groups.filter(g=>g!==currentGroup).map(g=><div key={g.id}><h3>{g.task}</h3>{g.records.map(m=><p key={m.id}><button onClick={()=>onDetail(m)}>{m.claim}</button></p>)}</div>)}</details>}</div>}
   <div className="home-recent"><h3>最近保存的结果与记录 <small>版本 {archive.revision}</small></h3>{recent.length?<ul>{recent.map(m=><li key={m.id}><button onClick={()=>onDetail(m)}>{m.claim}</button><small>{m.origin==='inference'?'AI 建议':m.origin==='human_statement'?'用户陈述':'工作观察'} · 点开看依据{m.freshness?.status==='stale'||m.verification?.status==='conflicted'||m.conflicts_with?.length?' · 需要复核':''}</small></li>)}</ul>:<p>还没有保存工作结果，完成后让 AI 提交记录。</p>}<p className="muted">收录不等于核验，完成声明以原记录为准。</p>{bridge?.suggestions?.length>0&&<details><summary>其他已记录的下一步 · {bridge.suggestions.length} 项</summary>{bridge.suggestions.map(s=><p key={s.id}><button onClick={()=>{const m=archive.bundle.memories.find(m=>m.id===s.id);if(m)onDetail(m);}}>{s.text}</button><small>{s.source} · {s.note}</small></p>)}</details>}</div>
   {bridge?.taskHistory?.length>0&&<details className="task-history"><summary>任务历史 · {bridge.taskHistory.length} 件</summary>{bridge.taskHistory.map(t=>{const g=groups.find(g=>g.id===t.taskThreadId),resume=(archive.work_imports||[]).find(r=>r.task_link?.ticket_id===t.id);return <article key={t.id}><h3>{t.task}</h3><p>{t.outcome?.stage==='completed'?'用户已标记完成':t.outcome?.stage==='in_progress'?'用户选择继续':'尚未记录完成'}{t.outcome?.next?' · '+t.outcome.next:''}</p>{t.outcome&&<small>记录人：{t.outcome.by.id==='local-user'?'本人':t.outcome.by.id} · {new Date(t.outcome.at).toLocaleString('zh-CN')}；不代表结果核验。</small>}{g?.records.map(m=><p key={m.id}><button onClick={()=>onDetail(m)}>{m.claim}</button></p>)}{!t.historyOnly&&g?.records.length>0&&<TaskOutcomeControl key={t.id+archive.revision} ticket={t} disabled={unavailable||pending>0} onSave={onTaskOutcome}/>} {!t.historyOnly&&t.outcome?.stage==='in_progress'&&resume&&t.id!==last?.id&&<button disabled={unavailable||pending>0} onClick={()=>onConnect({target:'codex',mode:'continue',parentTicketId:t.id,workSessionId:resume.session_id})}>用 Codex 继续这件任务</button>}</article>;})}</details>}
  </div>
  <div className="project-home-action">{last?.receipt?.taskReceived&&!closed&&!unavailable&&<FinishReminder key={id+last.id} projectId={id} ticketId={last.id} disabled={unavailable} onInbox={onInbox} onRepair={onRepair}/>}{unlinked>0&&<div className="task-repair-notice"><p>{unlinked} 条已保存工作记录尚未归类。</p><button disabled={unavailable} onClick={onRepair}>补充任务归属</button></div>}{!closed&&!pending&&taskRecords.length>0&&<TaskOutcomeControl key={last.id+archive.revision} ticket={last} disabled={unavailable} onSave={onTaskOutcome}/>}<span className="eyebrow">现在需要你做什么</span><h2>{pending?'检查这次结果':unavailable?'先核对最新状态':closed?'开始下一件事':'选一个 AI，接着工作'}</h2>
   {pending?<><p>收到 {pending} 条新记录。先检查要保留的内容，再带着最新记忆继续。</p><button className="primary" disabled={disabled} onClick={onReceive}>检查这次结果</button><p className="muted">不想现在保存，也可以在检查卡中整批暂存。</p></>:<><p>{closed?'原任务已记录结束或等待核验，请选择新的目标。':last?'沿用上次任务；要换目标，请开始新任务。':'选择常用 AI，再填写这次想做的事。'}</p><div className="home-ai-actions"><button className="primary" disabled={unavailable} onClick={()=>connect('codex',canContinue?'continue':'new')}>用 Codex {canContinue?'接着做':'开始'}</button><button disabled={unavailable} onClick={()=>connect('claude',canContinue?'continue':'new')}>用 Claude Code {canContinue?'接着做':'开始'}</button></div><button className="text-button" disabled={unavailable} onClick={()=>connect('codex','new')}>开始新任务 →</button><p className="muted">下一页核对任务后打开 AI，工作继续在原工具中。</p></>}
   {(error||inboxError||outdated)&&<div role="alert"><p>{outdated?'保存版本已更新，请刷新项目后继续。':error||inboxError}</p><button disabled={disabled} onClick={()=>{setRetry(x=>x+1);onRefresh();}}>刷新项目状态</button></div>}
  </div>
 </section>;
}
