import test from 'node:test';
import assert from 'node:assert/strict';
import {createBundle} from './core.mjs';
import {importWorklog} from './worklog.mjs';
import {createInbox} from './inbox.mjs';
const work=a=>({format:'project-memory-worklog',version:'0.1',project_id:a.bundle.project.id,session:{id:'inbox-test',agent:'测试 AI'},entries:[{id:'one',kind:'fact',title:'合成观察',detail:'合成结果',origin:'observation',source:{speaker:{kind:'agent',id:'测试 AI'},text:'合成依据'}}]});
test('收件不改项目；重复提交不增加草稿，不同提交不覆盖；确认前不可变更原文',()=>{
 const a=createBundle('收件测试','测试'),before=JSON.stringify(a),w=work(a),inbox=createInbox();
 const d=inbox.stage(a,{worklog:w,sourceReviewed:true});assert.equal(JSON.stringify(a),before);assert.equal(inbox.stage(a,{worklog:w,sourceReviewed:true}).id,d.id);
 const changed=structuredClone(w);changed.entries[0].detail='另一内容';assert.throws(()=>inbox.stage(a,{worklog:changed,sourceReviewed:true}),/等待检查/);assert.throws(()=>inbox.assert(a.bundle.project.id,d.id,changed),/变化/);
 d.worklog.entries[0].detail='改副本';assert.equal(inbox.get(a.bundle.project.id).worklog.entries[0].detail,w.entries[0].detail);
 const imported=importWorklog(a,{worklog:w,selected_ids:['one'],reviewed:true}).archive;inbox.consume(a.bundle.project.id,'wrong');assert.ok(inbox.get(a.bundle.project.id));inbox.consume(a.bundle.project.id,d.id);assert.equal(inbox.get(a.bundle.project.id),null);assert.equal(inbox.stage(imported,{worklog:w,sourceReviewed:true}).alreadyImported,true);
});
test('草稿隐私检查、项目隔离、容量与重启边界',()=>{
 const a=createBundle('收件测试','测试'),b=createBundle('另一项目','测试'),w=work(a),inbox=createInbox({limit:1});
 assert.throws(()=>inbox.stage(a,{worklog:w}),/排除/);const unsafe=structuredClone(w);unsafe.entries[0].source.text='password: synthetic-only';assert.throws(()=>inbox.stage(a,{worklog:unsafe,sourceReviewed:true}),/隐私|凭据/);assert.equal(inbox.get(a.bundle.project.id),null);
 assert.throws(()=>inbox.stage(b,{worklog:w,sourceReviewed:true}),/其他项目/);const d=inbox.stage(a,{worklog:w,sourceReviewed:true});assert.equal(inbox.get(b.bundle.project.id),null);assert.throws(()=>inbox.stage(b,{worklog:work(b),sourceReviewed:true}),/过多/);assert.throws(()=>createInbox().assert(a.bundle.project.id,d.id,w),/不存在/);
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateArchive} from './core.mjs';
function disk(t,a,extra={}){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'inbox-test-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return {directory,loadArchive:()=>a,...extra};}
test('草稿跨实例恢复原编号、时间及来源；重复提交不重写，不改正式项目',t=>{
 const a=createBundle('重启验证','测试'),before=JSON.stringify(a),w=work(a),config=disk(t,a),first=createInbox(config).stage(a,{worklog:w,sourceReviewed:true});
 const filename=path.join(config.directory,a.bundle.project.id+'.json'),raw=fs.readFileSync(filename,'utf8');const reopened=createInbox(config);
 assert.deepEqual(reopened.get(a.bundle.project.id),first);assert.deepEqual(reopened.stage(a,{worklog:w,sourceReviewed:true}),first);assert.equal(fs.readFileSync(filename,'utf8'),raw);assert.equal(JSON.stringify(a),before);assert.equal(fs.statSync(filename).mode&0o777,0o600);
 reopened.consume(a.bundle.project.id,first.id);assert.equal(createInbox(config).get(a.bundle.project.id),null);
});
test('隐私拒绝不落盘；损坏或改动的草稿保留且不覆盖',t=>{
 const a=createBundle('损坏验证','测试'),w=work(a),config=disk(t,a),box=createInbox(config);const bad=structuredClone(w);bad.entries[0].source.text='password: synthetic-only';assert.throws(()=>box.stage(a,{worklog:bad,sourceReviewed:true}));assert.deepEqual(fs.readdirSync(config.directory),[]);
 box.stage(a,{worklog:w,sourceReviewed:true});const filename=path.join(config.directory,a.bundle.project.id+'.json');const draft=JSON.parse(fs.readFileSync(filename,'utf8'));draft.worklog.entries[0].detail='被改动';fs.writeFileSync(filename,JSON.stringify(draft));assert.throws(()=>createInbox(config).get(a.bundle.project.id),/校验/);assert.throws(()=>box.stage(a,{worklog:w,sourceReviewed:true}),/校验/);assert.equal(JSON.parse(fs.readFileSync(filename,'utf8')).worklog.entries[0].detail,'被改动');
 fs.writeFileSync(filename,'incomplete');assert.throws(()=>box.get(a.bundle.project.id),/无法读取/);assert.equal(fs.readFileSync(filename,'utf8'),'incomplete');
});
test('项目已提交但草稿未清理时，恢复后不再出现未选项；未完成临时文件不影响恢复',t=>{
 let a=createBundle('中断验证','测试');const w=work(a);w.entries.push({...w.entries[0],id:'two',title:'未选内容'});const config=disk(t,a,{loadArchive:()=>a}),box=createInbox(config);const d=box.stage(a,{worklog:w,sourceReviewed:true});
 a=importWorklog(a,{worklog:w,selected_ids:['one'],reviewed:true}).archive;a.inbox_receipts=[{id:d.id,at:new Date().toISOString()}];validateArchive(a);
 fs.writeFileSync(path.join(config.directory,'interrupted.tmp'),'partial');const reopened=createInbox(config);assert.equal(reopened.get(a.bundle.project.id),null);assert.equal(fs.existsSync(path.join(config.directory,a.bundle.project.id+'.json')),false);assert.ok(!a.bundle.memories.some(m=>m.claim==='未选内容'));assert.equal(fs.readFileSync(path.join(config.directory,'interrupted.tmp'),'utf8'),'partial');
 a.inbox_receipts.push({...a.inbox_receipts[0]});assert.throws(()=>validateArchive(a),/草稿处理索引/);
});
