import {matchesAgentDeclaration} from './agent-declaration.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function validateTaskLink(link){
 if(!link||typeof link!=='object'||Object.keys(link).some(k=>!['project_id','ticket_id','task_id','task','target','read_at'].includes(k))||!['project_id','ticket_id','task_id'].every(k=>uuid.test(link[k]))||typeof link.task!=='string'||!link.task.trim()||link.task.length>2000||!['codex','claude','grok','other'].includes(link.target)||!Number.isFinite(Date.parse(link.read_at)))throw Error('工作记录的任务归属无效。');
 return link;
}
export function associateWork(projectId,work,tickets=[]){
 const id=work.session?.handoff_id;
 if(!id)return {status:'unknown',notice:'未提供本次交接编号，任务归属待确认；不会按标题或最近任务自动归类。'};
 const ticket=tickets.find(t=>t.id===id&&t.projectId===projectId);
 if(!ticket?.task||!ticket.taskThreadId||!ticket.receipt?.taskReceived||!matchesAgentDeclaration(work.session,ticket.target))return {status:'unknown',notice:'本批声明的交接编号、读取回执或整理者无法对上，任务归属待确认。'};
 const link=validateTaskLink({project_id:projectId,ticket_id:id,task_id:ticket.taskThreadId,task:ticket.task,target:ticket.target,read_at:ticket.receipt.at});
 return {status:'matched',link,notice:'交接编号和读取回执已对上；这是任务归类，不证明内容正确、AI身份已认证或任务完成。'};
}
export function taskWorkGroups(archive){
 const groups=new Map(),memories=new Map(archive.bundle.memories.map(m=>[m.id,m]));
 for(const r of archive.work_imports||[]){const link=r.task_link;if(!link||link.project_id!==archive.bundle.project.id)continue;try{validateTaskLink(link);}catch{continue;}const m=memories.get(r.memory_id);if(!m||m.lifecycle!=='accepted')continue;
  if(!groups.has(link.task_id))groups.set(link.task_id,{id:link.task_id,task:link.task,records:[],at:r.imported_at});const g=groups.get(link.task_id);if(!g.records.some(v=>v.id===m.id))g.records.push(m);if(r.imported_at>g.at)g.at=r.imported_at;
 }
 return [...groups.values()].sort((a,b)=>b.at.localeCompare(a.at));
}

export function validateTaskLinkReview(review){
 if(!review||Object.keys(review).some(k=>!['method','by','at'].includes(k))||review.method!=='manual'||!Number.isFinite(Date.parse(review.at))||!review.by||Object.keys(review.by).some(k=>!['kind','id'].includes(k))||!['human','agent','tool'].includes(review.by.kind)||typeof review.by.id!=='string'||!review.by.id.trim()||review.by.id.length>100)throw Error('任务归属检查记录无效。');
 return review;
}
