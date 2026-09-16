#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readStationJson,cliErrorMessage} from './memory.mjs';
import {requireSafe} from './shared/privacy.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const stdout=value=>new Promise((resolve,reject)=>process.stdout.write(value,error=>error?reject(error):resolve()));

// No files are written by this CLI. A receipt follows successful complete output only.
export async function runBridge(argv,{env=process.env,read=readStationJson,fetchImpl=fetch,write=stdout}={}){
 if(argv.length!==3||argv[0]!=='read'||!UUID.test(argv[1]||'')||!UUID.test(argv[2]||''))throw Error('请使用记忆站生成的完整交接命令：node bridge.mjs read <项目编号> <交接编号>。');
 const [,projectId,ticketId]=argv,port=Number(env.MEMORY_STATION_PORT||4180);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('本机端口无效。');
 const base=`/api/projects/${projectId}/bridge/${ticketId}`;
 const value=await read({port,pathname:base+'/context',fetchImpl});
 if(value?.projectId!==projectId||value?.ticketId!==ticketId||!['codex','claude','grok','other'].includes(value?.target)||!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.context!=='string'||!value.context.trim())throw Error('交接返回的项目、编号或版本不一致，未输出资料。');
 requireSafe(value.context);await write(value.context+'\n');
 try{
  const response=await fetchImpl(`http://127.0.0.1:${port}${base}/receipt`,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','X-Memory-Station':'1'},body:JSON.stringify({revision:value.revision,...(value.task?{taskReceived:true}:{})}),signal:AbortSignal.timeout(10000)});
  const result=await response.json();if(!response.ok||result?.recorded!==true||result?.ticket?.id!==ticketId||result?.ticket?.projectId!==projectId||result?.ticket?.receipt?.revision!==value.revision)throw Error('读取回执未被确认。');
  await write('\n本次工具读取回执已送达；不代表模型已理解或用户验收。\n');
  return {exitCode:0,receiptRecorded:true,revision:value.revision};
 }catch{
  await write('\n资料已输出，但本次读取回执未能确认；页面可能仍显示等待读取。不要据此声称已完成交接核验。如版本或待检查记录有变化，请回记忆站重新交接。\n');
  return {exitCode:0,receiptRecorded:false,revision:value.revision};
 }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const result=await runBridge(process.argv.slice(2));process.exitCode=result.exitCode;}
 catch(error){console.error(cliErrorMessage(error,'read'));process.exitCode=1;}
}
