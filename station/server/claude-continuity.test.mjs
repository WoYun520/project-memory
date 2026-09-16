import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createBundle,appendMemory,hash} from './core.mjs';
import {createWorkspaceConnector} from './workspace.mjs';
import {createInbox} from './inbox.mjs';
import {createClaudeLink} from './claude-link.mjs';
import {createClaudeLauncher} from './claude-launcher.mjs';
import {runBridge} from '../claude-bridge.mjs';

// Only synthetic projects and local mock services are used. No installed AI,
// user AI configuration, transcript, production archive or Terminal is opened.
function baseFixture(t,{long=false,name='project'}={}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'claude-continuity-')));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const project=path.join(root,name);fs.mkdirSync(project);
 const archive=createBundle('Claude 续接合成项目','');
 appendMemory(archive,{kind:'fact',title:'合成资料的已知边界',detail:long?'合成范围说明。'.repeat(1400):'合成资料已备齐。',source:(long?'合成原始依据。'.repeat(1000):'合成原始依据。')+'原文末端核对标记。',reviewed:true,recorder:{kind:'agent',id:'isolated-test'},speaker:{kind:'tool',id:'isolated-test'}});
 if(long)appendMemory(archive,{kind:'constraint',title:'不能省略的合成要求',detail:'保留规则。'.repeat(2200),source:'合成规则原文',reviewed:true});
 const id=archive.bundle.project.id,sessionId=randomUUID(),config={projectId:id,directory:project,port:4199};
 const event={hook_event_name:'SessionStart',session_id:sessionId,cwd:project,source:'startup'};
 const output=[],errors=[],posts=[];
 const deps={input:[JSON.stringify(event)],read:async({pathname})=>pathname.endsWith('/claude')?{projectId:id,currentRevision:archive.revision,pendingCount:0}:archive,write:async value=>output.push(value),writeError:async value=>errors.push(value),fetchImpl:async(url,options)=>{posts.push(JSON.parse(options.body));return {ok:true,json:async()=>({recorded:true})};}};
 return {root,project,archive,id,sessionId,event,config,output,errors,posts,deps};
}
const hookText=f=>JSON.parse(f.output.at(-1)).hookSpecificOutput.additionalContext;
const worklog=id=>({format:'project-memory-worklog',version:'0.1',project_id:id,session:{id:'continuity-synthetic-batch',agent:'Claude Code',actor:{kind:'agent',id:'Claude Code'}},entries:[{id:'one',kind:'fact',title:'合成本轮观察',detail:'已检查合成资料。',origin:'observation',source:{speaker:{kind:'agent',id:'Claude Code'},text:'隔离测试生成的原始说明。'}}]});

