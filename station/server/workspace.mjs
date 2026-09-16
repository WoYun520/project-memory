import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {privacyIssues,requireSafe} from '../shared/privacy.js';
import {WORKLOG_LIMIT} from '../shared/worklog.js';

export const WORKSPACE_LIMITS=Object.freeze({candidates:80,directoryEntries:400,fileBytes:65536,selectedFiles:8,excerptCharacters:4000});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const blocked=/^(?:node_modules|data|dist|build|target|vendor|coverage|tmp|temp|secrets?|credentials?|private|sessions?|logs?|backups?)$/i;
const privateName=/(?:password|passwd|credential|secret|private|(?:^|[._-])(?:sensitive|sessions?|tokens?)(?:[._-]|$)|\.env(?:\.|$)|id_rsa|id_ed25519)/i;
const digest=value=>createHash('sha256').update(value).digest('hex');
const localError=()=>Error('无法读取这个本机文件夹。请检查路径和读取权限。');
const validProject=id=>{if(typeof id!=='string'||!uuid.test(id))throw Error('项目编号无效。');return id;};
const contained=(root,target)=>{const relative=path.relative(root,target);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
const safeName=name=>name&&!name.startsWith('.')&&!blocked.test(name)&&!privateName.test(name)&&!privacyIssues(name).length;
const excludedRoot=()=>Object.assign(Error('不能连接隐藏目录、敏感目录或快捷链接下的项目。请选择普通项目文件夹的真实位置。'),{code:'WORKSPACE_ROOT_EXCLUDED'});
const platformDirectories=new Set(process.platform==='darwin'?['/private','/tmp','/private/tmp','/var','/private/var']:['/tmp','/var','/var/tmp']);
function checkAncestors(directory){
 let current=path.parse(directory).root;
 for(const part of directory.slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);
  if(!platformDirectories.has(current)&&!safeName(part))throw excludedRoot();
  const stat=fs.lstatSync(current);
  if(stat.isSymbolicLink()){
   const platformAlias=process.platform==='darwin'&&((current==='/tmp'&&fs.realpathSync(current)==='/private/tmp')||(current==='/var'&&fs.realpathSync(current)==='/private/var'));
   if(!platformAlias)throw excludedRoot();
  }else if(!stat.isDirectory())throw localError();
 }
}

export function checkedRoot(directory){
 if(typeof directory!=='string'||directory.length>4096||!path.isAbsolute(directory)||directory.includes('\0'))throw Error('请输入完整的本机项目文件夹路径。');
 try{
  if(directory.split(path.sep).includes('..'))throw excludedRoot();
  const normalized=path.resolve(directory);
  checkAncestors(normalized);
  const root=fs.realpathSync(normalized);
  // Check both spellings; macOS /tmp and /var are the only accepted system aliases.
  checkAncestors(root);
  if(!fs.statSync(root).isDirectory()||root===path.parse(root).root)throw localError();
  return root;
 }catch(e){if(e.code==='WORKSPACE_ROOT_EXCLUDED')throw e;throw localError();}
}

export function documentPath(relative){
 if(typeof relative!=='string'||relative.length>240||relative.includes('\\')||relative.includes('\0')||path.isAbsolute(relative))return false;
 const parts=relative.split('/');
 if(parts.some(p=>p==='.'||p==='..'||!safeName(p)))return false;
 if(parts.length===1)return /^(?:readme(?:[._-].*)?|architecture|decisions|roadmap|contributing|changelog)\.md$/i.test(relative)||relative==='package.json';
 return parts[0]==='docs'&&parts.length<=3&&/\.md$/i.test(parts.at(-1));
}

function checkedFile(root,relative){
 if(!documentPath(relative))throw Error('只能选择列表中的项目说明文件。');
 let current=root;
 for(const part of relative.split('/')){
  current=path.join(current,part);
  const stat=fs.lstatSync(current);
  if(stat.isSymbolicLink())throw Error('不读取快捷链接指向的文件。');
 }
 const resolved=fs.realpathSync(current),stat=fs.lstatSync(resolved);
 if(!contained(root,resolved)||!stat.isFile())throw Error('文件已移出所连接的项目文件夹。');
 if(stat.size>WORKSPACE_LIMITS.fileBytes)throw Error('所选文件超过 64 KB，请拆成较小的说明文件。');
 return {resolved,stat};
}

