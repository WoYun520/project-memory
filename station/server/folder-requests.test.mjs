import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createBundle} from './core.mjs';
import {createWorkspaceConnector} from './workspace.mjs';
import {createFolderRequests,FOLDER_REQUEST_LIMITS} from './folder-requests.mjs';
import {runConnectCLI,parseConnectCommand,connectErrorMessage} from '../connect-project.mjs';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'memory-folder-intake-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const project=path.join(root,'project');fs.mkdirSync(project);
 const archive=createBundle('已存在的项目',''),id=archive.bundle.project.id;
 const workspace=createWorkspaceConnector({directory:path.join(root,'bindings')});
 let time=Date.parse('2026-09-13T00:00:00Z');const loads=[];
 const config={stationRoot:path.resolve('.'),port:4180,workspace,loadArchive:projectId=>{loads.push(projectId);assert.equal(projectId,id);return archive;},listProjectIds:()=>[id],now:()=>time};
 return {root,project,archive,id,workspace,loads,config,requests:createFolderRequests(config),advance:ms=>{time+=ms;}};
}
function files(root){const values={};function visit(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const location=path.join(directory,entry.name);if(entry.isDirectory())visit(location);else values[path.relative(root,location)]=fs.readFileSync(location).toString('base64');}}visit(root);return values;}

test('报告仅暂存位置；确认前不建档、不绑定、不安装指引、不读正文',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.project,'README.md'),'合成正文，接入请求不读取它。');const before=files(f.root),archive=JSON.stringify(f.archive);
 const created=f.requests.create({});assert.equal(created.candidate,null);assert.equal(created.projectId,null);assert.match(created.prompt,/实际.*项目根目录/);assert.match(created.prompt,/不安装接续指引/);
 const proposed=f.requests.propose(created.id,{directory:f.project});assert.deepEqual(proposed.candidate,{directory:fs.realpathSync(f.project),name:'project'});assert.deepEqual(f.requests.get(created.id),proposed);
 assert.equal(f.workspace.getBinding(f.id),null);assert.deepEqual(files(f.root),before);assert.equal(JSON.stringify(f.archive),archive);assert.deepEqual(f.loads,[]);
 const afterRestart=createFolderRequests(f.config);assert.throws(()=>afterRestart.get(created.id),error=>error.statusCode===410);
});

test('同一真实目录重试幂等；不同目录不能替换候选，返回值不能改内部状态',t=>{
 const f=fixture(t),request=f.requests.create();const first=f.requests.propose(request.id,{directory:f.project});f.advance(1000);
 const again=f.requests.propose(request.id,{directory:f.project+'/.'});assert.deepEqual(again,first);
 const other=path.join(f.root,'other');fs.mkdirSync(other);assert.throws(()=>f.requests.propose(request.id,{directory:other}),error=>error.statusCode===409);
 first.candidate.directory=other;assert.equal(f.requests.get(request.id).candidate.directory,fs.realpathSync(f.project));assert.equal(f.requests.get(request.id).expiresAt,request.expiresAt);
});

test('已连接位置只读取绑定元数据并返回原项目名称，保留现有绑定',t=>{
 const f=fixture(t);f.workspace.bind(f.id,f.project);const before=files(f.root);f.workspace.get=()=>assert.fail('不得扫描项目候选文档');
 const request=f.requests.create({projectId:f.id}),proposed=f.requests.propose(request.id,{directory:f.project});
 assert.equal(proposed.projectId,f.id);assert.equal(proposed.candidate.existingProjectId,f.id);assert.equal(proposed.candidate.existingProjectName,'已存在的项目');assert.deepEqual(files(f.root),before);
 assert.equal(f.loads.length,2);
});

test('30分钟到期即丢弃候选且不能继续提交；64条限额到期可恢复',t=>{
 const f=fixture(t),first=f.requests.create();f.requests.propose(first.id,{directory:f.project});
 for(let i=1;i<FOLDER_REQUEST_LIMITS.maxRequests;i++)f.requests.create();assert.throws(()=>f.requests.create(),error=>error.statusCode===429);
 f.advance(FOLDER_REQUEST_LIMITS.ttlMs-1);assert.ok(f.requests.get(first.id).candidate);f.advance(1);
 assert.throws(()=>f.requests.get(first.id),error=>error.statusCode===410);assert.throws(()=>f.requests.propose(first.id,{directory:f.project}),error=>error.statusCode===410);assert.ok(f.requests.create().id);
});

