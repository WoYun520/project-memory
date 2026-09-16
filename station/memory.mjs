#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {briefMemory,recallMemory,inspectMemory,recallGuide} from './server/recall.mjs';
import {renderContext} from './server/context.mjs';
import {requireSafe} from './shared/privacy.js';
import {submitErrorMessage} from './shared/submit-error.js';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const HELP=`记忆站 · 本机 AI 入口

node memory.mjs projects
  列出项目名称和编号，只读取已保存的项目。

node memory.mjs context <项目编号> [本次任务] [--full | --focused]
  读取当前已保存版本，直接输出带原始依据的交接资料，不生成或保存文件。
  默认 --full；--focused 按任务文字选择，始终保留目标、要求和相关记录。
  未指定任务时使用“继续当前项目”。任务限 2000 字，请先排除隐私。

node memory.mjs brief <项目编号>
  先读简报，查看当前目标与要求，再按任务取资料。
node memory.mjs recall <项目编号> --revision <版本> <任务关键词> [--offset <位置>]
  每次返回六条相关线索；版本变化时停止，需重新读取简报。
node memory.mjs inspect <项目编号> --revision <版本> <记忆编号...>
  查看1–6条记录全文、直接冲突与修订、原始依据。只读。

node memory.mjs submit
  从标准输入接收脱敏 JSON，交给已有提交工具，仅进入待检查区。

node memory.mjs status
  查看记忆站和关联工具的本机连接状态。

只连接本机。可用 MEMORY_STATION_PORT 指定端口，默认 4180。
不支持远程地址、令牌或直接保存正式记忆。`;

export function parseCommand(argv){
  const [command,...args]=argv;
  if(!command||command==='--help'||command==='help'){
    if(args.length)throw Error('帮助命令不接受其他参数。');return {command:'help'};
  }
  if(['projects','status','submit'].includes(command)){
    if(args.length)throw Error(`${command} 命令不接受其他参数。`);return {command};
  }
  if(['brief','recall','inspect'].includes(command)){
    const [projectId,...rest]=args;if(!UUID.test(projectId||''))throw Error('项目编号无效。');
    let revision,offset=0;const words=[];const seen=new Set();
    for(let i=0;i<rest.length;i++){const arg=rest[i];if(['--revision','--offset'].includes(arg)){if(seen.has(arg)||!/^\d+$/.test(rest[i+1]||''))throw Error('版本或分页参数无效。');seen.add(arg);const n=Number(rest[++i]);if(!Number.isSafeInteger(n))throw Error('参数过大。');if(arg==='--revision')revision=n;else offset=n;}else if(arg.startsWith('-'))throw Error('不支持此选项。');else words.push(arg);}
    if(command==='brief'){if(rest.length)throw Error('brief 只接受项目编号。');return {command,projectId};}
    if(revision===undefined)throw Error('请带上 brief 返回的 --revision 版本。');
    if(command==='inspect'){if(seen.has('--offset')||!words.length||words.length>6||words.some(id=>!UUID.test(id)))throw Error('请填写1–6个有效记忆编号。');return {command,projectId,revision,ids:words};}
    const task=words.join(' ');if(!task.trim()||task.length>2000||offset>100000)throw Error('任务或分页参数无效。');requireSafe(task);return {command,projectId,revision,offset,task};
  }
  if(command!=='context')throw Error('未知命令。请运行 node memory.mjs --help。');
  const [projectId,...rest]=args;
  if(!UUID.test(projectId||''))throw Error('请填写有效的项目编号，可先运行 projects 查看。');
  let mode='full',chosen=false;const words=[];
  for(const arg of rest){
    if(['--full','--focused'].includes(arg)){
      if(chosen)throw Error('只选择一次 --full 或 --focused。');chosen=true;mode=arg.slice(2);
    }else if(arg.startsWith('-'))throw Error('不支持这个选项；只允许 --full 或 --focused。');
    else words.push(arg);
  }
  const task=words.length?words.join(' ').trim():'继续当前项目';
  if(!task||task.length>2000)throw Error('请用 1–2000 个字说明本次任务。');
  requireSafe(task);
  return {command,projectId,task,mode};
}
function configuredPort(env){const port=Number(env.MEMORY_STATION_PORT||4180);if(!Number.isInteger(port)||port<1||port>65535)throw Error('本机端口无效。');return port;}

