import TaskOutcomeChoice,{emptyOutcome} from './TaskOutcomeChoice.jsx';
import TaskCompletion from './TaskCompletion.jsx';
import {applicabilityLabel} from '../shared/applicability.js';
import React,{useEffect,useMemo,useState} from 'react';
import {api,Field,Check} from './ui.jsx';
import {actorLabel,originLabel} from '../shared/attribution.js';
import {privacyIssues} from '../shared/privacy.js';
import {WORKLOG_LIMIT,parseWorklogText,worklogPrompt,validateFileSource} from '../shared/worklog.js';
import {names} from './MemoryForm.jsx';
import './worklog-review.css';
import MemoryUpdateCard from './MemoryUpdateCard.jsx';
import WorkBatchCard from './WorkBatchCard.jsx';
import {triageWork} from '../shared/work-triage.js';

export default function WorklogImport({archive,onSaved,onHeld,draft=null}){
 const [text,setText]=useState(''),[work,setWork]=useState(null),[plan,setPlan]=useState(null),[chosen,setChosen]=useState([]),[edits,setEdits]=useState({}),[reviewed,setReviewed]=useState(false),[sourceReviewed,setSourceReviewed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[showPrompt,setShowPrompt]=useState(false);
 const [taskCompletions,setTaskCompletions]=useState({});
 const [associateTask,setAssociateTask]=useState(false);
 const [outcome,setOutcome]=useState(emptyOutcome);
 const activeCompletions=Object.fromEntries(Object.entries(taskCompletions).filter(([id])=>chosen.includes(id)));
 const completionError=Object.values(activeCompletions).some(v=>!v.reason?.trim())?'请填写旧待办的关联理由':new Set(Object.values(activeCompletions).map(v=>v.task_id)).size<Object.keys(activeCompletions).length?'同一待办只需选择一条结果关联':'';
 function chooseCompletion(id,value){setTaskCompletions(prev=>{const next={...prev};if(value)next[id]=value;else delete next[id];return next;});setReviewed(false);}
 const [applyUpdates,setApplyUpdates]=useState([]),[confirmations,setConfirmations]=useState({});
 const activeUpdates=applyUpdates.filter(id=>chosen.includes(id));
 const missingConfirmation=activeUpdates.some(id=>plan?.entries.find(e=>e.id===id)?.update_target?.requires_confirmation&&(!confirmations[id]?.text?.trim()||!confirmations[id]?.checked));
 function chooseUpdate(id,mode){if(busy)return;setChosen(prev=>mode==='skip'?prev.filter(v=>v!==id):[...new Set([...prev,id])]);setApplyUpdates(prev=>mode==='apply'?[...new Set([...prev,id])]:prev.filter(v=>v!==id));setReviewed(false);}
 const [continueTarget,setContinueTarget]=useState('');
 const [reviewerKind,setReviewerKind]=useState('human'),[reviewerName,setReviewerName]=useState('');
 const outcomeEnabled=associateTask&&plan?.association?.status==='matched'&&reviewerKind==='human'&&!Object.keys(activeCompletions).length;
 const activeOutcome=outcomeEnabled?{...outcome,confirmed:reviewed}:emptyOutcome();
 const [editing,setEditing]=useState({}),[expanded,setExpanded]=useState({});
 const [filter,setFilter]=useState('all'),[showEntries,setShowEntries]=useState(false);
 function inspect(id){setShowEntries(true);setFilter('all');requestAnimationFrame(()=>document.getElementById('work-entry-'+id)?.scrollIntoView({block:'start',behavior:'smooth'}));}
 const triage=useMemo(()=>triageWork(plan?.entries||[],archive,edits),[plan,archive,edits]);
 const triageById=new Map(triage.rows.map(row=>[row.id,row]));
 const selectedPrivacy=triage.rows.some(row=>chosen.includes(row.id)&&row.privacy.length);
 const visibleEntries=(plan?.entries||[]).filter(e=>{const r=triageById.get(e.id);return filter==='all'||filter==='attention'&&r.needsAttention||filter==='similar'&&(r.related.length||r.receipt==='duplicate')||filter==='suggestions'&&r.suggestion;});
 const project=archive.bundle.project;
 const prompt=worklogPrompt(project);
 const reset=value=>{setText(value);setWork(null);setPlan(null);setChosen([]);setEdits({});setTaskCompletions({});setApplyUpdates([]);setConfirmations({});setEditing({});setExpanded({});setShowEntries(false);setReviewed(false);setSourceReviewed(false);setError('');setNotice('');};
 const run=async fn=>{setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}};
 async function preview(value=text){await run(async()=>{const w=parseWorklogText(value);const p=await api(`/projects/${project.id}/work-preview`,{worklog:w,revision:archive.revision});setWork(w);setPlan(p);setOutcome(emptyOutcome());setAssociateTask(p.association?.status==='matched');setFilter('all');setChosen(p.entries.filter(e=>e.status==='new').map(e=>e.id));setEdits({});setTaskCompletions({});setApplyUpdates([]);setConfirmations({});setEditing({});setExpanded({});setShowEntries(false);setReviewed(false);});}
 function update(id,key,value){if(busy)return;if(key==='title'||key==='detail')chooseCompletion(id,null);setEdits(prev=>({...prev,[id]:{...prev[id],[key]:value}}));setConfirmations(prev=>({...prev,[id]:{...prev[id],checked:false}}));setReviewed(false);}
 function select(ids){if(busy)return;setChosen(ids);setTaskCompletions(prev=>Object.fromEntries(Object.entries(prev).filter(([id])=>ids.includes(id))));setApplyUpdates(prev=>prev.filter(id=>ids.includes(id)));setReviewed(false);}
 const newIds=plan?.entries.filter(e=>e.status==='new').map(e=>e.id)||[];
 const missingCorrections=plan?.entries.filter(e=>chosen.includes(e.id)&&e.correction_entry_id&&!chosen.includes(e.correction_entry_id)&&plan.entries.find(c=>c.id===e.correction_entry_id)?.status!=='duplicate')||[];
 const fileSource=source=>{try{validateFileSource(source);return source.file;}catch{return null;}};
 const stageNames={not_started:'尚未开始',in_progress:'进行中',blocked:'遇到阻碍',awaiting_validation:'等待验证',completed:'声称完成，保存后等待核验',cancelled:'已取消'};
 async function save(){await run(async()=>{if(activeOutcome.stage&&!activeOutcome.confirmed)throw Error('请明确确认任务进度。');if(completionError)throw Error(completionError);if(missingConfirmation)throw Error('请填写并确认新要求，或改为仅保存建议。');const selectedEdits=Object.fromEntries(Object.entries(edits).filter(([id])=>chosen.includes(id)));if(privacyIssues([selectedEdits,activeCompletions,activeOutcome,...activeUpdates.map(id=>confirmations[id]?.text||'')]).length)throw Error('修改后的内容疑似包含隐私，未发送或保存。');const result=await api(`/projects/${project.id}/work-import`,{worklog:work,...(activeOutcome.stage?{task_outcome:{...activeOutcome,ticket_id:plan.association.link.ticket_id}}:{}),associate_task:associateTask,selected_ids:chosen,edits:selectedEdits,task_completions:activeCompletions,apply_update_ids:activeUpdates,update_confirmations:Object.fromEntries(activeUpdates.filter(id=>plan.entries.find(e=>e.id===id)?.update_target?.requires_confirmation).map(id=>[id,confirmations[id]?.text??''])),reviewed,reviewer:{kind:reviewerKind,id:reviewerKind==='human'?'local-user':reviewerName},revision:archive.revision,...(draft?{draftId:draft.id,andHandoff:true,handoffReviewed:reviewed}:{})});await onSaved(result,activeOutcome.stage==='completed'?'':continueTarget);});}
 async function hold(){if(!draft||busy)return;await run(async()=>{const result=await api(`/projects/${project.id}/inbox-hold`,{draftId:draft.id});if(!result.held)throw Error('尚未确认暂存成功，请重新检查这批记录。');await onHeld({...result,projectId:project.id,draftId:draft.id});});}
 const holdAction=draft&&<section className="work-hold" aria-label="暂存本批记录"><div><strong>这批记录留待以后处理</strong><p>整批原文保留在本机，不写入记忆，也不会进入交接。可在“项目交接”的“暂存记录”里随时恢复检查。</p>{Object.keys(edits).length>0&&<small>暂存保留收到的原文，本页的表述修改不会保存。</small>}</div><button disabled={busy} onClick={hold}>暂存这批，不写入记忆</button></section>;
 useEffect(()=>{if(draft)preview(JSON.stringify(draft.worklog));},[draft?.id]);
 if(draft&&!plan)return <div className="work-import">{holdAction}<p>{busy?'正在准备新记录…':'新记录尚未准备好。'}</p>{error&&<p role="alert" className="error">{error}</p>}<button disabled={busy} onClick={()=>preview(JSON.stringify(draft.worklog))}>重新检查</button></div>;
 return <div className="work-import">
  <p className="muted">导入到 <strong>{project.name}</strong>。先预览，再选择保存；保存不等于核验结果或采纳 AI 建议。</p>
  {!plan&&holdAction}
  {!plan?<>
   <div className="work-intro"><strong>让 AI 整理，不用逐条填表</strong><p>把整理要求交给刚完成工作的 AI，再导入它返回的文件或粘贴内容。</p><button disabled={busy} onClick={()=>{setShowPrompt(true);run(async()=>{try{await navigator.clipboard.writeText(prompt);setNotice('整理要求已复制，可粘贴给刚完成工作的 AI。');}catch{setNotice('请复制下方整理要求。');}});}}>复制给 AI 的整理要求</button></div>
   {showPrompt&&<details open><summary>整理要求</summary><textarea readOnly aria-label="工作记录整理要求" rows={7} value={prompt}/></details>}
   <Field label="选择工作记录文件"><input type="file" accept=".json,application/json" disabled={busy} onChange={e=>{const file=e.target.files[0];reset('');if(!file)return;run(async()=>{if(file.size>WORKLOG_LIMIT)throw Error('文件过大，上限 300 KB。');const value=await file.text();parseWorklogText(value);setText(value);setNotice('文件已读取到本机页面，尚未保存。');});}}/></Field>
   <Field label="或粘贴 AI 返回的工作记录"><textarea rows={7} value={text} disabled={busy} onChange={e=>reset(e.target.value)} placeholder="粘贴按整理要求生成的内容"/></Field>
   <Check checked={sourceReviewed} disabled={busy} onChange={e=>setSourceReviewed(e.target.checked)}>我已在本机检查原材料，不含凭据或隐私</Check>
   <p className="muted">内容只在本机处理。规则只能识别部分隐私；预览草稿不写入记忆，关闭即放弃。</p>
   <button className="primary" disabled={busy||!sourceReviewed||!text.trim()} onClick={()=>preview()}>预览工作记录</button>
  </>:<>
   <div className="work-summary"><div><strong>一批工作 · {plan.entries.length} 条记录</strong><p>整理者：{actorLabel(plan.session.actor??{kind:'agent',id:plan.session.agent})}</p><details className="work-session"><summary>查看本次记录编号</summary><code>{plan.session.id}</code></details></div>{!draft&&<button disabled={busy} onClick={()=>{setPlan(null);setReviewed(false);}}>返回修改原材料</button>}</div>
   <section className="work-task-association" aria-label="本批对应的任务"><h3>这批结果对应哪件事？</h3>{plan.association?.status==='matched'?<><strong>{plan.association.link.task}</strong><p>{plan.association.notice}</p><Check checked={associateTask} disabled={busy} onChange={e=>{setAssociateTask(e.target.checked);setOutcome(emptyOutcome());setReviewed(false);}}>将所选记录归到这件事（不标记任务完成）</Check><small>如果这批混有其他任务的结果，请暂不归类，或让 AI 按任务拆批提交。</small></>:<p>{plan.association?.notice||'任务归属待确认，暂不归类。'}</p>}</section>
   {plan.entries.filter(e=>e.update).map(e=><MemoryUpdateCard key={e.id} entry={e} edit={edits[e.id]} selected={chosen.includes(e.id)} apply={activeUpdates.includes(e.id)} confirmation={confirmations[e.id]} onChoose={mode=>chooseUpdate(e.id,mode)} onConfirm={value=>{setConfirmations(prev=>({...prev,[e.id]:value}));setReviewed(false);}} onInspect={()=>inspect(e.id)} busy={busy} reviewerKind={reviewerKind}/>)}
   {plan.entries.some(e=>!e.update)&&<WorkBatchCard entries={plan.entries.filter(e=>!e.update)} triage={triageWork(plan.entries.filter(e=>!e.update),archive,edits)} edits={edits} chosen={chosen} onInspect={inspect}/>}
   <TaskCompletion entries={plan.entries.filter(e=>chosen.includes(e.id))} targets={plan.completion_targets||[]} choices={activeCompletions} onChange={chooseCompletion} busy={busy} reviewerKind={reviewerKind}/>
   {completionError&&<p className="error" role="alert">{completionError}</p>}
   <p className="work-batch-privacy">{triage.counts.privacy?`发现 ${triage.counts.privacy} 条疑似隐私，请展开处理后再保存。`:'规则未发现疑似隐私，仍需检查内容和依据。'}</p>
   <button className="work-batch-toggle" aria-expanded={showEntries} aria-controls="work-batch-entries" disabled={busy} onClick={()=>setShowEntries(value=>!value)}>{showEntries?'收起逐条检查':`展开 ${plan.entries.length} 条记录与原始依据 / 调整选择`}</button>
   <div id="work-batch-entries" hidden={!showEntries}>
   <section className="work-triage" aria-label="检查摘要">
    <div className="work-triage-heading"><div><h3>先看这些提示</h3><p>本机按文字和来源整理，不调用 AI；不会合并、改写或核验记录。</p></div><span>{triage.counts.attention} 条需留意</span></div>
    <div className="work-triage-filters" role="group" aria-label="按检查提示筛选">{[['all','全部',plan.entries.length],['attention','需留意',triage.counts.attention],['similar','重复或相近',triage.counts.similar],['suggestions','建议或推断',triage.counts.suggestions]].map(([key,label,count])=><button key={key} aria-pressed={filter===key} disabled={busy} onClick={()=>setFilter(key)}>{label} {count}</button>)}</div>
    <p className="work-triage-privacy">{triage.counts.privacy?`发现 ${triage.counts.privacy} 条疑似隐私，请先移除；不会发送或保存这些内容。`:'当前规则未发现疑似隐私，仍需你检查原始依据；这不是隐私安全保证。'}</p>
    <div className="work-triage-pick"><button disabled={busy||!triage.recommendedIds.length} onClick={()=>{select(triage.recommendedIds);setNotice('已选择常规新记录，需留意的条目仍在下方，可逐条补选。保存时未选项会随本批清空。');}}>只选常规新记录（{triage.recommendedIds.length}）</button><small>跳过相近、冲突和待核查条目，可在下方补选。保存时未选项会随本批清空。</small></div>
   </section>
   <div className="work-selectbar"><span aria-live="polite">已选 <strong>{chosen.length}</strong> 条 · 可新增 {newIds.length} 条</span><div><button disabled={busy||!newIds.length||chosen.length===newIds.length} onClick={()=>select(newIds)}>全选新记录</button><button disabled={busy||!chosen.length} onClick={()=>select([])}>清空选择</button></div></div>
   {filter!=='all'&&<p className="muted">筛选只改变显示范围；当前共选择 {chosen.length} 条，保存会包含其他筛选下已选中的记录。<button className="work-expand" onClick={()=>setFilter('all')}>查看全部</button></p>}
   {!visibleEntries.length&&<p className="muted">这个分类没有记录。</p>}
   <div className="work-candidates">{visibleEntries.map(e=>{
    const hint=triageById.get(e.id);
    const title=edits[e.id]?.title??e.title,detail=edits[e.id]?.detail??e.detail,source=fileSource(e.source),isEdited=!!edits[e.id],longDetail=detail.length>240||detail.split('\n').length>4;
    return <article id={'work-entry-'+e.id} className={'work-candidate '+(e.status==='new'?'':'work-muted')+(chosen.includes(e.id)?' work-selected':'')} key={e.id}>
     <header className="work-card-heading"><Check checked={chosen.includes(e.id)} disabled={e.status!=='new'||busy} onChange={ev=>select(ev.target.checked?[...chosen,e.id]:chosen.filter(id=>id!==e.id))}>{title||'标题待填写'}</Check>{e.status==='new'&&<button className="work-edit-toggle" disabled={busy} aria-expanded={!!editing[e.id]} aria-controls={'work-edit-'+e.id} onClick={()=>setEditing(prev=>({...prev,[e.id]:!prev[e.id]}))}>{editing[e.id]?'收起修改':'修改表述'}</button>}</header>
     {e.task_id&&<p className="work-warning">关联原任务：{e.task_title} · {['completed','awaiting_validation','cancelled'].includes(e.stage)?'保存后停止自动推荐，仍待核验':'保存后记录为继续或未完成'}。原任务和依据保留。</p>}
     <div className="work-card-meta"><span className="work-kind-label">{names[e.kind]}</span><span>{originLabel(e.origin)}</span><span>来源：{actorLabel(e.source.speaker)}</span>{isEdited&&<span className="work-edit-label">表述已调整</span>}</div>
     <div className="work-triage-tags">{hint.suggestion&&<span>建议或推断 · 不代表用户确认</span>}{hint.related.length>0&&<span className="work-tag-attention">文字相近 · 请比较</span>}{hint.privacy.map(label=><span className="work-tag-danger" key={label}>疑似{label}</span>)}</div>
     {hint.privacy.length>0&&<p role="alert" className="error">请先移除疑似隐私，再保存；不要把原值放入依据中。</p>}
     {hint.related.length>0&&<details className="work-comparison"><summary>对照 {hint.related.length} 条相近记录（不会自动合并）</summary><p className="muted">文字相近不代表内容相同，尤其注意否定、数字、时间、条件和不同来源。</p>{hint.related.map(other=><div key={other.from+other.id}><strong>{other.title}</strong><small>{other.from==='memory'?'已有记忆':'本批另一条'} · {other.match==='same'?'正文相同或仅格式差异':'部分文字相近'}{other.lifecycle&&other.lifecycle!=='accepted'?' · 历史或候选状态':''}</small><p>{other.detail}</p></div>)}</details>}
     <p className={'work-card-detail '+(longDetail&&!expanded[e.id]?'work-detail-clamped':'')} id={'work-detail-'+e.id}>{detail||'内容待填写'}</p>
     {longDetail&&<button className="work-expand" disabled={busy} aria-expanded={!!expanded[e.id]} aria-controls={'work-detail-'+e.id} onClick={()=>setExpanded(prev=>({...prev,[e.id]:!prev[e.id]}))}>{expanded[e.id]?'收起全文':'展开全文'}</button>}
     {source&&<p className="work-file-source">文件：<code>{source.path}</code>{source.selector&&<span> · {source.selector}</span>}</p>}
     {e.status!=='new'&&<p className={e.status==='conflict'?'error':'muted'}>{e.status==='duplicate'?'已导入，本次跳过。':'相同编号已有不同内容，请核对原记录；不会覆盖。'}</p>}
     {e.status==='new'&&editing[e.id]&&<div className="work-edit-fields" id={'work-edit-'+e.id}>
      <p className="muted">仅调整记忆表述，原始依据保持原文。修改不代表核验结果或采纳建议。</p>
      <Field label={`标题 · ${e.id}`}><input disabled={busy} maxLength={160} value={title} onChange={ev=>update(e.id,'title',ev.target.value)}/></Field>
      <Field label={`内容 · ${e.id}`}><textarea disabled={busy} rows={4} maxLength={12000} value={detail} onChange={ev=>update(e.id,'detail',ev.target.value)}/></Field>
      {isEdited&&<button disabled={busy} onClick={()=>{setEdits(prev=>{const next={...prev};delete next[e.id];return next;});setConfirmations(prev=>({...prev,[e.id]:{...prev[e.id],checked:false}}));setReviewed(false);}}>恢复原表述</button>}
     </div>}
     {['decision','constraint'].includes(e.kind)&&<><p>适用期限：{applicabilityLabel(edits[e.id]?.applicability??e.applicability??{kind:'unknown'})}（期限不等于用户确认）</p>{!e.update&&reviewerKind==='human'&&<><Field label={`适用期限 · ${e.id}`}><select disabled={busy} value={(edits[e.id]?.applicability??e.applicability)?.kind||'unknown'} onChange={ev=>update(e.id,'applicability',{kind:ev.target.value,...(ev.target.value==='task'?{task:''}:{})})}><option value="unknown">尚不明确</option><option value="task">仅指定任务</option><option value="project">项目长期适用</option></select></Field>{(edits[e.id]?.applicability??e.applicability)?.kind==='task'&&<Field label={`具体任务 · ${e.id}`}><input disabled={busy} maxLength={300} value={(edits[e.id]?.applicability??e.applicability).task||''} onChange={ev=>update(e.id,'applicability',{kind:'task',task:ev.target.value})}/></Field>}</>}{e.update&&<p>采用旧记忆更新会沿用原期限；需要改变期限时请从原记录单独修订。</p>}</>}
     {e.conditions&&<p>当时条件：{e.conditions}</p>}{e.result&&<p>观察结果：{e.result}</p>}{e.mistake&&<p className="work-warning">待核查的错误：{e.mistake}</p>}{e.reason&&<p>理由：{e.reason}</p>}{e.next&&<p>下一步建议：{e.next}</p>}{e.stage&&<p>报告阶段：{stageNames[e.stage]||e.stage}</p>}{e.correction_entry_id&&<p>关联纠正：{plan.entries.find(c=>c.id===e.correction_entry_id)?.title}</p>}
     {e.warnings.map(w=><p className="work-warning" key={w}>{w}</p>)}{e.check_note&&<p>报告的核查说明：{e.check_note}</p>}
     <details className="work-original"><summary>查看原始依据（保留原文）</summary>{source&&<p className="muted">文件位置与读取工具由提交者声明，导入不会自动核验。</p>}<pre>{e.source.text}</pre></details>
     {e.file_evidence?.map((attachment,index)=><details className="work-original work-file-attachment" key={index}><summary>附带文件原文：{attachment.file.path}{attachment.redacted?' · 节选':''}</summary><p className="muted">来源：{actorLabel(attachment.speaker)}。文件原文作为相关背景，不自动证明上方说明正确。</p><pre>{attachment.text}</pre></details>)}
    </article>;
   })}</div>
   </div>
   {missingCorrections.length>0&&<div role="alert" className="work-warning">{missingCorrections.map(e=>{const correction=plan.entries.find(c=>c.id===e.correction_entry_id);return <p key={e.id}>{correction?.status==='conflict'?`“${correction.title}”存在内容冲突，请先取消选择“${e.title}”并核对原记录。`:`“${e.title}”关联的纠正尝试还未选中，请同时选中“${correction?.title||e.correction_entry_id}”。`}</p>;})}</div>}
   {!newIds.length&&<p className="muted">本批没有可新增的记录。重复项已经保存，内容冲突项需要另行核对。</p>}
   <details className="work-reviewer"><summary>导入检查者（默认本人）</summary><Field label="这次导入由谁检查"><select disabled={busy} value={reviewerKind} onChange={e=>{setReviewerKind(e.target.value);setOutcome(emptyOutcome());setTaskCompletions({});setApplyUpdates([]);setConfirmations({});setReviewed(false);}}><option value="human">用户本人</option><option value="agent">AI</option><option value="tool">工具</option></select></Field>{reviewerKind!=='human'&&<Field label="导入检查者名称"><input disabled={busy} maxLength={100} value={reviewerName} onChange={e=>{setReviewerName(e.target.value);setReviewed(false);}}/></Field>}</details><div className="privacy-box"><Check checked={reviewed} disabled={busy} onChange={e=>setReviewed(e.target.checked)}>{draft?'我已检查所选记录与已有项目资料，不含隐私，允许保存并生成交接；这不代表核验；已明确选择的更新和待办进度按上方处理':'我已检查所选条目的内容和依据，允许保存；这不代表核验；已明确选择的更新和待办进度按上方处理'}</Check><small>{draft?'仅保存勾选项，未选项不进入记忆；本批草稿随后清空。已有记录与新记录一起进入交接。':'仅保存勾选项，原始依据保留。只有明确选择“采用更新”的条目会替代旧记忆，其余更新建议保存为候选。'}</small></div>
   {outcomeEnabled&&<><h3>本批记录属于：{plan.association.link.task}</h3><TaskOutcomeChoice confirmSeparately={false} value={outcome} onChange={v=>{setOutcome(v);if(v.stage==='completed')setContinueTarget('');setReviewed(false);}} disabled={busy}/></>}
   <Field label="保存后做什么"><select aria-label="保存后做什么" value={continueTarget} disabled={busy||activeOutcome.stage==='completed'} onChange={e=>setContinueTarget(e.target.value)}><option value="">只保存，稍后继续</option><option value="codex">用 Codex 接着做</option><option value="claude">用 Claude Code 接着做</option></select></Field>
   {continueTarget&&<p className="muted">保存后会带出已记录的下一步，供你确认或修改，再交给目标 AI。打开失败无需重复保存。</p>}
   <footer className="work-review-actions"><div><strong>本次保存 {chosen.length} 条 · 处理 {Object.keys(activeCompletions).length} 项待办 · 更新 {activeUpdates.length} 条旧记忆</strong><small>{missingConfirmation?'请填写并确认新要求':selectedPrivacy?'请先移除所选记录中的疑似隐私':missingCorrections.length?'请先处理关联的纠正尝试':!chosen.length?'请选择要保存的新记录':!reviewed?'检查内容后勾选上方确认':activeUpdates.length?'旧记录转入历史，采用的更新仍按实际核验状态保留':'原始依据保留，建议保持待确认'}</small></div><button className="primary" disabled={busy||!reviewed||!chosen.length||activeOutcome.stage&&!activeOutcome.confirmed||!!completionError||missingConfirmation||selectedPrivacy||missingCorrections.length>0||(reviewerKind!=='human'&&!reviewerName.trim())} onClick={save}>{busy?'正在保存…':activeOutcome.stage==='completed'?'保存并完成本次任务':continueTarget?'保存并用 '+(continueTarget==='claude'?'Claude Code':'Codex')+' 接着做':draft?'保存本次工作并生成交接':'保存本次工作'}</button></footer>
   {draft&&<details className="work-batch-later"><summary>这批暂时不保存</summary>{holdAction}</details>}
  </>}
  {error&&<p role="alert" className="error banner">{error}</p>}{notice&&<p role="status" className="muted">{notice}</p>}
 </div>;
}
