import React from 'react';
import {latestTaskStates,taskIsClosed} from '../shared/next-task.js';
import {Icon} from './ui.jsx';
import {actorLabel,originLabel} from '../shared/attribution.js';

const stageLabels={not_started:'尚未开始',in_progress:'进行中',blocked:'遇到阻碍',awaiting_validation:'声称完成，等待核验',completed:'已记录完成',cancelled:'已取消'};
function cautionsFor(memory){
 const notes=[];
 if(memory.conflicts_with.length)notes.push('存在冲突，先核对双方');
 if(memory.freshness.status==='stale')notes.push('已标记待复核');
 return notes;
}

export default function ProjectResume({records,onDetail,onHandoff,onFolder}){
 const active=records.filter(m=>m.lifecycle==='accepted').sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at));
 const taskStates=latestTaskStates(records);
 const progress=active.filter(m=>(m.kind==='state'||m.kind==='task')&&!taskIsClosed(taskStates.get(m.id))).slice(0,2);
 const cautions=active.filter(m=>m.kind==='constraint'||m.kind==='attempt'&&(m.data.mistake||m.data.outcome==='failed')).slice(0,3);
 return <section className="resume-grid"><div className="resume-panel">
  <div className="section-heading"><h2><Icon name="clock"/>接着上次做</h2><button className="text-button" onClick={onHandoff}>准备交接<Icon name="arrow" size={16}/></button></div>
  {progress.length?progress.map(memory=><button className="resume-record" key={memory.id} onClick={()=>onDetail(memory)}>
   <strong>{memory.claim}</strong>
   {memory.kind==='state'&&<small>{stageLabels[memory.data.stage]||memory.data.stage}</small>}
   <p>{memory.data.next_step?`记录中的下一步：${memory.data.next_step}`:memory.data.detail||memory.data.objective}</p>
   {cautionsFor(memory).map(note=><small className="work-warning" key={note}>{note}</small>)}
   <small>{originLabel(memory.origin)} · 录入：{actorLabel(memory.by)} · {memory.verification.status==='verified'?'已记录核查，不等于用户验收':'尚未核验'}</small>
  </button>):<div className="resume-empty"><p>还没有进度记录。可以连接项目文件夹，把已有说明加入待检查区。</p><button onClick={onFolder}>连接项目文件夹</button></div>}
 </div><div className="resume-panel"><div className="section-heading"><h2><Icon name="shield"/>要求与踩过的坑</h2></div>
  {cautions.length?cautions.map(memory=><button className="resume-record compact" key={memory.id} onClick={()=>onDetail(memory)}>
   <strong>{memory.claim}</strong>
   {cautionsFor(memory).map(note=><small className="work-warning" key={note}>{note}</small>)}
   <small>{memory.kind==='constraint'?(memory.approval?'有用户确认依据':'要求记录 · 待确认'):(memory.data.mistake?.status==='confirmed'?'有核查记录的错误':'尝试记录 · 请核对适用条件')}</small>
  </button>):<p className="muted">还没有这类记录，记忆站不会补全未提供的经历。</p>}
 </div></section>;
}
