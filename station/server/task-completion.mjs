import {nextTaskSuggestions,taskTarget} from '../shared/next-task.js';
import {appendMemory} from './core.mjs';

export function completionTargets(archive){return nextTaskSuggestions(archive.bundle.memories,{limit:Infinity});}
export const canLinkCompletion=e=>['fact','attempt'].includes(e.kind)&&e.origin!=='inference'&&!e.update;
export function validateCompletion(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['task_id','stage','reason'].includes(k))||typeof value.task_id!=='string'||!value.task_id||!['completed','in_progress'].includes(value.stage)||typeof value.reason!=='string'||!value.reason.trim()||value.reason.length>2000)throw Error('请明确选择原待办、完成程度，并填写关联理由。');
}
export function completionProposal(archive,e){
 if(!e.completion)return {};
 validateCompletion(e.completion);
 if(!canLinkCompletion(e))throw Error('只有新的工作事实或实际尝试可建议关联待办；更新建议和推断不能声明完成。');
 const task=taskTarget(archive.bundle.memories,e.completion.task_id);
 if(!task)throw Error('建议关联的待办不属于这个项目或不是任务，请使用原记忆编号。');
 return {completion_target:{id:task.id,title:task.claim,detail:task.data.objective||task.data.next_step,available:completionTargets(archive).some(t=>t.id===task.id)}};
}
export function validateCompletionChoices(archive,input,plan,selected,reviewer){
 const choices=input.task_completions??{};
 if(!choices||typeof choices!=='object'||Array.isArray(choices))throw Error('待办处理选择无效。');
 const ids=new Set(),stateIds=new Set(selected.filter(e=>e.task_id).map(e=>e.task_id));
 for(const [entryId,value]of Object.entries(choices)){
  if(reviewer.kind!=='human')throw Error('只有用户可在检查卡选择处理旧待办。');
  const e=selected.find(e=>e.id===entryId);
  if(!e||!canLinkCompletion(e))throw Error('只能关联已选中的工作事实或实际尝试。');
  validateCompletion(value);
  if(ids.has(value.task_id)||stateIds.has(value.task_id))throw Error('同一批只能为一个待办选择一条状态结果，请合并判断。');
  ids.add(value.task_id);
  // A retried imported entry is a no-op, never a second chance to close another task.
  if(e.status!=='duplicate'&&!completionTargets(archive).some(t=>t.id===value.task_id))throw Error('原待办已完成、被替代或需要复核，请重新预览后选择。');
 }
 return choices;
}
export function appendCompletion(archive,record,choice,reviewer,work,entry){
 const task=taskTarget(archive.bundle.memories,choice.task_id);
 const resultLabel=choice.stage==='completed'?'声称完成，等待核验，停止自动推荐':'部分完成，继续保留待办';
 const text=`用户在检查工作记录时选择关联待办“${task.claim}”〔${task.id}〕，关联结果“${record.claim}”〔${record.id}〕。处理方式：${resultLabel}。理由：${choice.reason}。此选择不代表独立核查、用户验收或批准原方案。`;
 const state=appendMemory(archive,{kind:'state',title:'待办进度：'+task.claim.slice(0,130),detail:text,source:text,reviewed:true,recorder:reviewer,speaker:reviewer,origin:'human_statement',subject_id:task.id,stage:choice.stage==='completed'?'awaiting_validation':'in_progress'});
 const evidence=archive.bundle.evidence.at(-1);evidence.locator.tool='memory-station-task-review';evidence.locator.session_id=work.session.id;evidence.locator.message_id=entry.id;evidence.note='用户选择了关联与处理方式；工作结果本身仍保留原始来源及核验状态。';
 state.related_ids=[record.id];state.evidence.push(...record.evidence.map(ref=>({...ref,relation:'context',claim_part:'/data'})));
 state.verification.unknowns=['关联由用户在检查卡选择；完成声明尚未独立核验，不代表功能验收或批准原方案。'];
 return state;
}
