import React,{useEffect,useRef,useState} from 'react';
import {api,Field,Check,download,Icon} from './ui.jsx';
import {names} from './MemoryForm.jsx';
import {privacyIssues} from '../shared/privacy.js';

const mandatory = m => m.lifecycle==='accepted'&&['goal','constraint'].includes(m.kind);
const validPlan = p => p&&Array.isArray(p.memoryIds)&&Array.isArray(p.reasons)&&Number.isFinite(p.approximateLength);

export default function ContextHandoff({archive,initial=null,onCopy}){
 const projectId=archive.bundle.project.id,archiveKey=JSON.stringify([projectId,archive.revision]);
 const [task,setTask]=useState(initial?.task||'继续当前项目'),[mode,setMode]=useState(initial?(initial.mode||'full'):'focused');
 const [readonlyTest,setReadonlyTest]=useState(initial?.readonlyTest===true),[reviewedKey,setReviewedKey]=useState(null);
 const [preview,setPreview]=useState(null),[artifact,setArtifact]=useState(initial?{value:initial,archiveKey}:null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const [manual,setManual]=useState(false),[chosen,setChosen]=useState([]);
 const alive=useRef(true),generation=useRef(0),generating=useRef(false),previousProject=useRef(projectId);
 const selectionKey=JSON.stringify([projectId,archive.revision,task,mode,manual,manual?[...chosen].sort():[]]);
 const reviewKey=JSON.stringify([selectionKey,readonlyTest]);
 const latest=useRef(null);latest.current={selectionKey,reviewKey,archiveKey};
 const candidate=artifact?.archiveKey===archiveKey?artifact.value:null;
 const handoff=candidate&&(!candidate.projectId||candidate.projectId===projectId)&&(candidate.revision===undefined||candidate.revision===archive.revision)?candidate:null;
 const plan=preview?.key===selectionKey?preview.data:null;
 const displayPlan=preview?.archiveKey===archiveKey?preview.data:null;
 const reviewed=reviewedKey===reviewKey&&Boolean(plan);
 const taskIssues=privacyIssues(task),taskValid=Boolean(task.trim())&&task.length<=2000&&!taskIssues.length;
 const required=new Set(archive.bundle.memories.filter(mandatory).map(m=>m.id));
 for(const reason of displayPlan?.reasons||[])if(reason.reasonCodes?.some(code=>['required','required_goal','required_constraint'].includes(code)))required.add(reason.memoryId);

 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
 useEffect(()=>{
  // Initial handoffs are produced after saving work. Legacy responses used full mode.
  generation.current++;generating.current=false;setBusy(false);setReviewedKey(null);setError('');
  if(initial){
   const sameProject=!initial.projectId||initial.projectId===projectId;
   const sameRevision=initial.revision===undefined||initial.revision===archive.revision;
   setArtifact(sameProject&&sameRevision?{value:initial,archiveKey}:null);
   setTask(initial.task||'继续当前项目');setMode(initial.mode||'full');setReadonlyTest(initial.readonlyTest===true);
   setManual(initial.mode==='focused'&&Array.isArray(initial.memoryIds));setChosen(initial.memoryIds||[]);
   if(!sameProject||!sameRevision)setError('项目记录已经变化，请重新准备交接。');
  }else setArtifact(null);
 },[initial]);
 useEffect(()=>{
  setReviewedKey(null);
  if(previousProject.current!==projectId){
   previousProject.current=projectId;setArtifact(null);setPreview(null);setTask('继续当前项目');setMode('focused');setReadonlyTest(false);setManual(false);setChosen([]);
  }else if(manual){
   const known=new Set(archive.bundle.memories.map(m=>m.id));
   setChosen(ids=>ids.every(id=>known.has(id))?ids:ids.filter(id=>known.has(id)));
  }
 },[archiveKey]);
 useEffect(()=>{
  setReviewedKey(null);setError('');
  if(handoff||!taskValid)return;
  let live=true;
  const key=selectionKey,revision=archive.revision,ids=[...chosen];
  const timer=setTimeout(()=>{
   api(`/projects/${projectId}/context-preview`,{task,mode,revision,...(manual?{memoryIds:ids}:{})}).then(result=>{
    if(!live||latest.current.selectionKey!==key)return;
    if(!validPlan(result))throw Error('未能读取交接范围，请重试。');
    setPreview({key,archiveKey,data:result});
   }).catch(err=>{if(live&&latest.current.selectionKey===key)setError(err.message);});
  },250);
  return()=>{live=false;clearTimeout(timer);};
 },[selectionKey,Boolean(handoff),retry]);

 function edit(action){setReviewedKey(null);setError('');action();}
 async function generate(){
  if(generating.current||!reviewed||!plan||!taskValid)return;
  const key=reviewKey,sourceArchiveKey=archiveKey,token=++generation.current;
  const settings={task,mode,readonlyTest,...(manual?{memoryIds:[...chosen]}:{})};
  generating.current=true;setBusy(true);setError('');
  try{
   const result=await api(`/projects/${projectId}/handoff`,{...settings,reviewed:true,revision:archive.revision});
   if(!alive.current||token!==generation.current)return;
   if(latest.current.reviewKey!==key||latest.current.archiveKey!==sourceArchiveKey){setError('项目或选择已经变化，请检查最新范围后重新准备交接。');return;}
   if((result.projectId&&result.projectId!==projectId)||(result.revision!==undefined&&result.revision!==archive.revision))throw Error('交接对应的项目记录已经变化，请刷新后重试。');
   if(typeof result.prompt!=='string'||typeof result.markdown!=='string')throw Error('交接文件未完整返回，请重试。');
   setArtifact({value:{...result,...settings},archiveKey:sourceArchiveKey});
  }catch(err){if(alive.current&&token===generation.current)setError(err.message);}
  finally{if(alive.current&&token===generation.current){generating.current=false;setBusy(false);}}
 }
 function retryPreview(){setPreview(null);setReviewedKey(null);setError('');setRetry(value=>value+1);}
 function toggleManual(enabled){
  edit(()=>{setManual(enabled);setChosen(enabled?(plan?.memoryIds||[]).filter(id=>!required.has(id)&&!plan.reasons.find(r=>r.memoryId===id)?.reasonCodes?.includes('dependency')):[]);});
 }
 return <div className="context-handoff">{handoff?<>
  <div className="handoff-ready"><Icon name="check" size={28}/><div><strong>交接已准备好</strong><p>复制下面的指令，发给同一台电脑上的 AI。</p></div></div>
  <textarea className="handoff-text" aria-label="新任务读取指令" readOnly value={handoff.prompt} rows={7}/>
  <div className="handoff-actions"><button className="primary" onClick={()=>onCopy(handoff.prompt)}><Icon name="copy"/>复制给下一位 AI</button><button onClick={()=>{setArtifact(null);setPreview(null);setReviewedKey(null);}}>调整这次交接</button></div>
  <p className="muted">新任务仍需收到这段指令。无法读取本机文件时，复制交接内容或下载文件提供给它。</p>
  <details><summary>查看交接内容</summary><pre className="handoff-preview">{handoff.markdown}</pre></details>
  <footer><button onClick={()=>onCopy(handoff.markdown)}>复制交接内容</button><button onClick={()=>download('project-handoff.md',handoff.markdown)}>下载交接文件</button></footer>
 </>:<>
  {artifact&&artifact.archiveKey!==archiveKey&&<p className="work-warning">项目记录已经更新，原交接已收起。请检查最新范围，再准备一份交接。</p>}
  <Field label="接下来想让 AI 做什么"><textarea rows={2} maxLength={2000} disabled={busy} value={task} onChange={e=>edit(()=>{setTask(e.target.value);setManual(false);setChosen([]);})} placeholder="例如：继续做首页，沿用之前确定的方案"/></Field>
  <div className="context-modes" role="group" aria-label="交接范围"><button disabled={busy} className={mode==='focused'?'selected':''} aria-pressed={mode==='focused'} onClick={()=>edit(()=>{setMode('focused');setManual(false);setChosen([]);})}><strong>围绕这次任务</strong><span>按关键词选取，保留目标、要求和相关依据</span></button><button disabled={busy} className={mode==='full'?'selected':''} aria-pressed={mode==='full'} onClick={()=>edit(()=>{setMode('full');setManual(false);setChosen([]);})}><strong>整个项目</strong><span>带上全部记忆和历史，适合首次了解项目</span></button></div>
  {taskIssues.length>0&&<p className="error">任务说明可能含隐私，请移除原值。</p>}
  {displayPlan&&taskValid?<div className="context-plan" aria-busy={!plan}>
   <div className="section-heading"><strong>{plan?`这次带上 ${plan.selectedCount} / ${plan.totalCount} 条记忆`:'正在更新记忆范围…'}</strong>{plan&&<span className="muted">约 {plan.approximateLength.toLocaleString()} 字符</span>}</div>
   <p className="muted">{mode==='focused'?'基于关键词与最近记录选取，请检查是否遗漏。原始依据按原文保留。':'包括历史记录与所有原始依据。'}</p>
   {plan?.totalCount===0&&<p className="work-warning">这个项目还没有记忆，交接会明确说明资料缺失。</p>}
   {plan?.warnings?.map(w=><p className="work-warning" key={w}>{w}</p>)}
   <details><summary>查看并调整记忆范围</summary>
    {mode==='focused'&&<Check checked={manual} disabled={busy||!plan} onChange={e=>toggleManual(e.target.checked)}>手动调整范围</Check>}
    {mode==='focused'&&manual&&<p className="muted">目标、要求和关联记录会自动保留。要移除关联内容，先取消带入它的记录。</p>}
    {archive.bundle.memories.map(memory=>{
     const reason=(plan||displayPlan).reasons.find(r=>r.memoryId===memory.id);
     const isSeed=chosen.includes(memory.id),isRequired=required.has(memory.id);
     const isDependency=!isSeed&&!isRequired&&Boolean(reason?.reasonCodes?.includes('dependency'));
     return <div className="context-record" key={memory.id}>
      {mode==='focused'&&manual?<Check checked={isSeed||isRequired||isDependency} disabled={busy||isRequired||isDependency} onChange={e=>edit(()=>setChosen(ids=>e.target.checked?[...new Set([...ids,memory.id])]:ids.filter(id=>id!==memory.id)))}>{names[memory.kind]} · {memory.claim}</Check>:<p><span className={reason?'context-included':'muted'}>{plan?(reason?'带上':'暂不带上'):'等待更新'}</span> {memory.claim}</p>}
      {reason&&plan&&<small>{reason.reasons.join('；')}</small>}
      {manual&&isRequired&&<small>目标或要求，自动保留。</small>}
      {manual&&isDependency&&<small>与已选内容关联，自动保留。</small>}
     </div>;
    })}
   </details>
  </div>:!error&&<p className="muted">{!task.trim()?'先写下这次任务。':taskIssues.length?'任务中的隐私内容移除后，再准备范围。':'正在准备记忆范围…'}</p>}
  <Check checked={reviewed} disabled={busy||!plan||!taskValid} onChange={e=>setReviewedKey(e.target.checked?reviewKey:null)}>我已检查这次交接的记忆和依据，适合提供给下一位 AI</Check>
  <details><summary>更多选项</summary><Check checked={readonlyTest} disabled={busy} onChange={e=>edit(()=>setReadonlyTest(e.target.checked))}>只读核对：不开发、不回写</Check><p className="muted">会生成独立文件，后续修改项目不会覆盖该文件。</p></details>
  <footer>{error&&!plan&&taskValid&&<button disabled={busy} onClick={retryPreview}>重新读取范围</button>}<button className="primary" disabled={busy||!reviewed||!plan||!taskValid} onClick={generate}>{busy?'正在准备…':'准备交接'}<Icon name="arrow"/></button></footer>
 </>}{error&&<p className="error banner" role="alert">{error}</p>}</div>;
}
