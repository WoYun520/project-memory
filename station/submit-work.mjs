import {parseWorklogText,fileAttachmentReceipt} from './shared/worklog.js';
import {submitErrorMessage} from './shared/submit-error.js';
import {deliverWorklog} from './shared/submit-delivery.js';
// Read only the explicitly supplied report; do not scan conversations or project files.
try {
 let text='';for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>300000)throw Error('工作记录不能超过 300 KB。');}
 const worklog=parseWorklogText(text),port=Number(process.env.MEMORY_STATION_PORT||4180);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('本机端口无效。');
 const result=await deliverWorklog({port,worklog},{onRetry:message=>process.stderr.write(message)});
 console.log(result.alreadyImported?'这些记录已导入，无需重复保存。':'已送到记忆站，等待预览确认；尚未写入正式记忆。');
 if(!result.alreadyImported&&fileAttachmentReceipt(result.worklog))process.stdout.write(fileAttachmentReceipt(result.worklog));
}catch(e){console.error(submitErrorMessage(e));process.exitCode=1;}