test('超长启动只输出短续读说明，完整 context 后才登记读取',async t=>{
 const f=baseFixture(t,{long:true});
 const result=await runBridge(f.config,['session-start'],f.deps);
 assert.deepEqual(result,{connected:false,contextDeferred:true,revision:0,receiptRecorded:false});
 const notice=hookText(f);
 assert.ok(notice.length<=10000);assert.match(notice,/没有输出完整记忆，也没有登记读取成功/);
 assert.ok(notice.includes(f.id));assert.ok(notice.includes(f.sessionId));assert.match(notice,/已保存版本：0/);
 assert.match(notice,/context --read-only/);assert.match(notice,/不是新增授权/);assert.doesNotMatch(notice,/原文末端核对标记/);
 assert.equal(f.posts.length,0);assert.equal(f.output.length,1);assert.deepEqual(f.errors,[]);
 const complete=await runBridge(f.config,['context','--full'],f.deps);
 assert.equal(complete.receiptRecorded,true);assert.equal(f.posts.length,1);
 assert.ok(f.output[1].length>10000);assert.match(f.output[1],/原文末端核对标记/);assert.match(f.output[1],/## 工作结束后的草稿格式/);
 assert.deepEqual(f.posts[0],{revision:0});
});

test('启动的一万字符边界包含草稿格式，超一字符即延后且不登记',async t=>{
 const f=baseFixture(t);
 const goal=appendMemory(f.archive,{kind:'goal',title:'合成目标',detail:'目标',source:'合成目标原文',reviewed:true});
 await runBridge(f.config,['session-start'],f.deps);
 const originalLength=hookText(f).length;
 assert.ok(originalLength<10000);
 const changeSource=extra=>{goal.data.desired_outcome+=extra;};
 changeSource('研'.repeat(10000-originalLength));f.output.length=0;f.posts.length=0;
 const exact=await runBridge(f.config,['session-start'],f.deps);
 assert.equal(hookText(f).length,10000);assert.equal(exact.connected,true);assert.equal(f.posts.length,1);
 changeSource('研');f.output.length=0;f.posts.length=0;
 const over=await runBridge(f.config,['session-start'],f.deps);
 assert.equal(over.contextDeferred,true);assert.ok(hookText(f).length<10000);assert.equal(f.posts.length,0);
});

test('续读命令中的目录空格、引号和 shell 符号保持原值，只读长资料零登记',async t=>{
 const f=baseFixture(t,{long:true,name:"project 中文 'quote' ; $(printf BAD) `printf BAD` & #"});
 await runBridge(f.config,['session-start'],f.deps);
 const command=hookText(f).split('\n').find(line=>line.endsWith("' context --full"));
 assert.ok(command);
 // This helper is a fixture that prints arguments; it never starts Claude or
 // reads any user file. Executing the quoted line checks the actual shell argv.
 fs.writeFileSync(path.join(f.project,'memory-station-claude.mjs'),'console.log(JSON.stringify(process.argv.slice(1)));\n');
 const args=JSON.parse(execFileSync('/bin/zsh',['-fc',command],{encoding:'utf8',timeout:5000}));
 assert.deepEqual(args,[path.join(f.project,'memory-station-claude.mjs'),'context','--full']);
 f.output.length=0;
 const result=await runBridge(f.config,['context','--read-only'],f.deps);
 assert.equal(result.readonly,true);assert.equal(f.posts.length,0);
 assert.ok(f.output[0].length>10000);assert.match(f.output[0],/原文末端核对标记/);assert.doesNotMatch(f.output[0],/工作结束后的草稿格式/);
});

async function connectedFixture(t){
 const f=baseFixture(t),stationRoot=path.join(f.root,'station-code');fs.mkdirSync(stationRoot);
 let server;
 f.workspace=createWorkspaceConnector({directory:path.join(f.root,'bindings')});f.workspace.bind(f.id,f.project);
 f.options={directory:path.join(f.root,'links'),stationRoot,workspace:f.workspace,loadArchive:()=>f.archive};
 f.requests=[];
 f.start=async port=>{
  f.inbox=createInbox({directory:path.join(f.root,'inbox'),loadArchive:()=>f.archive});
  server=http.createServer(async(req,res)=>{
   try{
    f.requests.push(req.method+' '+req.url);const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=chunks.length?JSON.parse(Buffer.concat(chunks)):{};let value;
    if(req.method==='GET'&&req.url.endsWith('/claude'))value=f.link.status(f.id);
    else if(req.method==='GET')value=f.archive;
    else if(req.url.endsWith('/receipt'))value=f.link.receipt(f.id,body.revision,body.sessionId);
    else if(req.url.endsWith('/submit'))value=f.link.submit(f.id,body.worklog);
    else throw Error('unexpected mock route');
    res.writeHead(200,{'Content-Type':'application/json','Connection':'close'});res.end(JSON.stringify(value));
   }catch(error){res.writeHead(error.statusCode||400,{'Content-Type':'application/json','Connection':'close'});res.end(JSON.stringify({error:error.message}));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port??0,'127.0.0.1',resolve);});
  f.config.port=server.address().port;f.options.port=f.config.port;
  f.link=createClaudeLink({...f.options,inbox:f.inbox});
 };
 f.stop=async()=>{if(server?.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));};
 t.after(f.stop);
 await f.start();f.link.install(f.id,f.link.status(f.id).token);
 f.call=(args=['session-start'])=>runBridge(f.config,args,{input:[JSON.stringify(f.event)],write:f.deps.write,writeError:f.deps.writeError});
 f.launchCalls=[];
 f.launcher=()=>createClaudeLauncher({directory:path.join(f.root,'launchers'),home:path.join(f.root,'synthetic-home'),platform:'darwin',workspace:f.workspace,claudeLink:f.link,isExecutable:file=>file===path.join(f.root,'synthetic-home','.local','bin','claude'),execute:async(...args)=>{f.launchCalls.push(args);return {stdout:'2.1.40 (Claude Code)'};}});
 return f;
}

test('真实本机断线明确未接续，服务重启后相同入口读取新版本',async t=>{
 const f=await connectedFixture(t);
 await f.call();assert.equal(f.link.status(f.id).lastRead.revision,0);
 const oldReceipt=f.link.status(f.id).lastRead,port=f.config.port;
 await f.stop();f.output.length=0;
 const disconnected=await f.call();assert.equal(disconnected.connected,false);
 assert.match(hookText(f),/本机端口拒绝连接/);assert.match(hookText(f),/没有登记读取成功/);
 assert.deepEqual(f.link.status(f.id).lastRead,oldReceipt);
 f.archive.revision=1;await f.start(port);f.output.length=0;
 const resumed=await f.call();assert.equal(resumed.connected,true);assert.match(hookText(f),/当前已保存版本：1/);
 assert.equal(f.link.status(f.id).lastRead.revision,1);assert.equal(f.link.status(f.id).lastRead.sessionId,f.sessionId);
 assert.match(f.link.status(f.id).lastRead.source,/不代表模型理解或用户验收/);
});

