import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createWorkspaceConnector,WORKSPACE_LIMITS} from './workspace.mjs';
import {createBundle} from './core.mjs';
import {previewWorklog,importWorklog} from './worklog.mjs';

function setup(t){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'memory-workspace-')),root=path.join(base,'project'),settings=path.join(base,'settings');
 fs.mkdirSync(root);t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const archive=createBundle('文件连接合成项目','用于边界检查'),projectId=archive.bundle.project.id;
 const put=(name,text)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);return file;};
 return {base,root,settings,archive,projectId,put,connector:createWorkspaceConnector({directory:settings})};
}

test('文件夹绑定独立持久化；列文件不读正文；所选原文作为工具观察进入可预览草稿',t=>{
 const x=setup(t),raw='\uFEFF  # 项目方向\r\n\r\n待讨论方案，尚未完成。\r\n';x.put('README.md',raw);x.put('docs/direction.md','另一个说明');
 x.put('docs/unselected.md','password: synthetic-never-previewed');
 const before=JSON.stringify(x.archive),bound=x.connector.bind(x.projectId,x.root);
 assert.deepEqual(bound.candidates.map(f=>f.path),['README.md','docs/direction.md','docs/unselected.md']);
 const settingsBefore=fs.readFileSync(path.join(x.settings,x.projectId+'.json'),'utf8');
 const restarted=createWorkspaceConnector({directory:x.settings});assert.equal(restarted.get(x.projectId).binding.directory,fs.realpathSync(x.root));
 const preview=restarted.preview(x.projectId,['README.md']);
 assert.equal(preview.files[0].excerpt,raw);assert.equal(preview.worklog.entries[0].source.text,raw);assert.equal(preview.worklog.entries[0].source.speaker.kind,'tool');
 assert.equal(preview.worklog.entries[0].origin,'observation');assert.equal(preview.worklog.entries[0].source.redacted,false);
 assert.deepEqual(preview.worklog.session.actor,{kind:'tool',id:'记忆站本机文件读取器'});
 assert.equal(preview.worklog.entries[0].source.file.path,'README.md');assert.equal(preview.worklog.entries[0].source.file.content_sha256,preview.files[0].sha256);
 assert.ok(!JSON.stringify(preview.worklog).includes(x.root));assert.ok(!JSON.stringify(preview.worklog).includes('synthetic-never-previewed'));
 assert.equal(previewWorklog(x.archive,preview.worklog).entries[0].status,'new');
 assert.equal(JSON.stringify(x.archive),before);assert.equal(fs.readFileSync(path.join(x.root,'README.md'),'utf8'),raw);
 assert.equal(fs.readFileSync(path.join(x.settings,x.projectId+'.json'),'utf8'),settingsBefore);assert.equal(fs.readdirSync(x.settings).length,1);
 assert.equal(fs.statSync(path.join(x.settings,x.projectId+'.json')).mode&0o777,0o600);
});

test('拒绝隐私整批返回，检查完整文件而不只检查可见片段；不写入正文',t=>{
 const x=setup(t);x.put('README.md','安全文件');x.put('docs/risk.md','安全段落\n'.repeat(1500)+'\npassword: synthetic-sensitive-value');
 x.connector.bind(x.projectId,x.root);
 assert.throws(()=>x.connector.preview(x.projectId,['README.md','docs/risk.md']),/疑似凭据或隐私/);
 assert.ok(!fs.readFileSync(path.join(x.settings,x.projectId+'.json'),'utf8').includes('synthetic-sensitive-value'));
 assert.deepEqual(fs.readdirSync(x.settings),[x.projectId+'.json']);
});

test('隐藏目录、产物、敏感文件名、大文件、目录链接不列出；越界和伪造路径不读取',t=>{
 const x=setup(t);x.put('README.md','介绍');x.put('docs/design.md','架构讨论');
 for(const name of ['.hidden/README.md','data/README.md','node_modules/README.md','build/README.md','docs/secrets.md','docs/private.md','docs/session.md','docs/.draft.md','docs/logs/trace.md','docs/deep/deeper/note.md','src/code.md'])x.put(name,'排除的内容');
 x.put('docs/large.md','x'.repeat(WORKSPACE_LIMITS.fileBytes+1));
 const outside=path.join(x.base,'outside.md');fs.writeFileSync(outside,'不允许的外部文字');
 fs.symlinkSync(outside,path.join(x.root,'docs','linked.md'));
 fs.symlinkSync(x.base,path.join(x.root,'docs','external'));
 const bound=x.connector.bind(x.projectId,x.root);assert.deepEqual(bound.candidates.map(f=>f.path),['README.md','docs/design.md']);
 for(const p of ['../outside.md',outside,'docs/../README.md','docs/linked.md','docs/external/outside.md','docs/large.md','docs\\design.md'])assert.throws(()=>x.connector.preview(x.projectId,[p]),/列表/);
 assert.throws(()=>x.connector.preview('../escape',['README.md']),/编号/);
});

