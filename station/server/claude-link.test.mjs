import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {createBundle} from './core.mjs';
import {createWorkspaceConnector} from './workspace.mjs';
import {createInbox} from './inbox.mjs';
import {createClaudeLink} from './claude-link.mjs';
import {createCodexLink} from './codex-link.mjs';

const filenames=['CLAUDE.md','memory-station-claude.mjs','memory-station-claude.settings.json'];
function fixture(t,{projectName='project'}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'claude-link-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const project=path.join(root,projectName);fs.mkdirSync(project);
 const archive=createBundle('Claude 接续合成项目',''),id=archive.bundle.project.id;
 const workspace=createWorkspaceConnector({directory:path.join(root,'bindings')});workspace.bind(id,project);
 const loadArchive=()=>archive,inbox=createInbox({directory:path.join(root,'inbox'),loadArchive});
 const options={directory:path.join(root,'links'),stationRoot:path.resolve('.'),port:4180,workspace,loadArchive,inbox};
 const link=createClaudeLink(options);
 return {root,project,archive,id,workspace,inbox,options,link};
}
const report=(id,actor='Claude Code',session='claude-synthetic-work')=>({format:'project-memory-worklog',version:'0.1',project_id:id,session:{id:session,agent:actor,actor:{kind:'agent',id:actor}},entries:[{id:'one',kind:'fact',title:'本轮合成观察',detail:'完成合成资料的读取。',origin:'observation',source:{speaker:{kind:'agent',id:actor},text:'本轮合成原始说明'}}]});
const mode=file=>fs.statSync(file).mode&0o777;
const snapshot=files=>files.map(file=>({file,bytes:fs.readFileSync(file),mode:mode(file)}));
const assertSnapshot=files=>{for(const file of files){assert.deepEqual(fs.readFileSync(file.file),file.bytes);assert.equal(mode(file.file),file.mode);}};

test('Claude 预览只读，安装保留 BOM、行尾与文件权限；重复启用幂等并保留后加规则',t=>{
 const f=fixture(t),file=path.join(f.project,'CLAUDE.md'),original=Buffer.from('\uFEFF# 原规则\r\n使用既有结构。\r\n');
 fs.writeFileSync(file,original,{mode:0o640});fs.chmodSync(file,0o640);
 const before=JSON.stringify(f.archive),preview=f.link.status(f.id);
 assert.deepEqual(fs.readFileSync(file),original);assert.deepEqual(fs.readdirSync(f.project),['CLAUDE.md']);
 assert.deepEqual(preview.files,filenames);assert.equal(preview.configured,false);assert.equal(preview.settingsFile,path.join(fs.realpathSync(f.project),filenames[2]));
 const installed=f.link.install(f.id,preview.token);assert.equal(installed.configured,true);assert.equal(mode(file),0o640);
 assert.deepEqual(fs.readFileSync(file).subarray(0,original.length),original);
 const all=snapshot(filenames.map(name=>path.join(f.project,name)));f.link.install(f.id,installed.token);assertSnapshot(all);
 fs.appendFileSync(file,'\r\n后加用户规则。');f.link.remove(f.id,f.link.status(f.id).token);
 assert.deepEqual(fs.readFileSync(file),Buffer.concat([original,Buffer.from('\r\n后加用户规则。')]));assert.equal(mode(file),0o640);assert.equal(JSON.stringify(f.archive),before);
});

test('只管理独立设置，生成有安全引用的绝对命令，不访问用户 .claude 目录',t=>{
 const f=fixture(t,{projectName:"project with ' quote"}),privateDirectory=path.join(f.project,'.claude');fs.mkdirSync(privateDirectory);
 const owned=path.join(privateDirectory,'settings.json'),local=path.join(privateDirectory,'settings.local.json'),nested=path.join(privateDirectory,'CLAUDE.md');
 fs.writeFileSync(owned,'{"permissions":{"defaultMode":"default"}}\n');fs.writeFileSync(local,'{"language":"zh"}\n');fs.writeFileSync(nested,'这是用户已有的配套规则。\r\n');
 const preserved=snapshot([owned,local,nested]),originalOpen=fs.openSync;
 t.mock.method(fs,'openSync',function(file,...args){if(typeof file==='string'&&file.startsWith(privateDirectory+path.sep))assert.fail('连接器不得读取 .claude 内容');return originalOpen.call(fs,file,...args);});
 const status=f.link.install(f.id,f.link.status(f.id).token),settings=JSON.parse(fs.readFileSync(status.settingsFile));
 assert.deepEqual(Object.keys(settings),['hooks']);assert.deepEqual(Object.keys(settings.hooks),['SessionStart','Stop']);
 assert.equal(settings.hooks.Stop[0].hooks[0].command,settings.hooks.SessionStart[0].hooks[0].command.replace(/ session-start$/,' stop'));
 assert.equal(settings.hooks.Stop[0].hooks[0].timeout,15);
 const hook=settings.hooks.SessionStart[0];assert.deepEqual(hook.matcher.split('|'),['startup','resume','clear','compact','fork']);assert.equal(hook.hooks.length,1);
 assert.equal(hook.hooks[0].timeout,45);assert.equal(hook.hooks[0].type,'command');assert.ok(hook.hooks[0].command.startsWith("'"+process.execPath+"' "));
 assert.ok(hook.hooks[0].command.includes("'\\''"));assert.ok(hook.hooks[0].command.endsWith("' session-start"));
 const helper=fs.readFileSync(path.join(f.project,filenames[1]),'utf8');assert.match(helper,/claude-bridge\.mjs/);assert.ok(helper.includes(JSON.stringify(fs.realpathSync(f.project))));
 f.link.remove(f.id,f.link.status(f.id).token);t.mock.restoreAll();assertSnapshot(preserved);
});

