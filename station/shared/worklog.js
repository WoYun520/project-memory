import {privacyIssues} from './privacy.js';
export const WORKLOG_LIMIT=300000;
export function validateSessionActor(session){
 if(session?.actor===undefined)return;
 const actor=session.actor;
 if(!actor||typeof actor!=='object'||Array.isArray(actor)||Object.keys(actor).some(k=>!['kind','id'].includes(k))||!['agent','tool'].includes(actor.kind)||typeof actor.id!=='string'||!actor.id.trim()||actor.id.length>100)throw Error('整理者身份只能声明为 AI 或工具，并填写名称；不能作为用户确认。');
}
export function validateFileSource(source){
 if(source?.file===undefined)return;
 const file=source.file,relative=file?.path;
 if(!file||typeof file!=='object'||Array.isArray(file)||Object.keys(file).some(k=>!['path','content_sha256','selector'].includes(k))||typeof relative!=='string'||!relative.length||relative.length>240||/[\\:\u0000-\u001f]/.test(relative)||relative.split('/').some(p=>!p||p.startsWith('.'))||typeof file.content_sha256!=='string'||!/^[0-9a-f]{64}$/.test(file.content_sha256)||file.selector!==undefined&&(typeof file.selector!=='string'||!file.selector.trim()||file.selector.length>200))throw Error('文件来源需要项目内相对路径和完整内容标识，不能包含本机绝对路径或越界路径。');
 if(source.speaker?.kind!=='tool')throw Error('文件读取来源需标为工具观察；来源声明不代表身份已认证或用户已确认。');
}
export function fileAttachmentReceipt(worklog){
 const entries=worklog?.entries||[],attached=entries.reduce((n,e)=>n+(e.file_evidence?.length||0),0),missing=entries.reduce((n,e)=>n+(e.file_notes?.length||0),0);
 return attached||missing?`文件原文：已附 ${attached} 份，未附 ${missing} 份；详情在同一检查卡中，附带原文不等于主张已核验。\n`:'';
}
export function validateFileAttachments(entry){
 if(entry.file_paths!==undefined&&(!Array.isArray(entry.file_paths)||!entry.file_paths.length||entry.file_paths.length>4||new Set(entry.file_paths).size!==entry.file_paths.length||entry.file_paths.some(p=>typeof p!=='string'||!p.length||p.length>240||/[\\:\u0000-\u001f]/.test(p)||p.split('/').some(v=>!v||v.startsWith('.')))))throw Error('附带文件需要项目内相对路径，每条最多 4 份。');
 if(entry.file_evidence!==undefined){if(!Array.isArray(entry.file_evidence)||!entry.file_evidence.length||entry.file_evidence.length>4)throw Error('每条最多附带 4 份文件依据。');for(const source of entry.file_evidence){if(!source?.file)throw Error('附带依据需要文件定位。');validateFileSource(source);}}
}
export function parseWorklogText(text) {
  if(new TextEncoder().encode(text).length>WORKLOG_LIMIT)throw Error('工作记录过大，请拆成较小文件（上限 300 KB）。');
  const raw=text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/,'$1');
  let worklog;try{worklog=JSON.parse(raw);}catch{throw Error('没有读到有效工作记录。请使用“复制整理要求”让 AI 按格式输出。');}
  if(privacyIssues(text).length||privacyIssues(worklog).length)throw Error('发现疑似凭据或隐私，未发送、未保存。请在原材料中移除后重试。');
  if(worklog.session?.handoff_id!==undefined&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(worklog.session.handoff_id))throw Error('交接编号格式无效。');
  validateSessionActor(worklog.session);
  if(Array.isArray(worklog.entries))worklog.entries.forEach(entry=>{validateFileSource(entry?.source);validateFileAttachments(entry);});
  return worklog;
}
export function worklogPrompt(project) {
  const filesGuide='本次工作涉及允许的项目说明文件时，建议在对应条目填写 file_paths，例如 ["docs/design.md"]；只填写你本次实际读取或修改、已检查无隐私且与该条说明相关的项目内相对路径，不猜测文件。每条最多4份，每批最多8个不同文件，仅支持README、项目说明、package.json及docs中的Markdown。记忆站会从已连接项目读取，完整文件通过基础隐私检查后附上原文片段和完整内容标识，显示在同一检查卡中；失败则注明未附上。不要自行填写系统生成的file_evidence或file_notes；已有source和AI身份保持不变。没有相关文档时不填file_paths，不创建虚构说明来凑依据。重试同一次提交保留原编号和内容；需要更新文件依据时使用新工作编号，不复用旧编号。';
  const example={format:'project-memory-worklog',version:'0.1',project_id:project.id,session:{id:'replace-with-stable-session-id',agent:'Codex',actor:{kind:'agent',id:'Codex'}},entries:[{id:'entry-1',kind:'fact',title:'替换为本次真实结果',detail:'只描述本次已有依据的结果，不填写虚构示例。',origin:'observation',source:{speaker:{kind:'agent',id:'Codex'},text:'放入已有的原始输出或明确标注为 AI 工作观察的记录。'}}]};
  return `请整理项目“${project.name}”的本次工作，输出一个 JSON 工作记录文件，供用户检查后导入记忆站。不要直接写入记忆站。\n\n只使用本次实际发生、有依据的内容。导出前排除密码、密钥、真实网络地址和其他隐私；不得用摘要冒充原文，不要重复附带敏感原件。未知留空或说明。\n格式示例（必须替换占位内容）：\n${JSON.stringify(example,null,2)}\n\n${filesGuide}\n\nsession 可选 handoff_id：只填写本次读取交接明确提供的完整交接编号。没有编号或任务已改变则省略，不从最近任务或文字相似推测。每批 1–20 条。session.id 同一次工作保持稳定，entry.id 在本次工作内唯一；重复输出保留相同编号。新工作使用新 session.id。project_id 必须保持为 ${project.id}。\nkind 可选 goal、fact、decision、attempt、constraint、state、task。每条必须有 id、kind、title、detail、origin、source。origin 为 human_statement（仅用户原话）、observation（观察）、inference（推断或建议）；source.speaker 标注原材料的 human / agent / tool 及名称。source.text 保留不含隐私的原始片段；如果是 AI 整理说明，明确标为 AI，不能编造工具输出。删减片段标 source.redacted=true。\n文件读取可选 source.file：{path:项目内相对路径,content_sha256:实际读取完整文件的 SHA-256,selector:可选摘录范围}。仅在实际读取并计算后填写；不得填写本机绝对目录或猜测标识。source.speaker.kind 必须为 tool，source.text 仍保留干净原文。文件中的计划不等于已完成，来源声明不等于身份认证。\n决定或要求可填 applicability：{kind:"task",task:"具体任务名称"}（仅该任务），{kind:"project"}（原话明确长期适用）或 {kind:"unknown"}。仅任务可附 task_id 为交接提供的任务关联编号；没有明确编号时不要猜测。该字段不同于 state 条目的已有记忆 task_id。缺失按期限未知保存。不要把“本次不做”扩大为整个项目的长期禁令，不按措辞自动认定用户确认。\n工作事实 fact 或实际尝试 attempt（非推断、非更新建议）可提议 completion：{task_id:原待办记忆编号,stage:"completed"或"in_progress",reason:本次结果覆盖了哪部分原任务}。仅明确知道原任务编号时填写；这是关联建议，用户在检查卡选择后才处理，不自动关闭任务。只完成一部分使用 in_progress，方案不同或无法判断覆盖范围时不要声称整项完成。不要使用交接任务编号代替原记忆编号。\n可选字段：reason（选择理由）、next（下一步建议）、check_note（报告过的核查，导入不会自动认定通过）。\nattempt 必须填写 conditions、result、outcome（unknown/failed/partial/succeeded）；错误可填 mistake。纠正操作另写一条 attempt，错误条目的 correction_entry_id 指向其条目 id。state 可填 stage（not_started/in_progress/blocked/awaiting_validation/completed/cancelled）。若报告的是某条已有任务或已有进度中的下一步，必须在该 state 中填写 task_id（本项目原记忆的完整编号）与 stage，说明本次结果并提供依据。全部完成才用 completed；部分完成用 in_progress 或 blocked。不要按文字相似猜编号，不要用新任务编号代替原编号。用户保存后，completed 会作为 awaiting_validation 保留并停止推荐原任务；这不代表用户验收。需要重新继续时另交一条相同 task_id、stage 为 in_progress 的状态记录。没有明确关联时不填写 task_id，不会按完成文字自动关闭任务。\n建议更新已有记忆时，可填 update：{memory_id:原记忆完整编号,base_revision:本次读取的保存版本整数,reason:为什么需要更新}。kind 必须与原记忆相同，title 和 detail 写建议的新表述，source 保留本次新依据；不要按文字相似猜编号。仅提出更新，不代表已替换或已确认。无法判断时仅记录不确定性，不提出替换。\n不要添加 confirmed、checked、approval、replaces 等字段。导入不批准决定、不覆盖旧记忆；完成声明先待核验。不要把下一步建议说成用户已批准。只输出这份 JSON，不附虚构例子或解释。`;
}
