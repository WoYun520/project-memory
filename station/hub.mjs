#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readLocalToolsConfig,inspectRadar,createRadarServer,readLoopback} from './server/local-tools.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const flags=new Set(process.argv.slice(2));
if([...flags].some(flag=>!['--no-open','--help'].includes(flag))){console.error('支持的选项：--no-open、--help');process.exit(1);}
if(flags.has('--help')){console.log('node hub.mjs [--no-open]\n启动记忆站，连接观察仓库和个人网站。不会停止已运行的服务。\n本机配置：data/local-tools.json，或环境变量 MEMORY_RADAR_ROOT。');process.exit(0);}
const startup=stage=>console.error('MEMORY_STATION_STARTUP:'+stage);
const children=[];let radarServer,closing=false;
function stop(){if(closing)return;closing=true;radarServer?.close();for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');}
process.on('SIGINT',()=>{stop();process.exitCode=0;});process.on('SIGTERM',()=>{stop();process.exitCode=0;});
const hash=value=>createHash('sha256').update(value).digest('hex');
async function inspectStation(port){
  const request=pathname=>readLoopback({port,pathname,host:'127.0.0.1'});
  try{
    const health=await request('/api/health');
    let info;try{info=JSON.parse(health.body.toString());}catch{}
    if(health.status===200&&info?.service==='project-memory-station')return 'ready';
    // Support the already running v0.1 service, which predates its dedicated identity route.
    const homepage=await request('/'),localIndex=path.join(ROOT,'dist/index.html');
    if(homepage.status===200&&fs.existsSync(localIndex)&&hash(homepage.body)===hash(fs.readFileSync(localIndex))){
      const projects=await request('/api/projects');let body;try{body=JSON.parse(projects.body.toString());}catch{}
      if(projects.status===200&&Array.isArray(body?.projects)&&body.projects.every(project=>typeof project.id==='string'&&typeof project.name==='string'))return 'ready';
    }
    throw Error(`记忆站端口 ${port} 已被其他服务使用。请检查原启动窗口；本次不会停止它。`);
  }catch(error){
    if(error.code==='ECONNREFUSED')return 'stopped';
    if(['EPERM','EACCES'].includes(error.code))throw Error('当前环境没有访问本机服务的权限，不能判断记忆站是否已启动。请在电脑上双击“打开工作台”。');
    throw error;
  }
}
function prepareStation(){
  const npm=process.platform==='win32'?'npm.cmd':'npm';
  if(!fs.existsSync(path.join(ROOT,'node_modules/ajv/package.json'))){
    console.log('首次打开，正在准备记忆站所需组件……');
    const result=spawnSync(npm,['ci','--no-audit','--no-fund'],{cwd:ROOT,stdio:'inherit',shell:false});
    if(result.status!==0)throw Error('组件准备失败。请检查网络后重新打开工作台。');
  }
  if(!fs.existsSync(path.join(ROOT,'dist/index.html'))){
    const result=spawnSync(npm,['run','build'],{cwd:ROOT,stdio:'inherit',shell:false});
    if(result.status!==0)throw Error('页面准备失败，请查看上方提示。');
  }
}
async function startStation(port){
  if(await inspectStation(port)==='ready'){console.log('记忆站已经打开，继续使用原服务。');return;}
  prepareStation();
  const child=spawn(process.execPath,[path.join(ROOT,'server/entry.mjs')],{cwd:ROOT,stdio:'inherit',env:{...process.env,MEMORY_STATION_PORT:String(port)}});children.push(child);
  let failure;child.on('error',error=>{failure=error;});
  const deadline=Date.now()+90000;
  // An unanswered OS file-access prompt can outlast 90 seconds. Keep the same live child.
  while(!closing){
    if(failure||child.exitCode!==null)throw Error('记忆站启动失败，请查看启动窗口中的提示。');
    await new Promise(resolve=>setTimeout(resolve,Date.now()<deadline?150:3000));
    if(await inspectStation(port)==='ready')return;
  }
  return;
}
async function startRadar(config){
  const current=await inspectRadar(config);
  if(current.status==='unconfigured'){console.log('观察仓库尚未连接。记忆站可以独立使用。');return;}
  if(current.status==='ready'){console.log(current.message);return;}
  if(current.status!=='stopped'){console.warn('观察仓库：'+current.message);return;}
  radarServer=createRadarServer(config);
  await new Promise((resolve,reject)=>{radarServer.once('error',reject);radarServer.listen(config.radarPort,'127.0.0.1',resolve);});
  console.log(`观察仓库：http://localhost:${config.radarPort}/\n个人网站：http://localhost:${config.radarPort}/website/`);
}
function openBrowser(url){
  const executable=process.platform==='darwin'?'open':process.platform==='linux'?'xdg-open':null;
  if(!executable)return;
  const child=spawn(executable,[url],{stdio:'ignore',shell:false});child.on('error',()=>console.warn('浏览器没有自动打开，请使用上方地址。'));child.unref();
}
try{
  startup('reading_config');
  const config=readLocalToolsConfig({stationRoot:ROOT});
  startup('starting_service');
  await startStation(config.stationPort);
  if(closing)process.exit(0);
  startup('ready');
  try{await startRadar(config);}catch{console.warn('观察仓库暂未连接，记忆站仍可独立使用。');}
  const url=`http://127.0.0.1:${config.stationPort}/`;
  console.log(`\n工作台已就绪：${url}\n观察仓库继续使用原来的 localhost 地址，旧浏览器记录不会迁移或清除。`);
  if(children.length||radarServer)console.log('本窗口负责本次启动的服务，使用时请保持打开。按 Ctrl+C 只关闭本次启动的服务。');
  if(!flags.has('--no-open'))openBrowser(url);
}catch(error){startup(['EACCES','EPERM'].includes(error.code)?'permission_denied':error.code==='STATION_CONFIG'?'configuration_error':'service_error');console.error('\n工作台未能完整打开：'+error.message);stop();process.exitCode=1;}
