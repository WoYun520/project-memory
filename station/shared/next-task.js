import {requireSafe} from './privacy.js';

export function checkedTask(value){
 if(typeof value!=='string'||!value.trim()||value.trim().length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw Error('请填写接下来要做的事，最多 2000 字。');
 const task=value.trim();requireSafe(task);return task;
}

export function taskTarget(memories,id){return memories.find(m=>m.id===id&&(m.kind==='task'||m.kind==='state'&&m.data.next_step));}

export function latestTaskStates(memories=[]){
 const states=new Map();
 for(const m of memories.filter(m=>m.lifecycle==='accepted'&&m.kind==='state').map((m,i)=>({m,i})).sort((a,b)=>b.m.recorded_at.localeCompare(a.m.recorded_at)||b.i-a.i).map(x=>x.m))if(m.data.subject_id&&!states.has(m.data.subject_id))states.set(m.data.subject_id,m);
 return states;
}
const usable=m=>m.freshness?.status!=='stale'&&!(m.conflicts_with?.length)&&m.verification?.status!=='conflicted';
const done=new Set(['completed','cancelled','awaiting_validation']);
export const taskIsClosed=state=>Boolean(state&&usable(state)&&done.has(state.data.stage));

// Suggestions are saved claims, not new instructions or proof of unfinished work.
export function nextTaskSuggestions(memories=[],{limit=3}={}){
 const active=memories.filter(m=>m.lifecycle==='accepted');
 const latestStates=latestTaskStates(active);
 const choices=[];
 for(const m of active.filter(usable).sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at))){
  let text;
  const linked=latestStates.get(m.id);
  if(linked&&usable(linked)&&done.has(linked.data.stage))continue;
  if(m.kind==='state'&&m.data.next_step&&!done.has(m.data.stage)){
   if(m.data.subject_id&&latestStates.get(m.data.subject_id)!==m)continue;
   text=m.data.next_step;
  }else if(m.kind==='task'){
   const state=latestStates.get(m.id);
   if(state&&usable(state)&&done.has(state.data.stage))continue;
   text=m.data.objective;
  }
  if(!text)continue;
  if(m.scope?.condition)text+='（仅在以下条件适用：'+m.scope.condition+'）';
  try{text=checkedTask(text);}catch{continue;}
  if(choices.some(c=>c.text===text))continue;
  choices.push({id:m.id,text,source:m.origin==='inference'?'已保存的 AI 建议':m.origin==='human_statement'?'已保存的用户陈述':'已保存的观察记录',note:linked&&!usable(linked)?'关联状态需要复核，请确认是否仍需继续':linked&&['in_progress','not_started','blocked'].includes(linked.data.stage)?'已有继续或未完成记录，请确认本次范围':m.kind==='task'?'档案未记录完成，请确认是否仍需继续':'来自记录中的下一步，请确认仍适用'});
  if(choices.length>=limit)break;
 }
 return choices;
}
