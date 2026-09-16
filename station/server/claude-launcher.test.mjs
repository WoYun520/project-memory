import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createClaudeLauncher} from './claude-launcher.mjs';

const id='ef68a7f8-2af5-4e2b-8d63-04dfd64137f5';
const probeOptions={timeout:5000,maxBuffer:4096,shell:false};
const launchOptions={timeout:10000,maxBuffer:65536,shell:false};
function fixture(t,{name='Snake game',...overrides}={}){
 const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'memory-claude-launch-')));
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const root=path.join(base,name),home=path.join(base,'home'),directory=path.join(base,'launchers');
 fs.mkdirSync(root);fs.mkdirSync(path.join(home,'.local','bin'),{recursive:true});
 const settingsFile=path.join(root,'memory-station-claude.settings.json');fs.writeFileSync(settingsFile,'{"hooks":{}}',{mode:0o600});
 const cli=path.join(home,'.local','bin','claude');fs.writeFileSync(cli,'fixture executable',{mode:0o700});
 const info={connected:true,configured:true,pendingCount:0,directory:root,settingsFile};
 const calls=[],queried=[];
 const args={directory,home,platform:'darwin',workspace:{getBinding:()=>({directory:root})},claudeLink:{status:()=>info},isExecutable:file=>{queried.push(file);return file===cli;},execute:async(...args)=>{calls.push(args);return {stdout:'2.1.40 (Claude Code)\n'};},...overrides};
 return {base,root,home,directory,settingsFile,cli,info,calls,queried,args,launcher:createClaudeLauncher(args)};
}

test('只探测固定安装入口和版本，不读认证配置、不返回底层输出',async t=>{
 const f=fixture(t);
 assert.deepEqual(await f.launcher.status(),{available:true,version:'2.1.40',message:'可以在已连接的项目中打开 Claude Code；请在终端说明本次任务。'});
 assert.deepEqual(f.calls,[[f.cli,['--version'],probeOptions]]);
 assert.deepEqual(f.queried,[f.cli,f.cli]);
 assert.equal(fs.existsSync(f.directory),false);
 assert.equal(fs.readdirSync(f.root).length,1);
});

