import test from 'node:test';
import assert from 'node:assert/strict';
import {createBundle,appendMemory,validateArchive,compile} from './core.mjs';
import {previewWorklog,importWorklog} from './worklog.mjs';
import {triageWork} from '../shared/work-triage.js';
const setup=(kind='fact',extra={})=>{const a=createBundle('合成更新项目',''),old=appendMemory(a,{kind,title:'旧记忆',detail:'原来只支持键盘，触屏还在计划中。',source:'旧依据原文\n不应被改写',reviewed:true,...extra});a.revision=7;return {a,old};};
const work=(a,old,extra={})=>({format:'project-memory-worklog',version:'0.1',project_id:a.bundle.project.id,session:{id:'synthetic-update',agent:'测试 AI'},entries:[{id:'change',kind:old.kind,title:'更新建议',detail:'触屏仍在计划中；新增暂停方案讨论。',origin:'inference',source:{speaker:{kind:'agent',id:'测试 AI'},text:'AI 合成观察：文档新增讨论，未验证实现。'},update:{memory_id:old.id,base_revision:a.revision,reason:'新文档补充了讨论，不能推断功能完成。'},...extra}]});
const save=(a,w,extra={})=>importWorklog(a,{worklog:w,selected_ids:w.entries.map(e=>e.id),reviewed:true,reviewer:{kind:'human',id:'synthetic-reviewer'},...extra});

