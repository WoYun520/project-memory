import {requireSafe} from './privacy.js';
import {parseWorklogText} from './worklog.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const transientCodes=new Set(['ECONNREFUSED','ECONNRESET','EPIPE','ETIMEDOUT','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']);
function transient(error){
 const codes=new Set();let timeout=false;
 function visit(e,depth=0){if(!e||depth>5)return;codes.add(e.code);if(e.name==='TimeoutError')timeout=true;visit(e.cause,depth+1);if(Array.isArray(e.errors))e.errors.forEach(x=>visit(x,depth+1));}
 visit(error);
 // Permission failures always win, even inside an AggregateError.
 if(codes.has('EACCES')||codes.has('EPERM'))return false;
 return timeout||[...codes].some(code=>transientCodes.has(code));
}
function contains(original,received){
 if(original===null||typeof original!=='object')return original===received;
 if(!received||typeof received!=='object')return false;
 if(Array.isArray(original))return Array.isArray(received)&&original.length===received.length&&original.every((v,i)=>contains(v,received[i]));
 return !Array.isArray(received)&&Object.keys(original).every(k=>Object.hasOwn(received,k)&&contains(original[k],received[k]));
}
function confirm(result,worklog){
 if(result?.alreadyImported===true)return;
 if(!UUID.test(result?.id||'')||!contains(worklog,result?.worklog))throw Error('记忆站没有确认对应草稿，不能声称已送达；请先查看待检查区，不要另建批次。');
}

// Retry only this explicit, privacy-checked batch in memory. No transcript reads,
// disk outbox, background process, formal-save request, or new batch IDs.
export async function deliverWorklog({port,worklog,channel='work-stage'},
 {fetchImpl=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onRetry=()=>{}}={}){
 const frozen=parseWorklogText(JSON.stringify(worklog));
 if(!UUID.test(frozen?.project_id||'')||typeof frozen.session?.id!=='string'||!frozen.session.id.trim()||!Array.isArray(frozen.entries)||!frozen.entries.length)throw Error('草稿缺少有效项目、批次或工作记录，未发送。');
 if(!Number.isInteger(port)||port<1||port>65535||!['work-stage','codex/submit','claude/submit'].includes(channel))throw Error('本机提交配置无效。');
 const body=JSON.stringify(channel==='work-stage'?{worklog:frozen,sourceReviewed:true}:{worklog:frozen});
 requireSafe(body);
 const url=`http://127.0.0.1:${port}/api/projects/${frozen.project_id}/${channel}`;
 for(let attempt=1;attempt<=3;attempt++){
  let response,result;
  try{
   response=await fetchImpl(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','X-Memory-Station':'1'},body,signal:AbortSignal.timeout(10000)});
   result=await response.json();
  }catch(error){
   if(!transient(error)||attempt===3)throw error;
   await onRetry(`记忆站连接暂时中断，正在重试同一批记录（${attempt+1}/3）；尚未确认送达。\n`);
   await sleep(attempt*1000);continue;
  }
  if(!response.ok){
   let message=typeof result?.error==='string'?result.error:'记忆站拒绝了这批记录；未自动重试，请先查看新记录。';
   try{requireSafe(message);}catch{message='记忆站返回的说明含疑似隐私，未展示；请检查本机记录。';}
   throw Error(message);
  }
  requireSafe(result);confirm(result,frozen);
  return result;
 }
}

export const deliveryGuide='完成本轮获准的实际工作后，在最终回复前主动提交一次脱敏草稿，无需等用户另发收尾提醒；只读、不回写、无新结果或本轮已送达时不提交。提交工具遇到短暂断连会自动用同一编号和内容重试，最多3次；工具最终失败后不要反复调用或重造批次。只按工具回执说明已送达、已处理或尚未确认，不把提交当作保存或验收。';
