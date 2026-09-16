import React from 'react';
import {Field,Check} from './ui.jsx';

export const emptyOutcome=()=>({stage:'',next:'',confirmed:false});
export default function TaskOutcomeChoice({value,onChange,disabled=false,label='这次任务做到哪了',standalone=false,confirmSeparately=true}){
 return <section className="task-outcome-choice" aria-label={label}>
  <Field label={label}><select value={value.stage} disabled={disabled} onChange={e=>onChange({stage:e.target.value,next:'',confirmed:false})}><option value="">{standalone?'暂不改变任务进度':'只保存记录，不改变任务进度'}</option><option value="completed">这件事已完成，移入任务历史</option><option value="in_progress">还有没做完的，继续保留</option></select></Field>
  {value.stage==='in_progress'&&<Field label="接下来还要做什么（可选）"><textarea rows={2} maxLength={2000} disabled={disabled} value={value.next} onChange={e=>onChange({...value,next:e.target.value,confirmed:false})} placeholder="例如：键盘已检查，接下来检查手机操作"/></Field>}
  {value.stage&&<>{confirmSeparately&&<Check disabled={disabled} checked={value.confirmed} onChange={e=>onChange({...value,confirmed:e.target.checked})}>{value.stage==='completed'?'我确认将这件任务标记完成':'我确认这件任务还要继续'}</Check>}<p className="muted">只记录你选择的任务进度，不把 AI 结果标成已核验，也不代表产品验收。原记录与依据保留，完成后可重新继续。</p></>}
 </section>;
}

export function TaskOutcomeControl({ticket,disabled,onSave}){
 const [value,setValue]=React.useState(emptyOutcome);
 return <details className="task-outcome-control"><summary>{ticket.outcome?.stage==='completed'?'重新继续这件任务':'完成或继续这件任务'}</summary>
  <TaskOutcomeChoice standalone label={'任务进度 · '+ticket.task} value={value} onChange={setValue} disabled={disabled}/>
  <button disabled={disabled||!value.stage||!value.confirmed} onClick={()=>onSave({ticket_id:ticket.id,...value,reviewer:{kind:'human',id:'local-user'}})}>{value.stage==='completed'?'确认完成本次任务':'保存继续事项'}</button>
 </details>;
}
