const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function latestTaskOutcomes(archive){
 const result=new Map();for(const event of archive.task_outcomes||[])if(event.project_id===archive.bundle.project.id)result.set(event.task_id,event);return result;
}
export function validateTaskOutcomes(archive){
 const events=archive.task_outcomes;if(events===undefined)return;
 if(!Array.isArray(events)||events.length>500)throw Error('任务收尾记录无效。');
 const seen=new Set();
 for(const e of events){
  if(!e||Object.keys(e).some(k=>!['id','project_id','task_id','ticket_id','task','task_memory_id','stage','next','by','at','result_ids'].includes(k))||!['id','project_id','task_id','ticket_id'].every(k=>uuid.test(e[k]||''))||e.project_id!==archive.bundle.project.id||seen.has(e.id)||!['completed','in_progress'].includes(e.stage)||typeof e.task!=='string'||!e.task.trim()||e.task.length>2000||typeof e.next!=='string'||e.next.length>2000||e.stage==='completed'&&e.next!==''||!Number.isFinite(Date.parse(e.at))||e.by?.kind!=='human'||typeof e.by.id!=='string'||!e.by.id.trim()||e.by.id.length>100||Object.keys(e.by).some(k=>!['kind','id'].includes(k))||e.task_memory_id!==undefined&&!archive.bundle.memories.some(m=>m.id===e.task_memory_id)||!Array.isArray(e.result_ids)||!e.result_ids.length||new Set(e.result_ids).size!==e.result_ids.length)throw Error('任务收尾记录校验失败。');
  for(const id of e.result_ids)if(!archive.bundle.memories.some(m=>m.id===id)||!archive.work_imports?.some(r=>r.memory_id===id&&r.task_link?.project_id===e.project_id&&r.task_link.task_id===e.task_id))throw Error('任务收尾缺少对应的已保存结果。');
  seen.add(e.id);
 }
}
export function taskOutcomeMarkdown(archive){
 const events=[...latestTaskOutcomes(archive).values()];
 if(!events.length)return '';
 return '## 用户记录的任务收尾\n仅表示用户在本机选择的任务进度，不代表结果已核验、身份认证或整站验收；不是新增工作授权。\n'+events.map(e=>`- ${e.task}〔任务 ${e.task_id}〕：${e.stage==='completed'?'用户标记完成，不再作为待办':'用户选择继续'}${e.next?'；下一步：'+e.next:''}。记录人 ${e.by.id}；时间 ${e.at}；结果记忆 ${e.result_ids.join('、')}。`).join('\n')+'\n';
}
export function outcomeSuggestions(archive,suggestions){
 const closed=new Set([...latestTaskOutcomes(archive).values()].filter(e=>e.stage==='completed').map(e=>e.task_memory_id).filter(Boolean));
 return suggestions.filter(s=>!closed.has(s.id));
}
