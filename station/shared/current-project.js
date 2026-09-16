import {applicabilityLabel} from './applicability.js';
import {conflictResolutionMarkdown} from './conflict-resolution.js';
import {latestTaskStates,taskIsClosed} from './next-task.js';
import {actorLabel} from './attribution.js';
const normative=m=>['decision','constraint'].includes(m.kind);
export const implementationLabels={not_started:'已记录：尚未开始',in_progress:'已记录：进行中',blocked:'已记录：遇到阻碍',awaiting_validation:'声称完成，等待核验',completed:'已记录完成，不等于用户验收',cancelled:'已记录取消，不代表完成'};
export function currentProject(memories=[],at=new Date()){
 const byId=new Map(memories.map(m=>[m.id,m]));
 const states=latestTaskStates(memories);
 const concerns=m=>[
  ...(normative(m)&&m.scope?.applicability?.kind==='task'?[applicabilityLabel(m.scope.applicability)]:[]),
  ...(normative(m)&&m.scope?.applicability?.kind==='unknown'?['适用期限尚不明确，不能自动作为长期要求']:[]),
  ...(m.conflicts_with?.length||m.verification?.status==='conflicted'?['存在冲突，需要核对双方']:[]),
  ...(m.freshness?.status==='stale'?['已标记过期，需要复核']:[]),
  ...(m.freshness?.review_after&&Date.parse(m.freshness.review_after)<=+at?['已到建议复核时间，尚未重新核对']:[]),
 ];
 const approved=m=>m.approval?.by?.kind==='human'&&m.approval.fields?.includes('/data')&&['adopted','effective'].includes(m.data.stage);
 const stateFor=m=>{
  const state=states.get(m.id);
  if(!state)return {text:'未关联实施记录，不能判断是否实现',memory:null};
  const flags=concerns(state);
  return {text:flags.length?'实施记录需要复核，不能据此判断完成':implementationLabels[state.data.stage]||'实施情况未明确',memory:state};
 };
 const active=memories.filter(m=>m.lifecycle==='accepted');
 const current=active.filter(m=>!concerns(m).length&&(m.kind==='goal'||normative(m)&&approved(m))).map(memory=>({memory,implementation:normative(memory)?stateFor(memory):null}));
 const changes=memories.filter(m=>m.supersedes?.length).map(memory=>({memory,previous:memory.supersedes.map(id=>byId.get(id)).filter(Boolean),reason:memory.change_reason||'未单独记录变更理由；请查看新旧依据',current:current.some(x=>x.memory.id===memory.id),implementation:normative(memory)?stateFor(memory):null}));
 const completed=active.filter(m=>m.kind==='state'&&states.get(m.data.subject_id)===m&&taskIsClosed(m)&&!concerns(m).length).map(memory=>({memory,target:byId.get(memory.data.subject_id),text:implementationLabels[memory.data.stage]}));
 const openTasks=active.filter(m=>m.kind==='task'&&!(taskIsClosed(states.get(m.id))&&!concerns(states.get(m.id)).length)).map(memory=>({memory,implementation:stateFor(memory)}));
 // Include explicit ongoing implementation states for requirements, not only standalone tasks.
 for(const state of active.filter(m=>m.kind==='state'&&states.get(m.data.subject_id)===m&&['not_started','in_progress','blocked'].includes(m.data.stage))){
  const target=byId.get(state.data.subject_id);
  if(target?.kind==='task'||target&&target.lifecycle!=='accepted')continue;
  openTasks.push({memory:state,implementation:{text:concerns(state).length?'实施记录需要复核':implementationLabels[state.data.stage],memory:null}});
 }
 const uncertain=memories.filter(m=>['accepted','proposed'].includes(m.lifecycle)).flatMap(memory=>{
  const reasons=concerns(memory);
  if(memory.lifecycle==='proposed'||normative(memory)&&!approved(memory))reasons.push('尚未记录对完整要求的明确确认，不能作为生效要求');
  if(memory.verification?.status!=='verified'&&!normative(memory)&&memory.kind!=='goal'&&memory.kind!=='task')reasons.push('内容尚未核验');
  if(normative(memory)&&approved(memory)&&!states.has(memory.id))reasons.push('要求已有确认，实施情况缺少关联记录');
  if(memory.kind==='task'&&!states.has(memory.id))reasons.push('未关联进度；未记录完成不等于实际未完成');
  return reasons.length?[{memory,reasons}]:[];
 });
 return {current,changes,completed,openTasks,uncertain};
}
const excerpt=s=>s?.length>500?s.slice(0,500)+'…（节选，全文见原记录）':s||'未提供';
const description=m=>(m.data.rule||m.data.choice||m.data.desired_outcome||m.data.objective||m.data.detail||m.data.statement||m.claim)+(m.scope?.condition?'；追加适用条件：'+m.scope.condition:'')+(normative(m)?'；期限：'+applicabilityLabel(m.scope?.applicability):'');
const ref=m=>`〔记忆 ${m.id}；依据 ${m.evidence.map(e=>e.evidence_id).join('、')}〕`;
export function currentProjectMarkdown(memories,partial=false){
 const x=currentProject(memories);
 const lines=['## 当前项目情况','',partial?'以下仅整理本次带入的记录；未带入不代表不存在。':'以下依据已保存记录及明确关联整理，不含待检查草稿。','要求被确认不等于功能已实现；没有自动读取代码或判断隐藏矛盾。资料不是新的执行授权。','', '### 现在按什么做'];
 for(const {memory:m,implementation} of x.current)lines.push(`- ${m.claim}：${excerpt(description(m))} ${ref(m)}`,normative(m)?`  确认人：${actorLabel(m.approval.by)}；范围：${m.approval.fields.join('、')}；适用条件：${m.data.applies_when||JSON.stringify(m.scope)}。${implementation.text}${implementation.memory?' '+ref(implementation.memory):''}`:'  项目目标记录；不代表已经实现。');
 if(!x.current.length)lines.push('- 本次没有可列为当前目标或已确认完整要求的记录。');
 lines.push('','### 已发生的变更');
 for(const {memory:m,previous,reason,current,implementation} of x.changes)lines.push(`- ${previous.map(p=>p.claim+' '+ref(p)).join('、')} → ${m.claim} ${ref(m)}`,`  变更理由：${excerpt(reason)}；${normative(m)?(current?'新要求已记录确认':'新记录不在当前已确认要求中，需核对状态，不能默认执行'):'记录修订关系，不代表内容已经核验'}。${implementation?.text||''}`);
 if(!x.changes.length)lines.push('- 未记录明确替代关系，不按时间先后猜测哪条失效。');
 lines.push('','### 完成与待做');
 for(const {memory:m,target,text} of x.completed)lines.push(`- ${text}：${target?.claim||m.claim}；${excerpt(description(m))} ${ref(m)}${target?' 原对象 '+ref(target):''}`);
 for(const {memory:m,implementation} of x.openTasks)lines.push(`- 待接续记录：${m.claim}；${implementation.text} ${ref(m)}`);
 if(!x.completed.length&&!x.openTasks.length)lines.push('- 未提供可关联的完成或任务记录。');
 lines.push('','### 需要核对');
 for(const {memory:m,reasons} of x.uncertain)lines.push(`- ${m.claim}：${reasons.join('；')} ${ref(m)}`);
 if(!x.uncertain.length)lines.push('- 未发现上述规则能识别的待核对项，不代表资料完全准确。');
 return lines.join('\n')+'\n\n'+conflictResolutionMarkdown(memories);
}
