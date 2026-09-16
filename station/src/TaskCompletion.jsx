import React from 'react';
import {Field} from './ui.jsx';

export default function TaskCompletion({entries,targets,choices,onChange,busy,reviewerKind}){
 const eligible=entries.filter(e=>e.status==='new'&&['fact','attempt'].includes(e.kind)&&e.origin!=='inference'&&!e.update);
 if(!eligible.length||(!targets.length&&!eligible.some(e=>e.completion)))return null;
 return <section className="task-completion-review" aria-label="顺手处理旧待办"><h3>这次工作处理了旧待办吗？</h3><p>可以一起更新进度。默认不处理；全部完成会停止推荐并等待核验，部分完成仍保留。</p>
 {eligible.map(e=>{const choice=choices[e.id],target=targets.find(t=>t.id===choice?.task_id),proposal=e.completion;const disabled=busy||reviewerKind!=='human';return <details key={e.id} open={!!choice||!!proposal}>
  <summary>{e.title}{choice?' · 已选择关联':proposal?' · AI 提议关联旧待办':' · 选择关联（可选）'}</summary>
  {proposal&&<div className="work-warning"><p>AI 建议：{e.completion_target?.title} · {proposal.stage==='completed'?'声称全部完成':'只完成一部分'}</p><p>{proposal.reason}</p><p>原待办内容：{e.completion_target?.detail}</p><button disabled={disabled||!e.completion_target?.available} onClick={()=>onChange(e.id,proposal)}>按此建议关联，保存时处理</button>{!e.completion_target?.available&&<p>此待办已不在可处理列表中，不能直接采用；可先只保存工作记录。</p>}</div>}
  <Field label={`关联旧待办 · ${e.title}`}><select disabled={disabled} value={choice?.task_id||''} onChange={ev=>onChange(e.id,ev.target.value?{task_id:ev.target.value,stage:'in_progress',reason:''}:null)}><option value="">不处理旧待办</option>{targets.map(t=><option key={t.id} value={t.id}>{t.text.slice(0,100)}</option>)}</select></Field>
  {choice&&<><p className="task-original">原待办全文：{target?.text||'待办状态有变化，请重新预览'}</p><small>{target?.source} · {target?.note}</small><Field label={`完成程度 · ${e.title}`}><select disabled={disabled} value={choice.stage} onChange={ev=>onChange(e.id,{...choice,stage:ev.target.value})}><option value="in_progress">只完成一部分，继续保留待办</option><option value="completed">已完成，停止推荐并等待核验</option></select></Field><Field label={`关联理由 · ${e.title}`}><textarea disabled={disabled} rows={2} maxLength={2000} value={choice.reason} onChange={ev=>onChange(e.id,{...choice,reason:ev.target.value})} placeholder="本次结果解决了原待办的哪部分？还有哪些没做？"/></Field><p>{choice.stage==='completed'?'保存后原待办停止自动推荐，但不会标成已核验或用户验收。':'保存后记录为进行中，原待办仍可继续推荐。'}原任务、工作结果与原始依据均保留。</p></>}
 </details>;})}</section>;
}
