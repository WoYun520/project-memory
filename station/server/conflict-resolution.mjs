import {appendMemory,hash,validateArchive} from './core.mjs';
import {requireSafe} from '../shared/privacy.js';

export function resolveConflict(archive,input){
 requireSafe(input);
 const allowed=['revision','request_id','memory_ids','action','retained_id','conditions','reason','reviewed','reviewer'];
 if(!input||Object.keys(input).some(k=>!allowed.includes(k))||!['choose','coexist','defer'].includes(input.action))throw Error('冲突处理方式无效。');
 if(input.reviewed!==true||input.reviewer?.kind!=='human'||input.reviewer.id!=='local-user'||Object.keys(input.reviewer).some(k=>!['kind','id'].includes(k)))throw Error('请由用户本人检查并确认这次处理，AI 不能代为决定。');
 if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.request_id??'')||!Number.isInteger(input.revision))throw Error('处理编号或保存版本无效，请重新打开。');
 if(!Array.isArray(input.memory_ids)||input.memory_ids.length!==2||new Set(input.memory_ids).size!==2||input.memory_ids.some(id=>typeof id!=='string'))throw Error('请选择两条不同的冲突记录。');
 if(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>2000)throw Error('请写明处理理由或尚不确定的原因，最多 2000 字。');
 if(input.action==='choose'?!input.memory_ids.includes(input.retained_id):input.retained_id!==undefined)throw Error('请明确采用哪一条记录。');
 if(input.action==='coexist'?(!Array.isArray(input.conditions)||input.conditions.length!==2||input.conditions.some(v=>typeof v!=='string'||!v.trim()||v.length>1500)||input.conditions[0].trim()===input.conditions[1].trim()):input.conditions!==undefined)throw Error('请分别填写两条记录不同的适用条件，不能只填相同说明。');
 const digest=hash(JSON.stringify([input.memory_ids,input.action,input.retained_id??null,input.conditions??null,input.reason,input.reviewer]));
 const previous=archive.bundle.memories.find(m=>m.conflict_resolution?.request_id===input.request_id);
 if(previous){if(previous.conflict_resolution.request_sha256!==digest)throw Error('同一处理编号的内容已经改变，请重新打开后处理。');return {archive,duplicate:true,resolution_id:previous.id};}
 if(input.revision!==archive.revision)throw Error('记忆已被更新，请重新打开冲突卡，核对最新内容。');
 const pair=input.memory_ids.map(id=>archive.bundle.memories.find(m=>m.id===id));
 if(pair.some(m=>!m)||!pair[0].conflicts_with.includes(pair[1].id)||!pair[1].conflicts_with.includes(pair[0].id))throw Error('这两条记录没有当前可处理的冲突，或不在本项目中。');
 if(input.action==='coexist'&&pair.some(m=>m.lifecycle!=='accepted'))throw Error('分别适用只能处理两条当前记录；历史记录需要先核对状态。');
 if(input.action==='choose'&&pair.find(m=>m.id===input.retained_id).lifecycle!=='accepted')throw Error('不能把历史记录直接当作当前采用项，请先核对记录状态。');
 const result=structuredClone(archive),current=input.memory_ids.map(id=>result.bundle.memories.find(m=>m.id===id));
 const actionText=input.action==='choose'?`采用“${current.find(m=>m.id===input.retained_id).claim}”，另一条归入历史；原有确认和核验状态不变。`:input.action==='coexist'?`两条分别适用：\n${current[0].claim}：${input.conditions[0].trim()}\n${current[1].claim}：${input.conditions[1].trim()}\n条件在原有范围之内追加，不扩大原授权。`:'暂时无法判断，保留双方冲突，后续 AI 需继续核对。';
 const source=`用户在冲突处理卡选择：${actionText}\n双方编号：${input.memory_ids.join('、')}\n用户填写的理由：${input.reason.trim()}\n此操作不代表独立核验，不新增或扩大对原主张的确认。`;
 const record=appendMemory(result,{kind:'fact',title:input.action==='defer'?'冲突暂未解决':'冲突处理：'+(input.action==='choose'?'采用一条':'分别适用'),detail:source,source,recorder:input.reviewer,speaker:input.reviewer,origin:'human_statement',reviewed:true});
 record.related_ids=[...input.memory_ids];record.conflict_resolution={action:input.action,memory_ids:[...input.memory_ids],request_id:input.request_id,request_sha256:digest,...(input.action==='choose'?{retained_id:input.retained_id}:{}),...(input.action==='coexist'?{conditions:input.conditions.map(v=>v.trim())}:{})};
 if(input.action!=='defer')for(const [i,m]of current.entries()){
  m.conflicts_with=m.conflicts_with.filter(id=>id!==current[1-i].id);
  if(input.action==='choose'&&m.id!==input.retained_id)m.lifecycle='rejected';
  if(input.action==='coexist'){
   m.scope.condition=[m.scope.condition,input.conditions[i].trim()].filter(Boolean).join('；并且：');
   m.evidence.push({evidence_id:record.evidence[0].evidence_id,relation:'context',claim_part:'/scope'});
  }
 }
 validateArchive(result);
 return {archive:result,duplicate:false,resolution_id:record.id};
}
