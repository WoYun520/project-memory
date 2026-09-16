import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
const key='project-memory';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function createClaudeDesktopConfig({configPath,nodePath,adapterPath,port,dataId}){
 if(![configPath,nodePath,adapterPath].every(path.isAbsolute)||!Number.isInteger(port)||port<1||port>65535||! /^[a-f0-9]{64}$/.test(dataId))throw Error('Claude 桌面连接路径无效。');
 const exists=p=>{try{return fs.statSync(p).isFile();}catch{return false;}};
 function load(){
  try{const st=fs.lstatSync(configPath);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>1_000_000)throw Error();const a=JSON.parse(fs.readFileSync(configPath,'utf8'));if(!a||typeof a!=='object'||Array.isArray(a)||a.mcpServers!==undefined&&(!a.mcpServers||typeof a.mcpServers!=='object'||Array.isArray(a.mcpServers)))throw Error();return a;}
  catch(e){if(e.code==='ENOENT')return {};throw Error('Claude 配置无法安全读取，原设置已保留；请在 Claude 检查连接设置。');}
 }
 function entry(ids){return {command:nodePath,args:[adapterPath],env:{MEMORY_STATION_PORT:String(port),MEMORY_STATION_DATA_ID:dataId,MEMORY_STATION_PROJECTS:JSON.stringify(ids)}};}
 function ids(a){const old=a.mcpServers?.[key];if(!old)return [];
  if(old.command!==nodePath||JSON.stringify(old.args)!==JSON.stringify([adapterPath])||Object.keys(old).some(k=>!['command','args','env'].includes(k))||!old.env||Object.keys(old.env).some(k=>!['MEMORY_STATION_PORT','MEMORY_STATION_DATA_ID','MEMORY_STATION_PROJECTS'].includes(k)))throw Error('已有同名连接使用其他设置，未覆盖。请在 Claude 中核对。');
  let result;try{result=JSON.parse(old.env.MEMORY_STATION_PROJECTS);}catch{}if(!Array.isArray(result)||result.some(id=>!uuid.test(id))||result.length>100)throw Error('原连接的项目范围无效，未改写。');
  if(old.env.MEMORY_STATION_DATA_ID!==dataId||old.env.MEMORY_STATION_PORT!==String(port))throw Error('原连接指向其他资料库或端口，未扩大访问范围。');return [...new Set(result)];
 }
 function write(a){const dir=path.dirname(configPath);fs.mkdirSync(dir,{recursive:true,mode:0o700});if(fs.lstatSync(dir).isSymbolicLink())throw Error('Claude 配置目录不能是符号链接。');const tmp=configPath+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(a,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,configPath);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
 return {
  status(id){if(!uuid.test(id))throw Error('项目编号无效。');const a=load();let projects=[],conflict='';try{projects=ids(a);}catch(e){conflict=e.message;}return {configured:projects.includes(id),ready:exists(nodePath)&&exists(adapterPath),conflict,notice:'配置存在不代表 Claude 已连接；修改后需完全退出再打开 Claude。仅暴露所选项目的保存记忆与待检查提交工具。'};},
  install(id){if(!uuid.test(id))throw Error('项目编号无效。');if(!exists(nodePath)||!exists(adapterPath))throw Error('请先安装最新版记忆站桌面应用。');const a=load(),projects=ids(a);if(!projects.includes(id)){if(projects.length>=100)throw Error("最多连接100个项目，请先断开不用的项目。");projects.push(id);a.mcpServers={...a.mcpServers,[key]:entry(projects)};write(a);}return this.status(id);},
  remove(id){if(!uuid.test(id))throw Error('项目编号无效。');const a=load(),projects=ids(a);if(projects.includes(id)){const remaining=projects.filter(v=>v!==id);if(remaining.length)a.mcpServers[key]=entry(remaining);else delete a.mcpServers[key];write(a);}return this.status(id);}
 };
}