test('旧预览对内容和权限变化失效，同名文件及遗留标记不被覆盖',t=>{
 const f=fixture(t),file=path.join(f.project,'CLAUDE.md'),preview=f.link.status(f.id);
 fs.writeFileSync(file,'用户修改');assert.throws(()=>f.link.install(f.id,preview.token),/变化/);
 const fresh=f.link.status(f.id);fs.chmodSync(file,0o640);assert.throws(()=>f.link.install(f.id,fresh.token),/变化/);
 for(const name of filenames.slice(1)){const existing=path.join(f.project,name);fs.writeFileSync(existing,'user-owned');assert.throws(()=>f.link.status(f.id),/同名/);assert.equal(fs.readFileSync(existing,'utf8'),'user-owned');fs.unlinkSync(existing);}
 for(const marker of ['<!-- memory-station:claude:start -->','<!-- memory-station:claude:end -->']){fs.writeFileSync(file,marker);assert.throws(()=>f.link.status(f.id),/标记/);assert.equal(fs.readFileSync(file,'utf8'),marker);}
});

test('辅助文件、独立设置和指引的快捷链接与硬链接不被读写',t=>{
 const f=fixture(t),target=path.join(f.root,'original.txt');fs.writeFileSync(target,'original');
 for(const name of filenames){const file=path.join(f.project,name);fs.symlinkSync(target,file);assert.throws(()=>f.link.status(f.id),/普通文件/);assert.equal(fs.readlinkSync(file),target);fs.unlinkSync(file);fs.linkSync(target,file);assert.throws(()=>f.link.status(f.id),/普通文件/);fs.unlinkSync(file);}
 assert.equal(fs.readFileSync(target,'utf8'),'original');
});

test('任何托管文件被修改都拒绝更新和移除，重复或零散标记也拒绝',t=>{
 const f=fixture(t);f.link.install(f.id,f.link.status(f.id).token);
 for(const name of filenames){const file=path.join(f.project,name),original=fs.readFileSync(file);const changed=name==='CLAUDE.md'?Buffer.from(original.toString().replace('原始依据不得被摘要覆盖','用户修改托管段落')):Buffer.concat([original,Buffer.from('\n用户修改')]);fs.writeFileSync(file,changed);
  assert.throws(()=>f.link.status(f.id),/已被修改/);assert.throws(()=>f.link.update(f.id,'stale'),/已被修改/);assert.throws(()=>f.link.remove(f.id,'stale'),/已被修改/);assert.deepEqual(fs.readFileSync(file),changed);fs.writeFileSync(file,original);
 }
 const file=path.join(f.project,'CLAUDE.md'),original=fs.readFileSync(file),manifest=JSON.parse(fs.readFileSync(path.join(f.root,'links',f.id+'.json')));
 for(const extra of [manifest.block,'<!-- memory-station:claude:start -->','<!-- memory-station:claude:end -->']){fs.appendFileSync(file,extra);assert.throws(()=>f.link.status(f.id),/标记不唯一/);assert.throws(()=>f.link.remove(f.id,'x'),/标记不唯一/);fs.writeFileSync(file,original);}
});

