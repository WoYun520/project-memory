import fs from 'node:fs';
import path from 'node:path';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {checkedRoot} from './workspace.mjs';

const execFileAsync=promisify(execFile);
const codexBundleId='com.openai.codex';
const codexSigningRequirement=`identifier "${codexBundleId}" and anchor apple generic and certificate leaf[subject.OU] = "2DC432GLL2"`;
const targets=new Map([
  ['codex',{label:'Codex',apps:['/Applications/Codex.app','/Applications/ChatGPT.app']}],
  ['claude',{label:'Claude',apps:['/Applications/Claude.app']}],
]);
const unsupported='当前系统暂不支持快捷打开桌面 AI，请手动打开目标 AI。';
const executionOptions=Object.freeze({timeout:10000,maxBuffer:65536,shell:false});
function bundleIdentifier(app){
  try{return execFileSync('/usr/bin/plutil',['-extract','CFBundleIdentifier','raw','-o','-',path.join(app,'Contents','Info.plist')],{timeout:3000,maxBuffer:65536,shell:false,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}
  catch{return null;}
}
// Official project URL, bundle identity and signing check:
// https://github.com/openai/codex/blob/main/codex-rs/cli/src/desktop_app/mac.rs
const codexProjectURL=directory=>'codex://threads/new?'+new URLSearchParams({path:directory});

export function createDesktopLauncher({platform=process.platform,exists=fs.existsSync,execute=execFileAsync,readBundleId=bundleIdentifier}={}){
  function isInstalled(id,app){
    if(!exists(app))return false;
    if(id!=='codex')return true;
    try{return readBundleId(app)===codexBundleId;}catch{return false;}
  }
  const installed=(id,target)=>target.apps.find(app=>isInstalled(id,app));
  function status(){
    const supported=platform==='darwin';
    return {supported,targets:[...targets].map(([id,target])=>{
      const app=supported?installed(id,target):null,available=Boolean(app),supportsProject=available&&id==='codex';
      return {id,label:target.label,available,supportsProject,message:!supported?unsupported:available?supportsProject?`可以请求打开 ${target.label} 并定位已连接的项目；仍需说明本次任务。`:`可以请求打开 ${target.label}；项目选择和本次任务需要在目标 AI 中完成。`:`未找到已安装的 ${target.label} 桌面应用，请手动打开目标 AI。`};
    })};
  }
  async function open(target,{directory,beforeDispatch}={}){
    if(typeof target!=='string'||!targets.has(target))throw Error('不支持这个桌面 AI，只能打开 Codex 或 Claude。');
    if(beforeDispatch!==undefined&&typeof beforeDispatch!=='function')throw Error('打开前检查必须是本机检查函数。');
    if(platform!=='darwin')throw Error(unsupported);
    const withProject=directory!==undefined;
    if(withProject&&target!=='codex')throw Error('目前只有 Codex 支持按已连接的项目打开。');
    const root=withProject?checkedRoot(directory):null;
    const definition=targets.get(target),app=installed(target,definition);
    if(!app)throw Error(`未找到已安装的 ${definition.label} 桌面应用，请手动打开目标 AI。`);
    if(target==='codex'){
      try{
        await execute('/usr/bin/codesign',['--verify','--deep','--strict','-R='+codexSigningRequirement,app],executionOptions);
        if(!isInstalled(target,app))throw Error('application changed');
      }catch{
        throw Error('无法核验 Codex 应用身份或官方签名，未打开应用。请检查安装后重试。');
      }
    }
    // Trusted synchronous application check, after asynchronous signature work.
    // Preserve its actionable error instead of replacing it with a launch error.
    if(beforeDispatch)beforeDispatch();
    try{
      const args=['-a',app];
      if(withProject)args.push(codexProjectURL(checkedRoot(root)));
      await execute('/usr/bin/open',args,executionOptions);
    }catch{
      if(withProject)throw Error('未能请求 Codex 打开这个项目。没有改用其他项目，请重试，或手动打开 Codex 并选择已连接的文件夹。');
      throw Error(`无法请求打开 ${definition.label}，请手动打开目标 AI。`);
    }
    return {target,dispatched:true,appOnly:!withProject,projectRequested:withProject,message:withProject?'已请求 Codex 在已连接的项目中打开新任务页面。请说明本次任务；尚未发送消息，也不代表 AI 已读取记忆。':`已请求打开 ${definition.label}；请在目标 AI 中选择项目并说明本次任务。`};
  }
  return {status,open};
}
