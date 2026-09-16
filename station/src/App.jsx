import TaskLinkRepair from './TaskLinkRepair.jsx';
import ConflictCard from './ConflictCard.jsx';
import {conflictPairs} from '../shared/conflict-resolution.js';
import SourceReview from './SourceReview.jsx';
import React,{useEffect,useRef,useState} from 'react';
import {Icon,Modal,Field,Check,api,download} from './ui.jsx';
import WorklogImport from './WorklogImport.jsx';
import SavedContinuation from './SavedContinuation.jsx';

import {rememberAI} from './ProjectSetup.jsx';
import QuickConnect from './QuickConnect.jsx';
import ProjectHome from './ProjectHome.jsx';
import ProjectSetup from './ProjectSetup.jsx';
import StationHome from './StationHome.jsx';
import CurrentProject from './CurrentProject.jsx';
import SourceCheck from './SourceCheck.jsx';
import ContextHandoff from './ContextHandoff.jsx';
import WorkspaceConnect from './WorkspaceConnect.jsx';
import './workbench.css';
import MemoryForm,{names} from './MemoryForm.jsx';
import {actorLabel,originLabel} from '../shared/attribution.js';
import {privacyIssues} from '../shared/privacy.js';

function status(m){if(m.lifecycle==='superseded')return '已被替代';if(m.lifecycle==='rejected')return '已归档';if(m.conflicts_with.length)return '存在冲突';if(m.freshness.status==='stale')return '待复核';if(m.approval)return '已确认';if(m.verification.status==='verified')return '已核验';return '待核验';}
function readable(key,value){
 const stages={unknown:'尚不确定',succeeded:'成功',failed:'失败',partial:'部分完成',proposed:'待确认',adopted:'已采纳',effective:'已生效',in_progress:'进行中',not_started:'尚未开始',blocked:'遇到阻碍',awaiting_validation:'等待验证',completed:'已完成',cancelled:'已取消',suspected:'怀疑',confirmed:'已确认'};
 if(key==='subject_id')return '当前项目';
 if(typeof value!=='object')return stages[value]||value;
 const labels={status:'判断',what_went_wrong:'做错了什么',consequence:'造成的后果',explanation:'原因说明',avoid_when:'下次注意',correction_attempt_id:'纠正操作',option:'未选方案',reason_not_chosen:'未选理由'};
 if(Array.isArray(value))return value.map(v=>readable('',v)).join('\n');
 return Object.entries(value).filter(([k])=>k!=='evidence_ids').map(([k,v])=>`${labels[k]||k}：${k==='correction_attempt_id'?'已关联一条纠正尝试':stages[v]||v}`).join('\n');
}
export default function App(){
 const navigation=useRef(0),currentRef=useRef(null),archiveRef=useRef(null),modalRef=useRef(null),reviewReturn=useRef(null),writes=useRef(0),pendingRuns=useRef(0),inboxEpoch=useRef(0),inboxRequest=useRef(0),overviewRequest=useRef(0);
 const [mutationBusy,setMutationBusy]=useState(false);
 function installArchive(value){if(currentRef.current!==value.bundle.project.id)return null;const previous=archiveRef.current,next=previous?.bundle.project.id===value.bundle.project.id&&previous.revision>value.revision?previous:value;archiveRef.current=next;setArchive(next);return next;}
 function updateProjectList(rows){setProjects(previous=>rows.map(row=>({...previous.find(p=>p.id===row.id),...row})));}
 function invalidateInbox(){inboxEpoch.current++;inboxRequest.current++;}
 function navigate(nextView){if(writes.current)return;navigation.current++;reviewReturn.current=null;modalRef.current=null;setModal(null);setView(nextView);setError('');}
 function applyProject(id){currentRef.current=id;reviewReturn.current=null;invalidateInbox();setCurrent(id);archiveRef.current=archiveRef.current?.bundle.project.id===id?archiveRef.current:null;setArchive(archiveRef.current);setInboxDraft(previous=>previous?.worklog.project_id===id?previous:null);setActiveDraft(null);setView('memory');setTab('all');setQuery('');setError('');try{localStorage.setItem('memory-station:last-project',id);}catch{}}

 const [inboxDraft,setInboxDraft]=useState(null),[activeDraft,setActiveDraft]=useState(null),[inboxError,setInboxError]=useState('');
 const [booting,setBooting]=useState(true);
 const [overview,setOverview]=useState(null),[overviewLoading,setOverviewLoading]=useState(true),[overviewError,setOverviewError]=useState(''),[tools,setTools]=useState(null),[query,setQuery]=useState('');
 async function refreshOverview(){const request=++overviewRequest.current;setOverviewLoading(true);try{const r=await api('/overview');if(request===overviewRequest.current){setOverview(r);updateProjectList(r.projects);setOverviewError('');}}catch(e){if(request===overviewRequest.current)setOverviewError(e.message);}finally{if(request===overviewRequest.current)setOverviewLoading(false);}}
 useEffect(()=>{refreshOverview();api('/local-tools').then(setTools).catch(()=>setTools({}));const timer=setInterval(()=>{if(document.visibilityState==='visible')refreshOverview();},4000);return()=>clearInterval(timer);},[]);
 function chooseProject(id){if(writes.current)return;navigation.current++;modalRef.current=null;setModal(null);applyProject(id);}
 async function startProject(id){if(writes.current)return;const intent=++navigation.current;await run(async()=>{const a=await api('/projects/'+id);if(intent!==navigation.current||writes.current)return;applyProject(id);installArchive(a);open('connect',null,intent);},{intent});}
 async function receiveProject(id,{returnToConnect=false}={}){if(writes.current||!id)return;const intent=++navigation.current;reviewReturn.current=null;await run(async()=>{const [a,r]=await Promise.all([api('/projects/'+id),api('/projects/'+id+'/inbox')]);if(intent!==navigation.current||writes.current)return;applyProject(id);installArchive(a);invalidateInbox();setInboxDraft(r.draft);setActiveDraft(r.draft);open(r.draft?'inbox':'connect',null,intent);if(r.draft&&returnToConnect)reviewReturn.current={projectId:id,intent,draftId:r.draft.id};},{intent});}
 async function searchResult(projectId,memoryId){if(writes.current)return;const intent=++navigation.current;await run(async()=>{const a=await api('/projects/'+projectId);if(intent!==navigation.current||writes.current)return;const candidate=currentRef.current===projectId&&archiveRef.current?.revision>a.revision?archiveRef.current:a;const item=candidate.bundle.memories.find(m=>m.id===memoryId);if(!item)throw Error('记录已变化，请刷新搜索结果。');applyProject(projectId);installArchive(candidate);open('detail',item,intent);},{intent});}

 const [continuation,setContinuation]=useState(null),continuationLaunch=useRef(false);
 const [readonlyTest,setReadonlyTest]=useState(false);
 const [projects,setProjects]=useState([]),[current,setCurrent]=useState(null),[archive,setArchive]=useState(null),[tab,setTab]=useState('all'),[view,setView]=useState('home'),[modal,setModal]=useState(null),[selected,setSelected]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[toast,setToast]=useState('');
 const [name,setName]=useState(''),[goal,setGoal]=useState(''),[reviewed,setReviewed]=useState(false),[task,setTask]=useState('继续当前项目'),[handoff,setHandoff]=useState(null),[importData,setImportData]=useState(null),[other,setOther]=useState('');
 useEffect(()=>{const receive=()=>{if(writes.current||modalRef.current){setToast('请先完成或关闭当前窗口，再查看新记录。');return;}navigate('inbox');refreshOverview();};window.addEventListener('memory-station:open-inbox',receive);return()=>window.removeEventListener('memory-station:open-inbox',receive);},[]);
 const navigationAtRender=navigation.current;
 const flash=message=>{setToast(message);setTimeout(()=>setToast(''),4000);};
 async function refreshList(){const r=await api('/projects');updateProjectList(r.projects);return r.projects;}
 async function refreshAfterWrite(){await Promise.allSettled([refreshList(),refreshOverview()]);}
 useEffect(()=>{let live=true;api('/projects').then(r=>{if(live){updateProjectList(r.projects);let last;try{last=localStorage.getItem('memory-station:last-project');}catch{}if(currentRef.current===null){const initialId=r.projects.some(p=>p.id===last)?last:r.projects[0]?.id||null;currentRef.current=initialId;setCurrent(initialId);}setBooting(false);}}).catch(e=>{setError(e.message);setBooting(false);});return()=>{live=false;};},[]);
 useEffect(()=>{let live=true;if(archiveRef.current?.bundle.project.id!==current)archiveRef.current=null;setArchive(archiveRef.current);if(current)api('/projects/'+current).then(a=>{if(live&&currentRef.current===current)installArchive(a);}).catch(e=>{if(live&&currentRef.current===current)setError(e.message);});return()=>{live=false;};},[current]);
 useEffect(()=>{let live=true;setInboxDraft(previous=>previous?.worklog.project_id===current?previous:null);setInboxError('');if(!current)return;const check=()=>{const epoch=inboxEpoch.current,request=++inboxRequest.current;api('/projects/'+current+'/inbox').then(r=>{if(live&&currentRef.current===current&&epoch===inboxEpoch.current&&request===inboxRequest.current){setInboxDraft(r.draft);setInboxError('');}}).catch(()=>{if(live&&currentRef.current===current&&epoch===inboxEpoch.current&&request===inboxRequest.current)setInboxError('暂时无法收取新记录，请检查本机服务。');});};check();const timer=setInterval(()=>{if(document.visibilityState==='visible')check();},4000);window.addEventListener('focus',check);return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',check);};},[current]);
 async function receive(){await receiveProject(current);}
 async function receiveForHandoff(){await receiveProject(current,{returnToConnect:true});}
 async function workHeld(result){
  const id=result.projectId,draftId=result.draftId,intent=navigationAtRender;
  if(currentRef.current===id){invalidateInbox();setInboxDraft(previous=>previous?.id===draftId?null:previous);setActiveDraft(previous=>previous?.id===draftId?null:previous);setInboxError('');}
  await refreshAfterWrite();
  if(!writes.current&&intent===navigation.current&&currentRef.current===id&&modalRef.current==='inbox'){
   open('connect',null,intent);
   flash('这批记录已暂存，整批原文保留；未写入记忆，也不会进入交接。可在暂存记录里恢复检查。');
  }
 }
 async function workSaved(result,target){
  const id=result.archive.bundle.project.id,intent=navigationAtRender,returnIntent=reviewReturn.current;
  const returnToConnect=returnIntent?.projectId===id&&returnIntent.intent===intent&&returnIntent.draftId===activeDraft?.id;
  const warnings=[...new Set([...(Array.isArray(result.warnings)?result.warnings:[result.warnings]),result.handoffError].filter(value=>typeof value==='string'&&value.trim()))];
  const savedNotice=message=>message+(warnings.length?' 提醒：'+warnings.join('；'):'');
  invalidateInbox();
  if(currentRef.current===id){installArchive(result.archive);setInboxDraft(null);setActiveDraft(null);}
  await refreshAfterWrite();
  const stillHere=!writes.current&&intent===navigation.current&&currentRef.current===id&&['inbox','worklog'].includes(modalRef.current);
  if(stillHere&&result.task_outcome&&(result.task_outcome.stage==='completed'||!target)){
   reviewReturn.current=null;close();flash(savedNotice(result.task_outcome.stage==='completed'?'记录已保存，本次任务已标记完成；可以开始新任务，历史与原始依据保留。':'记录和继续事项已保存，可以从首页接着做。'));
  }else if(stillHere&&['codex','claude'].includes(target)){
   beginContinuation({projectId:id,projectName:result.archive.bundle.project.name,revision:result.archive.revision,target,warnings,workTaskLink:result.work_task_link,workSessionId:result.work_session_id},intent);
  }else if(stillHere&&returnToConnect&&reviewReturn.current===returnIntent){
   open('connect',result.work_task_link?{target:'codex',mode:'continue',parentTicketId:result.work_task_link.ticket_id,workSessionId:result.work_session_id}:null,intent);
   flash(savedNotice('新记录已保存，接下来选择要继续使用的 AI；内容仍按原状态保留。'));
  }else if(stillHere&&result.handoff){
   reviewReturn.current=null;modalRef.current='handoff';setModal('handoff');setReadonlyTest(false);setTask('继续当前项目');setReviewed(true);setHandoff(result.handoff);flash(savedNotice('已保存，交接已准备好；内容仍待核验。'));
  }else{
   if(stillHere)close();
   flash(savedNotice('已保存到 '+result.archive.bundle.project.name+'：'+result.added+' 条；内容仍待核查。'));
  }
 }
 function beginContinuation(details,intent=navigation.current){
  if(continuationLaunch.current||intent!==navigation.current||currentRef.current!==details.projectId)return;
  continuationLaunch.current=true;
  rememberAI(details.projectId,details.target);
  reviewReturn.current=null;modalRef.current='continue';setModal('continue');
  continuationLaunch.current=false;
  setContinuation({...details});
 }
 async function run(fn,{mutation=false,intent}={}){if(mutation&&writes.current)return;if(mutation){writes.current++;setMutationBusy(true);}pendingRuns.current++;setBusy(true);setError('');try{await fn();}catch(e){if(intent===undefined||intent===navigation.current)setError(e.message);}finally{pendingRuns.current--;setBusy(pendingRuns.current>0);if(mutation){writes.current--;setMutationBusy(writes.current>0);}}}
 function open(type,item=null,intent){if(writes.current)return;if(intent!==undefined&&intent!==navigation.current)return;if(intent===undefined)navigation.current++;reviewReturn.current=null;modalRef.current=type;setModal(type);setSelected(item);setError('');setReviewed(false);setReadonlyTest(false);setHandoff(null);setImportData(null);setOther('');}
 function close(event){if(writes.current){event?.preventDefault?.();return;}navigation.current++;reviewReturn.current=null;modalRef.current=null;setModal(null);setError('');}
 function closeAfterWrite(){navigation.current++;reviewReturn.current=null;modalRef.current=null;setModal(null);setError('');}
 const records=archive?.bundle.memories||[], active=records.filter(m=>m.lifecycle==='accepted');
 const shown=records.filter(m=>!query.trim()||JSON.stringify({claim:m.claim,data:m.data}).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).filter(m=>tab==='history'?m.lifecycle!=='accepted':m.lifecycle==='accepted'&&(tab==='all'||tab==='review'&&(m.freshness.status==='stale'||m.conflicts_with.length)||m.kind===tab));
 const pairs=conflictPairs(records);
 async function openConflict(ids){if(writes.current)return;const intent=++navigation.current;await run(async()=>{const latest=await api('/projects/'+current);if(intent!==navigation.current||writes.current)return;installArchive(latest);open('conflict',ids,intent);},{intent});}
 async function saveTaskOutcome(input){await run(async()=>{const result=await api('/projects/'+current+'/task-outcome',{...input,revision:archive.revision});installArchive(result.archive);await refreshAfterWrite();flash(input.stage==='completed'?'任务已标记完成，结果与依据保留在历史中。':'任务继续事项已保存。');},{mutation:true});}
 async function repairTask(input){await run(async()=>{const result=await api('/projects/'+current+'/task-link-repair',{...input,revision:archive.revision});installArchive(result.archive);await refreshAfterWrite();closeAfterWrite();flash('任务归属已保存，原文与核验状态保留。');},{mutation:true});}
 async function resolvePair(input){await run(async()=>{const result=await api(`/projects/${current}/conflict-resolve`,{...input,revision:archive.revision});installArchive(result.archive);await refreshAfterWrite();closeAfterWrite();flash('处理已保存，原始依据与历史保留。下一次交接将使用新版本。');},{mutation:true});}
 const mainGoal=active.find(m=>m.kind==='goal')?.data.desired_outcome||'添加一个目标，让下一位 AI 知道要做什么。';
 async function save(f){await run(async()=>{const a=await api(`/projects/${current}/memories`,{...f,revision:archive.revision});installArchive(a);await refreshAfterWrite();closeAfterWrite();flash('已保存到本机，依据一并保留。');},{mutation:true});}
 async function review(action){await run(async()=>{const a=await api(`/projects/${current}/review`,{id:selected.id,action,otherId:other,revision:archive.revision});installArchive(a);await refreshAfterWrite();closeAfterWrite();flash('记录已更新。');},{mutation:true});}
 async function copy(text){try{await navigator.clipboard.writeText(text);flash('已复制。');}catch{setError('浏览器未允许复制，请选中文本手动复制。');}}
 return <div className="app-shell">
  {!modal&&view!=='inbox'&&overview?.pendingCount>0&&<div className="global-arrivals" role="status"><Icon name="inbox"/><span>{overview.pendingCount} 条新记录等你检查</span><button disabled={mutationBusy} onClick={()=>navigate('inbox')}>查看新记录</button></div>}
  <aside className="sidebar"><button className="brand brand-button" disabled={mutationBusy} onClick={()=>navigate('home')} aria-label="返回工作台"><Icon name="bookmark" size={34}/><div><strong>记忆站</strong><span>Project Memory</span></div></button><nav className="workspace-nav" aria-label="工作台导航"><button className={'nav-item '+(view==='home'?'active':'')} disabled={mutationBusy} onClick={()=>navigate('home')}><Icon name="home"/><span>工作台</span></button><button className={'nav-item '+(view==='inbox'?'active':'')} disabled={mutationBusy} onClick={()=>navigate('inbox')}><Icon name="inbox"/><span>新记录</span>{overview?.pendingCount>0&&<b className="nav-count">{overview.pendingCount}</b>}</button></nav><div className="section-label">我的项目<button className="icon-button" aria-label="新建项目" onClick={()=>{setName('');setGoal('');open('project');}}><Icon name="plus" size={17}/></button></div><nav aria-label="项目列表">{projects.map(p=><button key={p.id} className={current===p.id&&view==='memory'?'nav-item active':'nav-item'} disabled={mutationBusy} onClick={()=>chooseProject(p.id)}><Icon name="folder"/><span>{p.name}</span>{p.inbox?.count>0&&<i className="pending-dot" aria-label="有新记录"/>}</button>)}{(tools?.radar?.configured||tools?.website?.configured)&&<button className={view==='website'?'nav-item active website-link':'nav-item website-link'} disabled={mutationBusy} onClick={()=>navigate('website')}><Icon name="globe"/><span>网站与工具</span></button>}</nav><div className="sidebar-bottom"><button className="text-button" onClick={()=>open('import')}>导入项目备份</button><span><Icon name="monitor" size={19}/>记忆档案保存在本机</span></div></aside>
  <main>{view==='home'||view==='inbox'?<StationHome overview={overview} loading={overviewLoading} error={error||overviewError} navigationBlocked={mutationBusy} tools={tools} mode={view} onRefresh={()=>{refreshOverview();api('/local-tools').then(setTools).catch(()=>{});}} onProject={chooseProject} onStart={startProject} onReceive={receiveProject} onNew={()=>{setName('');setGoal('');open('project');}} onSearch={q=>api('/search?q='+encodeURIComponent(q))} onResult={searchResult}/>:view==='website'?<Website tools={tools}/>:<><div className="topbar"><span><button className="text-button breadcrumb" disabled={mutationBusy} onClick={()=>navigate('home')}>工作台</button><b>/</b> {archive?.bundle.project.name||'记忆站'}</span><div className="actions"><button disabled={!archive} onClick={()=>open('folder')}><Icon name="folder"/>连接文件夹</button><details className="more-actions"><summary>更多操作</summary><div><button disabled={!archive} onClick={()=>open('worklog')}>导入工作记录</button><button disabled={!archive} onClick={()=>open('backup')}>导出项目备份</button><button disabled={!archive} onClick={()=>open('handoff')}>准备交接文件</button></div></details></div></div>
   <div className="heading"><h1>{archive?.bundle.project.name||'你的项目，从这里继续'}</h1><p>让下一位 AI 接着做。</p></div>
   {error&&!modal&&<div className="error banner" role="alert">{error}<button onClick={()=>run(async()=>{const ps=await refreshList();if(current)installArchive(await api('/projects/'+current));else if(ps[0]?.id)chooseProject(ps[0].id);})}>重试 / 刷新</button></div>}
   {booting?<p>正在读取本机项目…</p>:!current?<div className="empty"><h2>建立第一份项目记忆</h2><p>保存目标、决定、试过的办法与依据。</p><button className="primary" onClick={()=>open('project')}>新建项目</button></div>:!archive?<p>正在读取本机记录…</p>:<>
   <ProjectHome onTaskOutcome={saveTaskOutcome} onInbox={()=>{navigate('inbox');refreshOverview();}} onRepair={()=>open('taskRepair')} key={current} archive={archive} inboxDraft={inboxDraft} inboxError={inboxError} disabled={busy} onReceive={receiveForHandoff} onConnect={options=>open('connect',options)} onDetail={m=>open('detail',m)} onRefresh={()=>run(async()=>{installArchive(await api('/projects/'+current));})}/>
   <details className="project-archive" key={current+':overview'}><summary>查看项目要求、变化与待核对事项</summary><SourceCheck refreshToken={modal===null} key={current+':'+archive.revision} archive={archive} onDetail={m=>open('detail',m)} onConnect={()=>open('folder')} onCompare={eid=>open('sourceReview',eid)}/><CurrentProject archive={archive} onDetail={m=>open('detail',m)} onRevise={m=>open('add',m)} onProgress={m=>open('progress',m)}/>
</details>
   <details className="project-archive" key={current+':records'}><summary>全部记忆与原始依据 · {records.length} 条</summary>
   <div className="record-search"><Icon name="search"/><input aria-label="搜索当前项目记忆" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索这个项目的记忆…"/><span>{shown.length} 条</span></div>
   <div className="toolbar"><div className="tabs" aria-label="记忆筛选">{[['all','全部记忆'],['decision','决定'],['attempt','尝试与错误'],['state','进度'],['task','任务'],['fact','配置'],['constraint','要求'],['review','待复核'],['history','历史']].map(([id,label])=><button key={id} className={tab===id?'selected':''} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</div><button className="primary" onClick={()=>open('add')}><Icon name="plus"/>新增记忆</button></div>
   {(pairs.length>0||records.some(m=>m.conflict_resolution))&&<section className="conflict-panel" aria-label="记忆分歧处理"><h2>有说法不一致，怎么处理？</h2><p>先看双方依据，再决定采用一条、分别适用，或继续保留分歧。</p>{pairs.map(pair=><article key={pair.map(m=>m.id).sort().join(':')}><span>{pair[0].claim} / {pair[1].claim}</span><button disabled={busy} onClick={()=>openConflict(pair.map(m=>m.id))}>处理这组分歧</button></article>)}{!pairs.length&&<p>没有仍标记的成对冲突；这不代表所有内容已核验。</p>}<details><summary>查看已记录的处理</summary>{records.filter(m=>m.conflict_resolution).slice().reverse().map(m=><p key={m.id}><button onClick={()=>open('detail',m)}>{m.claim}</button> · {new Date(m.recorded_at).toLocaleString('zh-CN')}</p>)}</details></section>}
   <section className="memory-list" aria-label="项目记忆">{shown.length?shown.map(m=><article className="memory-row" key={m.id}><span className={'kind '+m.kind}>{names[m.kind]}</span><button className="row-title" onClick={()=>open('detail',m)}>{m.claim}</button><span className={'status '+(['已确认','已核验'].includes(status(m))?'good':'pending')}>{status(m)}</span><button className="source-button" aria-label={'查看依据：'+m.claim} onClick={()=>open('detail',m)}>查看依据<Icon name="arrow" size={17}/></button></article>):<div className="empty"><p>{tab==='attempt'?'还没有尝试或错误记录，不会自动推测历史。':'这里还没有记录。'}</p><button onClick={()=>open('add')}>新增记忆</button></div>}</section>
   </details><div className="notice bottom-note"><Icon name="info"/>提醒：交接前检查隐私内容。</div></>}
  </>}</main>
  {toast&&<div className="toast" role="status">{toast}</div>}
  {modal&&<Modal title={{taskRepair:'补充任务归属',project:'新建项目',add:selected?'修订记忆':'新增记忆',progress:'记录实施进度',detail:'记忆与原始依据',handoff:'交给下一位 AI',backup:'导出本机备份',import:'导入项目备份',worklog:'导入本次工作记录',inbox:'检查新记录',continue:'保存并接着工作',connect:'项目交接',sourceReview:'对照变化，交给 AI 核对',folder:'连接项目文件夹',conflict:'对照双方，处理分歧'}[modal]} onClose={close} wide={['project','taskRepair','add','progress','detail','handoff','worklog','inbox','folder','connect','continue','sourceReview','conflict'].includes(modal)}>
   {error&&<div className="error banner" role="alert">{error}</div>}
   {modal==='taskRepair'&&<TaskLinkRepair archive={archive} busy={busy} onSave={repairTask} onRefresh={()=>run(async()=>{installArchive(await api('/projects/'+current));})}/>}
   {modal==='conflict'&&<ConflictCard key={selected.join(':')} archive={archive} pair={selected.map(id=>records.find(m=>m.id===id))} busy={busy} onSave={resolvePair}/>}
   {modal==='worklog'&&<WorklogImport key={archive.bundle.project.id} archive={archive} onSaved={workSaved}/>}
   {modal==='inbox'&&activeDraft&&archive&&<WorklogImport key={archive.bundle.project.id+':'+activeDraft.id} archive={archive} draft={activeDraft} onSaved={workSaved} onHeld={workHeld}/>}
   {modal==='continue'&&continuation&&<SavedContinuation continuation={continuation} onRetry={()=>beginContinuation(continuation)} onSetup={()=>open('connect')} onReceive={receiveForHandoff}/>}
   {modal==='sourceReview'&&<SourceReview key={current+':'+selected} archive={archive} evidenceId={selected} onDetail={m=>open('detail',m)} onReceive={receiveForHandoff} onSetup={()=>open('connect')}/>}
   {modal==='connect'&&<QuickConnect key={current} initialSelection={selected} projectId={current} projectName={archive?.bundle.project.name} revision={archive?.revision} inboxDraft={inboxDraft} inboxError={inboxError} onReceive={receiveForHandoff} onConnectFolder={()=>open('folder')}/>}
   {modal==='folder'&&archive&&<WorkspaceConnect projectId={current} onExistingProject={startProject} onStaged={async()=>{const id=current,intent=navigationAtRender;await refreshOverview();flash('文件已送到新记录，检查后再保存。');if(intent!==navigation.current||currentRef.current!==id)return;close();await receiveProject(id);}} onToast={flash}/>}
   {modal==='progress'&&<MemoryForm onSave={save} busy={busy} records={records} seed={{kind:'state',subject_id:selected.id,title:selected.claim+' · 实施进度'}}/>}
   {modal==='add'&&<MemoryForm onSave={save} busy={busy} records={records} initial={selected}/>}
   {modal==='project'&&<ProjectSetup onExistingProject={startProject} onBusyChange={value=>{writes.current=value?1:0;setMutationBusy(value);}} onChanged={refreshAfterWrite} onComplete={a=>{applyProject(a.bundle.project.id);installArchive(a);refreshAfterWrite();open('connect');}}/>}
   {modal==='detail'&&selected&&<div className="detail"><div className="detail-meta"><span className={'kind '+selected.kind}>{names[selected.kind]}</span><span>{status(selected)}</span></div><h3>{selected.claim}</h3>{selected.scope.condition&&<p className="notice">追加适用条件：{selected.scope.condition}</p>}<p className="muted">录入人：{actorLabel(selected.by)} · 来源性质：{originLabel(selected.origin)}</p>{selected.approval&&<p>确认人：{actorLabel(selected.approval.by)}；范围：{selected.approval.fields.join('、')}</p>}{selected.origin==='inference'&&<p className="notice">这是整理或推断，不是用户原话；请结合依据判断。</p>}<dl>{Object.entries(selected.data).map(([k,v])=><React.Fragment key={k}><dt>{({desired_outcome:'目标',statement:'内容',objective:'任务',choice:'选择',rationale:'理由',stage:'阶段',rule:'要求',applies_when:'适用条件',action:'操作',conditions:'当时条件',outcome:'结果',observed_result:'观察结果',mistake:'错误与纠正',detail:'进度',next_step:'下一步',subject_id:'关联对象',cause:'原因',alternatives:'其他方案'})[k]||k}</dt><dd>{k==='subject_id'?(records.find(m=>m.id===v)?.claim||readable(k,v)):readable(k,v)}</dd></React.Fragment>)}</dl><p className="muted">{selected.verification.status==='verified'?'核查已记录':'尚未独立核验'} · {new Date(selected.recorded_at).toLocaleString('zh-CN')}</p>{selected.verification.unknowns?.length>0&&<div className="notice"><strong>待核对</strong>{selected.verification.unknowns.map((note,i)=><p key={i}>{note}</p>)}</div>}{selected.verification.checks.map((c,i)=><p key={i}>核查人：{actorLabel(c.by)}<br/>核查说明：{c.method}</p>)}{selected.data.mistake?.correction_attempt_id&&<button onClick={()=>open('detail',records.find(m=>m.id===selected.data.mistake.correction_attempt_id))}>查看对应的纠正尝试</button>}{selected.kind==='state'&&records.some(m=>m.id===selected.data.subject_id)&&<button onClick={()=>open('detail',records.find(m=>m.id===selected.data.subject_id))}>查看关联的原任务 / 进度</button>}<h3>原始依据</h3>{selected.evidence.map(link=>{const e=archive.bundle.evidence.find(e=>e.id===link.evidence_id);return <div className="evidence" key={e.id}>{e.kind==='file'&&<p><strong>文件：{e.locator?.path}</strong>{link.relation==='context'?' · 相关背景':''}</p>}<small>来源：{actorLabel(e.locator?.speaker)}<br/>{e.note}</small><pre>{archive.snapshots[e.snapshot?.path]||'来源不可用'}</pre></div>;})}<div className="detail-actions"><button onClick={()=>open('add',selected)}>修订并保留历史</button><button onClick={()=>review('stale')} disabled={busy}>标记待复核</button><button onClick={()=>review(selected.lifecycle==='rejected'?'restore':'archive')} disabled={busy}>{selected.lifecycle==='rejected'?'恢复记录':'归档记录'}</button></div><Field label="与另一条记忆冲突"><select value={other} onChange={e=>setOther(e.target.value)}><option value="">选择冲突对象</option>{records.filter(m=>m.id!==selected.id).map(m=><option key={m.id} value={m.id}>{m.claim}</option>)}</select></Field><button disabled={!other||busy} onClick={()=>review('conflict')}>保留双方并标记冲突</button></div>}
   {modal==='handoff'&&archive&&<ContextHandoff archive={archive} initial={handoff} onCopy={copy}/>}
   {modal==='backup'&&<div><p>备份包含本项目记忆与允许保留的原始依据，下载到你的电脑。</p><Check checked={reviewed} onChange={e=>setReviewed(e.target.checked)}>我已检查所有内容不含凭据或隐私</Check><footer><button className="primary" disabled={!reviewed||busy} onClick={()=>run(async()=>{const a=await api(`/projects/${current}/backup`,{reviewed,revision:archive.revision});download('project-memory-backup.json',JSON.stringify(a,null,2),'application/json');close();flash('备份已下载。');})}>下载备份</button></footer></div>}
   {modal==='import'&&<div><p>仅导入记忆站导出的备份；会建立新项目，不覆盖现有内容。</p><Field label="选择本机备份文件"><input type="file" accept=".json" onChange={e=>run(async()=>{setImportData(null);setReviewed(false);const file=e.target.files[0];if(!file)return;if(file.size>3_000_000)throw Error('文件不能超过 3 MB。');const a=JSON.parse(await file.text());if(privacyIssues(a).length)throw Error('文件中发现疑似隐私，未导入。');setImportData(a);})}/></Field>{importData&&<p>待导入：{importData.bundle?.project?.name||'未知项目'} · {importData.bundle?.memories?.length||0} 条记录</p>}<Check checked={reviewed} onChange={e=>setReviewed(e.target.checked)}>我已在本机检查整个备份，不含凭据或隐私</Check><footer><button className="primary" disabled={!reviewed||!importData||busy} onClick={()=>run(async()=>{const a=await api('/import',{archive:importData,reviewed});applyProject(a.bundle.project.id);installArchive(a);await refreshAfterWrite();closeAfterWrite();flash('备份已导入为新项目。');},{mutation:true})}>导入为新项目</button></footer></div>}
  </Modal>}
 </div>;
}
function Website({tools}){return <section className="website-page"><div className="topbar">网站与工具</div><h1>从一个入口，继续你的工作。</h1><p className="lead">个人网站展示作品，观察仓库整理机会，记忆站保留项目经历。</p><div className="integration"><div><span className="step">01</span><h2>个人网站</h2><p>已有作品展示与制作工具，可从本机继续完善。</p>{tools?.website?.status==='ready'&&<a className="button" href={tools.website.url} target="_blank" rel="noreferrer">打开个人网站<Icon name="arrow"/></a>}</div><Icon name="arrow" size={28}/><div><span className="step">02</span><h2>观察仓库</h2><p>保留信号、需求证据与机会卡，使用原来的本机地址。</p>{tools?.radar?.status==='ready'&&<a className="button" href={tools.radar.url} target="_blank" rel="noreferrer">打开观察仓库<Icon name="arrow"/></a>}</div><Icon name="arrow" size={28}/><div><span className="step">03</span><h2>项目记忆</h2><p>连接项目文件夹，接收 AI 的工作记录，准备下一次交接。</p></div></div><div className="notice"><Icon name="info"/><div>这些入口在本机运行。网站与观察仓库的浏览器资料继续保存在原地址，记忆站只收取你选择并检查过的材料。</div></div><h2>记忆站的公开介绍</h2><p>独立产品页面可以放入未来公开网站；私人项目记忆继续留在电脑里。</p><a className="button" href="/site/" target="_blank" rel="noreferrer">查看产品介绍<Icon name="arrow"/></a></section>;}
