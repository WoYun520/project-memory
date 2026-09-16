import React,{useEffect,useRef,useState} from 'react';
import {api,Icon} from './ui.jsx';
import './folder-chooser.css';

// Receiving a location fills the form only. The enclosing form owns the final connection.
export default function FolderChooser({directory,onDirectory,projectId,disabled=false,onBusyChange=()=>{}}){
 const [request,setRequest]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const lock=useRef(false),alive=useRef(true),change=useRef(onDirectory),received=useRef('');
 change.current=onDirectory;
 const picker=window.webkit?.messageHandlers?.memoryFolder;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{
  if(!request?.id||request.candidate)return;
  let live=true,timer;
  async function poll(){try{
   const next=await api('/folder-requests/'+request.id);
   if(live){setRequest(next);if(next.candidate&&received.current!==next.id){received.current=next.id;change.current(next.candidate.directory,next.candidate);setNotice('AI 已送来项目位置。请核对项目名，再点击下方连接。');}}
  }catch(e){if(live){setError(e.message);setRequest(null);}return;}
   if(live)timer=setTimeout(poll,2000);
  }poll();return()=>{live=false;clearTimeout(timer);};
 },[request?.id,!!request?.candidate]);
 async function run(action){if(disabled||lock.current)return;lock.current=true;setBusy(true);onBusyChange(true);setError('');try{await action();}catch(e){if(alive.current)setError(e.message||'暂时没有完成，请重试。');}finally{lock.current=false;if(alive.current){setBusy(false);onBusyChange(false);}}}
 async function copyPrompt(value){try{await navigator.clipboard.writeText(value.prompt);if(alive.current)setNotice('已复制。发给正在做这个项目的本机 AI，然后回到这里。');}catch{if(alive.current)setNotice('请展开下方说明，手动复制给当前 AI。');}}
 function choose(value){setRequest(null);setNotice('');setError('');onDirectory(value,null);}
 return <div className="folder-chooser" aria-label="选择项目位置">
  {picker&&<button type="button" className="folder-pick" disabled={disabled||busy} onClick={()=>run(async()=>{const result=await picker.postMessage('choose-project');if(alive.current&&result?.directory)choose(result.directory);})}><Icon name="folder"/><span>{directory?'重新选择项目文件夹':'选择项目文件夹'}</span><small>从电脑中直接选择，无需填写路径</small></button>}
  <details className="folder-alternative" open={!picker||undefined}><summary>找不到文件夹？让当前 AI 帮忙</summary>
  <div className="folder-ai-intake"><strong>不知道项目放在哪？让当前 AI 帮你找到</strong><p>把接入说明发给正在做这个项目的本机 AI，它会把位置送到这里。</p>
   <button type="button" disabled={disabled||busy} onClick={()=>run(async()=>{const value=request||await api('/folder-requests',projectId?{projectId}:{});if(!alive.current)return;setRequest(value);await copyPrompt(value);})}><Icon name="copy" size={16}/>{busy?'正在准备…':request?'重新复制接入说明':'复制给当前 AI'}</button>
   {request&&!request.candidate&&<p role="status">等待 AI 送来项目位置… 收到后会自动显示。请保持此窗口打开。</p>}
   {request?.candidate&&<p className="folder-found" role="status">已找到：{request.candidate.existingProjectName||request.candidate.name}{request.candidate.existingProjectId?' · 已有项目':''}</p>}
   {request&&<details><summary>查看接入说明</summary><textarea aria-label="项目位置接入说明" readOnly value={request.prompt} onFocus={e=>e.target.select()}/><p>仅限能访问这台电脑的 AI。普通网页聊天无法直接找到本机项目。</p></details>}
  </div></details>
  {directory&&<details className="folder-location"><summary>项目位置：{directory.split('/').filter(Boolean).at(-1)}</summary><code>{directory}</code></details>}
  <details className="folder-manual"><summary>手动填写项目位置</summary><label className="field"><span>项目文件夹路径</span><input aria-label="项目文件夹路径" autoComplete="off" spellCheck="false" value={directory} onChange={e=>choose(e.target.value)} disabled={disabled||busy} placeholder="粘贴本机项目文件夹的完整路径"/></label></details>
  {notice&&<p className="folder-notice" role="status">{notice}</p>}{error&&<p className="error" role="alert">{error}</p>}
 </div>;
}
