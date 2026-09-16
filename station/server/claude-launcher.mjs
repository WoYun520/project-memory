import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {checkedRoot} from './workspace.mjs';

const executeFile=promisify(execFile);
const projectPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const unsupported='当前系统暂不支持快捷打开 Claude Code，请在项目文件夹中手动启动。';
const unavailable='未找到可用的 Claude Code。请检查本机安装后重试；记忆站不会自动安装或登录。';
const launchError='无法请求终端打开 Claude Code。没有发送任务，请检查终端和本机安装后重试。';
const managedError=()=>Error('本机启动文件已变化或无法安全读取，原文件已保留；未打开 Claude Code。');
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const hash=value=>createHash('sha256').update(value).digest('hex');
const commandOptions=Object.freeze({timeout:10000,maxBuffer:65536,shell:false});
const probeOptions=Object.freeze({timeout:5000,maxBuffer:4096,shell:false});

// Check local routing files, not AI configuration, authentication or session files.
// macOS /tmp and /var aliases are allowed; user-created symlinks are not.
function ordinaryPath(value,{create=false}={}){
 if(typeof value!=='string'||!path.isAbsolute(value)||value.length>4096||value.includes('\0')||value.split(path.sep).includes('..'))throw managedError();
 const normalized=path.resolve(value);let current=path.parse(normalized).root;
 for(const part of normalized.slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);let stat;
  try{stat=fs.lstatSync(current);}catch(error){if(error.code!=='ENOENT'||!create)throw managedError();fs.mkdirSync(current,{mode:0o700});stat=fs.lstatSync(current);}
  if(stat.isSymbolicLink()){
   const alias=process.platform==='darwin'&&((current==='/tmp'&&fs.realpathSync(current)==='/private/tmp')||(current==='/var'&&fs.realpathSync(current)==='/private/var'));
   if(!alias)throw managedError();
  }else if(current!==normalized&&!stat.isDirectory())throw managedError();
 }
 return normalized;
}
function readManaged(file,max=20000){
 let fd;
 try{
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>max)throw managedError();
  fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  const actual=fs.fstatSync(fd);
  if(actual.ino!==stat.ino||actual.dev!==stat.dev||actual.size>max||actual.nlink!==1)throw managedError();
  return {bytes:fs.readFileSync(fd),mode:actual.mode&0o777};
 }catch(error){if(error.code==='ENOENT')return null;throw managedError();}
 finally{if(fd!==undefined)fs.closeSync(fd);}
}
function atomicWrite(file,bytes,mode){
 const temp=file+'.'+randomUUID()+'.tmp';let fd;
 try{fd=fs.openSync(temp,'wx',mode);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,file);}
 finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
}

