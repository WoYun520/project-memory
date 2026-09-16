import test from 'node:test';
import assert from 'node:assert/strict';
import {submitErrorMessage} from '../shared/submit-error.js';
test('连接权限、拒绝连接及不确定结果分别报告，不把权限错误误报为服务未启动',()=>{
 const denied=submitErrorMessage({message:'fetch failed',cause:{code:'EPERM'}});assert.match(denied,/正常权限申请/);assert.match(denied,/不表示服务未启动/);
 assert.match(submitErrorMessage({cause:{errors:[{code:'EACCES'}]}}),/没有访问/);
 assert.match(submitErrorMessage({cause:{code:'ECONNREFUSED'}}),/拒绝连接/);
 assert.match(submitErrorMessage({name:'TimeoutError'}),/无法确认是否送达/);
 assert.match(submitErrorMessage({message:'fetch failed'}),/原因尚未确定/);
 assert.equal(submitErrorMessage({message:'已有一批记录等待检查'}),'已有一批记录等待检查');
});
