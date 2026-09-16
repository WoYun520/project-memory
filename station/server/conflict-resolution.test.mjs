import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {appendMemory,createBundle,reviewMemory,validateArchive,compile} from './core.mjs';
import {resolveConflict} from './conflict-resolution.mjs';
import {renderContext} from './context.mjs';
import {nextTaskSuggestions} from '../shared/next-task.js';
const add=(a,title,extra={})=>appendMemory(a,{kind:'fact',title,detail:title+'的原始主张',source:'合成依据：'+title+'\n原文保留。',reviewed:true,...extra});
const setup=()=>{const a=createBundle('合成冲突项目',''),left=add(a,'桌面使用键盘'),right=add(a,'手机使用触屏');reviewMemory(a,left.id,'conflict',right.id);a.revision=4;return {a,left,right};};
const input=(a,left,right,extra={})=>({revision:a.revision,request_id:randomUUID(),memory_ids:[left.id,right.id],action:'choose',retained_id:left.id,reason:'本次合成判断，只处理明确选择的双方。',reviewed:true,reviewer:{kind:'human',id:'local-user'},...extra});
test('采用一条保留旧档案与 Evidence，原批准和核验状态不升级；后续完整与任务交接带处理理由',()=>{
 const {a,left,right}=setup(),before=structuredClone(a),r=resolveConflict(a,input(a,left,right));
 assert.deepEqual(a,before);assert.equal(r.archive.bundle.memories[1].lifecycle,'rejected');assert.equal(r.archive.bundle.memories[0].verification.status,'unverified');assert.equal(r.archive.bundle.memories[0].approval,undefined);assert.deepEqual(r.archive.bundle.memories[0].conflicts_with,[]);
 assert.deepEqual(r.archive.bundle.evidence.slice(0,a.bundle.evidence.length),a.bundle.evidence);for(const [p,t]of Object.entries(a.snapshots))assert.equal(r.archive.snapshots[p],t);
 assert.match(compile(r.archive),/冲突处理记录/);const text=renderContext(r.archive,{mode:'focused',memoryIds:[left.id],task:'检查桌面'});assert.match(text,/本次合成判断/);assert.ok(text.includes(right.id));assert.match(text,/rejected/);
});
test('分别适用保留原主张与既有条件，附加条件随交接及后续修订保留',()=>{
 const {a,left,right}=setup();left.scope.condition='仅限合成项目';const r=resolveConflict(a,input(a,left,right,{action:'coexist',retained_id:undefined,conditions:['桌面键盘模式','手机触屏模式']})).archive;
 assert.equal(r.bundle.memories[0].scope.condition,'仅限合成项目；并且：桌面键盘模式');assert.deepEqual(r.bundle.memories[0].data,left.data);assert.deepEqual(r.bundle.memories[1].data,right.data);assert.equal(r.bundle.memories[0].evidence.at(-1).claim_part,'/scope');assert.match(compile(r),/手机触屏模式/);
 const revision=appendMemory(r,{kind:'fact',title:'后续说明',detail:'新主张',source:'合成新依据',reviewed:true,replaces:left.id});assert.equal(revision.scope.condition,'仅限合成项目；并且：桌面键盘模式');assert.equal(validateArchive(r),true);
});
test('暂无法判断只新增处理记录，不改变任何原记忆和冲突；后续重新处理仍可用',()=>{
 const {a,left,right}=setup(),w=input(a,left,right,{action:'defer',retained_id:undefined}),r=resolveConflict(a,w).archive;assert.deepEqual(r.bundle.memories.slice(0,2),a.bundle.memories);assert.match(compile(r),/当前双方仍标有冲突/);r.revision++;
 const next=resolveConflict(r,input(r,left,right)).archive;assert.equal(next.bundle.memories[1].lifecycle,'rejected');assert.match(compile(next),/曾选择采用/);
});
test('仅解除选定双方，第三方冲突继续保留；重新标记的冲突不被历史处理覆盖',()=>{
 const {a,left,right}=setup(),third=add(a,'另一环境');reviewMemory(a,left.id,'conflict',third.id);const r=resolveConflict(a,input(a,left,right)).archive;assert.deepEqual(r.bundle.memories[0].conflicts_with,[third.id]);assert.deepEqual(r.bundle.memories[2].conflicts_with,[left.id]);
 reviewMemory(r,left.id,'conflict',right.id);assert.match(compile(r),/当前双方仍标有冲突/);
});
test('重复响应或恢复备份后的重试不重复写入；同一处理编号改内容拒绝',()=>{
 const {a,left,right}=setup(),w=input(a,left,right),first=resolveConflict(a,w).archive;first.revision++;const copy=JSON.parse(JSON.stringify(first)),retry=resolveConflict(copy,w);assert.equal(retry.duplicate,true);assert.deepEqual(retry.archive,first);assert.throws(()=>resolveConflict(copy,{...w,reason:'变更内容'}),/编号/);
});
test('拒绝过期、跨项目、不成对、无用户确认、隐私与额外批准字段；失败原档案不变',()=>{
 const {a,left,right}=setup(),w=input(a,left,right),before=JSON.stringify(a);
 for(const change of [{revision:0},{memory_ids:[left.id,randomUUID()]},{memory_ids:[left.id,left.id]},{reviewed:false},{reviewer:{kind:'agent',id:'Codex'}},{confirmed:true},{reason:'password: synthetic-example'},{reason:' '},{request_id:'invalid'}])assert.throws(()=>resolveConflict(a,{...w,...change}));
 assert.equal(JSON.stringify(a),before);
});
test('分别适用需不同且非空的条件，不能扩大为使用历史记录；长条件失败不部分写入',()=>{
 const {a,left,right}=setup(),w=input(a,left,right,{action:'coexist',retained_id:undefined}),before=JSON.stringify(a);for(const conditions of [undefined,['','手机'],['同一条件','同一条件'],['桌面']])assert.throws(()=>resolveConflict(a,{...w,conditions}),/条件/);
 left.scope.condition='长'.repeat(3990);const snapshot=JSON.stringify(a);assert.throws(()=>resolveConflict(a,{...w,conditions:['新'.repeat(100),'手机']}));assert.equal(JSON.stringify(a),snapshot);left.scope.condition=undefined;delete left.scope.condition;assert.equal(JSON.stringify(a),before);
 right.lifecycle='rejected';assert.throws(()=>resolveConflict(a,{...w,conditions:['桌面','手机']}),/历史/);
});
test('已确认的相反要求采用后保留双方历史批准；候选要求不因处理变为已确认',()=>{
 const a=createBundle('合成要求',''),left=add(a,'用户要求',{kind:'constraint',confirmed:true}),right=add(a,'AI 建议',{kind:'constraint',recorder:{kind:'agent',id:'测试 AI'},speaker:{kind:'agent',id:'测试 AI'},origin:'inference'});reviewMemory(a,left.id,'conflict',right.id);a.revision=2;
 const r=resolveConflict(a,input(a,left,right,{retained_id:right.id})).archive;assert.deepEqual(r.bundle.memories[0].approval,left.approval);assert.equal(r.bundle.memories[1].approval,undefined);assert.equal(r.bundle.memories[1].data.stage,'proposed');assert.match(compile(r),/不会自动新增用户确认/);
});
test('任务建议必须带追加适用条件，避免交接前的简短任务遗漏条件',()=>{
 const a=createBundle('合成任务',''),left=add(a,'键盘任务',{kind:'task'}),right=add(a,'触屏任务',{kind:'task'});reviewMemory(a,left.id,'conflict',right.id);a.revision=3;const r=resolveConflict(a,input(a,left,right,{action:'coexist',retained_id:undefined,conditions:['仅桌面','仅手机']})).archive;assert.ok(nextTaskSuggestions(r.bundle.memories).every(s=>s.text.includes('仅在以下条件适用')));
});
