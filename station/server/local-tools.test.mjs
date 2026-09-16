import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {readLocalToolsConfig,resolvePublicAsset,inspectRadar,getLocalToolStatus,createRadarServer} from './local-tools.mjs';

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'memory-local-tools-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const write=(name,content)=>{fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),content);};
  write('index.html','<title>test radar</title>');write('app.js','const radar = true;');write('website/index.html','<title>test website</title>');
  return {root,write,config:{radarRoot:root,radarPort:4174,stationPort:4180}};
}
function response(status,body){return {status,body:Buffer.from(body)};}
function route(server,url,{method='GET',host='localhost:4174'}={}){
  let status,headers,body;
  server.emit('request',{url,method,headers:{host}},{writeHead(code,values){status=code;headers=values;},end(value){body=value;}});
  return {status,headers,body};
}

test('public preview excludes private paths, traversal and symlinked allowlisted files',t=>{
  const {root,write,config}=fixture(t);write('docs/private.md','private');write('data/local-tools.json','private');
  for(const name of ['/docs/private.md','/data/local-tools.json','/.git/config','/website/../docs/private.md','/%2e%2e/index.html','/%2fetc/passwd','/website%5cindex.html','/index.html%00'])assert.equal(resolvePublicAsset(root,name),null,name);
  fs.symlinkSync(path.join(root,'docs/private.md'),path.join(root,'styles.css'));
  assert.equal(resolvePublicAsset(root,'/styles.css'),null);
  const server=createRadarServer(config);
  assert.equal(route(server,'/index.html').status,200);
  assert.equal(route(server,'/website/').status,200);
  assert.equal(route(server,'/website').headers.Location,'/website/');
  assert.equal(route(server,'/docs/private.md').status,404);
  assert.equal(route(server,'/index.html',{host:'evil.example:4174'}).status,403);
  assert.equal(route(server,'/index.html',{method:'POST'}).status,405);
  assert.equal(route(server,'/index.html',{method:'HEAD'}).body,undefined);
});

test('legacy preview is reused only when the configured radar files match exactly',async t=>{
  const {root,config}=fixture(t);
  const request=async({pathname})=>pathname==='/__local_tools_health'?response(404,'not found'):response(200,fs.readFileSync(path.join(root,pathname)));
  assert.equal((await inspectRadar(config,{request})).connectionMode,'existing-preview');
  assert.equal((await inspectRadar(config,{request:async()=>response(200,'unrelated local application')})).status,'conflict');
  const denied=await inspectRadar(config,{request:async()=>{throw Object.assign(Error('denied'),{code:'EPERM'});}});
  assert.equal(denied.status,'unavailable');assert.match(denied.message,/权限/);
  assert.equal((await inspectRadar(config,{request:async()=>{throw Object.assign(Error('refused'),{code:'ECONNREFUSED'});}})).status,'stopped');
});

test('local tool configuration stays out of status and website mismatch is independently reported',async t=>{
  const {root,write}=fixture(t);write('data/local-tools.json',JSON.stringify({radarRoot:root}));
  const config=readLocalToolsConfig({stationRoot:root,env:{}});assert.equal(config.radarRoot,root);
  assert.throws(()=>readLocalToolsConfig({stationRoot:root,env:{MEMORY_RADAR_ROOT:'relative'}}),/绝对目录/);
  const status=await getLocalToolStatus({stationRoot:root,env:{},request:async({pathname})=>pathname==='/__local_tools_health'?response(404,'missing'):pathname==='/website/index.html'?response(200,'another website'):response(200,fs.readFileSync(path.join(root,pathname)))});
  assert.equal(status.radar.status,'ready');assert.equal(status.website.status,'conflict');
  assert.equal(status.radar.url,'http://localhost:4174/');assert.equal(status.website.url,'http://localhost:4174/website/');
  assert.equal(JSON.stringify(status).includes(root),false);
  write('data/local-tools.json','invalid');assert.equal((await getLocalToolStatus({stationRoot:root,env:{}})).radar.status,'unavailable');
});

test('startup configuration failures retain explicit categories without exposing content',t=>{
 const {root,write}=fixture(t),env={MEMORY_STATION_DATA_DIR:root};
 for(const value of ['{ invalid', '[]', '{"radarRoot":42}']){
  write('local-tools.json',value);
  assert.throws(()=>readLocalToolsConfig({stationRoot:root,env}),e=>e.code==='STATION_CONFIG'&&!e.message.includes(value));
 }
 write('local-tools.json','{}');
 assert.throws(()=>readLocalToolsConfig({stationRoot:root,env:{...env,MEMORY_STATION_PORT:'invalid'}}),e=>e.code==='STATION_CONFIG');
});
