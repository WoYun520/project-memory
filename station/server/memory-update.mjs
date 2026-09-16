import {randomUUID} from 'node:crypto';
import {hash,now} from './core.mjs';

// A proposed target is data, never permission to replace it.
export function updateTarget(archive,entry){
 if(!entry.update)return null;
 const old=archive.bundle.memories.find(m=>m.id===entry.update.memory_id);
 const blocked=!old?'找不到本项目的原记忆，请让 AI 核对编号。':old.kind!==entry.kind?'建议类型与原记忆不同，不能直接替换。':old.lifecycle!=='accepted'?'原记忆已不再有效，请从最新记录重新核对。':old.conflicts_with.length||old.verification.status==='conflicted'?'原记忆存在未解决冲突，请先核对双方；本次可仅保存建议。':entry.update.base_revision!==archive.revision?'记忆版本已变化，请让 AI 重新读取后核对；仍可仅保存建议。':'';
 return {blocked,requires_confirmation:!!old?.approval&&['decision','constraint'].includes(old.kind),memory:old??null,
  evidence:old?old.evidence.map(ref=>{const e=archive.bundle.evidence.find(e=>e.id===ref.evidence_id);return {id:e.id,kind:e.kind,relation:ref.relation,text:e.snapshot?archive.snapshots[e.snapshot.path]??'原文不可用':'原文不可用'};}):[]};
}

export function validateUpdateChoices(archive,input,plan,selected,reviewer){
 const ids=input.apply_update_ids??[],confirmations=input.update_confirmations??{};
 if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.some(id=>!selected.some(e=>e.id===id&&e.update)))throw Error('只能采用本次已选择的更新建议。');
 if(!confirmations||typeof confirmations!=='object'||Array.isArray(confirmations)||Object.entries(confirmations).some(([id,text])=>!ids.includes(id)||typeof text!=='string'||!text.trim()||text.length>2000))throw Error('确认原话只能用于本次采用的更新，最多 2000 字。');
 if(ids.length&&reviewer.kind!=='human')throw Error('采用旧记忆更新需要用户本人检查；AI 或工具只能保存建议。');
 const targets=new Set();
 for(const id of ids){
  const e=plan.entries.find(e=>e.id===id);
  // An identical import retry must not replace anything a second time.
  if(e.status==='duplicate'){
   const saved=archive.bundle.memories.find(m=>m.id===e.memory_id);
   if(!saved?.supersedes?.includes(e.update.memory_id))throw Error('此条已经作为建议保存，不能通过重复导入改成更新；请从记录详情修订。');
   continue;
  }
  const target=updateTarget(archive,e);
  if(target.blocked)throw Error(target.blocked);
  if(targets.has(e.update.memory_id))throw Error('同一条旧记忆有多份更新建议，本次只能采用一份。');
  targets.add(e.update.memory_id);
  if(target.requires_confirmation&&!confirmations[id]?.trim())throw Error('原要求已有用户确认，请单独填写本人的新确认原话，或仅保存建议。');
  if(confirmations[id]&&!target.requires_confirmation)throw Error('这条更新不需要确认原话；采用更新不会自动核验结果。');
 }
 return new Set(ids);
}

export function applyMemoryUpdate(archive,record,entry,reviewer,confirmation){
 const old=archive.bundle.memories.find(m=>m.id===entry.update.memory_id);
 if(confirmation){
  const id=randomUUID(),at=now(),file=`evidence/${id}.txt`,text=confirmation.trim();
  archive.snapshots[file]=text;
  archive.bundle.evidence.push({id,kind:'agent_session',captured_at:at,availability:'available',locator:{tool:'memory-station-update-review',session_id:archive.bundle.project.id,message_id:id,speaker:reviewer},snapshot:{path:file,sha256:hash(text),media_type:'text/plain'},privacy:{representation:'original',reviewed_by:reviewer,reviewed_at:at},note:'用户在更新检查卡单独填写的新确认原话；与 AI 的原始建议分开保存，仅确认这条决定或要求，不代表功能完成或测试通过。'});
  record.evidence.push({evidence_id:id,relation:'supports',claim_part:'/data'});
  record.approval={by:reviewer,at,evidence_ids:[id],fields:['/data']};
  record.data.stage=record.kind==='constraint'?'effective':'adopted';
 }
 record.scope=structuredClone(old.scope);
 if(record.kind==='constraint'&&!entry.conditions)record.data.applies_when=old.data.applies_when;
 record.supersedes=[old.id];record.change_reason=entry.update.reason.trim();old.lifecycle='superseded';
 // State updates continue to describe the same subject unless explicitly linked.
 if(record.kind==='state'&&!entry.task_id)record.data.subject_id=old.data.subject_id;
}
