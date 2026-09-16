import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runBridge} from '../claude-bridge.mjs';

function fixture(){
 const config={projectId:randomUUID(),directory:'/tmp/synthetic-project',port:4199};
 const event={hook_event_name:'Stop',cwd:config.directory,session_id:randomUUID(),stop_hook_active:false};
 const status={projectId:config.projectId,configured:true,updateAvailable:false,pendingCount:0};
 const out=[],errors=[],reads=[],paths=[];
 const deps={input:[JSON.stringify(event)],write:async s=>out.push(JSON.parse(s)),writeError:async s=>errors.push(s),
  read:async a=>{reads.push(a);return status;},realpath:async p=>{paths.push(p);return p;},stat:async()=>({isDirectory:()=>true}),fetchImpl:async()=>assert.fail('Stop must not POST')};
 return {config,event,status,out,errors,reads,paths,deps};
}
test('收尾仅给当前 AI 一次提醒，不读取档案或聊天、不提交、不登记回执',async()=>{
 const f=fixture();f.event.transcript_path='/private/never-read';f.event.last_assistant_message='synthetic-private@example.com';
 const r=await runBridge(f.config,['stop'],{...f.deps,input:[JSON.stringify(f.event)]});
 assert.equal(r.reminded,true);assert.equal(f.reads.length,1);assert.match(f.reads[0].pathname,/\/claude$/);
 assert.deepEqual(f.paths,[f.config.directory,f.config.directory]);
 const o=f.out[0];assert.equal(o.hookSpecificOutput.hookEventName,'Stop');
 assert.match(o.hookSpecificOutput.additionalContext,/只读、不回写/);assert.match(o.hookSpecificOutput.additionalContext,/已经成功提交过/);
 assert.match(o.hookSpecificOutput.additionalContext,/停止重试/);assert.doesNotMatch(JSON.stringify(o),/never-read|synthetic-private/);
 assert.deepEqual(f.errors,[]);
});
test('收尾继续后直接结束，不触发网络或文件读取，避免循环',async()=>{
 const f=fixture();const r=await runBridge(f.config,['stop'],{...f.deps,input:[JSON.stringify({...f.event,stop_hook_active:true})]});
 assert.equal(r.reminded,false);assert.deepEqual(f.out,[{}]);assert.deepEqual(f.reads,[]);assert.deepEqual(f.paths,[]);
});
test('有待检查批次或后台任务时不催生重复记录',async()=>{
 for(const key of ['pending','background_tasks','session_crons']){
  const f=fixture();if(key==='pending')f.status.pendingCount=2;else f.event[key]=[{description:'private ignored'}];
  const r=await runBridge(f.config,['stop'],{...f.deps,input:[JSON.stringify(f.event)]});
  assert.equal(r.reminded,false);assert.deepEqual(f.out,[{}]);assert.deepEqual(f.errors,[]);
 }
});
test('断连、旧配置、目录不符及坏事件都放行，不泄露输入或阻止用户结束',async()=>{
 for(const kind of ['offline','outdated','unconfigured','mismatch','invalid','missing-active','oversized','utf8']){
  const f=fixture();let d={...f.deps};
  if(kind==='offline')d.read=async()=>{throw Error('private secret');};
  if(kind==='outdated')f.status.updateAvailable=true;
  if(kind==='unconfigured')f.status.configured=false;
  if(kind==='mismatch')d.input=[JSON.stringify({...f.event,cwd:'/tmp/other'})];
  if(kind==='invalid')d.input=['{bad'];
  if(kind==='missing-active')d.input=[JSON.stringify({...f.event,stop_hook_active:undefined})];
  if(kind==='oversized')d.input=['x'.repeat(131073)];
  if(kind==='utf8')d.input=[Buffer.from([0xff])];
  const r=await runBridge(f.config,['stop'],d);
  assert.equal(r.reminded,false,kind);assert.deepEqual(f.out,[{}]);assert.equal(f.errors.length,1);assert.doesNotMatch(f.errors.join(''),/private secret/);
 }
});
test('不同轮次建议不同批次，提醒要求重试保持已有编号与内容',async()=>{
 const f=fixture();await runBridge(f.config,['stop'],f.deps);await runBridge(f.config,['stop'],f.deps);
 const a=f.out.map(o=>o.hookSpecificOutput.additionalContext);assert.notEqual(a[0],a[1]);
 for(const s of a){assert.ok(s.includes(f.event.session_id));assert.match(s,/保留已有编号与原内容/);}
});
