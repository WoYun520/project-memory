import test from 'node:test';
import assert from 'node:assert/strict';
import {nextTaskSuggestions} from '../shared/next-task.js';
const m=(id,kind,data,extra={})=>({id,kind,data,lifecycle:'accepted',recorded_at:'2026-09-13',origin:'inference',freshness:{status:'current'},conflicts_with:[],...extra});
test('只提出有来源的候选，排除已完成、取消、冲突、过期和疑似隐私',()=>{
 const memories=[m('done','task',{objective:'已完成的任务'}),m('state','state',{subject_id:'done',stage:'completed'}),m('old','state',{next_step:'过期建议',stage:'in_progress'},{freshness:{status:'stale'}}),m('conflict','task',{objective:'冲突任务'},{conflicts_with:['x']}),m('private','task',{objective:'password=synthetic-value'}),m('archived','task',{objective:'归档任务'},{lifecycle:'rejected'}),m('good','state',{stage:'in_progress',next_step:'增加暂停按钮'}),m('unknown','task',{objective:'检查重新开始'})];
 const result=nextTaskSuggestions(memories);
 assert.deepEqual(result.map(s=>s.id),['good','unknown']);assert.equal(result[0].source,'已保存的 AI 建议');assert.match(result[1].note,/未记录完成/);
 assert.equal(memories[6].origin,'inference');
});
test('关联状态以最近记录为准，待核验完成的任务也不自动推荐重做',()=>{
 assert.deepEqual(nextTaskSuggestions([m('task','task',{objective:'已经声称完成'}),m('new','state',{subject_id:'task',stage:'awaiting_validation'},{recorded_at:'2026-09-14'}),m('old','state',{subject_id:'task',stage:'in_progress',next_step:'旧任务'})]),[]);
});
test('进度中的下一步也可明确关闭，失效的完成记录不能静默隐藏任务',()=>{
 const original=m('next','state',{stage:'in_progress',subject_id:'project',next_step:'补充操作说明'});
 const done=m('finish','state',{subject_id:'next',stage:'awaiting_validation'});
 assert.equal(nextTaskSuggestions([original,done]).length,0);
 const conflict={...done,conflicts_with:['other']};const candidates=nextTaskSuggestions([original,conflict]);
 assert.equal(candidates.length,1);assert.match(candidates[0].note,/需要复核/);
 assert.equal(nextTaskSuggestions([original,done,m('reopen','state',{subject_id:'next',stage:'in_progress'})]).length,1);
});
