import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createDesktopLauncher} from './desktop-launcher.mjs';

const codexApp='/Applications/Codex.app',chatGPTApp='/Applications/ChatGPT.app',codexId='com.openai.codex';
const options={timeout:10000,maxBuffer:65536,shell:false};
const signatureArgs=app=>['--verify','--deep','--strict','-R=identifier "com.openai.codex" and anchor apple generic and certificate leaf[subject.OU] = "2DC432GLL2"',app];
function project(t,name='Snake game'){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'memory-launcher-'));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const directory=path.join(base,name);fs.mkdirSync(directory);
  return fs.realpathSync(directory);
}
const fakeIdentity=()=>codexId;

test('桌面快捷打开仅使用固定应用路径，不传递任务、材料或 shell 命令',async()=>{
  const calls=[],checked=[];
  const launcher=createDesktopLauncher({platform:'darwin',exists:app=>{checked.push(app);return [codexApp,'/Applications/Claude.app'].includes(app);},readBundleId:fakeIdentity,execute:async(...args)=>{calls.push(args);}});
  assert.deepEqual(launcher.status().targets.map(({id,available,supportsProject})=>({id,available,supportsProject})),[{id:'codex',available:true,supportsProject:true},{id:'claude',available:true,supportsProject:false}]);
  assert.deepEqual(calls,[]);
  const result=await launcher.open('codex');
  assert.deepEqual(result,{target:'codex',dispatched:true,appOnly:true,projectRequested:false,message:'已请求打开 Codex；请在目标 AI 中选择项目并说明本次任务。'});
  await launcher.open('claude');
  assert.deepEqual(calls,[
    ['/usr/bin/codesign',signatureArgs(codexApp),options],
    ['/usr/bin/open',['-a',codexApp],options],
    ['/usr/bin/open',['-a','/Applications/Claude.app'],options],
  ]);
  assert.ok(checked.every(app=>[codexApp,chatGPTApp,'/Applications/Claude.app'].includes(app)));
});

test('名为 ChatGPT 的 Codex 按 bundle ID 识别，打开前重新检查安装',async t=>{
  const directory=project(t),calls=[],identities=[];let present=true;
  const launcher=createDesktopLauncher({platform:'darwin',exists:app=>present&&app===chatGPTApp,readBundleId:app=>{identities.push(app);return codexId;},execute:async(...args)=>{calls.push(args);}});
  assert.equal(launcher.status().targets[0].available,true);
  assert.equal(launcher.status().targets[0].supportsProject,true);
  const result=await launcher.open('codex',{directory});
  assert.equal(result.projectRequested,true);assert.equal(result.appOnly,false);
  assert.deepEqual(calls[0],['/usr/bin/codesign',signatureArgs(chatGPTApp),options]);
  assert.equal(calls[1][1][1],chatGPTApp);
  assert.equal(new URL(calls[1][1][2]).searchParams.get('path'),directory);
  assert.ok(identities.every(app=>app===chatGPTApp));
  present=false;
  await assert.rejects(()=>launcher.open('codex'),{message:'未找到已安装的 Codex 桌面应用，请手动打开目标 AI。'});
  assert.equal(calls.length,2);
});

test('真正 ChatGPT 或伪装成 Codex 文件名的其他 bundle 不被认作 Codex',async t=>{
  const directory=project(t);
  for(const wrongId of ['com.openai.chat','com.example.fake','',null]){
    const launcher=createDesktopLauncher({platform:'darwin',exists:()=>true,readBundleId:()=>wrongId,execute:()=>assert.fail('错误身份不应执行')});
    assert.equal(launcher.status().targets[0].available,false);
    assert.equal(launcher.status().targets[0].supportsProject,false);
    await assert.rejects(()=>launcher.open('codex',{directory}),{message:'未找到已安装的 Codex 桌面应用，请手动打开目标 AI。'});
  }
});

test('未知、路径及命令型 target 均拒绝且不调用执行器',async()=>{
  const launcher=createDesktopLauncher({platform:'darwin',exists:()=>assert.fail('无效 target 不应查询应用'),readBundleId:()=>assert.fail('无效 target 不应读取身份'),execute:()=>assert.fail('无效 target 不应执行')});
  for(const target of ['terminal','/Applications/Claude.app','codex; touch bad','--args','__proto__','constructor',null,{},['codex']]){
    await assert.rejects(()=>launcher.open(target),{message:'不支持这个桌面 AI，只能打开 Codex 或 Claude。'});
    await assert.rejects(()=>launcher.open(target,{directory:'/unused'}),{message:'不支持这个桌面 AI，只能打开 Codex 或 Claude。'});
  }
});

