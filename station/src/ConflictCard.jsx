import React,{useState} from 'react';
import {Field,Check} from './ui.jsx';
import {actorLabel} from '../shared/attribution.js';
import {privacyIssues} from '../shared/privacy.js';
import './conflict-card.css';
const labels={statement:'内容',rule:'要求',choice:'选择',desired_outcome:'目标',objective:'任务',detail:'进度',action:'尝试',applies_when:'适用条件',conditions:'当时条件',stage:'阶段',rationale:'原因',observed_result:'观察结果'};
export default function ConflictCard({archive,pair,busy,onSave}){
 const [action,setAction]=useState(''),[retained,setRetained]=useState(''),[conditions,setConditions]=useState(['','']),[reason,setReason]=useState(''),[reviewed,setReviewed]=useState(false),[requestId]=useState(()=>crypto.randomUUID());
 const change=fn=>{fn();setReviewed(false);};
 const issues=privacyIssues({reason,conditions});
 const blocked=pair.some(m=>!m)||pair.length!==2;
 if(blocked)return <p>记录已变化，请重新打开冲突卡。</p>;
 const ready=action&&reason.trim()&&reviewed&&!issues.length&&(action!=='coexist'||conditions.every(s=>s.trim())&&conditions[0].trim()!==conditions[1].trim());
 return <div className="conflict-card">
  <p>对照双方原话、时间和适用条件，再决定这次如何处理。系统不判断谁正确，也不会按时间先后自动选一条。</p>
  <div className="conflict-columns">{pair.map((m,i)=><section key={m.id} aria-label={i===0?'说法 A':'说法 B'}><small>说法 {i===0?'A':'B'} · {m.lifecycle==='accepted'?'当前记录':'历史记录'}</small><h3>{m.claim}</h3><p className="muted">记录于 {new Date(m.recorded_at).toLocaleString('zh-CN')} · {actorLabel(m.by)}</p><p className="muted">{m.approval?'有用户确认，范围见依据':'未记录用户确认'} · {m.verification.status==='verified'?'有核查记录':'仍需核查'}</p>
  <dl>{Object.entries(m.data).map(([key,value])=><React.Fragment key={key}><dt>{labels[key]||key}</dt><dd>{typeof value==='object'?JSON.stringify(value):String(value)}</dd></React.Fragment>)}</dl>{m.scope.condition&&<p>追加适用条件：{m.scope.condition}</p>}
  <details><summary>查看原始依据与确认范围</summary>{m.approval&&<p>确认人：{actorLabel(m.approval.by)}；范围：{m.approval.fields.join('、')}</p>}{m.evidence.map((ref,j)=>{const e=archive.bundle.evidence.find(e=>e.id===ref.evidence_id);return <div key={j}><small>{actorLabel(e.locator?.speaker)} · {e.kind}</small><pre>{archive.snapshots[e.snapshot?.path]||'原文不可用'}</pre></div>;})}</details>
  <button disabled={busy||m.lifecycle!=='accepted'} aria-pressed={action==='choose'&&retained===m.id} onClick={()=>change(()=>{setAction('choose');setRetained(m.id);})}>采用说法 {i===0?'A':'B'}</button></section>)}</div>
  <div className="conflict-actions"><button disabled={busy||pair.some(m=>m.lifecycle!=='accepted')} aria-pressed={action==='coexist'} onClick={()=>change(()=>setAction('coexist'))}>两条分别适用</button><button disabled={busy} aria-pressed={action==='defer'} onClick={()=>change(()=>setAction('defer'))}>暂时无法判断</button></div>
  {action==='coexist'&&<div className="conflict-columns">{pair.map((m,i)=><Field key={m.id} label={`说法 ${i===0?'A':'B'} 适用于什么情况`}><textarea disabled={busy} maxLength={1500} rows={3} value={conditions[i]} placeholder="例如：仅限手机触屏模式" onChange={e=>change(()=>setConditions(prev=>prev.map((v,n)=>n===i?e.target.value:v)))}/></Field>)}</div>}
  {action&&<p className="notice">{action==='choose'?'所选记录保留为当前记录，另一条转入历史。原有确认和核验状态不变；未确认的 AI 建议不会自动成为生效要求。':action==='coexist'?'在各自原有范围内追加条件，仅解除这两条之间的冲突；其他冲突仍需处理。原主张及依据不改写，条件与处理理由单独记录。':'双方冲突继续保留，本次记录尚不确定的原因，并提醒后续 AI 核对。'}</p>}
  <Field label={action==='defer'?'哪里还说不准':'为什么这样处理'}><textarea disabled={busy} maxLength={2000} rows={3} value={reason} onChange={e=>change(()=>setReason(e.target.value))}/></Field>
  {issues.length>0&&<p className="error">内容疑似包含隐私，请移除后再保存。</p>}
  <Check checked={reviewed} disabled={busy||!action} onChange={e=>setReviewed(e.target.checked)}>我已检查双方依据，确认上述处理和适用条件，不含隐私；这不代表功能验收或独立核验</Check>
  <footer><small>本次处理会保留理由、原始依据和旧档案，不直接启动 AI。</small><button className="primary" disabled={busy||!ready} onClick={()=>onSave({request_id:requestId,memory_ids:pair.map(m=>m.id),action,...(action==='choose'?{retained_id:retained}:{}),...(action==='coexist'?{conditions}:{}),reason,reviewed,reviewer:{kind:'human',id:'local-user'}})}>{busy?'正在保存…':'保存这次处理'}</button></footer>
 </div>;
}