// Lists names and sizes only. Explicit preview/source-check actions may read selected safe documents.
function candidates(root){
 const result=[];let inspected=0,limited=false;
 function scan(relative='',depth=0){
  let names;
  try{names=fs.readdirSync(path.join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));}
  catch{if(!relative)throw localError();return;}
  for(const item of names){
   if(++inspected>WORKSPACE_LIMITS.directoryEntries||result.length>=WORKSPACE_LIMITS.candidates){limited=true;return;}
   if(!safeName(item.name)||item.isSymbolicLink())continue;
   const name=relative?relative+'/'+item.name:item.name;
   if(item.isDirectory()){
    if((depth===0&&item.name==='docs')||(depth===1&&relative==='docs'))scan(name,depth+1);
    continue;
   }
   if(!item.isFile()||!documentPath(name))continue;
   try{const {stat}=checkedFile(root,name);result.push({path:name,bytes:stat.size,modifiedAt:stat.mtime.toISOString()});}catch{}
  }
 }
 scan();
 return {candidates:result.sort((a,b)=>(a.path.toLowerCase()==='readme.md'?-1:b.path.toLowerCase()==='readme.md'?1:a.path.localeCompare(b.path))),limited};
}

export function readSelected(root,relative){
 const {resolved,stat}=checkedFile(root,relative);let fd;
 try{
  fd=fs.openSync(resolved,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  const opened=fs.fstatSync(fd);
  if(!opened.isFile()||opened.size>WORKSPACE_LIMITS.fileBytes||opened.dev!==stat.dev||opened.ino!==stat.ino)throw Error('文件在读取前发生变化，请重新预览。');
  const buffer=Buffer.alloc(WORKSPACE_LIMITS.fileBytes+1);let size=0,read=0;
  do{read=fs.readSync(fd,buffer,size,buffer.length-size,null);size+=read;}while(read&&size<buffer.length);
  if(size>WORKSPACE_LIMITS.fileBytes)throw Error('所选文件超过 64 KB，请拆成较小的说明文件。');
  const bytes=buffer.subarray(0,size),text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  if(text.includes('\0'))throw Error('所选文件不是可读取的文字说明。');
  // Inspect the full selected file, including the portion not shown in the excerpt.
  if(privacyIssues(text).length)throw Error('所选材料含疑似凭据或隐私，整批未预览、未保存。请先在本机准备不含隐私的说明副本。');
  if(!text.trim())throw Error('所选说明文件为空，请选择有内容的文件。');
  let excerpt=text.slice(0,WORKSPACE_LIMITS.excerptCharacters);
  if(/[\uD800-\uDBFF]$/.test(excerpt))excerpt=excerpt.slice(0,-1);
  if(!excerpt.trim())throw Error('文件开头没有可用文字，请先整理说明文件。');
  if(fs.realpathSync(root)!==root||fs.realpathSync(path.join(root,relative))!==resolved)throw Error('文件位置在读取时发生变化，请重新连接后预览。');
  const finalStat=fs.statSync(path.join(root,relative));
  if(finalStat.dev!==opened.dev||finalStat.ino!==opened.ino||finalStat.size!==opened.size||finalStat.mtimeMs!==opened.mtimeMs||finalStat.ctimeMs!==opened.ctimeMs)throw Error('文件在读取时发生变化，请重新预览。');
  return {path:relative,sha256:digest(bytes),excerpt,truncated:excerpt.length<text.length,bytes:size};
 }finally{if(fd!==undefined)fs.closeSync(fd);}
}

// Only the directory binding is persisted here. It is deliberately outside project.json and evidence.
export function createWorkspaceConnector({directory}={}){
 if(!directory||!path.isAbsolute(directory))throw Error('需要本机连接设置目录。');
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 if(fs.lstatSync(directory).isSymbolicLink()||!fs.statSync(directory).isDirectory())throw Error('本机连接设置目录无效。');
 const setting=id=>path.join(directory,validProject(id)+'.json');
 function storedBinding(projectId){
  const file=setting(projectId);let value;
  try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>10000)throw Error('invalid');value=JSON.parse(fs.readFileSync(file,'utf8'));}
  catch(e){if(e.code==='ENOENT')return null;throw Error('本机连接设置无法读取，原设置已保留。');}
  if(value?.projectId!==projectId||typeof value.directory!=='string'||!Number.isFinite(Date.parse(value.connectedAt)))throw Error('本机连接设置格式无效，原设置已保留。');
  return value;
 }
 function binding(projectId){
  const value=storedBinding(projectId);if(!value)return null;
  const root=checkedRoot(value.directory);
  if(root!==value.directory)throw Error('连接的文件夹位置已变化，请重新连接。');
  return {projectId,directory:root,folderName:path.basename(root),connectedAt:value.connectedAt};
 }
 function get(projectId){const value=binding(projectId);return {binding:value,...(value?candidates(value.directory):{candidates:[],limited:false}),limits:WORKSPACE_LIMITS};}
 return {
  get,
  getBinding:binding,
  getStoredBinding:storedBinding,
  bind(projectId,selectedDirectory){
   const file=setting(projectId),root=checkedRoot(selectedDirectory);
   const previous=storedBinding(projectId);
   if(previous?.directory===root)return {binding:{...previous,folderName:path.basename(root)},...candidates(root),limits:WORKSPACE_LIMITS};
   // Compare only stored connection metadata. A location owned by another
   // project must not silently redirect this project's future AI work.
   for(const entry of fs.readdirSync(directory)){
    if(!entry.endsWith('.json'))continue;const otherId=entry.slice(0,-5);
    if(!uuid.test(otherId)||otherId===projectId)continue;
    const other=storedBinding(otherId);
    if(other?.directory===root)throw Object.assign(Error('这个文件夹已连接到另一个项目。请打开已有项目继续使用，或选择当前项目自己的文件夹；原有连接未更改。'),{statusCode:409,code:'WORKSPACE_ALREADY_BOUND',existingProjectId:otherId});
   }
   // Confirm a readable listing before replacing an existing binding.
   const list=candidates(root);
   const value={projectId,directory:root,connectedAt:new Date().toISOString()},tmp=file+'.'+randomUUID()+'.tmp';let fd;
   try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,file);}
   catch{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch{}throw Error('本机连接设置未能保存，请检查文件夹权限。');}
   return {binding:{...value,folderName:path.basename(root)},...list,limits:WORKSPACE_LIMITS};
  },
  unbind(projectId){try{fs.unlinkSync(setting(projectId));}catch(e){if(e.code!=='ENOENT')throw Error('无法移除本机连接设置。');}return {binding:null,candidates:[],limited:false,limits:WORKSPACE_LIMITS};},
  preview(projectId,paths){
   const value=binding(projectId);
   if(!value)throw Error('请先连接这个项目的本机文件夹。');
   if(!Array.isArray(paths)||!paths.length||paths.length>WORKSPACE_LIMITS.selectedFiles||new Set(paths).size!==paths.length)throw Error('请选 1 至 8 份不重复的说明文件。');
   const allowed=new Set(candidates(value.directory).candidates.map(c=>c.path));
   if(paths.some(name=>typeof name!=='string'||!allowed.has(name)))throw Error('所选文件不在当前列表中，请刷新后重选。');
   let files;
   try{files=paths.slice().sort().map(relative=>readSelected(value.directory,relative));}
   catch(e){if(e instanceof TypeError)throw Error('所选文件不是有效的 UTF-8 文字说明。');if(e.code)throw Error('所选文件已变化或无法读取，请刷新后重选。');throw e;}
   const sessionId='workspace-'+digest(JSON.stringify(files.map(f=>({path:f.path,sha256:f.sha256})))).slice(0,40);
   const worklog={format:'project-memory-worklog',version:'0.1',project_id:projectId,session:{id:sessionId,agent:'记忆站本机文件读取器',actor:{kind:'tool',id:'记忆站本机文件读取器'}},entries:files.map(f=>({
    id:'file-'+digest(f.path).slice(0,32),kind:'fact',title:('文档摘录：'+f.path).slice(0,160),origin:'observation',
    detail:`本机读取文件 ${f.path}。${f.truncated?'以下仅为开头片段，不代表完整文件。':'以下为所选文件原文。'}文档内容尚未独立核验，连接文件夹不表示用户确认其中的计划或结果。\n\n${f.excerpt}`,
    source:{speaker:{kind:'tool',id:'记忆站本机文件读取器'},text:f.excerpt,redacted:f.truncated,file:{path:f.path,content_sha256:f.sha256,selector:f.truncated?`原文开头 ${Array.from(f.excerpt).length} 个字符`:'完整文件'}}
   }))};
   requireSafe(worklog);
   if(Buffer.byteLength(JSON.stringify(worklog))>WORKLOG_LIMIT)throw Error('本批说明过大，请减少选中文件。');
   return {binding:value,files,worklog};
  }
 };
}
