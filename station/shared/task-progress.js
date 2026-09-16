import {associateWork} from './work-association.js';
export function taskProgress(archive,tickets,draft){
 const last=[...tickets].reverse().find(t=>t.task),thread=last?.taskThreadId;
 if(!thread)return [];
 const accepted=new Set(archive.bundle.memories.filter(m=>m.lifecycle==='accepted').map(m=>m.id));
 const association=draft?associateWork(archive.bundle.project.id,draft.worklog,tickets):null;
 return tickets.filter(t=>t.taskThreadId===thread).slice(-8).reverse().map(t=>{
  const rows=(archive.work_imports||[]).filter(r=>r.task_link?.project_id===archive.bundle.project.id&&r.task_link.ticket_id===t.id&&accepted.has(r.memory_id));
  return {id:t.id,target:t.target,createdAt:t.createdAt,revision:t.revision,readAt:t.receipt?.at||null,taskReceived:t.receipt?.taskReceived===true,savedCount:new Set(rows.map(r=>r.memory_id)).size,manualCount:rows.filter(r=>r.task_link_review).length,pendingCount:association?.status==='matched'&&association.link.ticket_id===t.id?draft.worklog.entries.length:0};
 });
}
