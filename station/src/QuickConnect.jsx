import ClaudeDesktop from './ClaudeDesktop.jsx';
import React,{useEffect,useState,useRef} from 'react';
import {api,Icon,download} from './ui.jsx';
import GrokWork from './GrokWork.jsx';
import AgentConnect from './AgentConnect.jsx';
import TaskContinuation from './TaskContinuation.jsx';
import HeldWorklogs from './HeldWorklogs.jsx';
import './start-work.css';
import './memory-bridge.css';
import {preferredAI,rememberAI} from './ProjectSetup.jsx';
function AdvancedConnect({projectId,onReceive,onConnectFolder,revision}){
 const [guides,setGuides]=useState(null),[error,setError]=useState(''),[show,setShow]=useState(false),[notice,setNotice]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let live=true;setGuides(null);setError('');setNotice('');setShow(false);api(`/projects/${projectId}/agent-guide`).then(r=>{if(live)setGuides(r);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[projectId,retry]);
 async function copy(value){setShow(true);try{await navigator.clipboard.writeText(value);setNotice('说明已复制，发给这个项目的 AI 即可。');}catch{setNotice('浏览器没有允许复制，请手动复制下方说明。');}}
 return <div className="quick-connect"><details className="quick-generic-connect"><summary>使用其他 AI：复制开工说明</summary><div className="connect-intro"><Icon name="link" size={30}/><h3>复制一次说明，让 AI 接上项目</h3><p>开工时读取最新已保存记忆，结束后把新结果送回来。你只需在新记录里检查和保存。</p></div><button className="primary" disabled={!guides?.startPrompt} onClick={()=>copy(guides.startPrompt)}><Icon name="copy"/>复制开工说明</button><p className="muted">发给能在这台电脑上运行工具的 AI。每次执行会读取当时最新的已保存版本，无需先生成交接文件。</p>
  {show&&<><textarea className="handoff-text" readOnly aria-label="AI 开工说明" rows={8} value={guides?.startPrompt||''}/><button disabled={!guides?.startPrompt} onClick={()=>download('project-memory-start.md',guides?.startPrompt||'')}>下载接入说明</button></>}
  <ol className="connect-steps"><li><strong>AI 开始工作</strong><span>读取项目目标、进度和试错记录</span></li><li><strong>AI 提交结果</strong><span>只发送已处理隐私的待检查草稿</span></li><li><strong>你决定保留什么</strong><span>检查卡片后保存，下次读取就能带上</span></li></ol>
  <details><summary>AI 已经在工作，只需要送回记录</summary><p className="muted">把下面的提交说明发给它。</p><textarea className="handoff-text" readOnly aria-label="AI 提交说明" rows={6} value={guides?.prompt||''}/><button disabled={!guides?.prompt} onClick={async()=>{try{await navigator.clipboard.writeText(guides.prompt);setNotice('提交说明已复制。');}catch{setNotice('请手动复制上方提交说明。');}}}>复制提交说明</button></details>
  <p className="muted">通用说明由你交给其他 AI，记忆站不会读取它们的会话。待检查草稿单独留在本机，重启后仍在；未保存的草稿不会被当作正式项目记忆。</p><button onClick={onReceive}>查看是否有新记录</button>{notice&&<p role="status">{notice}</p>}{error&&<div><p role="alert" className="error">{error}</p><button onClick={()=>setRetry(value=>value+1)}>重新读取接入说明</button></div>}</details>
 </div>;
}


const targetNames={codex:'Codex',claude:'Claude Code','claude-desktop':'Claude 桌面聊天',grok:'Grok 终端',other:'其他本机 AI'};
export default function QuickConnect({initialSelection=null,projectId,projectName,revision,onReceive,onConnectFolder,inboxDraft,inboxError}){
 const [target,setTarget]=useState(()=>{if(['codex','claude'].includes(initialSelection?.target))return initialSelection.target;try{if(localStorage.getItem('memory-station:target:'+projectId)==='claude-desktop')return 'claude-desktop';}catch{}return preferredAI(projectId);});
 const [status,setStatus]=useState(null),[apps,setApps]=useState(null),[guides,setGuides]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[prepared,setPrepared]=useState(''),[busy,setBusy]=useState(false),[agentBusy,setAgentBusy]=useState(false),[showTools,setShowTools]=useState(false),[showSettings,setShowSettings]=useState(false),[retry,setRetry]=useState(0),[guideError,setGuideError]=useState(''),[connectionError,setConnectionError]=useState('');
 const generation=useRef(0),actionLock=useRef(false),actionEpoch=useRef(0);
 useEffect(()=>{const current=++generation.current;let timer;setStatus(null);setGuides(null);setGuideError('');setConnectionError('');setError('');setPrepared('');setNotice('');
  Promise.allSettled([api(`/projects/${projectId}/agent-guide`),api('/desktop-ai')]).then(([g,a])=>{if(current!==generation.current)return;if(g.status==='fulfilled')setGuides(g.value);else setGuideError('暂时无法取得留给当前 AI 的说明。可以重新读取，或先处理它已经提交的记录。');if(a.status==='fulfilled')setApps(a.value);});
  async function poll(){const epoch=actionEpoch.current;try{const r=await api(`/projects/${projectId}/bridge`);if(current===generation.current&&epoch===actionEpoch.current){setStatus(r);setConnectionError('');}}catch(e){if(current===generation.current)setConnectionError('暂时无法核对交接状态。'+e.message);}if(current===generation.current)timer=setTimeout(poll,3000);}poll();return()=>{generation.current++;clearTimeout(timer);};
 },[projectId,retry]);
 const pending=Math.max(status?.pendingCount||0,inboxDraft?.worklog?.entries?.length||0);
 const integrated=target==='codex'||target==='claude';
 function select(v){setTarget(v);setPrepared('');setNotice('');rememberAI(projectId,v);}
 async function copy(text){setPrepared(text);try{await navigator.clipboard.writeText(text);return true;}catch{return false;}}
 async function leave(){if(!guides?.prompt)return;const text='我要换到另一个 AI 继续这个项目。请只整理你在本次实际工作中知道的目标变化、当前进度、决定与理由、失败尝试、未解决问题，以及下一步建议。不要继续开发，不补写未知经历。原始依据先排除隐私，AI 建议不要写成用户确认。把下方示例中的 AI 名称替换为你自己的实际名称。只提交待检查草稿，不调用正式保存。\n\n'+guides.prompt;const ok=await copy(text);setNotice(ok?'已复制。发给正在工作的 AI，让它先把最新进度送回来。':'请手动复制下方说明，发给正在工作的 AI。');}
 return <div className="memory-bridge">
  <div className="bridge-intro"><span className="eyebrow">PROJECT MEMORY BRIDGE</span><h3>{projectName||'当前项目'}</h3><p>在你熟悉的 AI 里继续工作。这里负责把项目记忆接过去。</p></div>
  <div className="bridge-saved"><Icon name="bookmark"/><div><strong>{status?`已保存到版本 ${status.revision}`:'正在核对项目记忆…'}</strong><span>{pending?`${pending} 条新记录还未进入交接`:'交接会保留目标、进度、试错记录和原始依据'}</span></div></div>

  {pending>0&&<div className="arrival-card" role="status"><div><strong>先处理这 {pending} 条新记录</strong><p>检查后可保存，或整批暂存后继续交接；暂存记录不会进入交接。</p></div><button className="primary" disabled={busy} onClick={onReceive}>检查后继续交接</button></div>}
  <HeldWorklogs projectId={projectId} revision={revision} pending={pending>0} inboxError={inboxError} onReceive={onReceive}/>
  <section className="bridge-arrive"><div className="bridge-step-heading"><Icon name="arrow" size={20}/><h4>切换 AI，接着工作</h4></div>
   <label className="bridge-target">目标 AI<select aria-label="目标 AI" value={target} disabled={busy||agentBusy} onChange={e=>select(e.target.value)}>{Object.entries(targetNames).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
   {target==='claude-desktop'?<ClaudeDesktop key={projectId} projectId={projectId} projectName={projectName} onBusyChange={setAgentBusy}/>:<TaskContinuation key={projectId} initialSelection={initialSelection} projectId={projectId} target={target} onReceive={onReceive} onSetup={()=>setShowSettings(true)} onBusyChange={setAgentBusy}/>}
  </section>
  <details className="bridge-leave"><summary>上一位 AI 还没留下最新进度？</summary><p>如果它已经提交过记录，可以直接往下。记忆站不会自行读取你的聊天窗口。</p><button disabled={!guides||busy} onClick={leave}><Icon name="copy" size={16}/>复制给当前 AI</button></details>
  {notice&&<p className="start-notice" role="status">{notice}</p>}
  {prepared&&<details className="prepared-prompt" open={notice.startsWith('自动复制')||notice.startsWith('请手动')}><summary>查看或手动复制说明</summary><textarea aria-label="交接说明" readOnly rows={6} value={prepared} onFocus={e=>e.target.select()}/></details>}

  {guideError&&<div className="error" role="alert"><p>{guideError}</p><button disabled={busy} onClick={()=>setRetry(v=>v+1)}>重新读取留记录说明</button></div>}
  {(error||connectionError||inboxError)&&<div className="error" role="alert"><p>{error||connectionError||inboxError}</p><button disabled={busy} onClick={()=>setRetry(v=>v+1)}>重新核对连接</button></div>}
  <details className="start-settings" open={showSettings} onToggle={e=>setShowSettings(e.currentTarget.open)}><summary>连接项目文件夹与接入设置</summary>{showSettings&&<>{integrated&&<AgentConnect key={projectId+target} agent={target} projectId={projectId} onConnectFolder={onConnectFolder} onBusyChange={setAgentBusy} setupOnly/>}<button onClick={onConnectFolder}>连接项目文件夹</button><AdvancedConnect projectId={projectId} onReceive={onReceive} onConnectFolder={onConnectFolder} revision={revision}/></>}</details>
  <details className="bridge-extra" onToggle={e=>setShowTools(e.currentTarget.open)}><summary>辅助工具：让 Grok 整理资料</summary>{showTools&&<GrokWork projectId={projectId} revision={revision} onReceive={onReceive} onConnectFolder={onConnectFolder} compact/>}</details>
 </div>;
}