test('升级替换旧托管段落与路径，完整保留外部规则、三文件权限和回执',t=>{
 const f=fixture(t),file=path.join(f.project,'CLAUDE.md'),original=Buffer.from('\uFEFF原规则\r\n');fs.writeFileSync(file,original);
 f.link.install(f.id,f.link.status(f.id).token);const sessionId=randomUUID();f.link.receipt(f.id,0,sessionId);f.link.submit(f.id,report(f.id));
 const manifest=path.join(f.root,'links',f.id+'.json'),value=JSON.parse(fs.readFileSync(manifest));value.block=value.block.replace('用户本次具体任务优先；','');
 fs.writeFileSync(file,Buffer.concat([original,Buffer.from(value.block),Buffer.from('\r\n用户后加规则')]));fs.writeFileSync(manifest,JSON.stringify(value));
 [0o640,0o700,0o644].forEach((permission,index)=>fs.chmodSync(path.join(f.project,filenames[index]),permission));
 const next=createClaudeLink({...f.options,stationRoot:path.join(f.root,'next-station')});const preview=next.status(f.id);assert.equal(preview.updateAvailable,true);
 fs.appendFileSync(file,'。');assert.throws(()=>next.update(f.id,preview.token),/变化/);
 const changed=next.update(f.id,next.status(f.id).token);assert.equal(changed.updateAvailable,false);assert.deepEqual(changed.lastRead,value.lastRead);assert.deepEqual(changed.lastSubmission,value.lastSubmission);
 assert.deepEqual(fs.readFileSync(file),Buffer.concat([original,Buffer.from(changed.preview),Buffer.from('\r\n用户后加规则。')]));
 [0o640,0o700,0o644].forEach((permission,index)=>assert.equal(mode(path.join(f.project,filenames[index])),permission));
 next.remove(f.id,changed.token);assert.deepEqual(fs.readFileSync(file),Buffer.concat([original,Buffer.from('\r\n用户后加规则。')]));assert.equal(mode(file),0o640);
});

test('安装中失败恢复原文件，移除中失败恢复完整配置',t=>{
 const f=fixture(t),file=path.join(f.project,'CLAUDE.md'),original=Buffer.from('\uFEFF用户规则\r\n');fs.writeFileSync(file,original,{mode:0o640});fs.chmodSync(file,0o640);
 const manifest=path.join(f.root,'links',f.id+'.json'),rename=fs.renameSync;let failed=false;
 t.mock.method(fs,'renameSync',function(from,to){if(to===manifest&&!failed){failed=true;throw Error('synthetic persist failure');}return rename.call(fs,from,to);});
 assert.throws(()=>f.link.install(f.id,f.link.status(f.id).token),/synthetic/);assert.deepEqual(fs.readFileSync(file),original);assert.equal(mode(file),0o640);assert.deepEqual(fs.readdirSync(f.project),['CLAUDE.md']);assert.equal(fs.existsSync(manifest),false);t.mock.restoreAll();
 const installed=f.link.install(f.id,f.link.status(f.id).token),all=snapshot([...filenames.map(name=>path.join(f.project,name)),manifest]),unlink=fs.unlinkSync;failed=false;
 t.mock.method(fs,'unlinkSync',function(target){if(target===installed.settingsFile&&!failed){failed=true;throw Error('synthetic remove failure');}return unlink.call(fs,target);});
 assert.throws(()=>f.link.remove(f.id,installed.token),/synthetic/);assertSnapshot(all);t.mock.restoreAll();assert.equal(f.link.status(f.id).configured,true);
});

test('升级中失败完整恢复三文件、权限和原连接记录',t=>{
 const f=fixture(t);f.link.install(f.id,f.link.status(f.id).token);f.link.receipt(f.id,0,randomUUID());
 const manifest=path.join(f.root,'links',f.id+'.json'),all=snapshot([...filenames.map(name=>path.join(f.project,name)),manifest]);
 const next=createClaudeLink({...f.options,stationRoot:path.join(f.root,'next-station')}),rename=fs.renameSync;let failed=false;
 t.mock.method(fs,'renameSync',function(from,to){if(to===manifest&&!failed){failed=true;throw Error('synthetic update failure');}return rename.call(fs,from,to);});
 assert.throws(()=>next.update(f.id,next.status(f.id).token),/synthetic/);assertSnapshot(all);t.mock.restoreAll();assert.equal(next.status(f.id).updateAvailable,true);
});

test('改绑文件夹先停用；不在新目录误写文件；首次创建文件可完整移除',t=>{
 const f=fixture(t);f.link.install(f.id,f.link.status(f.id).token);const other=path.join(f.root,'other');fs.mkdirSync(other);
 assert.throws(()=>f.link.assertWorkspaceChange(f.id,null),/停用/);assert.throws(()=>f.link.assertWorkspaceChange(f.id,other),/停用/);f.link.assertWorkspaceChange(f.id,f.project);
 f.workspace.bind(f.id,other);assert.throws(()=>f.link.status(f.id),/文件夹已改变/);assert.deepEqual(fs.readdirSync(other),[]);
 f.workspace.bind(f.id,f.project);f.link.remove(f.id,f.link.status(f.id).token);assert.deepEqual(fs.readdirSync(f.project),[]);f.link.assertWorkspaceChange(f.id,other);
});

