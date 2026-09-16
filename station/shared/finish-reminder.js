import {latestTaskOutcomes} from './task-outcome.js';
import {matchesAgentDeclaration} from './agent-declaration.js';
export function finishReminderStatus(archive,ticket,tickets,draft,held=[]){
 const no=(reason,message)=>({available:false,reason,message});
 if(!ticket?.taskThreadId||!ticket.task||ticket.projectId!==archive.bundle.project.id)return no('no_task','这次交接没有可核对的任务。');
 if([...tickets].reverse().find(t=>t.task)?.id!==ticket.id)return no('changed','当前交接已变化，请回到最新任务。');
 if(latestTaskOutcomes(archive).get(ticket.taskThreadId)?.stage==='completed')return no('saved','这个任务已标记完成，无需催收。');
 if(!ticket.receipt?.taskReceived)return no('unread','尚未收到任务读取回执，请先让AI读取交接。');
 if((archive.work_imports||[]).some(r=>r.task_link?.project_id===archive.bundle.project.id&&r.task_link.ticket_id===ticket.id))return no('saved','这次交接已有保存结果，无需重复催收。');
 if(draft)return no('pending','已有新记录等待检查，先查看结果，避免重复提交。');
 if(held.length)return no('held','本项目有暂存记录，请先在新记录中检查暂存批次。');
 const possible=(archive.work_imports||[]).some(r=>{if(r.task_link||r.imported_at<ticket.receipt.at)return false;const m=archive.bundle.memories.find(m=>m.id===r.memory_id);return m&&matchesAgentDeclaration({agent:m.by.id,actor:m.by},ticket.target);});
 if(possible)return no('unlinked','读取之后已有同一AI的未归类记录，可能包含本次结果。请先核对归属。');
 return {available:true,reason:'missing',message:'已有任务读取回执，尚未收到关联结果；这不表示AI已经完成。'};
}
