import test from 'node:test';
import assert from 'node:assert/strict';
import {openSavedWork,savedReadStatus} from '../shared/saved-continuation.js';
const ready={currentRevision:7,pendingCount:0,connected:true,configured:true,updateAvailable:false,lastRead:{revision:6,at:'2026-09-13T10:00:00Z'}};
const request={projectId:'synthetic-project',revision:7,target:'codex'};
test('保存后的打开仅检查配置和打开目标，不再次保存；保留旧读取基线',async()=>{
 for(const target of ['codex','claude']){
  const calls=[];const api=async(path,input)=>{calls.push([path,input]);return input?{dispatched:true,projectRequested:true}:ready;};
  const result=await openSavedWork({...request,target,api});assert.equal(calls.length,2);assert.deepEqual(result.baseline,ready.lastRead);
  assert.equal(calls[1][0],target==='codex'?'/desktop-ai/open':'/projects/synthetic-project/claude/open');assert.ok(!calls.some(([p])=>p.includes('work-import')));
 }
});
test('版本变化、新草稿、未连接、未配置及旧指引均不打开',async()=>{
 for(const override of [{currentRevision:8},{pendingCount:1},{connected:false},{configured:false},{updateAvailable:true}]){
  let called=0;await assert.rejects(openSavedWork({...request,api:async()=>{called++;return {...ready,...override};}}));assert.equal(called,1);
 }
});
test('离开项目后取消尚未发出的打开请求；不把失败或仅打开应用当作定位项目',async()=>{
 let called=0;assert.equal((await openSavedWork({...request,isCurrent:()=>false,api:async()=>{called++;return ready;}})).cancelled,true);assert.equal(called,1);
 for(const response of [{dispatched:false,projectRequested:true},{dispatched:true,projectRequested:false}])await assert.rejects(openSavedWork({...request,api:async(p,b)=>b?response:ready}));
 await assert.rejects(openSavedWork({...request,api:async(p,b)=>{if(b)throw Error('合成打开失败');return ready;}}),/合成打开失败/);
});
test('旧回执不能冒充本次读取；新版本回执、新草稿、版本变化分别显示',()=>{
 const baseline={revision:7,at:'2026-09-13T10:00:00Z'};
 assert.equal(savedReadStatus({...ready,lastRead:baseline},7,baseline),'waiting');
 assert.equal(savedReadStatus({...ready,lastRead:{revision:6,at:'2026-09-13T10:01:00Z'}},7,baseline),'waiting');
 assert.equal(savedReadStatus({...ready,lastRead:{revision:7,at:'invalid'}},7,baseline),'waiting');
 assert.equal(savedReadStatus({...ready,lastRead:{revision:7,at:'2026-09-13T09:59:00Z'}},7,baseline),'waiting');
 const fresh={...ready,lastRead:{revision:7,at:'2026-09-13T10:01:00Z'}};
 assert.equal(savedReadStatus(fresh,7,baseline),'received');
 assert.equal(savedReadStatus({...fresh,pendingCount:1},7,baseline),'pending');
 assert.equal(savedReadStatus({...fresh,currentRevision:8},7,baseline),'changed');
});