test('读取回执只记录工具观察，UUID 会话可选，拒绝非法版本和任意文本',t=>{
 const f=fixture(t);f.link.install(f.id,f.link.status(f.id).token);const before=JSON.stringify(f.archive),session=randomUUID();
 f.link.receipt(f.id,0,session);assert.equal(f.link.status(f.id).lastRead.sessionId,session);assert.match(f.link.status(f.id).lastRead.source,/工具观察.*不代表/);
 const prior=f.link.status(f.id).lastRead;
 for(const id of ['arbitrary content','',null,{},23])assert.throws(()=>f.link.receipt(f.id,0,id),/UUID/);
 for(const revision of [-1,1,0.5,'0',null])assert.throws(()=>f.link.receipt(f.id,revision),/版本/);
 assert.deepEqual(f.link.status(f.id).lastRead,prior);f.link.receipt(f.id,0);assert.equal(Object.hasOwn(f.link.status(f.id).lastRead,'sessionId'),false);
 f.archive.revision=1;const status=f.link.status(f.id);assert.equal(status.currentRevision,1);assert.equal(status.lastRead.revision,0);f.archive.revision=0;assert.equal(JSON.stringify(f.archive),before);
});

test('草稿只允许 Claude Code 身份，阻止隐私和跨项目，已有批次不覆盖',t=>{
 const f=fixture(t);f.link.install(f.id,f.link.status(f.id).token);const before=JSON.stringify(f.archive);
 assert.throws(()=>f.link.submit(f.id,report(f.id,'Codex')),/Claude Code/);assert.throws(()=>f.link.submit(f.id,report(randomUUID())),/当前项目/);
 const impersonated=report(f.id);impersonated.session.actor.kind='human';assert.throws(()=>f.link.submit(f.id,impersonated),/Claude Code/);
 const privateWork=report(f.id);privateWork.entries[0].source.text='synthetic@example.com';assert.throws(()=>f.link.submit(f.id,privateWork),/隐私/);
 assert.equal(f.inbox.get(f.id),null);f.link.submit(f.id,report(f.id));
 const status=f.link.status(f.id);assert.equal(status.pendingCount,1);assert.equal(status.lastSubmission.sessionId,'claude-synthetic-work');assert.match(status.lastSubmission.source,/不代表用户验收/);
 assert.throws(()=>f.link.submit(f.id,report(f.id,'Claude Code','different-batch')),/已有/);assert.equal(f.inbox.get(f.id).worklog.session.id,'claude-synthetic-work');assert.equal(JSON.stringify(f.archive),before);
 f.link.remove(f.id,f.link.status(f.id).token);assert.equal(f.inbox.get(f.id).worklog.entries.length,1);
});

test('Codex 和 Claude Code 各自保持连接与读取状态，共享待检查区不会互相覆盖',t=>{
 const f=fixture(t),codex=createCodexLink({...f.options,directory:path.join(f.root,'codex-links')});
 codex.install(f.id,codex.status(f.id).token);f.link.install(f.id,f.link.status(f.id).token);
 f.link.receipt(f.id,0,randomUUID());assert.equal(codex.status(f.id).lastRead,null);codex.receipt(f.id,0);
 const codexFiles=snapshot([path.join(f.project,'AGENTS.md'),path.join(f.project,'memory-station-codex.mjs'),path.join(f.root,'codex-links',f.id+'.json')]);
 f.link.submit(f.id,report(f.id));assert.equal(codex.status(f.id).pendingCount,1);assert.equal(codex.status(f.id).lastSubmission,null);
 assert.throws(()=>codex.submit(f.id,report(f.id,'Codex','codex-batch')),/已有/);assert.equal(f.inbox.get(f.id).worklog.session.agent,'Claude Code');
 f.link.remove(f.id,f.link.status(f.id).token);assertSnapshot(codexFiles);assert.equal(codex.status(f.id).configured,true);assert.equal(f.link.status(f.id).configured,false);
});
test('Claude Code AI 明确别名原样收件，Codex 名称仍被拒绝',t=>{const f=fixture(t);f.link.install(f.id,f.link.status(f.id).token);assert.throws(()=>f.link.submit(f.id,report(f.id,'Codex AI')),/整理者/);f.link.submit(f.id,report(f.id,'Claude Code AI'));assert.equal(f.inbox.get(f.id).worklog.session.actor.id,'Claude Code AI');});