test('绑定目标或说明文件替换为链接后拒绝读取，断开只移除连接设置',t=>{
 const x=setup(t);x.put('README.md','原项目');x.connector.bind(x.projectId,x.root);
 const outside=path.join(x.base,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'README.md'),'外部材料');
 fs.unlinkSync(path.join(x.root,'README.md'));fs.symlinkSync(path.join(outside,'README.md'),path.join(x.root,'README.md'));
 assert.throws(()=>x.connector.preview(x.projectId,['README.md']),/列表/);
 fs.renameSync(x.root,path.join(x.base,'moved'));fs.symlinkSync(outside,x.root);
 assert.throws(()=>x.connector.get(x.projectId),/文件夹/);
 assert.equal(x.connector.unbind(x.projectId).binding,null);assert.equal(fs.readFileSync(path.join(outside,'README.md'),'utf8'),'外部材料');
 assert.equal(x.connector.get(x.projectId).binding,null);
});

test('重复读取有稳定编号；文件变化生成新批次；旧依据保持逐字原文和待核查身份',t=>{
 const x=setup(t);const raw='首版原文\n保留空白  \n';x.put('README.md',raw);x.connector.bind(x.projectId,x.root);
 const first=x.connector.preview(x.projectId,['README.md']).worklog;
 assert.deepEqual(x.connector.preview(x.projectId,['README.md']).worklog,first);
 const saved=importWorklog(x.archive,{worklog:first,selected_ids:[first.entries[0].id],reviewed:true});
 assert.equal(previewWorklog(saved.archive,first).entries[0].status,'duplicate');
 assert.equal(saved.archive.bundle.memories.at(-1).verification.status,'unverified');assert.equal(saved.archive.bundle.memories.at(-1).approval,undefined);
 assert.equal(saved.archive.bundle.memories.at(-1).by.kind,'tool');
 assert.equal(saved.archive.bundle.evidence.at(-1).kind,'file');assert.equal(saved.archive.bundle.evidence.at(-1).locator.path,'README.md');
 assert.equal(Object.values(saved.archive.snapshots).at(-1),raw);
 x.put('README.md','更新后的原文');const updated=x.connector.preview(x.projectId,['README.md']).worklog;
 assert.notEqual(updated.session.id,first.session.id);assert.equal(previewWorklog(saved.archive,updated).entries[0].status,'new');
 assert.equal(Object.values(saved.archive.snapshots).at(-1),raw);
});

test('截取保持 Unicode 原文；长度、重复选择、非法文字受到限制',t=>{
 const x=setup(t),raw='中'.repeat(3999)+'🌱后续内容';x.put('README.md',raw);x.put('docs/invalid.md',Buffer.from([0xff,0xfe,0]));
 x.connector.bind(x.projectId,x.root);const preview=x.connector.preview(x.projectId,['README.md']);
 assert.equal(preview.files[0].excerpt,raw.slice(0,3999));assert.equal(preview.files[0].truncated,true);
 assert.equal(preview.worklog.entries[0].source.redacted,true);previewWorklog(x.archive,preview.worklog);
 assert.throws(()=>x.connector.preview(x.projectId,[]),/1 至 8/);assert.throws(()=>x.connector.preview(x.projectId,Array(9).fill('README.md')),/1 至 8/);
 assert.throws(()=>x.connector.preview(x.projectId,['README.md','README.md']),/不重复/);assert.throws(()=>x.connector.preview(x.projectId,['docs/invalid.md']),/UTF-8/);
});

test('损坏设置保留原件且不自动恢复为已连接状态',t=>{
 const x=setup(t);x.put('README.md','正常内容');x.connector.bind(x.projectId,x.root);
 const file=path.join(x.settings,x.projectId+'.json');fs.writeFileSync(file,'not json');assert.throws(()=>x.connector.get(x.projectId),/原设置已保留/);
 assert.equal(fs.readFileSync(file,'utf8'),'not json');
});
test('显式连接也拒绝隐藏或敏感祖先与中间链接，保留原设置；普通系统临时路径可用',t=>{
 const x=setup(t);x.put('README.md','普通项目');x.connector.bind(x.projectId,x.root);
 const setting=path.join(x.settings,x.projectId+'.json'),previous=fs.readFileSync(setting,'utf8');
 const hidden=path.join(x.base,'.hidden','project'),sensitive=path.join(x.base,'secrets','project'),ordinary=path.join(x.base,'ordinary','project');
 for(const dir of [hidden,sensitive,ordinary]){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'README.md'),'不应通过别名读取的说明');}
 fs.symlinkSync(path.dirname(hidden),path.join(x.base,'alias'));
 fs.symlinkSync(path.dirname(ordinary),path.join(x.base,'ordinary-alias'));
 for(const target of [hidden,sensitive,path.join(x.base,'alias','project'),path.join(x.base,'ordinary-alias','project')]){
  assert.throws(()=>x.connector.bind(x.projectId,target),error=>/隐藏目录、敏感目录或快捷链接/.test(error.message)&&!error.message.includes(target));
  assert.equal(fs.readFileSync(setting,'utf8'),previous);
 }
 const temp=fs.mkdtempSync(path.join('/tmp','memory-ancestor-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 fs.writeFileSync(path.join(temp,'README.md'),'普通临时项目');
 assert.equal(x.connector.bind(x.projectId,temp).binding.directory,fs.realpathSync(temp));
 assert.equal(x.connector.preview(x.projectId,['README.md']).files[0].excerpt,'普通临时项目');
 assert.equal(x.connector.bind(x.projectId,fs.realpathSync(temp)).binding.directory,fs.realpathSync(temp));
});