test('拒绝附加正文、错误项目编号和非对象输入；非法请求不消耗候选',t=>{
 const f=fixture(t);
 for(const input of [null,[],{directory:f.project},{projectId:null},{projectId:4},{projectId:'bad'},{projectId:f.id,content:'不允许正文'}])assert.throws(()=>f.requests.create(input));
 assert.throws(()=>f.requests.get('invalid'),/编号/);const request=f.requests.create();
 for(const input of [null,[],{}, {directory:f.project,content:'合成正文'}, {directory:f.project,projectId:f.id}, {directory:5}]){assert.throws(()=>f.requests.propose(request.id,input));assert.equal(f.requests.get(request.id).candidate,null);}
});

test('复用既有目录保护规则，拒绝隐藏或敏感位置、链接、文件、上级路径和缺失目录',t=>{
 const f=fixture(t),hidden=path.join(f.root,'.hidden'),sensitive=path.join(f.root,'secrets'),link=path.join(f.root,'link'),file=path.join(f.root,'note.md');
 fs.mkdirSync(hidden);fs.mkdirSync(sensitive);fs.symlinkSync(f.project,link);fs.writeFileSync(file,'合成说明');const request=f.requests.create();
 for(const directory of ['relative','/',hidden,sensitive,link,file,f.project+'/../project',path.join(f.root,'missing'),f.project+'\0',5]){
  assert.throws(()=>f.requests.propose(request.id,{directory}));assert.equal(f.requests.get(request.id).candidate,null);
 }
 assert.equal(f.requests.propose(request.id,{directory:f.project}).candidate.directory,fs.realpathSync(f.project));
});

test('生成的命令正确引用含空格和引号的工具路径，不混入项目正文',t=>{
 const f=fixture(t),requests=createFolderRequests({...f.config,stationRoot:"/a folder/user's station"});
 const prompt=requests.create().prompt;assert.ok(prompt.includes("node '/a folder/user'\\''s station/connect-project.mjs'"));assert.match(prompt,/MEMORY_STATION_PORT=4180/);assert.match(prompt,/--directory '<本任务实际项目根目录>'/);
});

test('CLI只发送目录，先核验本机服务；支持显式目录和已确认的当前目录',async()=>{
 const id=randomUUID(),calls=[],directory="/project with spaces/it's here";
 const fetchImpl=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.endsWith('/health')?{service:'project-memory-station'}:{id,candidate:{directory,name:'project'}}};};
 const result=await runConnectCLI([id,'--directory',directory],{env:{MEMORY_STATION_PORT:'4199'},fetchImpl});
 assert.equal(calls.length,2);assert.equal(calls[0].url,'http://127.0.0.1:4199/api/health');assert.equal(calls[0].options.method,'GET');assert.equal(calls[1].options.headers['X-Memory-Station'],'1');assert.deepEqual(JSON.parse(calls[1].options.body),{directory});assert.equal(calls[1].options.redirect,'error');assert.match(result.output,/等待用户选择确认/);assert.match(result.output,/尚未建立连接/);
 assert.deepEqual(parseConnectCommand([id],{cwd:'/actual-project'}),{id,directory:'/actual-project'});
});

