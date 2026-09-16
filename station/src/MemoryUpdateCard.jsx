import React from 'react';
import {Field,Check} from './ui.jsx';
import {actorLabel} from '../shared/attribution.js';
const detailKeys={goal:'desired_outcome',fact:'statement',task:'objective',decision:'choice',constraint:'rule',state:'detail',attempt:'action'};

export default function MemoryUpdateCard({entry,edit,selected,apply,confirmation,onChoose,onConfirm,onInspect,busy,reviewerKind}){
 const target=entry.update_target,old=target?.memory,disabled=busy||entry.status!=='new';
 return <section className="memory-update-card" aria-label={`更新建议：${entry.title}`}>
  <header><div><small>更新旧记忆 · AI 建议</small><h3>{edit?.title??entry.title}</h3></div><span>{entry.status==='duplicate'?'已处理':apply&&selected?'保存时采用更新':selected?'仅保存建议':'本次不保存'}</span></header>
  <div className="memory-update-columns"><div><h4>原来怎么记的</h4><strong>{old?.claim??'原记忆不可用'}</strong><p>{old?.data?.[detailKeys[old.kind]]??'请核对原记忆编号。'}</p>{old&&<details><summary>查看原记忆全部信息与依据</summary><p>状态：{old.lifecycle} · {old.verification.status}；{old.approval?'有用户确认记录':'未记录用户确认'}。原记忆和依据始终保留。</p>{Object.entries(old.data).filter(([key])=>key!==detailKeys[old.kind]).map(([key,value])=><p key={key}>{({stage:'阶段',rationale:'原选择理由',applies_when:'适用条件',next_step:'下一步',subject_id:'关联对象',conditions:'当时条件',outcome:'结果',observed_result:'观察结果',mistake:'错误记录'})[key]||key}：{typeof value==='object'?JSON.stringify(value):String(value)}</p>)}{target.evidence.map((e,i)=><div key={e.id+'-'+i}><small>原依据 · {e.kind} · {e.id}</small><pre>{e.text}</pre></div>)}</details>}</div>
  <div><h4>建议更新为</h4><strong>{edit?.title??entry.title}</strong><p>{edit?.detail??entry.detail}</p>{old?.kind==='constraint'&&<p>适用条件：{entry.conditions||old.data.applies_when}</p>}{old?.kind==='state'&&<p>阶段：{entry.stage==='completed'?'等待验证':entry.stage||'进行中'}；关联对象：{entry.task_id||old.data.subject_id}</p>}<button disabled={busy} onClick={onInspect}>调整表述 / 查看全部字段</button><details><summary>查看这次新依据</summary><p>来源：{actorLabel(entry.source.speaker)}；保存或采用不代表核验通过。</p><pre>{entry.source.text}</pre>{entry.file_evidence?.map((s,i)=><div key={i}><strong>{s.file.path}</strong><pre>{s.text}</pre></div>)}{entry.file_notes?.map(n=><p key={n}>{n}</p>)}</details></div></div>
  <p className="memory-update-reason"><strong>为什么建议修改：</strong>{entry.update.reason}</p>
  {target?.blocked&&<p className="work-warning" role="status">{target.blocked}</p>}
  {target?.requires_confirmation&&<p className="work-warning">原要求已有你的确认。采用更新需要单独填写新的确认，AI 的原文保持不变。</p>}
  <div className="memory-update-actions" role="group" aria-label="如何处理这条更新"><button disabled={disabled||!!target?.blocked||reviewerKind!=='human'} aria-pressed={apply&&selected} onClick={()=>onChoose('apply')}>采用更新</button><button disabled={disabled} aria-pressed={selected&&!apply} onClick={()=>onChoose('suggestion')}>仅保存建议</button><button disabled={disabled} aria-pressed={!selected} onClick={()=>onChoose('skip')}>暂不更新</button></div>
  {apply&&selected&&target?.requires_confirmation&&<><Field label={`我的新确认 · ${entry.id}`}><textarea disabled={busy} maxLength={2000} rows={3} value={confirmation?.text??''} placeholder="用自己的话写明新的决定或要求及适用范围" onChange={e=>onConfirm({text:e.target.value,checked:false})}/></Field><Check disabled={busy||!confirmation?.text?.trim()} checked={!!confirmation?.checked} onChange={e=>onConfirm({...confirmation,checked:e.target.checked})}>我确认以上新要求替代这条旧要求；不代表功能已经完成</Check></>}
  {reviewerKind!=='human'&&<p className="muted">当前检查者为 AI 或工具，只能保存建议，不能采用更新。</p>}
  <small>“采用更新”在点击本批保存后生效，旧版本和原始依据保留；“仅保存建议”不改变当前记忆。“暂不更新”的条目不随本批保存；要保留整批以后处理，可选择暂存。</small>
 </section>;
}