export function createClaudeLauncher({directory,workspace,claudeLink,bridge,platform=process.platform,home=os.homedir(),execute=executeFile,isExecutable=file=>{try{return fs.statSync(file).isFile()&&(fs.accessSync(file,fs.constants.X_OK),true);}catch{return false;}}}={}){
 const candidates=[path.join(home,'.local','bin','claude'),'/opt/homebrew/bin/claude','/usr/local/bin/claude'];
 async function detect(){
  if(platform!=='darwin')return {available:false,version:null,message:unsupported};
  for(const file of candidates){
   // A native Claude installation can itself use a symlink. Only these fixed
   // installation entry points are probed; no PATH search or config is read.
   if(!isExecutable(file))continue;
   try{
    const result=await execute(file,['--version'],probeOptions);
    const match=/^(\d+\.\d+\.\d+(?:[+-][a-zA-Z0-9.-]+)?)(?:\s+\(Claude Code\))?$/.exec(String(result?.stdout??'').trim());
    if(match&&isExecutable(file))return {available:true,version:match[1],message:'可以在已连接的项目中打开 Claude Code；请在终端说明本次任务。',file};
   }catch{/* Do not expose command output, login state or installation details. */}
  }
  return {available:false,version:null,message:unavailable};
 }
 async function status(){const {file,...info}=await detect();return info;}
 async function projectInfo(projectId){
  if(typeof projectId!=='string'||!projectPattern.test(projectId))throw Error('项目编号无效。');
  const binding=workspace.getBinding?workspace.getBinding(projectId):workspace.get(projectId).binding;
  if(!binding)throw Error('请先连接这个项目的本机文件夹。');
  const root=checkedRoot(binding.directory),info=await claudeLink.status(projectId);
  if(!info.connected||!info.configured)throw Error('请先启用这个项目的 Claude Code 接续。');
  if(info.updateAvailable===true)throw Error('接续指引有更新，请先在记忆站更新后再打开。');
  if(!Number.isInteger(info.pendingCount)||info.pendingCount<0)throw Error('无法确认待检查记录，请刷新项目后重试。');
  if(info.pendingCount)throw Error('这个项目还有待检查记录，请先检查保存或处理后再切换 AI。');
  if(info.directory!==root)throw Error('项目连接位置已变化，请重新连接后再打开。');
  const settings=ordinaryPath(info.settingsFile),stat=fs.lstatSync(settings);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw managedError();
  return {root,settings};
 }
 function prepare(projectId,{root,settings},file,{ticketId,prompt}={}){
  const launchDirectory=ordinaryPath(directory,{create:true}),directoryStat=fs.lstatSync(launchDirectory);
  if(!directoryStat.isDirectory()||directoryStat.isSymbolicLink()||(directoryStat.mode&0o077)!==0)throw managedError();
  const command=path.join(launchDirectory,projectId+(ticketId?'-'+ticketId:'')+'.command'),manifest=path.join(launchDirectory,projectId+(ticketId?'-'+ticketId:'')+'.json');
  const previousCommand=readManaged(command),previousManifest=readManaged(manifest,2048);
  if(Boolean(previousCommand)!==Boolean(previousManifest))throw managedError();
  if(previousManifest){
   let saved;try{saved=JSON.parse(previousManifest.bytes);}catch{throw managedError();}
   if(saved.projectId!==projectId||saved.format!=='project-memory-claude-launcher-v1'||saved.sha256!==hash(previousCommand.bytes)||previousCommand.mode!==0o700||previousManifest.mode!==0o600)throw managedError();
  }
  const script=`#!/bin/zsh\n# Managed by Project Memory. Local routing only.\ncd -- ${quote(root)} || exit\nexec ${quote(file)} --settings ${quote(settings)}${prompt?' '+quote(prompt):''}\n`;
  if(previousCommand?.bytes.equals(Buffer.from(script)))return command;
  const metadata=JSON.stringify({format:'project-memory-claude-launcher-v1',projectId,sha256:hash(script)});
  try{
   atomicWrite(command,script,0o700);
   atomicWrite(manifest,metadata,0o600);
  }catch{
   // Only restore bytes we have just written; never overwrite a concurrent edit.
   try{if(readManaged(command)?.bytes.equals(Buffer.from(script))){if(previousCommand)atomicWrite(command,previousCommand.bytes,previousCommand.mode);else fs.unlinkSync(command);}}catch{}
   throw managedError();
  }
  return command;
 }
 async function open(projectId,{ticketId}={}){
  if(ticketId!==undefined&&(typeof ticketId!=='string'||!projectPattern.test(ticketId)||!bridge))throw Error('本次交接编号无效。');
  if(ticketId)bridge.launchPrompt(projectId,ticketId,'claude');
  if(platform!=='darwin')throw Error(unsupported);
  const initial=await projectInfo(projectId),installed=await detect();
  if(!installed.available)throw Error(installed.message);
  // Version probing is asynchronous. Recheck project and managed settings before
  // dispatch, so a changed binding or new review draft cannot silently pass.
  const current=await projectInfo(projectId);
  if(current.root!==initial.root||current.settings!==initial.settings)throw Error('项目连接位置已变化，请刷新后重试。');
  const prompt=ticketId?bridge.launchPrompt(projectId,ticketId,'claude'):undefined;
  const command=prepare(projectId,current,installed.file,{ticketId,prompt});
  try{await execute('/usr/bin/open',['-a','Terminal',command],commandOptions);}catch{throw Error(launchError);}
  return {target:'claude-code',dispatched:true,projectRequested:true,appOnly:false,taskRequested:Boolean(ticketId),message:ticketId?'已请求 Claude Code 带着本次任务启动；正在等待读取工具回执。终端若提示登录或授权，请在那里完成。':'已请求终端在这个项目中打开 Claude Code。请在终端说明本次任务；尚未发送消息，也不代表 AI 已读取记忆。'};
 }
 return {status,open};
}
