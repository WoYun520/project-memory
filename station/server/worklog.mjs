import {validateTaskLink} from '../shared/work-association.js';
import {completionTargets,completionProposal,validateCompletionChoices,appendCompletion} from './task-completion.mjs';
import {validateApplicability,applicabilityLabel} from '../shared/applicability.js';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import Ajv from 'ajv/dist/2020.js';
import {appendMemory,validateArchive,hash,now} from './core.mjs';
import {updateTarget,validateUpdateChoices,applyMemoryUpdate} from './memory-update.mjs';
import {taskTarget} from '../shared/next-task.js';
import {requireSafe} from '../shared/privacy.js';
import {WORKLOG_LIMIT,validateFileSource,validateFileAttachments,validateSessionActor} from '../shared/worklog.js';
const validate=new Ajv({strict:false}).compile(JSON.parse(readFileSync(new URL('../../spec/worklog.schema.json',import.meta.url))));
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const fingerprint=(work,e)=>hash(JSON.stringify(canonical({session:work.session,entry:e})));
const requestEntry=e=>{const {file_evidence,file_notes,...request}=e;return request;};
export const worklogRequestFingerprint=work=>hash(JSON.stringify(canonical({...work,entries:work.entries.map(requestEntry)})));

export function previewWorklog(archive,work) {
  requireSafe(work);
  if(Buffer.byteLength(JSON.stringify(work)??'')>WORKLOG_LIMIT)throw Error('工作记录不能超过 300 KB。');
  if(!validate(work))throw Error('工作记录格式不符。请让 AI 按整理要求输出，不能附带已批准、已核验或覆盖旧记录的字段。');
  validateSessionActor(work.session);
  if(work.project_id!==archive.bundle.project.id)throw Error('这份工作记录属于其他项目，请切换到对应项目。');
  const ids=new Set(work.entries.map(e=>e.id));
  if(ids.size!==work.entries.length)throw Error('工作记录中的条目编号重复。');
  for(const e of work.entries){
    if(e.applicability){validateApplicability(e.applicability);if(!['decision','constraint'].includes(e.kind))throw Error('只有决定与要求可设置适用期限。');}
    validateFileSource(e.source);
    validateFileAttachments(e);
    if(e.update&&!e.update.reason.trim())throw Error('请说明为什么建议更新原记忆。');
    if(e.task_id&&!taskTarget(archive.bundle.memories,e.task_id))throw Error('关联任务不存在于这个项目，或没有可关联的下一步。请使用原任务编号。');
    if(!e.title.trim()||!e.detail.trim()||!e.source.text.trim())throw Error('标题、内容和依据不能留空。');
    if(e.origin==='human_statement'&&e.source.speaker.kind!=='human')throw Error('AI 或工具来源不能标为用户原话。');
    if(e.correction_entry_id){const c=work.entries.find(c=>c.id===e.correction_entry_id);if(!c||c.id===e.id||c.kind!=='attempt')throw Error('纠正操作必须关联本批另一条真实尝试。');}
  }
  function walk(id,seen=new Set()){if(seen.has(id))throw Error('纠正关联形成循环。');const e=work.entries.find(e=>e.id===id);if(e.correction_entry_id)walk(e.correction_entry_id,new Set([...seen,id]));}
  work.entries.forEach(e=>walk(e.id));
  return {session:work.session,completion_targets:completionTargets(archive),entries:work.entries.map(e=>{
    const digest=fingerprint(work,e),receipt=(archive.work_imports||[]).find(r=>r.session_id===work.session.id&&r.entry_id===e.id);
    const requestDuplicate=e.file_paths&&!e.file_evidence&&!e.file_notes&&receipt?.request_sha256===fingerprint(work,requestEntry(e));
    return {...e,...completionProposal(archive,e),...(e.update?{update_target:updateTarget(archive,e)}:{}),...(e.task_id?{task_title:taskTarget(archive.bundle.memories,e.task_id).claim}:{}),status:!receipt?'new':receipt.sha256===digest||requestDuplicate?'duplicate':'conflict',memory_id:receipt?.memory_id,
      warnings:[...(['constraint','decision'].includes(e.kind)?[applicabilityLabel(e.applicability??{kind:'unknown'})]:[]),...(e.file_notes||[]),...(e.file_paths&&!e.file_evidence&&!e.file_notes?['请求的文件原文尚未附上，不能当作已有文件依据。']:[]),...(e.kind==='decision'||e.kind==='constraint'?['保存为待确认建议，不代表用户采纳。']:[]),...(e.stage==='completed'?['完成声明暂存为等待验证。']:[]),...(e.mistake?['错误判断保留为待核查，不自动确认。']:[]),...(e.check_note?['核查说明作为报告保留，不自动变成已核验。']:[])]};
  })};
}