test('一个项目目录只连接一个项目，重复绑定幂等，冲突不更改双方设置或档案',t=>{
 const x=setup(t),otherId=createBundle('第二个合成项目','').bundle.project.id,otherRoot=path.join(x.base,'other');fs.mkdirSync(otherRoot);
 x.put('README.md','位置核验不得读取此正文。');fs.writeFileSync(path.join(otherRoot,'README.md'),'第二个项目正文。');
 const first=x.connector.bind(x.projectId,x.root);x.connector.bind(otherId,otherRoot);
 const firstFile=path.join(x.settings,x.projectId+'.json'),otherFile=path.join(x.settings,otherId+'.json'),beforeFirst=fs.readFileSync(firstFile),beforeOther=fs.readFileSync(otherFile),archive=JSON.stringify(x.archive);
 assert.deepEqual(x.connector.bind(x.projectId,x.root+'/.'),first);assert.equal(fs.readFileSync(firstFile).equals(beforeFirst),true);
 const originalRead=fs.readFileSync;t.mock.method(fs,'readFileSync',function(file,...args){if(path.resolve(String(file)).startsWith(path.resolve(x.root)+path.sep)||path.resolve(String(file)).startsWith(path.resolve(otherRoot)+path.sep))assert.fail('唯一性核验不可读取项目正文');return originalRead.call(fs,file,...args);});
 assert.throws(()=>x.connector.bind(otherId,x.root),error=>error.statusCode===409&&error.code==='WORKSPACE_ALREADY_BOUND'&&error.existingProjectId===x.projectId&&/原有连接未更改/.test(error.message));
 assert.equal(fs.readFileSync(firstFile).equals(beforeFirst),true);assert.equal(fs.readFileSync(otherFile).equals(beforeOther),true);assert.equal(JSON.stringify(x.archive),archive);
 const freshId=createBundle('第三个合成项目','').bundle.project.id;assert.throws(()=>x.connector.bind(freshId,x.root),error=>error.code==='WORKSPACE_ALREADY_BOUND');assert.equal(fs.existsSync(path.join(x.settings,freshId+'.json')),false);
 x.connector.unbind(x.projectId);assert.equal(fs.existsSync(firstFile),false);assert.equal(fs.readFileSync(otherFile).equals(beforeOther),true);
 assert.equal(x.connector.bind(otherId,x.root).binding.directory,fs.realpathSync(x.root));
});

test('旧连接位置不可访问时仍只比较元数据，冲突和坏设置不自动清理原件',t=>{
 const x=setup(t),otherId=createBundle('第二个合成项目','').bundle.project.id,otherRoot=path.join(x.base,'other');fs.mkdirSync(otherRoot);
 x.connector.bind(x.projectId,x.root);const firstFile=path.join(x.settings,x.projectId+'.json'),first=fs.readFileSync(firstFile);fs.rmdirSync(x.root);
 assert.equal(x.connector.bind(otherId,otherRoot).binding.directory,fs.realpathSync(otherRoot));assert.equal(fs.readFileSync(firstFile).equals(first),true);
 const otherFile=path.join(x.settings,otherId+'.json'),other=fs.readFileSync(otherFile);fs.writeFileSync(firstFile,'synthetic broken metadata');fs.mkdirSync(x.root);
 assert.throws(()=>x.connector.bind(otherId,x.root),/原设置已保留/);assert.equal(fs.readFileSync(firstFile,'utf8'),'synthetic broken metadata');assert.equal(fs.readFileSync(otherFile).equals(other),true);
 // Reconfirming an unchanged valid connection need not rewrite or repair other settings.
 x.connector.bind(otherId,otherRoot);assert.equal(fs.readFileSync(otherFile).equals(other),true);
});