test('默认仅保存候选建议，预览带精确旧记忆和原文，不改变当前记录',()=>{
 const {a,old}=setup(),before=JSON.stringify(a),w=work(a,old),plan=previewWorklog(a,w);
 assert.equal(plan.entries[0].update_target.memory.id,old.id);assert.equal(plan.entries[0].update_target.evidence[0].text,'旧依据原文\n不应被改写');
 assert.equal(triageWork(plan.entries,a).recommendedIds.length,0);
 const r=save(a,w).archive,m=r.bundle.memories.at(-1);assert.equal(m.lifecycle,'proposed');assert.deepEqual(m.related_ids,[old.id]);assert.equal(m.supersedes,undefined);assert.deepEqual(r.bundle.memories[0],old);assert.equal(JSON.stringify(a),before);
 assert.match(compile(r),/候选|待确认/);assert.equal(m.approval,undefined);
});
test('明确采用后保留旧版本及所有 Evidence，下一次交接区分当前与历史，不自动核验',()=>{
 const {a,old}=setup(),before=structuredClone(a),w=work(a,old),r=save(a,w,{apply_update_ids:['change'],edits:{change:{detail:'经检查调整的描述'}}});
 assert.equal(r.updated,1);assert.equal(r.archive.bundle.memories[0].lifecycle,'superseded');const next=r.archive.bundle.memories.at(-1);assert.deepEqual(next.supersedes,[old.id]);assert.equal(next.change_reason,w.entries[0].update.reason);assert.equal(next.data.statement,'经检查调整的描述');assert.equal(next.by.kind,'agent');assert.equal(next.verification.status,'unverified');assert.equal(next.approval,undefined);
 assert.deepEqual(r.archive.bundle.evidence.slice(0,a.bundle.evidence.length),a.bundle.evidence);for(const [p,t]of Object.entries(a.snapshots))assert.equal(r.archive.snapshots[p],t);
 assert.match(r.archive.bundle.evidence.at(-1).note,/触屏仍在计划中/);assert.match(compile(r.archive),/替代旧记录/);assert.deepEqual(a,before);assert.equal(validateArchive(r.archive),true);
 r.archive.revision++;const retry=save(r.archive,w,{apply_update_ids:['change']});assert.equal(retry.added,0);assert.equal(retry.updated,0);assert.deepEqual(retry.archive,r.archive);
});
test('旧版本、已替代、类型不符及跨项目编号只能作为候选，不能采用',()=>{
 for(const scenario of ['version','lifecycle','kind','id']){const {a,old}=setup(),w=work(a,old);if(scenario==='version')a.revision++;if(scenario==='lifecycle')old.lifecycle='superseded';if(scenario==='kind')w.entries[0].kind='goal';if(scenario==='id')w.entries[0].update.memory_id=createBundle('别的项目','').bundle.project.id;
  const before=JSON.stringify(a);assert.ok(previewWorklog(a,w).entries[0].update_target.blocked);assert.throws(()=>save(a,w,{apply_update_ids:['change']}),/编号|版本|有效|类型/);assert.equal(JSON.stringify(a),before);assert.equal(save(a,w).archive.bundle.memories.at(-1).lifecycle,'proposed');
 }
});
test('同一旧记忆不能同时采用两份建议，未选择和非更新条目不能借参数替换',()=>{
 const {a,old}=setup(),w=work(a,old);w.entries.push({...structuredClone(w.entries[0]),id:'other'});assert.throws(()=>save(a,w,{apply_update_ids:['change','other']}),/只能采用一份/);assert.throws(()=>save(a,w,{selected_ids:['other'],apply_update_ids:['change']}),/已选择/);assert.throws(()=>save(a,w,{apply_update_ids:['change','change']}),/已选择/);
 delete w.entries[0].update;assert.throws(()=>save(a,w,{apply_update_ids:['change']}),/已选择/);
});
test('已确认要求采用时需独立用户确认原话，AI 原依据身份不变，不确认功能完成',()=>{
 const {a,old}=setup('constraint',{confirmed:true,conditions:'仅限移动端测试'}),w=work(a,old),before=JSON.stringify(a);
 assert.throws(()=>save(a,w,{apply_update_ids:['change']}),/确认原话/);assert.throws(()=>save(a,w,{apply_update_ids:['change'],reviewer:{kind:'agent',id:'AI'},update_confirmations:{change:'测试确认'}}),/用户本人/);assert.equal(JSON.stringify(a),before);
 const r=save(a,w,{apply_update_ids:['change'],update_confirmations:{change:'合成测试确认：采用新的适用要求，仅用于本次测试。'}}).archive,m=r.bundle.memories.at(-1),confirmation=r.bundle.evidence.find(e=>e.id===m.approval.evidence_ids[0]);
 assert.equal(m.data.applies_when,'仅限移动端测试');assert.equal(m.data.stage,'effective');assert.equal(m.by.kind,'agent');assert.equal(m.verification.status,'unverified');assert.equal(m.approval.by.kind,'human');assert.equal(confirmation.locator.speaker.kind,'human');assert.equal(r.bundle.evidence[1].locator.speaker.kind,'agent');assert.equal(r.snapshots[r.bundle.evidence[1].snapshot.path],w.entries[0].source.text);assert.equal(validateArchive(r),true);
});
test('拒绝草稿伪造采用/批准，拒绝空理由和隐私确认；失败整批不变',()=>{
 const {a,old}=setup(),w=work(a,old),before=JSON.stringify(a);
 for(const field of ['confirmed','approval','apply_update_ids','replaces']){const bad=structuredClone(w);bad.entries[0][field]=true;assert.throws(()=>previewWorklog(a,bad),/格式/);}
 const bad=structuredClone(w);bad.entries[0].update.reason=' ';assert.throws(()=>previewWorklog(a,bad),/为什么/);
 assert.throws(()=>save(a,w,{apply_update_ids:['change'],update_confirmations:{change:'password: synthetic-example'}}),/隐私/);assert.throws(()=>save(a,w,{update_confirmations:{change:'额外确认'}}),/确认原话/);assert.throws(()=>save(a,w,{apply_update_ids:['change'],reviewer:{kind:'tool',id:'工具'}}),/用户本人/);assert.equal(JSON.stringify(a),before);
});
test('原先仅保存的建议不可通过重试升级为已采用；重启后的重复与内容冲突保留',()=>{
 const {a,old}=setup(),w=work(a,old),r=JSON.parse(JSON.stringify(save(a,w).archive));r.revision++;
 assert.equal(save(r,w).added,0);assert.throws(()=>save(r,w,{apply_update_ids:['change']}),/已经作为建议/);const changed=structuredClone(w);changed.entries[0].update.reason='变更后的理由';assert.equal(previewWorklog(r,changed).entries[0].status,'conflict');assert.throws(()=>save(r,changed,{apply_update_ids:['change']}),/编号/);
});
test('进度更新保持原 subject，完成仍等待验证，原任务不被无故重新推荐',()=>{
 const a=createBundle('合成进度',''),task=appendMemory(a,{kind:'task',title:'测试任务',detail:'测试目标',source:'合成记录',reviewed:true}),old=appendMemory(a,{kind:'state',title:'测试状态',detail:'待实施',source:'合成记录',stage:'in_progress',subject_id:task.id,reviewed:true});a.revision=4;
 const w=work(a,old,{stage:'completed'}),r=save(a,w,{apply_update_ids:['change']}).archive;assert.equal(r.bundle.memories.at(-1).data.subject_id,task.id);assert.equal(r.bundle.memories.at(-1).data.stage,'awaiting_validation');
});

test('更新卡不把未解决的冲突静默变为当前有效要求',()=>{
 const {a,old}=setup(),other=appendMemory(a,{kind:'fact',title:'相反记录',detail:'另一种观察',source:'合成另一份依据',reviewed:true});old.conflicts_with=[other.id];other.conflicts_with=[old.id];const before=JSON.stringify(a),w=work(a,old);
 assert.match(previewWorklog(a,w).entries[0].update_target.blocked,/冲突/);assert.throws(()=>save(a,w,{apply_update_ids:['change']}),/冲突/);assert.equal(JSON.stringify(a),before);assert.equal(save(a,w).archive.bundle.memories.at(-1).lifecycle,'proposed');
});