export function importWorklog(archive,input,{association=null}={}) {
  if(input.associate_task!==undefined&&typeof input.associate_task!=="boolean")throw Error("任务归类选择无效。");
  const taskLink=association?.status==="matched"&&input.associate_task===true?validateTaskLink(association.link):null;
  if(input.associate_task===true&&(!taskLink||taskLink.project_id!==archive.bundle.project.id||taskLink.ticket_id!==input.worklog?.session?.handoff_id))throw Error("任务归属无法核对，请重新预览或暂不归类。");
  if(input.reviewed!==true)throw Error('请先检查要保存的内容和依据。');
  const reviewer=input.reviewer??{kind:'human',id:'local-user'};
  if(!reviewer||!['human','agent','tool'].includes(reviewer.kind)||typeof reviewer.id!=='string'||!reviewer.id.trim()||reviewer.id.length>100)throw Error('请填写有效的导入检查者。');
  requireSafe(input);const plan=previewWorklog(archive,input.worklog);
  if(!Array.isArray(input.selected_ids)||!input.selected_ids.length||new Set(input.selected_ids).size!==input.selected_ids.length)throw Error('请选择至少一条不重复的工作记录。');
  if(input.selected_ids.some(id=>!plan.entries.some(e=>e.id===id)))throw Error('选中了不存在的条目。');
  const edits=input.edits??{};
  if(!edits||typeof edits!=='object'||Array.isArray(edits)||Object.entries(edits).some(([id,v])=>!input.selected_ids.includes(id)||!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['title','detail','applicability'].includes(k))||Object.entries(v).some(([k,x])=>k!=='applicability'&&typeof x!=='string')))throw Error('只允许修改所选条目的标题、内容与适用期限；原始依据不能被覆盖。');
  for(const [id,edit]of Object.entries(edits))if(edit.applicability){validateApplicability(edit.applicability);const e=plan.entries.find(e=>e.id===id);if(!['decision','constraint'].includes(e.kind)||e.update||reviewer.kind!=='human')throw Error('仅用户可调整新决定或要求的期限；修订沿用原期限。');}
  const selected=plan.entries.filter(e=>input.selected_ids.includes(e.id));
  if(selected.some(e=>e.status==='conflict'))throw Error('相同编号的内容已经改变，请检查原记录；新的工作请使用新编号。');
  const applyUpdates=validateUpdateChoices(archive,input,plan,selected,reviewer);
  const completionChoices=validateCompletionChoices(archive,input,plan,selected,reviewer);
  const taskUpdates=[];
  const fresh=selected.filter(e=>e.status==='new');
  for(const e of fresh)if(e.correction_entry_id&&!selected.some(c=>c.id===e.correction_entry_id)&&!plan.entries.some(c=>c.id===e.correction_entry_id&&c.status==='duplicate'))throw Error('所选错误关联了未选中的纠正尝试，请同时选中纠正条目。');
  // Work on a copy: any validation failure leaves the source archive intact.
  const result=structuredClone(archive);result.work_imports??=[];
  const mapped=new Map(plan.entries.filter(e=>e.status==='duplicate').map(e=>[e.id,e.memory_id]));
  const add=e=>{
    if(mapped.has(e.id))return;
    if(e.correction_entry_id&&!mapped.has(e.correction_entry_id))add(fresh.find(c=>c.id===e.correction_entry_id));
    const recorder=input.worklog.session.actor??{kind:'agent',id:input.worklog.session.agent};
    const record=appendMemory(result,{kind:e.kind,title:edits[e.id]?.title??e.title,detail:edits[e.id]?.detail??e.detail,source:e.source.text,
      recorder,speaker:e.source.speaker,origin:e.origin,redacted:e.source.redacted,reviewed:true,applicability:edits[e.id]?.applicability??e.applicability,conditions:e.conditions,result:e.result,outcome:e.outcome,
      reason:e.reason,next:e.next,subject_id:e.task_id,stage:e.stage==='completed'?'awaiting_validation':e.stage,mistake:e.mistake,correction_id:mapped.get(e.correction_entry_id)});
    const evidence=result.bundle.evidence.at(-1);
    evidence.locator.tool='memory-station-worklog';evidence.locator.session_id=input.worklog.session.id;evidence.locator.message_id=e.id;
    if(e.source.file){
      evidence.kind='file';
      evidence.locator={...evidence.locator,repository:result.bundle.project.id,path:e.source.file.path,content_sha256:e.source.file.content_sha256,...(e.source.file.selector?{selector:e.source.file.selector}:{})};
      evidence.note=`来自提交者声明的文件读取，读取工具标注为 ${e.source.speaker.id}；保存所附${e.source.redacted?'删减片段':'原文'}。文件位置、完整内容标识和工具身份是提交者提供的声明，导入未重新读取项目文件，也未认证工具身份；文件内容尚未独立核验。`;
    }
    evidence.privacy.reviewed_by={kind:reviewer.kind,id:reviewer.id.trim()};
    evidence.note+=` 来自工作记录 ${input.worklog.session.id} / ${e.id}；导入检查不是对主张的核验或采纳。`;
    if(e.task_id)evidence.note+=` 本次状态关联原任务 ${e.task_id}；不是对原任务或结果的用户验收。`;
    record.verification.unknowns=[e.source.file?'由工作记录导入文件原文，来源定位由提交者声明，尚未独立核查。':recorder.kind==='tool'?'由工具工作记录导入，尚未独立核查。':'由 AI 工作记录导入，尚未独立核查。',...e.warnings,...(e.check_note?[`报告的核查说明（未核验）：${e.check_note}`]:[])];
    if(e.applicability)evidence.note+=' AI 工作条目申报的适用期限：'+JSON.stringify(e.applicability)+'；不是用户确认。';
    if(edits[e.id]?.applicability){
     const eid=randomUUID(),at=now(),file=`evidence/${eid}.txt`,text='用户在导入检查时选择适用期限：'+JSON.stringify(edits[e.id].applicability)+'。仅限本条期限，不代表确认原主张或功能验收。';
     result.snapshots[file]=text;result.bundle.evidence.push({id:eid,kind:'agent_session',captured_at:at,availability:'available',locator:{tool:'memory-station-scope-review',session_id:input.worklog.session.id,message_id:e.id,speaker:reviewer},snapshot:{path:file,sha256:hash(text),media_type:'text/plain'},privacy:{representation:'original',reviewed_by:reviewer,reviewed_at:at}});record.evidence.push({evidence_id:eid,relation:'context',claim_part:'/scope'});
    }
    if(edits[e.id])evidence.note+=' 预览中调整了记忆表述，原始依据未改动；此操作不表示用户确认。';
    // Keep the submitted claim separately from edited memory, without saving unchecked entries.
    evidence.note+=` 导入时的标题：${e.title}；内容：${e.detail}`;
    for(const source of e.file_evidence||[]){
      const eid=randomUUID(),snapshotPath=`evidence/${eid}.txt`;
      result.snapshots[snapshotPath]=source.text;
      result.bundle.evidence.push({id:eid,kind:'file',captured_at:now(),availability:'available',locator:{tool:'memory-station-worklog',session_id:input.worklog.session.id,message_id:e.id,speaker:source.speaker,repository:result.bundle.project.id,...source.file},snapshot:{path:snapshotPath,sha256:hash(source.text),media_type:'text/plain'},privacy:{representation:source.redacted?'redacted':'original',reviewed_by:{kind:reviewer.kind,id:reviewer.id.trim()},reviewed_at:now()},note:'随工作记录附带的文件原文。定位和读取身份保留为来源声明；文件内容作为相关背景，不自动证明 AI 的说明、完成声明或决定正确，导入检查不是用户验收。'});
      record.evidence.push({evidence_id:eid,relation:'context',claim_part:'/data'});
    }
    if(e.update){
      const old=result.bundle.memories.find(m=>m.id===e.update.memory_id);
      if(applyUpdates.has(e.id)){applyMemoryUpdate(result,record,e,reviewer,input.update_confirmations?.[e.id]);evidence.note+=` 用户在检查卡明确采用了更新，替代 ${e.update.memory_id}；原始依据和历史保留，结果仍未独立核验。`;}
      else {record.lifecycle='proposed';if(old)record.related_ids=[old.id];record.verification.unknowns.push(`仅保存更新建议，未替代原记忆 ${e.update.memory_id}。理由：${e.update.reason}`);}
      evidence.note+=` 建议针对记忆 ${e.update.memory_id}，基于保存版本 ${e.update.base_revision}；理由：${e.update.reason}`;
    }
    if(e.completion)evidence.note+=' AI 建议的待办关联（未经用户选择不处理）：'+JSON.stringify(e.completion);
    if(completionChoices[e.id])taskUpdates.push(appendCompletion(result,record,completionChoices[e.id],reviewer,input.worklog,e).id);
    if(taskLink)evidence.note+=` 本批按已存在交接 ${taskLink.ticket_id} 归到任务：${taskLink.task}（任务编号 ${taskLink.task_id}）。这是归类，不代表任务完成或用户验收。`;
    const submitted=input.worklog.entries.find(x=>x.id===e.id);
    result.work_imports.push({session_id:input.worklog.session.id,entry_id:e.id,sha256:fingerprint(input.worklog,submitted),...(submitted.file_paths?{request_sha256:fingerprint(input.worklog,requestEntry(submitted))}:{}),memory_id:record.id,imported_at:now(),...(taskLink?{task_link:structuredClone(taskLink)}:{})});
    mapped.set(e.id,record.id);
  };
  fresh.forEach(add);validateArchive(result);
  const savedTaskLink=taskLink&&selected.every(e=>result.work_imports.some(r=>r.session_id===input.worklog.session.id&&r.entry_id===e.id&&r.task_link?.ticket_id===taskLink.ticket_id))?taskLink:null;
  return {archive:result,...(savedTaskLink?{work_task_link:savedTaskLink,work_session_id:input.worklog.session.id}:{}),task_updates:taskUpdates,added:fresh.length,updated:fresh.filter(e=>applyUpdates.has(e.id)).length,skipped:selected.length-fresh.length};
}
