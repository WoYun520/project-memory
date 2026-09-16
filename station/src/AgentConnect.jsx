import React,{useEffect,useRef,useState} from 'react';
import {api,Icon} from './ui.jsx';
import './codex-connect.css';

export default function AgentConnect({agent='codex',projectId,onConnectFolder,onBusyChange=()=>{},setupOnly=false}){
 const claude=agent==='claude',label=claude?'Claude Code':'Codex',base=`/projects/${projectId}/${agent}`;
 const [info,setInfo]=useState(null),[available,setAvailable]=useState(false),[launchMessage,setLaunchMessage]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[copiedText,setCopiedText]=useState(''),[retry,setRetry]=useState(0);
 const epoch=useRef(0),lock=useRef(false);
 useEffect(()=>{let live=true,timer;setInfo(null);setAvailable(false);setError('');setNotice('');setCopiedText('');setLaunchMessage('');
  api(claude?'/claude-code':'/desktop-ai').then(r=>{if(live){setAvailable(claude?r.available:r.targets?.some(t=>t.id==='codex'&&t.available));if(claude&&!r.available)setLaunchMessage(r.message);}}).catch(()=>{if(live)setLaunchMessage('暂时无法检查本机安装，可重新检查或复制说明。');});
  async function poll(){const current=epoch.current;try{const value=await api(base);if(live&&current===epoch.current&&!lock.current){setInfo(value);setError('');}}catch(e){if(live&&current===epoch.current&&!lock.current)setError(e.message);}if(live)timer=setTimeout(poll,3000);}
  poll();return()=>{live=false;clearTimeout(timer);epoch.current++;};
 },[projectId,agent,retry]);
 function active(value){lock.current=value;setBusy(value);onBusyChange(value);}
 async function change(action){if(lock.current||!info)return;active(true);epoch.current++;setError('');setNotice('');try{setInfo(await api(base+'/'+action,{token:info.token}));setNotice(action==='install'?'项目接续已启用，点击打开项目后继续。':action==='update'?'项目接续指引已更新，原有规则保留。':'已停用此项目接续，原项目规则保留。');}catch(e){setError(e.message);}finally{active(false);}}
 async function copyPrompt(text){setCopiedText(text);try{await navigator.clipboard.writeText(text);setNotice('已复制。发到当前项目的 '+label+' 任务中即可。');}catch{setNotice('请手动复制下方说明。');}}
 async function launch(){if(lock.current||error||!info?.configured||info.pendingCount>0)return;active(true);setNotice('');try{const result=await api(claude?base+'/open':'/desktop-ai/open',claude?{}:{target:'codex',projectId});setNotice(result.message);}catch(e){setNotice('没有完成打开。'+e.message);}finally{active(false);}}
 const fresh=info?.lastRead?.revision===info?.currentRevision,date=value=>new Date(value).toLocaleString();
 return <section className="codex-connect codex-continuity" aria-label={label+' 项目接续'}>
  <header><div><h3>{label} 项目接续</h3><p>开工先读记忆，完成工作后送回草稿。</p></div><span>{error?'需要处理':info?.configured?'指引已配置':info?'尚未配置':'检查中'}</span></header>
  {info?.connected?<>
   <details className="codex-folder"><summary>项目文件夹：{info.directory.split('/').filter(Boolean).at(-1)} · 查看位置</summary><code>{info.directory}</code></details>
   {!info.configured?<>
    <p>{claude?'启用会添加本项目的接续指引和启动设置，保留原有 Claude 配置与项目规则。':'启用会添加本项目的接续指引和一个辅助文件。已有规则保留，不修改 Codex 全局设置。'}</p>
    <button type="button" className="primary" disabled={busy||!!error} onClick={()=>change('install')}>{busy?'正在配置…':'一键启用 '+label+' 接续'}</button>
   </>:<>
    {claude&&info.updateAvailable?<><p>更新一次接续设置，启用自动收尾提醒。原有项目规则保留；已打开的 Claude 会话需重新打开。</p><button type="button" className="primary" disabled={busy||!!error} onClick={()=>change('update')}>{busy?'正在更新…':'更新并启用自动收尾'}</button></>:info.pendingCount>0?<p className="muted">先检查上方的新记录，即可带着最新进度继续开工。</p>:setupOnly?<p className="muted">接续已配置。回到上方确认本次任务后开始。</p>:<button type="button" className="primary" disabled={busy||!!error} onClick={()=>available?launch():copyPrompt(info.startPrompt)}>{busy?'正在打开…':available?'在 '+label+' 中打开这个项目':'复制开工说明'}<Icon name="arrow" size={16}/></button>}
    {launchMessage&&<p className="muted">{launchMessage}</p>}
    <p className="muted">{claude?'会在终端打开这个项目，并尝试在会话启动时带入已保存记忆、登记读取回执，以实际回执为准。你直接说明本次任务即可；Claude 若提示登录或项目授权，请在终端完成。':'打开时会尝试带上项目位置，你只需在 Codex 中说明这次要做什么。不会自动发送任务；读取与提交以工具记录为准。'}</p>
    {claude&&<p className="muted">{info.updateAvailable?'更新后可用：':'自动收尾提醒已配置：'}回答结束前提醒 Claude 检查遗漏的工作记录，最多继续一次。只读问答或已提交的内容不重复提交；草稿仍由你检查保存。实际送达看最近提交。直接在别处启动、手动中断或模型报错时，不保证触发收尾。</p>}
    <div className="codex-events" aria-label="接续工具记录"><div><strong>最近读取</strong><p>{info.lastRead?`${date(info.lastRead.at)} · 版本 ${info.lastRead.revision}`:'尚未收到读取记录'}</p>{info.lastRead&&<span className={fresh?'continuity-current':'continuity-stale'}>{fresh?'读取版本与当前保存版本一致':'读过旧版本，需要重新读取'}</span>}{info.lastRead?.sessionId&&<small>读取会话：{info.lastRead.sessionId}</small>}</div><div><strong>最近提交</strong><p>{info.lastSubmission?`${date(info.lastSubmission.at)} · ${info.lastSubmission.count} 条${info.lastSubmission.alreadyImported?'已处理记录':'草稿已接收'}`:'尚未收到工作草稿'}</p>{info.lastSubmission?.sessionId&&<small>工作批次：{info.lastSubmission.sessionId}</small>}</div></div>
    <p className="muted">这是 {label} 最近的工具记录，可能来自其他任务；不代表当前任务已理解正确或用户验收。只读查看不会登记时间。</p>
    <details className="codex-fallback"><summary>没有自动读取？复制补充说明</summary><p>若 AI 没接上记忆，把说明发到当前任务。没有实际新结果时，不必为了刷新状态重复提交。</p><div className="codex-actions"><button type="button" disabled={busy} onClick={()=>copyPrompt(info.startPrompt)}>复制开工说明</button><button type="button" disabled={busy} onClick={()=>copyPrompt(info.readPrompt)}>复制只读说明</button></div></details>
   </>}
   <details><summary>接入设置与文件变更</summary><p>{claude?'仅追加 CLAUDE.md 的记忆站段落，添加 memory-station-claude.mjs 与 memory-station-claude.settings.json；启动时加载这份独立设置。':'仅修改 AGENTS.md 中的记忆站段落，并添加 memory-station-codex.mjs。'}这些本机接入文件不适合直接发布到公共仓库。</p><pre>{info.preview}</pre>
    {info.configured&&info.updateAvailable&&<><p>指引有更新。查看后可更新，原项目规则及工具记录会保留。</p><pre>{info.updatePreview}</pre><button type="button" disabled={busy||!!error} onClick={()=>change('update')}>更新接续指引</button></>}
    {info.configured&&<details><summary>停用项目接续</summary><p>移除记忆站管理的段落及辅助文件。若被手动修改，会保留并提示处理。</p><button type="button" disabled={busy||!!error} onClick={()=>change('remove')}>停用 {label} 接续</button></details>}
   </details>
  </>:info&&<button type="button" disabled={busy} onClick={onConnectFolder}>选择项目文件夹</button>}
  {copiedText&&<label>补充说明<textarea aria-label="已准备的完整指令" readOnly value={copiedText} onFocus={e=>e.target.select()}/></label>}
  {error&&<div role="alert" className="error"><p>{error}</p><p>原文件保留。可重新检查，或使用下方的临时交接。</p><button type="button" disabled={busy} onClick={()=>setRetry(v=>v+1)}>重新检查 {label} 接续</button></div>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
