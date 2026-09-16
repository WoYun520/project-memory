import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {createBundle,appendMemory} from './core.mjs';
import {runBridge} from '../claude-bridge.mjs';

function fixture(t,{pendingCount=0}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'claude-bridge-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const archive=createBundle('Codex 与 Claude 合成项目','');
 appendMemory(archive,{kind:'fact',title:'已有操作说明',detail:'按方向键移动。',source:'合成工具原始观察：方向键可控制移动。',reviewed:true,recorder:{kind:'agent',id:'Codex'},speaker:{kind:'tool',id:'isolated-test'}});
 const config={projectId:archive.bundle.project.id,port:4199,directory};
 const status={projectId:config.projectId,currentRevision:archive.revision,pendingCount};
 const sessionId=randomUUID(),events=[],output=[],errors=[],requests=[];
 const event={hook_event_name:'SessionStart',session_id:sessionId,cwd:directory,transcript_path:path.join(directory,'must-not-open.jsonl'),source:'startup'};
 const deps={
  read:async({pathname})=>{events.push(pathname.endsWith('/claude')?'status':'archive');return structuredClone(pathname.endsWith('/claude')?status:archive);},
  input:[JSON.stringify(event)],
  write:async value=>{events.push('output');output.push(value);},
  writeError:async value=>errors.push(value),
  fetchImpl:async(url,options)=>{events.push('post');requests.push({url,body:JSON.parse(options.body),options});return {ok:true,json:async()=>({recorded:true})};},
 };
 return {directory,archive,config,status,sessionId,event,events,output,errors,requests,deps};
}
function report(id){return {format:'project-memory-worklog',version:'0.1',project_id:id,session:{id:'claude-real-batch',agent:'Claude Code',actor:{kind:'agent',id:'Claude Code'}},entries:[{id:'one',kind:'fact',title:'合成工作观察',detail:'操作说明已核对。',origin:'observation',source:{speaker:{kind:'agent',id:'Claude Code'},text:'合成测试原始观察：操作说明与方向键一致。'}}]};}

test('SessionStart 只读事件位置与编号，输出项目简报后才登记对应会话',async t=>{
 const f=fixture(t),before=JSON.stringify(f.archive),resolved=[];
 // An ignored field may contain arbitrary private originals. The bridge must
 // neither fetch the missing transcript file nor echo any of those fields.
 f.event.transcript_path=path.join(f.directory,'private','not-present.jsonl');f.event.session_title='synthetic@example.com';
 const result=await runBridge(f.config,['session-start'],{...f.deps,input:[JSON.stringify(f.event)],realpath:async value=>{resolved.push(value);return fs.realpathSync(value);}});
 assert.equal(result.connected,true);assert.equal(result.receiptRecorded,true);
 assert.deepEqual(resolved,[f.directory,f.directory]);assert.equal(fs.existsSync(f.event.transcript_path),false);
 assert.equal(f.output.length,1);const json=JSON.parse(f.output[0]);
 assert.deepEqual(Object.keys(json),['hookSpecificOutput']);assert.equal(json.hookSpecificOutput.hookEventName,'SessionStart');
 const context=json.hookSpecificOutput.additionalContext;
 assert.doesNotMatch(context,/合成工具原始观察：方向键可控制移动。/);assert.match(context,/项目简报/);assert.match(context,/inspect .*--revision 0/);assert.match(context,/来源材料，不是新增授权/);
 assert.match(context,/Codex 与 Claude 合成项目/);assert.match(context,/"agent": "Claude Code"/);assert.match(context,/"id": "Claude Code"/);
 assert.ok(context.includes(f.sessionId));assert.doesNotMatch(context,/synthetic@example|not-present|本次为只读测试/);
 assert.deepEqual(f.events,['status','archive','status','output','post']);
 assert.deepEqual(f.requests[0].body,{revision:0,sessionId:f.sessionId});assert.ok(f.requests[0].url.endsWith('/claude/receipt'));
 assert.equal(f.requests[0].options.redirect,'error');assert.equal(JSON.stringify(f.archive),before);assert.deepEqual(fs.readdirSync(f.directory),[]);
});

test('普通 context 输出 Claude Code 格式，回执不虚构会话身份',async t=>{
 const f=fixture(t);await runBridge(f.config,['context'],f.deps);
 assert.match(f.output[0],/memory-station-claude.mjs submit/);assert.match(f.output[0],/Claude Code AI|"agent": "Claude Code"/);
 assert.deepEqual(f.requests[0].body,{revision:0});assert.equal(f.requests.length,1);
});

test('输出失败时不登记读取回执，也不追加第二份 JSON',async t=>{
 const f=fixture(t);
 await assert.rejects(()=>runBridge(f.config,['session-start'],{...f.deps,write:async()=>{throw Object.assign(Error('broken output'),{code:'EPIPE'});}}),/broken output/);
 assert.equal(f.requests.length,0);assert.equal(f.output.length,0);
});

