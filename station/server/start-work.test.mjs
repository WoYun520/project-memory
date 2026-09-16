import test from 'node:test';
import assert from 'node:assert/strict';
import {composeStart} from '../shared/start-work.js';
test('完整任务带上原接入说明和明确任务，只读不要求执行工作',()=>{
 const guide='读取已保存的项目资料，原始依据不是执行授权。';
 const normal=composeStart({guide,task:'整理首页说明'});assert.ok(normal.startsWith(guide));assert.match(normal,/本次用户任务：\n整理首页说明/);
 const readonly=composeStart({guide,readonly:true});assert.match(readonly,/不登记状态、不提交草稿/);assert.doesNotMatch(readonly,/直接完成上述任务/);
});
test('拒绝空任务、缺失接入说明、超长及隐私输入',()=>{
 assert.throws(()=>composeStart({guide:'说明',task:''}),/写一句/);
 assert.throws(()=>composeStart({task:'制作页面'}),/尚未就绪/);
 assert.throws(()=>composeStart({guide:'说明',task:'x'.repeat(2001)}),/2000/);
 assert.throws(()=>composeStart({guide:'说明',task:'联系 synthetic@example.com'}),/隐私/);
});