test('打开只派发固定 Terminal 命令，不发送任务或修改运行权限',async t=>{
 const f=fixture(t),result=await f.launcher.open(id),command=path.join(f.directory,id+'.command');
 assert.equal(result.dispatched,true);assert.equal(result.projectRequested,true);assert.equal(result.appOnly,false);
 assert.match(result.message,/尚未发送消息/);assert.match(result.message,/不代表 AI 已读取记忆/);
 assert.deepEqual(f.calls,[[f.cli,['--version'],probeOptions],['/usr/bin/open',['-a','Terminal',command],launchOptions]]);
 const script=fs.readFileSync(command,'utf8');
 assert.match(script,/^#!\/bin\/zsh\n/);assert.match(script,/\ncd -- /);assert.match(script,/ --settings /);
 assert.equal(script.includes('--print'),false);assert.equal(script.includes('--dangerously-skip-permissions'),false);assert.equal(script.includes('--model'),false);
 assert.equal(fs.statSync(command).mode&0o777,0o700);assert.equal(fs.statSync(path.join(f.directory,id+'.json')).mode&0o777,0o600);
 assert.equal(fs.statSync(f.directory).mode&0o777,0o700);
 assert.equal(fs.readFileSync(f.settingsFile,'utf8'),'{"hooks":{}}');
 assert.deepEqual(fs.readdirSync(f.root),['memory-station-claude.settings.json']);
 const metadata=JSON.parse(fs.readFileSync(path.join(f.directory,id+'.json')));
 assert.deepEqual(Object.keys(metadata).sort(),['format','projectId','sha256']);
});

test('目录空格、单引号和 shell 符号保持原值，不成为命令',async t=>{
 const f=fixture(t,{name:"Snake 中文 'quote' ; $(printf BAD) `printf BAD` & #"});
 const record=path.join(f.base,'argv.json');
 fs.writeFileSync(f.cli,`#!${process.execPath}\nimport fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(record)},JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}));\n`,{mode:0o700});
 await f.launcher.open(id);
 // Only this isolated fixture script is executed. Its fake CLI records argv;
 // no installed AI, terminal window, model or permission flow is started.
 execFileSync('/bin/zsh',[path.join(f.directory,id+'.command')],{timeout:5000});
 assert.deepEqual(JSON.parse(fs.readFileSync(record)),{cwd:f.root,args:['--settings',f.settingsFile]});
 assert.deepEqual(fs.readdirSync(f.root),['memory-station-claude.settings.json']);
});

test('原生安装快捷链接可以探测，脚本仍仅使用固定 CLI 入口',async t=>{
 const f=fixture(t),native=path.join(f.base,'native-claude');
 fs.unlinkSync(f.cli);fs.writeFileSync(native,'fixture',{mode:0o700});fs.symlinkSync(native,f.cli);
 const launcher=createClaudeLauncher({...f.args,isExecutable:undefined});
 assert.equal((await launcher.status()).available,true);
 await launcher.open(id);
 assert.match(fs.readFileSync(path.join(f.directory,id+'.command'),'utf8'),new RegExp(f.cli.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 assert.deepEqual(f.calls.slice(0,2).map(call=>call.slice(0,2)),[[f.cli,['--version']],[f.cli,['--version']]]);
});

test('缺少 CLI 时不安装或打开；版本失败和异常输出不会外泄',async t=>{
 const f=fixture(t),secret='synthetic unrelated authentication output';
 const missing=createClaudeLauncher({...f.args,isExecutable:()=>false,execute:()=>assert.fail('不存在时不执行')});
 assert.equal((await missing.status()).available,false);
 await assert.rejects(()=>missing.open(id),/未找到可用的 Claude Code/);
 for(const execute of [async()=>{throw Error(secret);},async()=>({stdout:secret}),async()=>({stdout:'2.1.40\n'+secret}),async()=>({stdout:''})]){
  const launcher=createClaudeLauncher({...f.args,execute}),status=await launcher.status();
  assert.equal(status.available,false);assert.equal(status.version,null);assert.equal(JSON.stringify(status).includes(secret),false);
  await assert.rejects(()=>launcher.open(id),error=>!error.message.includes(secret)&&/未找到可用/.test(error.message));
 }
 assert.equal(fs.existsSync(f.directory),false);
});

test('依次检查三处固定入口，不搜索 PATH，也不使用其他命令',async t=>{
 const f=fixture(t),queried=[],calls=[];
 const launcher=createClaudeLauncher({...f.args,isExecutable:file=>{queried.push(file);return file!=='/opt/homebrew/bin/claude';},execute:async(...args)=>{calls.push(args);if(args[0]===f.cli)throw Error('unusable');return {stdout:'2.1.41'};}});
 assert.equal((await launcher.status()).version,'2.1.41');
 assert.deepEqual(queried,[f.cli,'/opt/homebrew/bin/claude','/usr/local/bin/claude','/usr/local/bin/claude']);
 assert.deepEqual(calls,[[f.cli,['--version'],probeOptions],['/usr/local/bin/claude',['--version'],probeOptions]]);
});

test('非 Mac 不探测、不生成文件也不启动',async t=>{
 const f=fixture(t);
 for(const platform of ['linux','win32']){
  const launcher=createClaudeLauncher({...f.args,platform,isExecutable:()=>assert.fail('非 Mac 不探测'),execute:()=>assert.fail('非 Mac 不执行')});
  assert.equal((await launcher.status()).available,false);
  await assert.rejects(()=>launcher.open(id),/当前系统暂不支持/);
 }
 assert.equal(fs.existsSync(f.directory),false);
});

test('无效编号、未连接、未启用和待检查记录阻止启动',async t=>{
 const f=fixture(t,{execute:()=>assert.fail('无效状态不得探测或打开')});
 for(const invalid of ['../bad','/tmp/bad','__proto__','',null,{},[id],id+';echo'])await assert.rejects(()=>f.launcher.open(invalid),/项目编号无效/);
 await assert.rejects(()=>createClaudeLauncher({...f.args,workspace:{getBinding:()=>null}}).open(id),/请先连接/);
 for(const field of ['configured','connected']){
  f.info[field]=false;await assert.rejects(()=>f.launcher.open(id),/请先启用/);f.info[field]=true;
 }
 f.info.pendingCount=1;await assert.rejects(()=>f.launcher.open(id),/还有待检查记录/);
 for(const value of [undefined,-1,0.5,'0']){f.info.pendingCount=value;await assert.rejects(()=>f.launcher.open(id),/无法确认待检查记录/);}
 assert.equal(fs.existsSync(f.directory),false);
});

test('无效根目录、目录变更和 managed settings 链接不派发',async t=>{
 const f=fixture(t,{execute:()=>assert.fail('无效文件不得探测或打开')}),file=path.join(f.base,'ordinary-file'),link=path.join(f.base,'alias');
 fs.writeFileSync(file,'fixture');fs.symlinkSync(f.root,link);
 for(const invalid of [file,link,f.root+'-missing','relative',null])await assert.rejects(()=>createClaudeLauncher({...f.args,workspace:{getBinding:()=>({directory:invalid})}}).open(id));
 f.info.directory=file;await assert.rejects(()=>f.launcher.open(id),/项目连接位置已变化/);f.info.directory=f.root;
 fs.unlinkSync(f.settingsFile);fs.symlinkSync(file,f.settingsFile);
 await assert.rejects(()=>f.launcher.open(id),/本机启动文件已变化/);
 assert.equal(fs.existsSync(f.directory),false);
});

test('接续校验抛错时停止，异步探测后重新核对草稿和路径',async t=>{
 const f=fixture(t);
 await assert.rejects(()=>createClaudeLauncher({...f.args,claudeLink:{status:()=>{throw Error('managed hash mismatch');}}}).open(id),/managed hash mismatch/);
 assert.deepEqual(f.calls,[]);
 for(const change of ['pending','settings']){
  f.info.pendingCount=0;f.info.settingsFile=f.settingsFile;
  const changed=path.join(f.root,'different.settings.json');fs.writeFileSync(changed,'{}');
  const calls=[];
  const launcher=createClaudeLauncher({...f.args,execute:async(...args)=>{calls.push(args);if(change==='pending')f.info.pendingCount=1;else f.info.settingsFile=changed;return {stdout:'2.1.40'};}});
  await assert.rejects(()=>launcher.open(id),change==='pending'?/待检查记录/:/位置已变化/);
  assert.equal(calls.length,1);assert.deepEqual(calls[0].slice(0,2),[f.cli,['--version']]);
 }
 assert.equal(fs.existsSync(f.directory),false);
});

test('每个项目复用同一启动文件，不积累临时文件',async t=>{
 const f=fixture(t);await f.launcher.open(id);
 const command=path.join(f.directory,id+'.command'),before=fs.statSync(command);
 await f.launcher.open(id);await f.launcher.open(id);
 assert.deepEqual(fs.readdirSync(f.directory).sort(),[id+'.command',id+'.json']);
 assert.equal(fs.statSync(command).mtimeMs,before.mtimeMs);
 assert.equal(f.calls.filter(call=>call[0]==='/usr/bin/open').length,3);
});

test('未知文件、用户修改、损坏元数据和链接均保留原文件且不打开',async t=>{
 for(const change of ['unknown','edited','metadata','symlink','hardlink','mode','missing-script','missing-manifest']){
  const f=fixture(t);await f.launcher.open(id);f.calls.length=0;
  const command=path.join(f.directory,id+'.command'),manifest=path.join(f.directory,id+'.json');
  if(change==='unknown'){fs.unlinkSync(manifest);fs.writeFileSync(command,'user-owned command');}
  if(change==='edited')fs.appendFileSync(command,'# user change\n');
  if(change==='metadata')fs.writeFileSync(manifest,'broken json');
  if(change==='symlink'){fs.unlinkSync(command);fs.symlinkSync(f.settingsFile,command);}
  if(change==='hardlink'){fs.unlinkSync(command);fs.linkSync(f.settingsFile,command);}
  if(change==='mode')fs.chmodSync(command,0o755);
  if(change==='missing-script')fs.unlinkSync(command);
  if(change==='missing-manifest')fs.unlinkSync(manifest);
  const before=fs.existsSync(command)?fs.readFileSync(command):null;
  await assert.rejects(()=>f.launcher.open(id),/本机启动文件已变化/);
  assert.equal(f.calls.some(call=>call[0]==='/usr/bin/open'),false);
  assert.deepEqual(fs.existsSync(command)?fs.readFileSync(command):null,before);
 }
});

test('启动目录本身或父目录为快捷链接时拒绝，不修改指向位置',async t=>{
 const f=fixture(t),target=path.join(f.base,'other-folder');fs.mkdirSync(target,{mode:0o700});fs.symlinkSync(target,f.directory);
 await assert.rejects(()=>f.launcher.open(id),/本机启动文件已变化/);
 assert.deepEqual(fs.readdirSync(target),[]);
 const nested=createClaudeLauncher({...f.args,directory:path.join(f.directory,'child')});
 await assert.rejects(()=>nested.open(id),/本机启动文件已变化/);
 assert.deepEqual(fs.readdirSync(target),[]);
 assert.equal(f.calls.some(call=>call[0]==='/usr/bin/open'),false);
});

test('启动失败不泄露底层输出，也不声称已工作或改用其他启动方式',async t=>{
 const f=fixture(t),calls=[];
 const launcher=createClaudeLauncher({...f.args,execute:async(...args)=>{calls.push(args);if(args[0]==='/usr/bin/open')throw Error('synthetic private system output');return {stdout:'2.1.40 (Claude Code)'};}});
 await assert.rejects(()=>launcher.open(id),error=>/无法请求终端打开/.test(error.message)&&!error.message.includes('synthetic'));
 assert.equal(calls.length,2);assert.equal(calls[1][0],'/usr/bin/open');
});

test('任务作为一个独立 CLI 参数传入；不同交接脚本互不覆盖，不放宽权限',async t=>{
 const f=fixture(t),one='11111111-1111-4111-8111-111111111111',two='22222222-2222-4222-8222-222222222222';
 const prompt="先读项目记忆，再增加暂停按钮。保留 '引号' 和 $(printf BAD) `printf BAD`\n第二行";
 let checked=0;
 const bridge={launchPrompt:(projectId,ticketId,target)=>{assert.equal(projectId,id);assert.ok([one,two].includes(ticketId));assert.equal(target,'claude');checked++;return prompt;}};
 const launcher=createClaudeLauncher({...f.args,bridge});
 const record=path.join(f.base,'argv.json');
 fs.writeFileSync(f.cli,`#!${process.execPath}\nimport fs from 'node:fs';fs.writeFileSync(${JSON.stringify(record)},JSON.stringify(process.argv.slice(2)));`,{mode:0o700});
 const result=await launcher.open(id,{ticketId:one});
 assert.equal(result.taskRequested,true);assert.equal(checked,2);
 const script=path.join(f.directory,id+'-'+one+'.command'),original=fs.readFileSync(script);
 execFileSync('/bin/zsh',[script],{timeout:5000});
 assert.deepEqual(JSON.parse(fs.readFileSync(record)),['--settings',f.settingsFile,prompt]);
 await launcher.open(id,{ticketId:two});assert.ok(fs.readFileSync(script).equals(original));
 assert.doesNotMatch(original.toString(),/dangerously-skip|--model|--print/);
});

test('异步探测后任务交接过期，不派发已准备的任务',async t=>{
 const f=fixture(t);let checks=0;
 const launcher=createClaudeLauncher({...f.args,bridge:{launchPrompt:()=>{if(++checks===2)throw Error('版本已过期');return '安全的合成任务';}}});
 await assert.rejects(()=>launcher.open(id,{ticketId:'11111111-1111-4111-8111-111111111111'}),/版本已过期/);
 assert.equal(f.calls.some(c=>c[0]==='/usr/bin/open'),false);
});