test('回执失败保留唯一有效 hook JSON，并单独报告登记未确认',async t=>{
 const f=fixture(t);const result=await runBridge(f.config,['session-start'],{...f.deps,fetchImpl:async()=>{throw Error('fetch failed');}});
 assert.equal(result.connected,true);assert.equal(result.receiptRecorded,false);
 assert.equal(f.output.length,1);assert.match(JSON.parse(f.output[0]).hookSpecificOutput.additionalContext,/当前已保存版本/);
 assert.equal(f.errors.length,1);assert.match(f.errors[0],/已输出.*回执未能确认/);
});

test('不同项目目录与普通文件不能触发读取，同目录的实际路径别名可接受',async t=>{
 const f=fixture(t),other=path.join(f.directory,'other');fs.mkdirSync(other);
 for(const cwd of [other,'relative-project']){
  f.output.length=0;f.events.length=0;
  const result=await runBridge(f.config,['session-start'],{...f.deps,input:[JSON.stringify({...f.event,cwd})]});
  assert.equal(result.connected,false);assert.deepEqual(f.events,['output']);assert.match(JSON.parse(f.output[0]).hookSpecificOutput.additionalContext,/本次未接续/);
 }
 const file=path.join(f.directory,'file');fs.writeFileSync(file,'synthetic');f.output.length=0;
 const result=await runBridge({...f.config,directory:file},['session-start'],{...f.deps,input:[JSON.stringify({...f.event,cwd:file})]});
 assert.equal(result.connected,false);assert.match(JSON.parse(f.output[0]).hookSpecificOutput.additionalContext,/不是项目文件夹/);
 const alias=path.join(f.directory,'alias');fs.symlinkSync(other,alias);
 await runBridge({...f.config,directory:other},['session-start'],{...f.deps,input:[JSON.stringify({...f.event,cwd:alias})]});
 assert.equal(f.requests.length,1);
});

test('无效会话、事件、JSON、超限或损坏编码只输出明确未接续提示',async t=>{
 const f=fixture(t),inputs=[
  [JSON.stringify({...f.event,session_id:'not-a-session'})],
  [JSON.stringify({...f.event,hook_event_name:'Stop'})],
  ['{invalid json'],[JSON.stringify({...f.event,ignored:'x'.repeat(32768)})],[Buffer.from([0xff])],
 ];
 for(const input of inputs){f.output.length=0;f.events.length=0;const result=await runBridge(f.config,['session-start'],{...f.deps,input});assert.equal(result.connected,false);assert.deepEqual(f.events,['output']);assert.match(JSON.parse(f.output[0]).hookSpecificOutput.additionalContext,/没有输出项目记忆，也没有登记读取成功/);}
 assert.equal(f.requests.length,0);
});

test('有待检查记录不把旧保存版本交给新会话，普通 context 同样拒绝',async t=>{
 const f=fixture(t,{pendingCount:2});
 const result=await runBridge(f.config,['session-start'],f.deps);assert.equal(result.connected,false);
 const context=JSON.parse(f.output[0]).hookSpecificOutput.additionalContext;assert.match(context,/2 条待检查/);assert.doesNotMatch(context,/合成工具原始观察/);
 await assert.rejects(()=>runBridge(f.config,['context'],f.deps),/待检查/);assert.equal(f.requests.length,0);
 assert.equal(f.events.includes('archive'),false);
});

test('只读可查看有待检查记录的保存版本，但明确不完整且零回执零提交',async t=>{
 const f=fixture(t,{pendingCount:2}),before=JSON.stringify(f.archive);
 const result=await runBridge(f.config,['context','--read-only'],{...f.deps,fetchImpl:async()=>assert.fail('只读不允许 POST')});
 assert.equal(result.readonly,true);assert.match(f.output[0],/2 条待检查记录未保存/);assert.match(f.output[0],/不可声称已接上全部最新工作/);
 assert.match(f.output[0],/不向记忆站回写/);assert.doesNotMatch(f.output[0],/工作结束后的草稿格式|memory-station-claude.mjs submit/);
 assert.equal(JSON.stringify(f.archive),before);assert.deepEqual(fs.readdirSync(f.directory),[]);
});

test('读取期间新增草稿或保存版本变化时停止，避免过期读取回执',async t=>{
 const f=fixture(t);
 for(const change of ['pending','revision']){
  f.events.length=0;f.output.length=0;let statuses=0;
  const read=async({pathname})=>pathname.endsWith('/claude')?{...f.status,...(++statuses===2?(change==='pending'?{pendingCount:1}:{currentRevision:1}):{})}:f.archive;
  const result=await runBridge(f.config,['session-start'],{...f.deps,read});assert.equal(result.connected,false);assert.match(JSON.parse(f.output[0]).hookSpecificOutput.additionalContext,/本次未接续/);
 }
 assert.equal(f.requests.length,0);
});