test('未安装时仅报告不可用，不尝试打开、下载或安装',async t=>{
  const directory=project(t);
  const launcher=createDesktopLauncher({platform:'darwin',exists:()=>false,readBundleId:()=>assert.fail('不存在的应用不应读取身份'),execute:()=>assert.fail('未安装时不应执行')});
  assert.equal(launcher.status().supported,true);
  assert.equal(launcher.status().targets.every(target=>!target.available&&!target.supportsProject),true);
  await assert.rejects(()=>launcher.open('claude'),{message:'未找到已安装的 Claude 桌面应用，请手动打开目标 AI。'});
  await assert.rejects(()=>launcher.open('codex',{directory}),{message:'未找到已安装的 Codex 桌面应用，请手动打开目标 AI。'});
});

test('不支持的平台不查应用也不派发打开请求',async()=>{
  for(const platform of ['linux','win32']){
    const launcher=createDesktopLauncher({platform,exists:()=>assert.fail('不支持的平台不应查询应用'),readBundleId:()=>assert.fail('不支持的平台不应读取身份'),execute:()=>assert.fail('不支持的平台不应执行')});
    assert.equal(launcher.status().supported,false);
    assert.equal(launcher.status().targets.every(target=>!target.available&&!target.supportsProject),true);
    await assert.rejects(()=>launcher.open('codex'),{message:'当前系统暂不支持快捷打开桌面 AI，请手动打开目标 AI。'});
    await assert.rejects(()=>launcher.open('codex',{directory:'/unused'}),{message:'当前系统暂不支持快捷打开桌面 AI，请手动打开目标 AI。'});
  }
});

test('启动错误统一提示，不泄露底层输出或误报已开始工作',async()=>{
  const launcher=createDesktopLauncher({platform:'darwin',exists:()=>true,readBundleId:fakeIdentity,execute:async()=>{throw Error('synthetic private execution output');}});
  await assert.rejects(()=>launcher.open('claude'),{message:'无法请求打开 Claude，请手动打开目标 AI。'});
});

test('官方新任务 URL 中空格、中文和符号可准确解码，只传项目不发任务',async t=>{
  const directory=project(t,"Snake 中文 & $(echo nope) 'quote' ; `fake` #1 + 50%?"),calls=[],checked=[];
  const launcher=createDesktopLauncher({platform:'darwin',exists:value=>{checked.push(value);return value===codexApp;},readBundleId:fakeIdentity,execute:async(...args)=>{calls.push(args);}});
  const result=await launcher.open('codex',{directory});
  assert.equal(result.projectRequested,true);assert.equal(result.appOnly,false);
  assert.match(result.message,/尚未发送消息/);assert.match(result.message,/不代表 AI 已读取记忆/);
  assert.deepEqual(calls[0],['/usr/bin/codesign',signatureArgs(codexApp),options]);
  assert.equal(calls.length,2);
  const [command,args,execution]=calls[1];
  assert.equal(command,'/usr/bin/open');assert.deepEqual(execution,options);
  assert.deepEqual(args.slice(0,2),['-a',codexApp]);assert.equal(args.length,3);
  const url=new URL(args[2]);
  assert.equal(url.protocol,'codex:');assert.equal(url.hostname,'threads');assert.equal(url.pathname,'/new');
  assert.deepEqual([...url.searchParams],[['path',directory]]);assert.equal(url.hash,'');
  assert.ok(checked.every(value=>[codexApp,chatGPTApp,'/Applications/Claude.app'].includes(value)));
});

test('不存在、非目录、快捷链接与不合法的项目位置不派发任何请求',async t=>{
  const directory=project(t),file=path.join(directory,'readme.md'),link=path.join(path.dirname(directory),'alias');
  fs.writeFileSync(file,'fixture');fs.symlinkSync(directory,link);
  const launcher=createDesktopLauncher({platform:'darwin',exists:()=>assert.fail('应先校验项目'),readBundleId:()=>assert.fail('应先校验项目'),execute:()=>assert.fail('无效目录不应执行')});
  for(const invalid of [directory+'-missing',file,link,'relative-folder','',null,{},['/unused'],directory+'\0']){
    await assert.rejects(()=>launcher.open('codex',{directory:invalid}));
  }
});