test('CLI拒绝坏参数与伪装服务，失败或异常回执不会声称接入成功',async()=>{
 const id=randomUUID();for(const args of [[],['bad'],[id,'--url','https://example.invalid'],[id,'--directory','relative'],[id,'--directory','/project','extra'],['--help','extra']])assert.throws(()=>parseConnectCommand(args));
 await assert.rejects(()=>runConnectCLI([id],{env:{MEMORY_STATION_PORT:'oops'},fetchImpl:()=>assert.fail('端口错误不请求')}),/端口/);
 let calls=0;await assert.rejects(()=>runConnectCLI([id],{fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({service:'other'})};}}),/不是.*记忆站/);assert.equal(calls,1);
 const fetchImpl=async url=>({ok:url.endsWith('/health'),json:async()=>url.endsWith('/health')?{service:'project-memory-station'}:{error:'请求已过期'}});
 await assert.rejects(()=>runConnectCLI([id],{fetchImpl}),/过期/);
 await assert.rejects(()=>runConnectCLI([id],{fetchImpl:async url=>({ok:true,json:async()=>url.endsWith('/health')?{service:'project-memory-station'}:{id:randomUUID(),candidate:{directory:'/x',name:'x'}}})}),/未收到有效.*回执/);
 const help=await runConnectCLI(['--help'],{fetchImpl:()=>assert.fail('帮助不访问本机服务')});assert.match(help.output,/不要猜测/);
 assert.match(connectErrorMessage({cause:{code:'EPERM'}}),/这不表示记忆站未启动/);assert.match(connectErrorMessage({name:'TimeoutError'}),/尚未确认送达/);
});

test('真实HTTP路由与CLI交付位置但不改档案，打开入口只接受已连接的项目编号',async t=>{
 const f=fixture(t),data=path.join(f.root,'station-fixture');fs.mkdirSync(data);
 const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const child=spawn(process.execPath,[fileURLToPath(new URL('./index.mjs',import.meta.url))],{env:{...process.env,MEMORY_STATION_PORT:String(port),MEMORY_STATION_DATA_DIR:data,MEMORY_STATION_EMPTY:'1'},stdio:['ignore','pipe','pipe']});
 const childExit=once(child,'close');t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await childExit;}});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('合成服务启动超时')),10000);child.stdout.on('data',chunk=>{if(chunk.toString().includes('记忆站：http')){clearTimeout(timer);resolve();}});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);reject(Error('合成服务提前退出：'+code));});});
 const base=`http://127.0.0.1:${port}`;
 async function request(route,input,headers={}){const response=await fetch(base+route,input===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json','X-Memory-Station':'1',...headers},body:JSON.stringify(input)});return {status:response.status,value:await response.json()};}
 const created=await request('/api/projects',{name:'合成项目位置测试',goal:'',reviewed:true}),projectId=created.value.bundle.project.id;
 assert.equal(created.status,201);const before=files(data);
 const pending=await request('/api/folder-requests',{projectId});assert.equal(pending.status,201);assert.equal(pending.value.candidate,null);
 const cli=await runConnectCLI([pending.value.id,'--directory',f.project],{env:{MEMORY_STATION_PORT:String(port)}});assert.match(cli.output,/等待用户选择确认/);
 const state=await request('/api/folder-requests/'+pending.value.id);assert.equal(state.value.candidate.directory,fs.realpathSync(f.project));assert.deepEqual(files(data),before);
 const getWorkspace=await request(`/api/projects/${projectId}/workspace`);assert.equal(getWorkspace.value.binding,null);
 assert.equal((await request('/api/folder-requests',{projectId},{'X-Memory-Station':'0'})).status,405);
 assert.equal((await request('/api/folder-requests/'+randomUUID())).status,410);
 const arbitrary=await request('/api/desktop-ai/open',{target:'codex',directory:f.project});assert.equal(arbitrary.status,400);assert.match(arbitrary.value.error,/不支持/);
 const unbound=await request('/api/desktop-ai/open',{target:'codex',projectId});assert.equal(unbound.status,400);assert.match(unbound.value.error,/尚未连接/);
 assert.deepEqual(files(data),before);
 const second=await request('/api/projects',{name:'第二个合成项目',goal:'',reviewed:true}),secondId=second.value.bundle.project.id;
 assert.equal((await request(`/api/projects/${projectId}/workspace`,{directory:f.project})).status,200);
 const boundBefore=files(data),conflict=await request(`/api/projects/${secondId}/workspace`,{directory:f.project});
 assert.equal(conflict.status,409);assert.equal(conflict.value.code,'WORKSPACE_ALREADY_BOUND');assert.equal(conflict.value.existingProjectId,projectId);assert.deepEqual(files(data),boundBefore);
});