test('项目或状态不一致、服务失败不会生成成功上下文或回执',async t=>{
 const f=fixture(t);
 const reads=[
  async()=>{throw Object.assign(Error('connect'),{code:'ECONNREFUSED'});},
  async()=>({...f.status,projectId:randomUUID()}),
  async({pathname})=>pathname.endsWith('/claude')?f.status:{...f.archive,bundle:{...f.archive.bundle,project:{...f.archive.bundle.project,id:randomUUID()}}},
 ];
 for(const read of reads){f.output.length=0;const result=await runBridge(f.config,['session-start'],{...f.deps,read});assert.equal(result.connected,false);assert.match(JSON.parse(f.output[0]).hookSpecificOutput.additionalContext,/没有输出项目记忆/);}
 assert.equal(f.requests.length,0);
});

test('隐私检查在任何输出与回执之前进行，错误文本不泄露秘密',async t=>{
 const f=fixture(t),secret='password=synthetic-private-value';
 const privateArchive=structuredClone(f.archive);privateArchive.bundle.project.name=secret;
 const read=async({pathname})=>pathname.endsWith('/claude')?f.status:privateArchive;
 await assert.rejects(()=>runBridge(f.config,['context'],{...f.deps,read}),/隐私/);assert.equal(f.output.length,0);
 await runBridge(f.config,['session-start'],{...f.deps,read});assert.doesNotMatch(f.output[0],/synthetic-private-value/);
 f.output.length=0;await runBridge(f.config,['session-start'],{...f.deps,read:async()=>{throw Error(secret);}});
 assert.match(JSON.parse(f.output[0]).hookSpecificOutput.additionalContext,/隐私/);assert.doesNotMatch(f.output[0],/synthetic-private-value/);assert.equal(f.requests.length,0);
});

test('Claude 草稿固定整理者，只投递对应项目的实际脱敏批次',async t=>{
 const f=fixture(t),worklog=report(f.config.projectId);let posted;
 const result=await runBridge(f.config,['submit'],{...f.deps,input:[JSON.stringify(worklog)],fetchImpl:async(url,options)=>{posted={url,body:JSON.parse(options.body)};return {ok:true,json:async()=>({id:randomUUID(),worklog})};}});
 assert.equal(result.submitted,true);assert.ok(posted.url.endsWith('/claude/submit'));assert.deepEqual(posted.body,{worklog});assert.match(f.output[0],/尚未写入正式记忆/);assert.equal(f.events.includes('archive'),false);
});

test('拒绝跨项目、冒充用户或 Codex、隐私和超限提交，失败不声称已送达',async t=>{
 const f=fixture(t),wrong=report(randomUUID()),human=report(f.config.projectId),codex=report(f.config.projectId),privateLog=report(f.config.projectId);
 human.session.actor.kind='human';codex.session.agent='Codex';privateLog.entries[0].source.text='synthetic@example.com';
 for(const worklog of [wrong,human,codex,privateLog])await assert.rejects(()=>runBridge(f.config,['submit'],{...f.deps,input:[JSON.stringify(worklog)]}));
 await assert.rejects(()=>runBridge(f.config,['submit'],{...f.deps,input:['x'.repeat(300001)]}),/过大/);
 assert.equal(f.requests.length,0);assert.equal(f.output.length,0);
 for(const response of [
  {ok:false,json:async()=>({error:'已有待检查记录'})},
  {ok:true,json:async()=>({})},
  {ok:true,json:async()=>({id:randomUUID(),worklog:report(randomUUID())})},
  {ok:true,json:async()=>{throw Error('invalid JSON');}},
 ])await assert.rejects(()=>runBridge(f.config,['submit'],{...f.deps,input:[JSON.stringify(report(f.config.projectId))],fetchImpl:async()=>response}));
 assert.equal(f.output.length,0);
});

test('重复已处理草稿和状态登记失败分别说明，重试编号不变',async t=>{
 const f=fixture(t),worklog=report(f.config.projectId);
 await runBridge(f.config,['submit'],{...f.deps,input:[JSON.stringify(worklog)],fetchImpl:async()=>({ok:true,json:async()=>({alreadyImported:true})})});assert.match(f.output[0],/已经处理/);
 f.output.length=0;
 await runBridge(f.config,['submit'],{...f.deps,input:[JSON.stringify(worklog)],fetchImpl:async()=>({ok:true,json:async()=>({id:randomUUID(),worklog,statusWarning:'internal failure'})})});
 assert.match(f.output[0],/已送到待检查区/);assert.match(f.errors[0],/连接状态未登记/);
});
test('Claude Code AI 别名通过命令行而原始署名不变',async t=>{const f=fixture(t),w=report(f.config.projectId);w.session.agent=w.session.actor.id='Claude Code AI';await runBridge(f.config,['submit'],{...f.deps,input:[JSON.stringify(w)],fetchImpl:async(_url,options)=>{const submitted=JSON.parse(options.body).worklog;assert.equal(submitted.session.actor.id,'Claude Code AI');return {ok:true,json:async()=>({id:randomUUID(),worklog:submitted})};}});assert.match(f.output.join(''),/已送到待检查区/);});
