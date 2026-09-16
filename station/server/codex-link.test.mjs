import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createBundle} from './core.mjs';
import {createWorkspaceConnector} from './workspace.mjs';
import {createInbox} from './inbox.mjs';
import {createCodexLink} from './codex-link.mjs';
import {runBridge} from '../codex-bridge.mjs';

function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'codex-link-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const project=path.join(root,'project');fs.mkdirSync(project);const a=createBundle('接入演示',''),id=a.bundle.project.id;const workspace=createWorkspaceConnector({directory:path.join(root,'bindings')});workspace.bind(id,project);const loadArchive=()=>a;const inbox=createInbox({directory:path.join(root,'inbox'),loadArchive});const link=createCodexLink({directory:path.join(root,'links'),stationRoot:path.resolve('.'),port:4180,workspace,loadArchive,inbox});return {root,project,a,id,workspace,inbox,link};}
const report=id=>({format:'project-memory-worklog',version:'0.1',project_id:id,session:{id:'codex-test',agent:'Codex',actor:{kind:'agent',id:'Codex'}},entries:[{id:'one',kind:'fact',title:'本轮观察',detail:'完成合成资料的读取。',origin:'observation',source:{speaker:{kind:'agent',id:'Codex'},text:'本轮合成原始说明'}}]});
test('预览不写项目；启用保留原规则字节，重复启用幂等，停用保留后来追加规则',t=>{
 const f=fixture(t),file=path.join(f.project,'AGENTS.md'),original=Buffer.from('\uFEFF# 原规则\r\n保留原始行尾。\r\n');fs.writeFileSync(file,original);const before=JSON.stringify(f.a);const p=f.link.status(f.id);assert.equal(fs.readFileSync(file).equals(original),true);assert.equal(fs.existsSync(path.join(f.project,'memory-station-codex.mjs')),false);
 const enabled=f.link.install(f.id,p.token);assert.equal(enabled.configured,true);assert.equal(fs.readFileSync(file).subarray(0,original.length).equals(original),true);f.link.install(f.id,enabled.token);
 fs.appendFileSync(file,'\n新增用户规则。');f.link.remove(f.id,f.link.status(f.id).token);assert.equal(fs.readFileSync(file).toString(),original.toString()+'\n新增用户规则。');assert.equal(JSON.stringify(f.a),before);
});
test('过期预览、覆盖指引、已有辅助文件和快捷链接均不被覆盖',t=>{
 const f=fixture(t),file=path.join(f.project,'AGENTS.md'),p=f.link.status(f.id);fs.writeFileSync(file,'原规则已变化');assert.throws(()=>f.link.install(f.id,p.token),/变化/);
 fs.writeFileSync(path.join(f.project,'AGENTS.override.md'),'优先规则');assert.throws(()=>f.link.status(f.id),/override/);fs.unlinkSync(path.join(f.project,'AGENTS.override.md'));
 fs.writeFileSync(path.join(f.project,'memory-station-codex.mjs'),'user code');assert.throws(()=>f.link.status(f.id),/同名/);fs.unlinkSync(path.join(f.project,'memory-station-codex.mjs'));
 fs.unlinkSync(file);fs.symlinkSync(path.join(f.project,'README.md'),file);assert.throws(()=>f.link.status(f.id),/普通文件/);
});
test('修改托管段落后拒绝停用，改绑文件夹不误写新项目',t=>{
 const f=fixture(t);f.link.install(f.id,f.link.status(f.id).token);const file=path.join(f.project,'memory-station-codex.mjs');fs.appendFileSync(file,'\n// user edit');assert.throws(()=>f.link.remove(f.id,'x'),/已被修改/);assert.ok(fs.readFileSync(file,'utf8').includes('user edit'));
 const other=path.join(f.root,'other');fs.mkdirSync(other);assert.throws(()=>f.link.assertWorkspaceChange(f.id,null),/停用/);assert.throws(()=>f.link.assertWorkspaceChange(f.id,other),/停用/);f.link.assertWorkspaceChange(f.id,f.project);f.workspace.bind(f.id,other);assert.throws(()=>f.link.status(f.id),/文件夹已改变/);assert.deepEqual(fs.readdirSync(other),[]);
});
test('首次创建的指引可完整移除；读取回执与草稿提交不修改正式记忆',t=>{
 const f=fixture(t),before=JSON.stringify(f.a);f.link.install(f.id,f.link.status(f.id).token);f.link.receipt(f.id,0);assert.equal(f.link.status(f.id).lastRead.revision,0);assert.throws(()=>f.link.receipt(f.id,99),/版本/);
 f.link.submit(f.id,report(f.id));assert.equal(f.inbox.get(f.id).worklog.entries.length,1);assert.equal(f.link.status(f.id).lastSubmission.count,1);
 const other=report(f.id);other.session.id='different';assert.throws(()=>f.link.submit(f.id,other),/已有/);assert.equal(f.inbox.get(f.id).worklog.session.id,'codex-test');assert.equal(JSON.stringify(f.a),before);
 f.link.remove(f.id,f.link.status(f.id).token);assert.deepEqual(fs.readdirSync(f.project),[]);assert.equal(f.inbox.get(f.id).worklog.entries.length,1);
});
test('桥接先输出完整记忆再登记读取，不加入只读测试约束或伪造模型验收',async()=>{
 const a=createBundle('合成项目',''),events=[];await runBridge({projectId:a.bundle.project.id,port:4180},['context'],{read:async()=>a,write:async text=>{events.push('output');assert.ok(text.includes('当前已保存版本'));assert.ok(!text.includes('本次为只读测试'));},fetchImpl:async(url,opts)=>{events.push('receipt');assert.ok(url.endsWith('/codex/receipt'));assert.deepEqual(JSON.parse(opts.body),{revision:0});return {ok:true,json:async()=>({recorded:true})};}});assert.deepEqual(events,['output','receipt']);
});
test('桥接拒绝跨项目、隐私及冒充用户提交，服务失败不假装已接收',async()=>{
 const a=createBundle('合成项目',''),config={projectId:a.bundle.project.id,port:4180};let called=false;
 const attempt=work=>runBridge(config,['submit'],{input:[JSON.stringify(work)],write:async()=>{},fetchImpl:async()=>{called=true;return {ok:false,json:async()=>({error:'已有待检查记录'})};}});
 const wrong=report('00000000-0000-4000-8000-000000000000');await assert.rejects(()=>attempt(wrong),/其他项目/);
 const secret=report(config.projectId);secret.entries[0].source.text='联系 synthetic@example.com';await assert.rejects(()=>attempt(secret),/隐私/);
 const impersonated=report(config.projectId);impersonated.session.actor.kind='human';await assert.rejects(()=>attempt(impersonated),/身份/);assert.equal(called,false);
 await assert.rejects(()=>attempt(report(config.projectId)),/已有/);assert.equal(called,true);
});

