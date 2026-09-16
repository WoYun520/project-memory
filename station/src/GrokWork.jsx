import React,{useEffect,useRef,useState} from 'react';
import {Icon} from './ui.jsx';
import {privacyIssues} from '../shared/privacy.js';
import './grok-work.css';

const isActive=run=>run?.status==='starting'||run?.status==='running';
const runLabels={starting:'正在准备',running:'正在工作',completed:'工作已结束',failed:'这次工作没有完成',cancelled:'已停止',interrupted:'工作已中断'};
const stepLabels={pending:'等待',starting:'准备中',running:'进行中',completed:'已完成',succeeded:'已完成',failed:'未完成',cancelled:'已停止',skipped:'已跳过'};
const safeTime=value=>{const time=new Date(value);return Number.isFinite(time.getTime())?time.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';};
const summarizeRun=run=>({id:run.id,projectId:run.projectId,task:run.task,status:run.status,mode:run.mode,startedAt:run.startedAt,draft:run.draft});
const busyInAnotherProject=(info,projectId)=>info?.busyElsewhere===true||!!(info?.activeRun&&info.activeRun.projectId!==projectId&&isActive(info.activeRun));

async function request(path,{input,signal}={}){
 const response=await fetch('/api'+path,{signal,...(input!==undefined?{method:'POST',headers:{'Content-Type':'application/json','X-Memory-Station':'1'},body:JSON.stringify(input)}:{})});
 let result;try{result=await response.json();}catch{throw Error('暂时没有读到服务回复，请稍后重新查看。');}
 if(!response.ok)throw Error(result.error||'这次操作没有完成，请重新查看状态。');
 return result;
}

export default function GrokWork({projectId,revision,onReceive,onConnectFolder,compact=false}){
 const [connection,setConnection]=useState(null),[loading,setLoading]=useState(true),[run,setRun]=useState(null),[task,setTask]=useState('');
 const [action,setAction]=useState(''),[error,setError]=useState(''),[monitorError,setMonitorError]=useState(''),[notice,setNotice]=useState(''),[refreshKey,setRefreshKey]=useState(0);
 const [selectedRunId,setSelectedRunId]=useState(''),[historyLoading,setHistoryLoading]=useState(false);
 const generation=useRef(0),actionLock=useRef(false),resultVersion=useRef(0),requests=useRef(new Set()),selection=useRef(''),historyRequest=useRef(null);
 const base=`/projects/${projectId}/grok`;
 const backgroundRun=connection?.activeRun?.projectId===projectId&&isActive(connection.activeRun)?connection.activeRun:null;
 const active=!!backgroundRun||isActive(run),pollRunId=backgroundRun?.id||(isActive(run)?run.id:null);
 const otherRun=busyInAnotherProject(connection,projectId);
 const canRead=connection?.available&&connection?.capabilities?.read!==false;
 const busy=!!action;
 const historyOptions=[...new Map([...(selectedRunId&&run?[run]:[]),...(connection?.recentRuns||[]),connection?.activeRun,connection?.latestRun].filter(item=>item?.id&&(!item.projectId||item.projectId===projectId)).map(item=>[item.id,item])).values()].sort((a,b)=>(Date.parse(b.startedAt)||0)-(Date.parse(a.startedAt)||0));

 function rememberRun(next){
  setConnection(previous=>{
   const latest=previous?.latestRun;
   return {...previous,activeRun:isActive(next)?next:previous?.activeRun?.id===next.id?null:previous?.activeRun,
    latestRun:!latest||latest.id===next.id||Date.parse(next.startedAt)>=Date.parse(latest.startedAt)?next:latest,
    recentRuns:[summarizeRun(next),...(previous?.recentRuns||[]).filter(item=>item.id!==next.id)].sort((a,b)=>(Date.parse(b.startedAt)||0)-(Date.parse(a.startedAt)||0)).slice(0,100)};
  });
 }

 // A project change aborts only browser requests. It never cancels the background work.
 useEffect(()=>{
  const current=++generation.current;resultVersion.current++;selection.current='';setSelectedRunId('');setHistoryLoading(false);actionLock.current=false;setAction('');setConnection(null);setRun(null);setTask('');setError('');setMonitorError('');setNotice('');setLoading(true);
  return()=>{if(generation.current===current)generation.current++;for(const controller of requests.current)controller.abort();requests.current.clear();};
 },[projectId]);

 useEffect(()=>{
  const current=generation.current,version=resultVersion.current,controller=new AbortController();requests.current.add(controller);setLoading(true);
  request(base,{signal:controller.signal}).then(result=>{
   if(current!==generation.current||version!==resultVersion.current)return;
   setConnection(result);
   const candidate=result.activeRun?.projectId===projectId?result.activeRun:result.latestRun?.projectId===projectId?result.latestRun:null;
   if(!selection.current)setRun(candidate);setMonitorError('');if(isActive(candidate))setError('');
  }).catch(e=>{if(current===generation.current&&e.name!=='AbortError')setError(e.message);}).finally(()=>{requests.current.delete(controller);if(current===generation.current)setLoading(false);});
  return()=>{controller.abort();requests.current.delete(controller);};
 },[projectId,refreshKey]);

 useEffect(()=>{
  if(!otherRun)return;
  const current=generation.current,controller=new AbortController();requests.current.add(controller);let timer;
  async function checkAvailability(){
   if(actionLock.current){timer=setTimeout(checkAvailability,3000);return;}
   const version=resultVersion.current;
   try{
    const result=await request(base,{signal:controller.signal});
    if(current!==generation.current||controller.signal.aborted)return;
    if(version!==resultVersion.current){timer=setTimeout(checkAvailability,3000);return;}
    setConnection(result);setMonitorError('');
    if(!selection.current)setRun(result.activeRun?.projectId===projectId?result.activeRun:result.latestRun?.projectId===projectId?result.latestRun:null);
    if(busyInAnotherProject(result,projectId))timer=setTimeout(checkAvailability,3000);
   }catch(e){
    if(current!==generation.current||controller.signal.aborted||e.name==='AbortError')return;
    setMonitorError('暂时无法更新另一项目的工作状态，正在继续检查。');timer=setTimeout(checkAvailability,3000);
   }
  }
  timer=setTimeout(checkAvailability,3000);
  return()=>{clearTimeout(timer);controller.abort();requests.current.delete(controller);};
 },[projectId,otherRun]);

 useEffect(()=>{
  if(!pollRunId)return;
  const current=generation.current,runId=pollRunId,controller=new AbortController();requests.current.add(controller);let timer;
  async function poll(){
   if(actionLock.current){timer=setTimeout(poll,2000);return;}
   const version=resultVersion.current;
   try{
    const result=await request(base+'/runs/'+encodeURIComponent(runId),{signal:controller.signal});
    if(current!==generation.current||controller.signal.aborted)return;
    if(version!==resultVersion.current){timer=setTimeout(poll,2000);return;}
    if(result.run?.projectId!==projectId||result.run?.id!==runId)throw Error('返回的进度与当前任务不一致，请重新查看。');
    rememberRun(result.run);if(!selection.current||selection.current===runId)setRun(result.run);setMonitorError('');
    if(isActive(result.run))timer=setTimeout(poll,2000);
    else setRefreshKey(value=>value+1);
   }catch(e){
    if(current!==generation.current||controller.signal.aborted||e.name==='AbortError')return;
    setMonitorError('暂时无法读取进度，后台任务可能仍在进行。'+e.message);timer=setTimeout(poll,2000);
   }
  }
  timer=setTimeout(poll,2000);
  return()=>{clearTimeout(timer);controller.abort();requests.current.delete(controller);};
 },[projectId,pollRunId]);

 async function selectHistory(id){
  if(actionLock.current)return;
  historyRequest.current?.abort();selection.current=id;setSelectedRunId(id);setError('');setNotice('');
  if(!id){setHistoryLoading(false);setRun(connection?.activeRun?.projectId===projectId?connection.activeRun:connection?.latestRun?.projectId===projectId?connection.latestRun:null);return;}
  const current=generation.current,controller=new AbortController();historyRequest.current=controller;requests.current.add(controller);setHistoryLoading(true);setRun(null);
  try{
   const result=await request(base+'/runs/'+encodeURIComponent(id),{signal:controller.signal});
   if(current!==generation.current||controller.signal.aborted||selection.current!==id)return;
   if(result.run?.projectId!==projectId||result.run?.id!==id)throw Error('这份工作结果与所选记录不一致，请重新打开。');
   setRun(result.run);rememberRun(result.run);
  }catch(e){if(current===generation.current&&!controller.signal.aborted&&e.name!=='AbortError')setError(e.message);}
  finally{requests.current.delete(controller);if(current===generation.current&&historyRequest.current===controller){setHistoryLoading(false);historyRequest.current=null;}}
 }

 async function mutate(kind,path,input){
  if(actionLock.current)return;
  const current=generation.current,targetRunId=kind==='start'?null:run?.id,controller=new AbortController();resultVersion.current++;requests.current.add(controller);actionLock.current=true;setAction(kind);setError('');setNotice('');
  try{
   const result=await request(path,{input,signal:controller.signal});
   if(current!==generation.current)return;
   if(result.run?.projectId!==projectId||!result.run?.id||targetRunId&&result.run.id!==targetRunId)throw Error('返回的工作记录与当前任务不一致，请重新查看。');
   if(kind==='start'){historyRequest.current?.abort();selection.current='';setSelectedRunId('');setHistoryLoading(false);}
   setRun(result.run);rememberRun(result.run);setMonitorError('');
   if(kind==='cancel'&&isActive(result.run))setNotice('已请求停止，正在等待后台结束这次工作。');
   if(kind==='retry'&&result.run.draft?.status==='queued')setNotice('这次工作记录已送到新记录，等待你检查。');
  }catch(e){
   if(current!==generation.current||e.name==='AbortError')return;
   setError((kind==='cancel'?'停止结果尚未确认，任务可能仍在运行。':kind==='start'?'未能确认是否已启动，请重新查看状态。':'草稿送入结果尚未确认。')+e.message);
   if(kind==='start')setRefreshKey(value=>value+1);
  }finally{requests.current.delete(controller);if(current===generation.current){actionLock.current=false;setAction('');}}
 }

 function start(event){
  event.preventDefault();
  if(actionLock.current||loading||active||otherRun||!canRead||!task.trim())return;
  if(privacyIssues(task).length){setError('任务里发现疑似凭据或隐私，请先移除原值，再开始。内容尚未发送。');return;}
  mutate('start',base+'/start',{task:task.trim(),mode:'read',...(Number.isInteger(revision)?{revision}:{})});
 }

 return <section className={compact?"grok-work grok-compact":"grok-work"} aria-label="Grok 项目工作区">
  <header className="grok-heading"><div className="grok-symbol" aria-hidden="true">G</div><div><h3>用 Grok 开始工作</h3><p>结合项目记忆，整理分析、制作方案和代码建议。</p></div><span className={'grok-connection '+(canRead?'is-ready':'')}>{loading?'正在连接…':canRead?'已就绪':'尚未就绪'}</span></header>
  {!loading&&!canRead&&<div className="grok-unavailable"><p>{connection?.message||error||'本机 Grok 暂未就绪，可选择 Codex 或其他 AI，复制任务继续。'}</p><button disabled={busy} onClick={()=>{setError('');setRefreshKey(value=>value+1);}}>重新检查连接</button></div>}
  {otherRun&&<p className="grok-callout">另一个项目的 Grok 任务还在进行，请等待它结束后再开始。</p>}
  {backgroundRun&&run?.id!==backgroundRun.id&&<div className="grok-background"><span>这个项目另有一次工作正在后台进行。</span><button disabled={busy} onClick={()=>selectHistory('')}>查看进行中的工作</button></div>}
  <form className="grok-task-form" onSubmit={start}>
   <label className="grok-task-label" htmlFor={'grok-task-'+projectId}>本次任务</label>
   <textarea id={'grok-task-'+projectId} rows={4} maxLength={2000} value={task} disabled={busy||active||loading} onChange={e=>{setTask(e.target.value);setError('');}} placeholder="例如：根据已有记录，整理下一步制作方案。"/>
   <div className="grok-start-row"><p>Grok 将收到这个项目已保存的记忆和本次任务，整理结果会送回待检查区。</p><button className="primary" disabled={busy||loading||active||!!otherRun||!canRead||!task.trim()}>{action==='start'?'正在开始…':active?'Grok 正在工作':'开始整理'}<Icon name="arrow" size={17}/></button></div>
   {onConnectFolder&&<button className="grok-add-material" type="button" disabled={busy||active} onClick={onConnectFolder}>需要更多背景：补充项目资料</button>}
  </form>
  {historyOptions.length>0&&<div className="grok-history"><label htmlFor={'grok-history-'+projectId}>之前的工作</label><select id={'grok-history-'+projectId} value={selectedRunId} disabled={busy} onChange={event=>selectHistory(event.target.value)}><option value="">当前工作（自动更新）</option>{historyOptions.map(item=><option key={item.id} value={item.id}>{safeTime(item.startedAt)} · {runLabels[item.status]||'状态待确认'} · {(item.task||'一次项目整理').slice(0,36)}</option>)}</select></div>}
  {historyLoading&&<p className="muted" role="status">正在打开这次工作…</p>}
  {selectedRunId&&!run&&!historyLoading&&<button disabled={busy} onClick={()=>selectHistory(selectedRunId)}>重新打开这次工作</button>}
  {run&&<section className={'grok-run is-'+run.status} aria-label="Grok 工作进度">
   <div className="grok-run-heading"><div><span className="grok-run-status" role="status">{runLabels[run.status]||'状态待确认'}</span><small>{safeTime(run.startedAt)} · 整理与分析</small></div>{isActive(run)&&<button disabled={busy} onClick={()=>mutate('cancel',base+'/runs/'+encodeURIComponent(run.id)+'/cancel',{})}>{action==='cancel'?'正在停止…':'停止这次工作'}</button>}</div>
   <p className="grok-run-task">{run.task}</p>
   {run.message&&<p className="grok-run-message">{run.message}</p>}
   {run.steps?.length>0&&<ol className="grok-steps">{run.steps.map((step,index)=>{const unfinished=!isActive(run)&&['starting','running'].includes(step.status);return <li key={index} className={'step-'+(unfinished?'unfinished':step.status)}><span className="grok-step-dot" aria-hidden="true"/><span>{step.label}</span><small>{unfinished?run.status==='completed'?'步骤状态待核对':'未完成':stepLabels[step.status]||'状态待确认'}</small></li>;})}</ol>}
   {run.status==='interrupted'&&<p className="grok-callout">上次工作中断了。先查看已留下的结果，再决定是否重新开始。</p>}
   {run.answer&&<details className="grok-answer" open={!isActive(run)&&!compact}><summary>查看工作结果</summary><div>{run.answer}</div></details>}
   {run.draft?.status==='queued'&&<div className="grok-draft"><Icon name="inbox" size={20}/><div><strong>{run.draft.count?`${run.draft.count} 条工作记录已送达`:'工作记录已送到新记录'}</strong><p>{run.draft.message||'检查后再保存，不代表你已经认可其中的结论。'}</p></div>{onReceive&&<button disabled={busy} onClick={onReceive}>查看新记录</button>}</div>}
   {run.draft?.status==='waiting'&&<div className="grok-draft needs-review"><Icon name="inbox" size={20}/><div><strong>这次草稿正在等待送入</strong><p>{run.draft.message||'先处理已有的新记录，再把这次工作结果送入。'}</p><div className="grok-draft-actions">{onReceive&&<button disabled={busy} onClick={onReceive}>先查看新记录</button>}<button disabled={busy||isActive(run)} onClick={()=>mutate('retry',base+'/runs/'+encodeURIComponent(run.id)+'/retry-draft',{})}>{action==='retry'?'正在送入…':'重新送入这次草稿'}</button></div></div></div>}
   {run.draft?.status==='rejected'&&<p className="grok-callout error">草稿没有进入新记录。{run.draft.message||'请先查看工作结果，检查材料是否需要补充或处理隐私。'}</p>}
   {!isActive(run)&&run.draft?.status==='none'&&<p className="muted">{run.draft.message||'本次暂未生成待检查记录。'}</p>}
   {run.status==='completed'&&run.answer&&['rejected','none'].includes(run.draft?.status)&&<button className="grok-recover-draft" disabled={busy} onClick={()=>mutate('retry',base+'/runs/'+encodeURIComponent(run.id)+'/retry-draft',{})}>{action==='retry'?'正在送入…':'重新送入这次草稿'}</button>}
   {!isActive(run)&&<p className="grok-outcome-note">这里显示 Grok 的工作报告，完成状态不等于结果已经核验，也不代表用户验收。</p>}
  </section>}
  {monitorError&&<p className="error" role="alert">{monitorError}</p>}{error&&connection?.available&&<p className="error" role="alert">{error}</p>}{notice&&<p className="grok-notice" role="status">{notice}</p>}
  <div className="grok-footnote"><span>离开此页面后，已开始的任务会继续在后台运行。</span><button disabled={busy||loading} onClick={()=>{setError('');setRefreshKey(value=>value+1);}}>重新查看状态</button></div>
 </section>;
}
