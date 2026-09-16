#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const HELP=`记忆站 · 报告当前项目位置

node connect-project.mjs <请求编号> [--directory <完整项目根目录>]

先确定本任务实际使用的项目根目录，再报告位置；不要猜测。
省略 --directory 时使用当前目录，只有确认当前目录就是项目根目录时才使用。
只向本机记忆站报告文件夹位置，不读取项目正文或聊天，不写项目文件。
位置送达后等待用户在记忆站选择确认，不自动建立连接或安装接续指引。
可用 MEMORY_STATION_PORT 指定本机端口，默认 4180。不接受远程地址。`;

export function parseConnectCommand(args,{cwd=process.cwd()}={}){
 if(args.length===1&&['--help','help'].includes(args[0]))return {help:true};
 if(args.length!==1&&args.length!==3)throw Error('请填写请求编号，并按需使用 --directory 指定完整项目根目录；可先查看 --help。');
 const [id,flag,selected]=args;
 if(!uuid.test(id||''))throw Error('项目位置请求编号无效，请从记忆站重新复制接入说明。');
 if(args.length===3&&flag!=='--directory')throw Error('这里只支持 --directory，不接收项目内容或其他参数。');
 const directory=args.length===3?selected:cwd;
 if(typeof directory!=='string'||!directory||directory.length>4096||directory.includes('\0')||!path.isAbsolute(directory))throw Error('请指定完整的本机项目根目录。');
 return {id,directory};
}

async function responseJson(response){
 let value;try{value=await response.json();}catch{throw Error('本机端口没有返回有效的记忆站响应，项目位置尚未确认送达。');}
 if(!response.ok)throw Error(typeof value?.error==='string'?value.error:'记忆站未接收项目位置。');return value;
}

export async function runConnectCLI(args,{env=process.env,cwd=process.cwd(),fetchImpl=fetch}={}){
 const command=parseConnectCommand(args,{cwd});if(command.help)return {exitCode:0,output:HELP};
 const port=Number(env.MEMORY_STATION_PORT||4180);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('本机端口无效，未发送项目位置。');
 const base=`http://127.0.0.1:${port}`;
 const health=await responseJson(await fetchImpl(base+'/api/health',{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000)}));
 if(health?.service!=='project-memory-station')throw Error('这个本机端口不是可识别的记忆站，未发送项目位置。');
 const result=await responseJson(await fetchImpl(`${base}/api/folder-requests/${command.id}/propose`,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','X-Memory-Station':'1'},body:JSON.stringify({directory:command.directory}),signal:AbortSignal.timeout(10000)}));
 if(result?.id!==command.id||typeof result.candidate?.directory!=='string'||typeof result.candidate?.name!=='string')throw Error('未收到有效的位置回执，不能确认送达；请回记忆站查看。');
 return {exitCode:0,output:'项目位置已送到记忆站，等待用户选择确认。尚未建立连接、修改项目文件或写入正式记忆。'};
}

export function connectErrorMessage(error){
 const codes=new Set();function collect(value,depth=0){if(!value||depth>5)return;if(value.code)codes.add(value.code);collect(value.cause,depth+1);if(Array.isArray(value.errors))value.errors.forEach(item=>collect(item,depth+1));}collect(error);
 if(codes.has('EPERM')||codes.has('EACCES'))return '当前任务没有访问本机端口的权限，尚未确认送达；请通过正常权限流程处理，这不表示记忆站未启动。';
 if(codes.has('ECONNREFUSED'))return '本机端口拒绝连接，尚未送达项目位置；请检查记忆站是否运行、端口是否正确。';
 if(error?.name==='TimeoutError'||codes.has('ETIMEDOUT'))return '连接记忆站超时，尚未确认送达；请回记忆站查看，必要时重试同一请求。';
 if(error?.message==='fetch failed')return '连接本机记忆站失败，原因尚未确定；尚未确认送达，请检查服务和当前任务权限。';
 return error?.message||'项目位置尚未确认送达，请回记忆站查看。';
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const result=await runConnectCLI(process.argv.slice(2));console.log(result.output);process.exitCode=result.exitCode;}
 catch(error){console.error(connectErrorMessage(error));process.exitCode=1;}
}
