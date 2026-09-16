import {randomUUID} from 'node:crypto';
import {requireSafe} from '../shared/privacy.js';
import {validateArchive} from './core.mjs';
import {latestTaskOutcomes} from '../shared/task-outcome.js';

export function applyTaskOutcome(archive,input,ticket){
 requireSafe(input);
 if(!input||Object.keys(input).some(k=>!['ticket_id','stage','next','confirmed','reviewer'].includes(k))||!ticket?.taskThreadId||ticket.projectId!==archive.bundle.project.id||input.ticket_id!==ticket.id||!ticket.receipt?.taskReceived)throw Error('请先核对本次任务与读取回执，未修改进度。');
 if(input.confirmed!==true||input.reviewer?.kind!=='human'||typeof input.reviewer.id!=='string'||!input.reviewer.id.trim()||input.reviewer.id.length>100||Object.keys(input.reviewer).some(k=>!['kind','id'].includes(k)))throw Error('任务收尾需要用户明确选择，AI 检查不能代替用户确认。');
 if(!['completed','in_progress'].includes(input.stage)||typeof input.next!=='string'||input.next.length>2000||input.stage==='completed'&&input.next.trim())throw Error('请选择完成或继续；完成时不附带未完成事项。');
 const accepted=new Set(archive.bundle.memories.filter(m=>m.lifecycle==='accepted').map(m=>m.id));
 const ids=[...new Set((archive.work_imports||[]).filter(r=>r.task_link?.project_id===ticket.projectId&&r.task_link.task_id===ticket.taskThreadId&&accepted.has(r.memory_id)).map(r=>r.memory_id))];
 if(!ids.length)throw Error('这个任务还没有明确关联的已保存结果，请先检查保存或补充归属。');
 const previous=latestTaskOutcomes(archive).get(ticket.taskThreadId);
 if(previous?.stage===input.stage&&previous.next===input.next.trim()&&JSON.stringify(previous.result_ids)===JSON.stringify(ids))return {archive,task_outcome:previous,changed:false};
 const result=structuredClone(archive),event={id:randomUUID(),project_id:ticket.projectId,task_id:ticket.taskThreadId,ticket_id:ticket.id,task:ticket.task,...(ticket.taskMemoryId?{task_memory_id:ticket.taskMemoryId}:{}),stage:input.stage,next:input.next.trim(),by:{kind:'human',id:input.reviewer.id.trim()},at:new Date().toISOString(),result_ids:ids};
 result.task_outcomes??=[];result.task_outcomes.push(event);validateArchive(result);
 return {archive:result,task_outcome:event,changed:true};
}
