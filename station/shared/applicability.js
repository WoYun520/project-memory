export function validateApplicability(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['kind','task','task_id'].includes(k))||!['unknown','task','project'].includes(value.kind))throw Error('适用期限无效。');
 if(value.kind==='task'?(typeof value.task!=='string'||!value.task.trim()||value.task.length>300):value.task!==undefined)throw Error('仅本次任务需要填写具体任务，其他期限不能附带任务。');
 if(value.task_id!==undefined&&(value.kind!=='task'||typeof value.task_id!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.task_id)))throw Error('任务关联编号无效。');
 return value;
}
export function applicabilityLabel(value){
 if(!value)return '旧记录未注明期限；不能仅凭“本项目”认定长期有效';
 if(value.kind==='task')return `仅指定任务：${value.task}${value.task_id?'（已附任务编号）':''}；不自动延续到新任务`;
 if(value.kind==='project')return '项目长期适用；仍需满足原有条件、确认及核验边界';
 return '期限尚不明确；不要自动当作长期要求';
}
