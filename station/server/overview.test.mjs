import test from 'node:test';
import assert from 'node:assert/strict';
import {createBundle,appendMemory} from './core.mjs';
import {summarizeProject,searchArchives} from './overview.mjs';

test('overview treats queue as draft and preserves AI origin',()=>{
 const a=createBundle('项目 A','');appendMemory(a,{kind:'goal',title:'观察目标',detail:'继续搭建框架',source:'工具观察到这条目标描述',origin:'observation',recorder:{kind:'agent',id:'AI'},reviewed:true});
 const result=summarizeProject(a,{receivedAt:'2026-09-12T00:00:00Z',worklog:{session:{agent:'AI'},entries:[{title:'草稿'}]}});
 assert.equal(result.count,1);assert.equal(result.inbox.count,1);assert.equal(result.goalOrigin,'observation');assert.equal(a.bundle.memories.length,1);
});
test('global search returns project identity and lifecycle without mixing archives',()=>{
 const a=createBundle('项目 A','配置本地缓存'),b=createBundle('项目 B','缓存故障排查');
 a.bundle.memories[0].lifecycle='rejected';const before=JSON.stringify([a,b]);const result=searchArchives([a,b],'缓存');
 assert.equal(result.total,2);assert.equal(result.results[0].projectId,b.bundle.project.id);assert.equal(result.results[1].lifecycle,'rejected');assert.equal(JSON.stringify([a,b]),before);
 assert.deepEqual(searchArchives([a],''),{results:[],total:0});assert.throws(()=>searchArchives([a],'x'.repeat(201)));
});