test('重启保留待检查批次并阻止开工，显式只读仍说明缺失最近进度',async t=>{
 const f=await connectedFixture(t),batch=worklog(f.id);
 f.link.submit(f.id,batch);const port=f.config.port;await f.stop();await f.start(port);
 assert.deepEqual(f.inbox.get(f.id).worklog,batch);
 f.requests.length=0;await f.call();assert.match(hookText(f),/1 条待检查记录/);
 assert.deepEqual(f.requests,['GET /api/projects/'+f.id+'/claude']);assert.equal(f.link.status(f.id).lastRead,null);
 f.requests.length=0;f.output.length=0;await f.call(['context','--read-only']);
 assert.match(f.output[0],/不可声称已接上全部最新工作/);assert.equal(f.requests.some(value=>value.startsWith('POST')),false);
 assert.equal(f.link.status(f.id).lastRead,null);assert.deepEqual(f.inbox.get(f.id).worklog,batch);
});

test('外部规则手改保留；托管规则改动时 hook 给出保留修改的失败说明',async t=>{
 const f=await connectedFixture(t),rules=path.join(f.project,'CLAUDE.md');
 fs.appendFileSync(rules,'\n用户新增独立规则。\n');await f.call();assert.equal(f.link.status(f.id).configured,true);
 const changed=fs.readFileSync(rules,'utf8').replace('用户本次具体任务优先；','用户手改的托管句子；');fs.writeFileSync(rules,changed);
 const manifest=path.join(f.root,'links',f.id+'.json'),before=fs.readFileSync(manifest);f.output.length=0;
 const result=await f.call();assert.equal(result.connected,false);assert.match(hookText(f),/接入指引已被修改/);
 assert.match(hookText(f),/不自动覆盖或移除/);assert.equal(fs.readFileSync(rules,'utf8'),changed);assert.deepEqual(fs.readFileSync(manifest),before);
});

test('站点路径或端口改变先提示更新，更新后才派发；探测中变旧也阻止',async t=>{
 const f=await connectedFixture(t),oldHelper=fs.readFileSync(path.join(f.project,'memory-station-claude.mjs'),'utf8');
 const nextRoot=path.join(f.root,'station-moved');fs.renameSync(f.options.stationRoot,nextRoot);
 f.link=createClaudeLink({...f.options,stationRoot:nextRoot,port:f.config.port===65535?65534:f.config.port+1,inbox:f.inbox});
 assert.equal(f.link.status(f.id).updateAvailable,true);
 await assert.rejects(()=>f.launcher().open(f.id),/接续指引有更新，请先在记忆站更新后再打开/);
 assert.deepEqual(f.launchCalls,[]);assert.equal(fs.readFileSync(path.join(f.project,'memory-station-claude.mjs'),'utf8'),oldHelper);
 f.link.update(f.id,f.link.status(f.id).token);assert.equal(f.link.status(f.id).updateAvailable,false);
 const updated=fs.readFileSync(path.join(f.project,'memory-station-claude.mjs'),'utf8');assert.ok(updated.includes(nextRoot));assert.notEqual(updated,oldHelper);
 assert.equal((await f.launcher().open(f.id)).dispatched,true);assert.equal(f.launchCalls.at(-1)[0],'/usr/bin/open');
 const info=f.link.status(f.id),calls=[];
 const changing=createClaudeLauncher({directory:path.join(f.root,'other-launchers'),home:path.join(f.root,'synthetic-home'),platform:'darwin',workspace:f.workspace,claudeLink:{status:()=>info},isExecutable:()=>true,execute:async(...args)=>{calls.push(args);info.updateAvailable=true;return {stdout:'2.1.40'};}});
 await assert.rejects(()=>changing.open(f.id),/接续指引有更新/);assert.equal(calls.length,1);assert.deepEqual(calls[0][1],['--version']);
});

test('项目文件夹被搬移后不读取或写入搬移目标，恢复原位置可继续',async t=>{
 const f=await connectedFixture(t),moved=path.join(f.root,'project-moved');
 const manifest=path.join(f.root,'links',f.id+'.json'),before=fs.readFileSync(manifest);
 fs.renameSync(f.project,moved);const files=fs.readdirSync(moved).map(name=>({name,bytes:fs.readFileSync(path.join(moved,name))}));
 f.event.cwd=moved;
 const result=await f.call();assert.equal(result.connected,false);assert.match(hookText(f),/无法核对当前项目文件夹/);
 assert.deepEqual(fs.readFileSync(manifest),before);
 for(const file of files)assert.deepEqual(fs.readFileSync(path.join(moved,file.name)),file.bytes);
 await assert.rejects(()=>f.launcher().open(f.id),/无法读取这个本机文件夹/);assert.deepEqual(f.launchCalls,[]);
 fs.renameSync(moved,f.project);f.event.cwd=f.project;f.output.length=0;
 assert.equal((await f.call()).connected,true);
});
