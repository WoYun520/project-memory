import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {requireSafe} from './shared/privacy.js';
import {deliveryGuide} from './shared/submit-delivery.js';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";

// Stop is only a bounded reminder to the current agent. It never reads a
// transcript, stores hook input, extracts claims, or submits/approves a draft.
export async function runWrap(config,{input,read,write,writeError,realpath=fs.realpath,stat=fs.stat}){
 let output={},reason='unavailable';
 try{
  const chunks=[];let size=0;
  for await(const chunk of input){const b=Buffer.from(chunk);size+=b.length;if(size>131072)throw Error('event too large');chunks.push(b);}
  const event=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  if(!event||event.hook_event_name!=='Stop'||!uuid.test(event.session_id||'')||typeof event.stop_hook_active!=='boolean')throw Error('invalid event');
  if(event.stop_hook_active)reason='already-reminded';
  else if((Array.isArray(event.background_tasks)&&event.background_tasks.length)||(Array.isArray(event.session_crons)&&event.session_crons.length))reason='background-work';
  else{
   if(!uuid.test(config?.projectId||'')||!Number.isInteger(config.port)||config.port<1||config.port>65535||typeof config.directory!=='string'||!path.isAbsolute(config.directory)||typeof event.cwd!=='string'||!path.isAbsolute(event.cwd))throw Error('invalid connection');
   const [expected,actual]=await Promise.all([realpath(config.directory),realpath(event.cwd)]);
   if(expected!==actual||!(await stat(expected)).isDirectory())throw Error('wrong project');
   const status=await read({port:config.port,pathname:`/api/projects/${config.projectId}/claude`});
   if(status?.projectId!==config.projectId||status.configured!==true||status.updateAvailable===true||!Number.isInteger(status.pendingCount)||status.pendingCount<0)throw Error('connection unavailable');
   if(status.pendingCount)reason='pending-review';
   else{
    const command=`${quote(process.execPath)} ${quote(path.join(config.directory,'memory-station-claude.mjs'))}`;
    const batch=`${event.session_id}-${randomUUID()}`;
    let notice=`Project Memory 自动收尾提醒（最多继续一次）。这不是新的开发任务或保存授权。\n先检查本轮用户要求和实际工作：如果用户要求只读、不回写，尚未给出任务，没有新增有依据的工作结果，或本轮已经成功提交过草稿，请直接结束，不生成记录、不重复提交。不要为了收尾继续开发或补做未授权工作。\n只有本轮有尚未提交且允许记录的实际结果时，按之前读到的工作记录格式整理脱敏草稿，通过 ${command} submit 从标准输入提交。若缺少格式，可用 ${command} context --read-only 读取；只读读取不能绕过用户不回写的要求。\n新批次可使用 ${batch} 作为 session.id；若是在重试已有批次，保留已有编号与原内容。整理者为 Claude Code AI。只记录实际修改、结果、尝试、错误及未知项；未完成的内容如实记录。若已有未提交的本轮合规草稿，直接使用，不重造同一批。\n不读取聊天文件、登录文件或凭据，不复制私密原件，不将摘要冒充原始依据。用户限制优先；不正式保存、不代替用户确认。提交失败或已有待检查批次时停止重试，保留合规草稿并简短告知用户；不要声称送达。完成后简短说明记录是否送达，结束本轮。`;
    notice += '\n使用当前已有依据，不为可选字段额外运行命令。严格遵守用户对文件修改范围的限制，不得为收尾向项目添加未授权的临时文件；无法在现有权限和用户范围内提交时，说明未送达并结束。';
    notice+='\n'+deliveryGuide;
    requireSafe(notice);
    output={hookSpecificOutput:{hookEventName:'Stop',additionalContext:notice}};
    reason='reminded';
   }
  }
 }catch{
  await writeError('记忆站本次未能执行收尾提醒；没有读取聊天文件或自动提交记录。可按项目指引手动收尾。\n');
 }
 // Fail open: outages, malformed events and permission failures cannot trap
 // the user's Claude turn in a loop. Do not echo any untrusted hook fields.
 await write(JSON.stringify(output)+'\n');
 return {reminded:reason==='reminded',reason};
}
