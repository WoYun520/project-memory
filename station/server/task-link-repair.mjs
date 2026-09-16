import {matchesAgentDeclaration} from '../shared/agent-declaration.js';
import {requireSafe} from '../shared/privacy.js';
import {validateTaskLink,validateTaskLinkReview} from '../shared/work-association.js';
export function repairTaskLinks(archive,input,tickets){
 requireSafe(input);
 if(!input||Object.keys(input).some(k=>!['revision','ticket_id','memory_ids','reviewed','reviewer'].includes(k))||input.reviewed!==true)throw Error('请先检查记录和对应任务，只补充归属。');
 if(input.revision!==archive.revision)throw Error('保存版本已变化，请刷新后重新检查。');
 if(!Array.isArray(input.memory_ids)||!input.memory_ids.length||input.memory_ids.length>100||new Set(input.memory_ids).size!==input.memory_ids.length)throw Error('请选择不重复的记录，每次最多100条。');
 const id=archive.bundle.project.id,ticket=tickets.find(t=>t.id===input.ticket_id&&t.projectId===id);
 if(!ticket?.taskThreadId||!ticket.task||!ticket.receipt?.taskReceived)throw Error('请选择本项目有任务读取回执的交接。');
 const at=new Date().toISOString(),review=validateTaskLinkReview({method:'manual',by:input.reviewer,at});
 const link=validateTaskLink({project_id:id,ticket_id:ticket.id,task_id:ticket.taskThreadId,task:ticket.task,target:ticket.target,read_at:ticket.receipt.at});
 const chosen=input.memory_ids.map(mid=>{
  const m=archive.bundle.memories.find(m=>m.id===mid&&m.lifecycle==='accepted');
  const rows=(archive.work_imports||[]).filter(r=>r.memory_id===mid);
  if(!m||rows.length!==1)throw Error('记录不属于可补归属的已保存工作记录。');
  if(!matchesAgentDeclaration({agent:m.by.id,actor:m.by},ticket.target))throw Error('记录整理者与所选交接的AI不一致。');
  if(rows[0].task_link&&rows[0].task_link.ticket_id!==ticket.id)throw Error('记录已有其他归属，不会覆盖；请重新检查。');
  return rows[0];
 });
 const result=structuredClone(archive);let added=0;
 for(const row of chosen){if(row.task_link)continue;const r=result.work_imports.find(r=>r.memory_id===row.memory_id);r.task_link={...link};r.task_link_review=structuredClone(review);added++;}
 return {archive:result,added,duplicate:added===0};
}
