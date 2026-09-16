import {applicabilityLabel} from '../shared/applicability.js';
import React from 'react';

// A reading view of the received entries, never a replacement for their evidence.
export default function WorkBatchCard({entries,triage,edits,chosen,onInspect}){
 const hints=new Map(triage.rows.map(row=>[row.id,row]));
 const groups=[
  ['本次目标',e=>e.kind==='goal'&&!hints.get(e.id)?.suggestion],
  ['工作与观察',e=>!['goal','task','decision','constraint'].includes(e.kind)&&!hints.get(e.id)?.suggestion],
  ['待定事项与建议',e=>['task','decision','constraint'].includes(e.kind)||hints.get(e.id)?.suggestion],
 ];
 return <section className="work-batch-card" aria-label="本次工作检查卡">
  <header><div><h3>一次检查这次工作</h3><p>按原记录分组，正文展示节选；点标题可看全文和依据。保存后仍保留每条原记录。</p></div><span>{entries.length} 条原记录</span></header>
  <p className="work-batch-attention">{triage.counts.attention} 条需留意 · {triage.counts.suggestions} 条建议或推断；对应提示随原记录保留。</p>
  {groups.map(([label,match])=>{const rows=entries.filter(match);return rows.length>0&&<section className="work-batch-group" key={label}><h4>{label}</h4>{rows.map(e=><div className="work-batch-line" key={e.id}>
   <button onClick={()=>onInspect(e.id)}>{edits[e.id]?.title??e.title}</button><small>{e.status==='duplicate'?'已保存，本次跳过':e.status==='conflict'?'编号冲突，不能保存':chosen.includes(e.id)?'已选':'未选'}</small>
   <p>{edits[e.id]?.detail??e.detail}</p>{['decision','constraint'].includes(e.kind)&&<button onClick={()=>onInspect(e.id)}>适用期限：{applicabilityLabel(edits[e.id]?.applicability??e.applicability??{kind:'unknown'})} · 查看或调整</button>}
   {e.file_evidence?.length>0&&<button onClick={()=>onInspect(e.id)}>已附 {e.file_evidence.length} 份文件原文：{e.file_evidence.map(s=>s.file.path).join('、')} · 查看</button>}
   {e.file_notes?.length>0&&<button className="work-warning" onClick={()=>onInspect(e.id)}>有 {e.file_notes.length} 份文件未附上原文 · 查看原因</button>}
   {e.task_id&&<p className="work-warning">关联任务：{e.task_title}。{['completed','awaiting_validation','cancelled'].includes(e.stage)?'保存这条后，原任务不再自动推荐；完成声明仍待核验。':'保存这条后，按未完成或继续状态推荐原任务。'}取消选择此条就不改变原任务的推荐。</p>}
  </div>)}</section>;})}
  <div className="work-batch-notices" aria-label="本批需留意事项">
   {triage.rows.filter(row=>row.needsAttention||row.suggestion||row.receipt==='duplicate').map(row=>{const e=entries.find(item=>item.id===row.id);const labels=[row.privacy.length>0?'疑似隐私':null,row.receipt==='conflict'?'编号冲突':null,row.receipt==='duplicate'?'已导入':null,row.related.length>0?'与其他记录相近':null,row.suggestion||e.kind==='task'?'建议尚未采纳':null,e.mistake?'含错误记录':null,e.file_notes?.length||e.file_paths&&!e.file_evidence&&!e.file_notes?'部分文件原文未附上':null,e.stage==='completed'?'完成声明待核验':null].filter(Boolean);return <button className={row.privacy.length?'work-batch-danger':''} key={row.id} onClick={()=>onInspect(row.id)}>{edits[e.id]?.title??e.title}：{labels.join(' · ')} <span>查看详情 →</span></button>;})}
  </div>
  <p className="work-batch-footnote">记录中的完成、测试与建议均保留原身份和核验状态；保存不代表你已确认它们正确。</p>
 </section>;
}