test('非 Codex 指定项目会明确拒绝，不静默打开错误项目',async()=>{
  const launcher=createDesktopLauncher({platform:'darwin',exists:()=>assert.fail('非 Codex 指定项目不应查询应用'),readBundleId:()=>assert.fail('非 Codex 指定项目不应读取身份'),execute:()=>assert.fail('非 Codex 指定项目不应执行')});
  await assert.rejects(()=>launcher.open('claude',{directory:'/unused'}),{message:'目前只有 Codex 支持按已连接的项目打开。'});
});

test('签名失败或打开失败均报错，不降级绕过检查或改为普通打开',async t=>{
  const directory=project(t);
  for(const failure of ['signature','open']){
    const calls=[];
    const launcher=createDesktopLauncher({platform:'darwin',exists:()=>true,readBundleId:fakeIdentity,execute:async(...args)=>{
      calls.push(args);
      if(failure==='signature'||calls.length===2)throw Error('synthetic private failure');
    }});
    await assert.rejects(()=>launcher.open('codex',{directory}),{message:failure==='signature'?'无法核验 Codex 应用身份或官方签名，未打开应用。请检查安装后重试。':'未能请求 Codex 打开这个项目。没有改用其他项目，请重试，或手动打开 Codex 并选择已连接的文件夹。'});
    assert.equal(calls.length,failure==='signature'?1:2);
    assert.equal(calls.filter(call=>call[0]==='/usr/bin/open').length,failure==='signature'?0:1);
  }
});

test('普通 Codex 打开同样需要官方签名，不存在绕过路径',async()=>{
  const calls=[];
  const launcher=createDesktopLauncher({platform:'darwin',exists:()=>true,readBundleId:fakeIdentity,execute:async(...args)=>{calls.push(args);throw Error('synthetic signature failure');}});
  await assert.rejects(()=>launcher.open('codex'),/无法核验 Codex 应用身份或官方签名/);
  assert.deepEqual(calls,[['/usr/bin/codesign',signatureArgs(codexApp),options]]);
});

test('检查期间应用身份或目录变化时停止，不打开其他项目',async t=>{
  for(const changed of ['app','identity','directory']){
    const directory=project(t),calls=[];let appPresent=true,identity=codexId;
    const launcher=createDesktopLauncher({platform:'darwin',exists:value=>value===codexApp&&appPresent,readBundleId:()=>identity,execute:async(...args)=>{
      calls.push(args);
      if(changed==='app')appPresent=false;else if(changed==='identity')identity='com.openai.chat';else fs.rmdirSync(directory);
    }});
    await assert.rejects(()=>launcher.open('codex',{directory}),changed==='directory'?/未能请求 Codex 打开这个项目/:/无法核验 Codex 应用身份或官方签名/);
    assert.equal(calls.length,1);assert.equal(calls[0][0],'/usr/bin/codesign');
  }
});

test('无法读取 bundle 身份时状态为不可用且不尝试启动',async()=>{
  const launcher=createDesktopLauncher({platform:'darwin',exists:()=>true,readBundleId:()=>{throw Error('synthetic plist failure');},execute:()=>assert.fail('不能读取身份时不应执行')});
  assert.equal(launcher.status().targets[0].available,false);
  await assert.rejects(()=>launcher.open('codex'),/未找到已安装的 Codex/);
});

test('签名期间新增草稿时派发前检查拦截，保留原错误且不影响普通打开',async t=>{
  const directory=project(t),calls=[],blocked=Object.assign(Error('有新记录等待检查，请先处理，再打开项目。'),{statusCode:409});let pending=0,checked=0;
  const launcher=createDesktopLauncher({platform:'darwin',exists:()=>true,readBundleId:fakeIdentity,execute:async(...args)=>{calls.push(args);if(args[0]==='/usr/bin/codesign')pending=1;}});
  await assert.rejects(()=>launcher.open('codex',{directory,beforeDispatch(){checked++;assert.equal(calls.length,1);if(pending)throw blocked;}}),error=>error===blocked);
  assert.equal(checked,1);assert.deepEqual(calls,[['/usr/bin/codesign',signatureArgs(codexApp),options]]);
  calls.length=0;
  const ordinary=await launcher.open('codex');assert.equal(ordinary.appOnly,true);
  assert.deepEqual(calls,[['/usr/bin/codesign',signatureArgs(codexApp),options],['/usr/bin/open',['-a',codexApp],options]]);
  calls.length=0;
  for(const invalid of [null,{},'callback',true])await assert.rejects(()=>launcher.open('codex',{directory,beforeDispatch:invalid}),/打开前检查必须是本机检查函数/);
  assert.deepEqual(calls,[]);
});
