import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';import {spawn} from 'node:child_process';import {once} from 'node:events';import {fileURLToPath} from 'node:url';
import {createBundle} from './core.mjs';import {createWorkspaceConnector} from './workspace.mjs';import {createInbox} from './inbox.mjs';import {createCodexLink} from './codex-link.mjs';import {createClaudeLink} from './claude-link.mjs';import {createBridge} from './bridge.mjs';
test('真实 HTTP 入口兼容别名并预览原任务，跨 AI 被拒绝，正式档案不变',{timeout:15000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-alias-http-')),data=path.join(root,'data'),stationRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');fs.mkdirSync(data);
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const archives=new Map(),loadArchive=id=>archives.get(id),workspace=createWorkspaceConnector({directory:path.join(data,'workspace-links')}),inbox=createInbox({directory:path.join(data,'inbox'),loadArchive});
 const bridge=createBridge({directory:path.join(data,'bridges'),port,stationRoot,loadArchive,inbox,workspace});const cases=[];
 for(const [target,name,create] of [['codex','Codex',createCodexLink],['claude','Claude Code',createClaudeLink]]){
  const a=createBundle('合成署名测试',''),id=a.bundle.project.id,folder=path.join(root,target);fs.mkdirSync(folder);fs.mkdirSync(path.join(data,id));const original=JSON.stringify(a);fs.writeFileSync(path.join(data,id,'project.json'),original);archives.set(id,a);workspace.bind(id,folder);
  const link=create({directory:path.join(data,target+'-links'),stationRoot,port,workspace,loadArchive,inbox});link.install(id,link.status(id).token);
  const ticket=bridge.prepare(id,{target,revision:0,task:'核对合成任务',taskMode:'new'}).ticket;bridge.receipt(id,ticket.id,{revision:0,taskReceived:true});cases.push({target,name,id,ticket,original});
 }
 const child=spawn(process.execPath,[path.join(stationRoot,'server/index.mjs')],{env:{...process.env,MEMORY_STATION_PORT:String(port),MEMORY_STATION_DATA_DIR:data,MEMORY_STATION_EMPTY:'1'},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}fs.rmSync(root,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('server did not start')),5000);child.once('error',reject);child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('记忆站：http')){clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);reject(Error('server exited '+code));});});
 const call=async(p,input)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,input?{method:'POST',headers:{'Content-Type':'application/json','X-Memory-Station':'1'},body:JSON.stringify(input)}:{});return {status:r.status,body:await r.json()};};
 for(const c of cases){const w={format:'project-memory-worklog',version:'0.1',project_id:c.id,session:{id:'alias-batch',agent:c.name+' AI',actor:{kind:'agent',id:c.name+' AI'},handoff_id:c.ticket.id},entries:[{id:'one',kind:'fact',title:'合成观察',detail:'仅检查合成任务。',origin:'observation',source:{speaker:{kind:'agent',id:c.name+' AI'},text:'合成原始观察'}}]};
  const wrong=structuredClone(w);wrong.session.actor.id=c.target==='codex'?'Claude Code AI':'Codex AI';assert.notEqual((await call(`/projects/${c.id}/${c.target}/submit`,{worklog:wrong})).status,200);
  assert.equal((await call(`/projects/${c.id}/inbox`)).body.draft,null);
  const sent=await call(`/projects/${c.id}/${c.target}/submit`,{worklog:w});assert.equal(sent.status,200,JSON.stringify(sent.body));
  const draft=(await call(`/projects/${c.id}/inbox`)).body.draft;assert.equal(draft.worklog.session.actor.id,c.name+' AI');
  const preview=await call(`/projects/${c.id}/work-preview`,{revision:0,worklog:draft.worklog});assert.equal(preview.status,200);assert.equal(preview.body.association.link.ticket_id,c.ticket.id);assert.equal(fs.readFileSync(path.join(data,c.id,'project.json'),'utf8'),c.original);
 }
});