test('只读桥接只获取资料，不登记回执、不附带提交指令',async()=>{
 const a=createBundle('合成只读项目',''),before=JSON.stringify(a),events=[];
 await runBridge({projectId:a.bundle.project.id,port:4180},['context','--read-only'],{read:async()=>{events.push('get');return a;},fetchImpl:async()=>{assert.fail('只读模式不能发起 POST');},write:async output=>{events.push('output');assert.match(output,/只读模式/);assert.match(output,/合成只读项目/);assert.match(output,/不向记忆站回写/);assert.doesNotMatch(output,/工作结束后的草稿格式|memory-station-codex.mjs submit/);}});
 assert.deepEqual(events,['get','output']);assert.equal(JSON.stringify(a),before);
 await assert.rejects(()=>runBridge({projectId:a.bundle.project.id,port:4180},['submit','--read-only']),/支持/);
});
test('升级只替换旧托管段落，保留原字节和回执，过期预览拒绝写入',t=>{
 const f=fixture(t),file=path.join(f.project,'AGENTS.md'),original=Buffer.from('\uFEFF原项目规则\r\n');fs.writeFileSync(file,original);f.link.install(f.id,f.link.status(f.id).token);f.link.receipt(f.id,0);f.link.submit(f.id,report(f.id));
 const manifest=path.join(f.root,'links',f.id+'.json'),value=JSON.parse(fs.readFileSync(manifest));const latest=value.block;value.block=latest.replace(/用户要求只读、不修改或不回写时[^\n]+?读失败时/,'读失败时');
 fs.writeFileSync(file,Buffer.concat([original,Buffer.from(value.block),Buffer.from('\r\n后加规则')]));fs.writeFileSync(manifest,JSON.stringify(value));
 const p=f.link.status(f.id);assert.equal(p.updateAvailable,true);assert.match(p.readPrompt,/context --read-only/);assert.match(p.startPrompt,/尚未给出具体工作时先等待/);
 fs.appendFileSync(file,'。');assert.throws(()=>f.link.update(f.id,p.token),/变化/);
 const result=f.link.update(f.id,f.link.status(f.id).token);assert.equal(result.updateAvailable,false);assert.deepEqual(result.lastRead,value.lastRead);assert.deepEqual(result.lastSubmission,value.lastSubmission);assert.equal(fs.readFileSync(file).toString(),original.toString()+latest+'\r\n后加规则。');
 f.link.remove(f.id,result.token);assert.equal(fs.readFileSync(file).toString(),original.toString()+'\r\n后加规则。');
});

test('接续状态区分当前版本与历史读取，并保留提交批次来源',t=>{
 const f=fixture(t);f.link.install(f.id,f.link.status(f.id).token);
 let status=f.link.status(f.id);assert.equal(status.currentRevision,0);assert.equal(status.pendingCount,0);assert.equal(status.lastRead,null);
 f.link.receipt(f.id,0);f.a.revision=1;status=f.link.status(f.id);assert.equal(status.currentRevision,1);assert.equal(status.lastRead.revision,0);
 f.link.submit(f.id,report(f.id));status=f.link.status(f.id);assert.equal(status.pendingCount,1);assert.equal(status.lastSubmission.sessionId,'codex-test');assert.match(status.lastSubmission.source,/不代表用户验收/);
 assert.equal(status.lastRead.revision,0);assert.equal(f.a.bundle.memories.length,0);
});
test('Codex AI 别名经命令行和项目入口原样进入待检查区，不正式保存',async t=>{const f=fixture(t);f.link.install(f.id,f.link.status(f.id).token);const w=report(f.id);w.session.agent=w.session.actor.id='Codex AI';w.entries[0].source.speaker.id='Codex AI';const before=JSON.stringify(f.a);await runBridge({projectId:f.id,port:4180},['submit'],{input:[JSON.stringify(w)],write:async()=>{},fetchImpl:async(_url,options)=>{const input=JSON.parse(options.body);assert.equal(input.worklog.session.actor.id,'Codex AI');return {ok:true,json:async()=>f.link.submit(f.id,input.worklog)};}});assert.equal(f.inbox.get(f.id).worklog.session.actor.id,'Codex AI');assert.equal(JSON.stringify(f.a),before);});
