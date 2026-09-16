import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {deliverWorklog} from '../shared/submit-delivery.js';
import {createInbox} from './inbox.mjs';
import {createBundle} from './core.mjs';
import {runBridge as codex} from '../codex-bridge.mjs';
import {runBridge as claude} from '../claude-bridge.mjs';

const report=(id=randomUUID())=>({format:'project-memory-worklog',version:'0.1',project_id:id,session:{id:'same-batch',agent:'Codex AI',actor:{kind:'agent',id:'Codex AI'}},entries:[{id:'one',kind:'fact',title:'合成检查结果',detail:'合成检查已结束。',origin:'observation',source:{speaker:{kind:'agent',id:'Codex AI'},text:'合成工具观察：检查成功。'}}]});
const ok=worklog=>({ok:true,json:async()=>({id:randomUUID(),worklog})});
const fail=code=>Object.assign(Error('connection interrupted'),{cause:{code}});

test('短暂断连使用完全相同的请求重试，最多三次且不改变调用方记录',async()=>{
 const worklog=report(),before=JSON.stringify(worklog),calls=[],delays=[],notices=[];
 const result=await deliverWorklog({port:4181,worklog},{sleep:async ms=>delays.push(ms),onRetry:s=>notices.push(s),fetchImpl:async(url,options)=>{calls.push({url,body:options.body});assert.equal(options.redirect,'error');if(calls.length<3)throw fail(calls.length===1?'ECONNREFUSED':'ECONNRESET');return ok(JSON.parse(options.body).worklog);}});
 assert.equal(result.worklog.session.id,'same-batch');assert.equal(calls.length,3);assert.deepEqual(calls,[calls[0],calls[0],calls[0]]);assert.deepEqual(delays,[1000,2000]);assert.equal(notices.length,2);assert.equal(JSON.stringify(worklog),before);
});
test('持续断连有界退出，权限错误与未知错误不自动重试',async()=>{
 for(const [error,expected] of [[fail('ECONNREFUSED'),3],[fail('EPERM'),1],[fail('EACCES'),1],[Error('fetch failed'),1],[new AggregateError([fail('ECONNRESET'),fail('EPERM')]),1]]){
  let n=0;await assert.rejects(deliverWorklog({port:4181,worklog:report()},{sleep:async()=>{},fetchImpl:async()=>{n++;throw error;}}));assert.equal(n,expected);
 }
});
test('隐私和无效输入在网络前拒绝，不写任何队列',async()=>{
 const secret=report();secret.entries[0].detail='password=synthetic-secret';
 for(const config of [{port:4181,worklog:secret},{port:4181,worklog:report(),channel:'work-import'},{port:0,worklog:report()},{port:4181,worklog:{...report(),project_id:'other'}}])await assert.rejects(deliverWorklog(config,{fetchImpl:async()=>assert.fail('must not send')}));
});
test('冲突、校验失败及HTTP服务错误不盲目重发',async()=>{
 for(const status of [400,403,409,422,500,503]){
  let n=0;await assert.rejects(deliverWorklog({port:4181,worklog:report()},{fetchImpl:async()=>{n++;return {ok:false,status,json:async()=>({error:'已有待检查记录'})};}}),/已有/);assert.equal(n,1);
 }
});
test('只接受对应批次及原始内容的确认，错误回执不显示成功',async()=>{
 for(const mutation of [r=>r.worklog.project_id=randomUUID(),r=>r.worklog.session.id='wrong',r=>r.worklog.entries=[],r=>r.worklog.entries[0].detail='changed',r=>r.id='bad']){
  const worklog=report(),result={id:randomUUID(),worklog:structuredClone(worklog)};mutation(result);let n=0;
  await assert.rejects(deliverWorklog({port:4181,worklog},{fetchImpl:async()=>{n++;return {ok:true,json:async()=>result};}}),/没有确认/);assert.equal(n,1);
 }
 const worklog=report(),enriched=structuredClone(worklog);enriched.entries[0].file_notes=['文件未附上'];
 await deliverWorklog({port:4181,worklog},{fetchImpl:async()=>ok(enriched)});
 assert.equal((await deliverWorklog({port:4181,worklog},{fetchImpl:async()=>({ok:true,json:async()=>({alreadyImported:true})})})).alreadyImported,true);
});
test('真实本机HTTP接收后丢失响应，再发同批只保留一份待检查草稿',async t=>{
 const archive=createBundle('独立投递检查',''),inbox=createInbox({loadArchive:()=>archive}),before=JSON.stringify(archive),worklog=report(archive.bundle.project.id);let calls=0,first;
 const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);calls++;const result=inbox.stage(archive,input);if(calls===1){first=result.id;req.socket.destroy();return;}res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const result=await deliverWorklog({port:server.address().port,worklog},{sleep:async()=>{}});
 assert.equal(calls,2);assert.equal(result.id,first);assert.equal(inbox.get(worklog.project_id).id,first);assert.equal(JSON.stringify(archive),before);
});
test('Codex和Claude提交共用有界重试且最终只报告一次送达',async()=>{
 for(const [run,actor,channel] of [[codex,'Codex AI','codex'],[claude,'Claude Code AI','claude']]){
  const worklog=report();worklog.session.agent=worklog.session.actor.id=worklog.entries[0].source.speaker.id=actor;let n=0;const output=[],errors=[];
  await run({projectId:worklog.project_id,port:4181,directory:'/tmp/synthetic'},['submit'],{input:[JSON.stringify(worklog)],write:async s=>output.push(s),writeError:s=>errors.push(s),sleep:async()=>{},fetchImpl:async(url,opts)=>{assert.ok(url.endsWith(`/${channel}/submit`));if(++n===1)throw fail('ECONNRESET');return ok(JSON.parse(opts.body).worklog);}});
  assert.equal(n,2);assert.equal(output.filter(s=>s.includes('已送到待检查区')).length,1);assert.equal(errors.length,1);
 }
});
test('通用交接命令真实重试并退出成功，只有一份待检查记录',async t=>{
 const archive=createBundle('通用命令独立检查',''),inbox=createInbox({loadArchive:()=>archive}),worklog=report(archive.bundle.project.id);let calls=0,first;
 const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;calls++;const result=inbox.stage(archive,JSON.parse(raw));if(calls===1){first=result.id;req.socket.destroy();return;}res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const child=spawn(process.execPath,[new URL('../submit-work.mjs',import.meta.url).pathname],{env:{...process.env,MEMORY_STATION_PORT:String(server.address().port)},stdio:['pipe','pipe','pipe']});
 let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.stdin.end(JSON.stringify(worklog));
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
 assert.equal(code,0,err);assert.equal(calls,2);assert.match(err,/重试同一批/);assert.match(out,/尚未写入正式记忆/);assert.equal(inbox.get(worklog.project_id).id,first);assert.equal(archive.revision,0);
});
