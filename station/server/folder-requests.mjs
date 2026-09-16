import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {checkedRoot} from './workspace.mjs';

export const FOLDER_REQUEST_LIMITS=Object.freeze({ttlMs:30*60*1000,maxRequests:64});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const failure=(message,statusCode=400)=>Object.assign(Error(message),{statusCode});
function fields(input,allowed){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!allowed.includes(key)))throw failure('项目位置请求包含不支持的内容；这里只接收文件夹位置。');
}

// Temporary location suggestions live only in this process. No archive, evidence,
// workspace binding, project instruction or draft is written by this module.
export function createFolderRequests({stationRoot,port,workspace,loadArchive,listProjectIds,now=Date.now,makeId=randomUUID,checkDirectory=checkedRoot}){
 if(!path.isAbsolute(stationRoot||'')||!Number.isInteger(port)||port<1||port>65535||typeof workspace?.getBinding!=='function'||typeof loadArchive!=='function'||typeof listProjectIds!=='function')throw Error('项目位置接入配置无效。');
 const requests=new Map();
 function prune(){const time=now();for(const [id,value]of requests)if(value.expiresAtMs<=time){clearTimeout(value.expiryTimer);requests.delete(id);}}
 function prompt(id){
  return `请帮我把当前项目的位置送到本机记忆站，等待我在记忆站选择确认。先确定本任务实际使用的项目根目录；不要猜测，不要把无关的当前目录当作项目。不能确定时请直接说明，暂不提交。\n\n确认实际目录后，将下面的占位路径替换成项目根目录，并进行安全的 shell 引用，再执行：\nMEMORY_STATION_PORT=${port} node ${quote(path.join(stationRoot,'connect-project.mjs'))} ${quote(id)} --directory ${quote('<本任务实际项目根目录>')}\n\n这里只报告项目文件夹的位置。不要读取或发送项目正文、其他 AI 聊天、登录配置、密码或密钥；不提交工作草稿，不建立或改变项目连接，不安装接续指引，不继续开发。工具默认可使用当前目录，但只有已确认它就是实际项目根目录时才可省略 --directory。报告成功只代表位置已送达，仍等我在记忆站选择确认。该请求将在 30 分钟后失效。`;
 }
 function getRequest(id){
  prune();
  if(typeof id!=='string'||!uuid.test(id))throw failure('项目位置请求编号无效。');
  const value=requests.get(id);
  if(!value)throw failure('这次项目位置请求已过期或已失效，请回记忆站重新发起。',410);
  return value;
 }
 function publicValue(value){return {id:value.id,projectId:value.projectId,prompt:prompt(value.id),expiresAt:new Date(value.expiresAtMs).toISOString(),candidate:value.candidate?{...value.candidate}:null};}
 return {
  create(input={}){
   fields(input,['projectId']);prune();
   const projectId=input.projectId??null;
   if(Object.hasOwn(input,'projectId')){
    if(typeof projectId!=='string'||!uuid.test(projectId))throw failure('项目编号无效。');
    loadArchive(projectId);
   }
   if(requests.size>=FOLDER_REQUEST_LIMITS.maxRequests)throw failure('同时等待的位置请求太多，请稍后再试；旧请求会在 30 分钟后失效。',429);
   const id=makeId();if(!uuid.test(id)||requests.has(id))throw failure('未能创建新的项目位置请求，请重试。');
   const value={id,projectId,expiresAtMs:now()+FOLDER_REQUEST_LIMITS.ttlMs,candidate:null};
   value.expiryTimer=setTimeout(()=>{if(requests.get(id)===value)requests.delete(id);},FOLDER_REQUEST_LIMITS.ttlMs);value.expiryTimer.unref?.();
   requests.set(id,value);return publicValue(value);
  },
  get(id){return publicValue(getRequest(id));},
  propose(id,input){
   const value=getRequest(id);fields(input,['directory']);
   const directory=checkDirectory(input.directory);
   if(value.candidate){
    if(value.candidate.directory!==directory)throw failure('这次请求已有一个项目位置，未覆盖；请回记忆站重新发起。',409);
    return publicValue(value);
   }
   let existingProject;
   for(const projectId of listProjectIds()){
    let binding;try{binding=workspace.getBinding(projectId);}catch{continue;}
    if(binding?.directory===directory){
     // Only load an archive after its connection metadata matches this directory.
     const archive=loadArchive(projectId);existingProject={id:projectId,name:archive.bundle.project.name};break;
    }
   }
   value.candidate={directory,name:path.basename(directory),...(existingProject?{existingProjectId:existingProject.id,existingProjectName:existingProject.name}:{})};
   return publicValue(value);
  }
 };
}