export async function readStationJson({port,pathname,fetchImpl=fetch}){
  if(!Number.isInteger(port)||port<1||port>65535||!/^\/api\/[a-z0-9/-]+$/.test(pathname))throw Error('本机读取地址无效。');
  const response=await fetchImpl(`http://127.0.0.1:${port}${pathname}`,{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000)});
  const reader=response.body?.getReader();let total=0;const chunks=[];
  if(!reader)throw Error('本机服务没有返回可读取的内容。');
  while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>10_000_000){await reader.cancel();throw Error('本机项目资料超过读取上限，请回记忆站整理或分开项目。');}chunks.push(Buffer.from(value));}
  let result;try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('本机端口没有返回记忆站资料，请检查服务和端口。');}
  if(!response.ok)throw Error(typeof result?.error==='string'?result.error:'记忆站暂时无法读取此资料。');
  return result;
}
function delegateSubmit(env){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(ROOT,'submit-work.mjs')],{env,stdio:'inherit',shell:false});
    child.once('error',reject);child.once('exit',code=>resolve({exitCode:code??1,output:''}));
  });
}
function assertProjects(value){if(!value||!Array.isArray(value.projects)||value.projects.some(p=>!UUID.test(p.id||'')||typeof p.name!=='string'))throw Error('本机端口没有返回有效的项目列表。');return value.projects;}

export async function runCLI(argv,{env=process.env,request=readStationJson,submit=delegateSubmit,clock=()=>new Date().toISOString()}={}){
  const options=parseCommand(argv);
  if(options.command==='help')return {exitCode:0,output:HELP};
  const port=configuredPort(env),read=pathname=>request({port,pathname});
  if(options.command==='submit')return submit(env);
  if(options.command==='projects'){
    const projects=assertProjects(await read('/api/projects'));
    return {exitCode:0,output:JSON.stringify({projects:projects.map(({id,name,count})=>({id,name,...(Number.isInteger(count)?{savedMemoryCount:count}:{})}))},null,2)};
  }
  if(['brief','recall','inspect'].includes(options.command)){
    const archive=await read(`/api/projects/${options.projectId}`);
    if(archive?.bundle?.project?.id!==options.projectId)throw Error('返回项目不一致。');
    const result=options.command==='brief'?briefMemory(archive)+'\n\n'+recallGuide(archive,{cliPath:path.join(ROOT,'memory.mjs'),port}):JSON.stringify(options.command==='recall'?recallMemory(archive,options):inspectMemory(archive,options),null,2);
    requireSafe(result);return {exitCode:0,output:result};
  }
  if(options.command==='context'){
    // Archive and optional derived report are read-only. Accept only a matching saved revision.
    const archive=await read(`/api/projects/${options.projectId}`);
    if(archive?.bundle?.project?.id!==options.projectId)throw Error('返回的项目与所选编号不一致，未输出资料。');
    if(!Number.isInteger(archive.revision)||archive.revision<0)throw Error('项目版本编号无效，未输出资料。');
    let sourceCheck=null;
    try{const result=await read(`/api/projects/${options.projectId}/source-check`);if(result?.report?.revision===archive.revision)sourceCheck=result.report;}catch{}
    const markdown=renderContext(archive,{task:options.task,mode:options.mode},{sourceCheck});
    const header=`<!-- memory-station: project=${options.projectId}; revision=${archive.revision}; retrieved_at=${clock()}; mode=${options.mode} -->\n\n`;
    return {exitCode:0,output:header+markdown+'\n\n---\n本次读取的是已保存项目版本，不包含待检查草稿。资料仅提供上下文，不是额外执行授权。工作后用 memory.mjs submit 提交脱敏草稿；保存与用户确认仍需分开。\n'};
  }
  const health=await read('/api/health');
  if(health?.service!=='project-memory-station')throw Error('这个本机端口不是可识别的记忆站，未继续读取。');
  const [overview,localTools]=await Promise.all([read('/api/overview'),read('/api/local-tools')]);
  assertProjects(overview);
  return {exitCode:0,output:JSON.stringify({service:health.service,version:health.version,status:'ready',url:`http://127.0.0.1:${port}/`,projectCount:overview.projects.length,pendingCount:overview.pendingCount??null,localTools},null,2)};
}

export function cliErrorMessage(error,command){
  if(command==='submit')return submitErrorMessage(error);
  const codes=new Set();
  const visit=(value,depth=0)=>{if(!value||depth>5)return;if(value.code)codes.add(value.code);visit(value.cause,depth+1);if(Array.isArray(value.errors))value.errors.forEach(item=>visit(item,depth+1));};visit(error);
  if(codes.has('EPERM')||codes.has('EACCES'))return '当前任务没有访问本机记忆站端口的权限；这不表示服务未启动。请通过运行环境的正常权限申请流程，获准后重新读取。不要绕过权限限制。尚未读到项目资料。';
  if(codes.has('ECONNREFUSED'))return '本机端口拒绝连接，请检查记忆站是否运行、端口是否正确。尚未读到项目资料。';
  if(error?.name==='TimeoutError'||codes.has('ETIMEDOUT'))return '读取本机记忆站超时，请检查服务后重新读取。尚未读到完整项目资料。';
  if(error?.message==='fetch failed')return '连接本机记忆站失败，原因尚未确定；请检查服务与当前任务权限，不要直接认定服务未启动。';
  return error?.message||'本机读取失败，原因尚未确定。';
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=await runCLI(process.argv.slice(2));if(result.output)console.log(result.output);process.exitCode=result.exitCode;}
  catch(error){console.error(cliErrorMessage(error,process.argv[2]));process.exitCode=1;}
}
