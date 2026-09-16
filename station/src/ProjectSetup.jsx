import React,{useEffect,useRef,useState} from 'react';
import {api,Icon} from './ui.jsx';
import {privacyIssues} from '../shared/privacy.js';
import './project-setup.css';
import FolderChooser from './FolderChooser.jsx';
export const aiNames={codex:'Codex',claude:'Claude Code',grok:'Grok 终端',other:'其他 AI'};
export function preferredAI(projectId){try{const value=localStorage.getItem('memory-station:target:'+projectId)||localStorage.getItem('memory-station:bridge-target');return aiNames[value]?value:'codex';}catch{return 'codex';}}
export function rememberAI(projectId,target){try{localStorage.setItem('memory-station:target:'+projectId,target);localStorage.setItem('memory-station:bridge-target',target);}catch{}}
export default function ProjectSetup({onComplete,onChanged,onBusyChange,onExistingProject=()=>{}}){
 const [directory,setDirectory]=useState(''),[name,setName]=useState(''),[target,setTarget]=useState(()=>preferredAI('')),[manual,setManual]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[created,setCreated]=useState(null),[uncertain,setUncertain]=useState(false),[enableAgent,setEnableAgent]=useState(true),[candidate,setCandidate]=useState(null);
 const lock=useRef(false);
 const [availability,setAvailability]=useState(null),[check,setCheck]=useState(0);
 useEffect(()=>{let live=true;setAvailability(null);if(!['codex','claude'].includes(target))return;
  api(target==='claude'?'/claude-code':'/desktop-ai').then(value=>{if(live)setAvailability(target==='claude'?value:value.targets?.find(item=>item.id==='codex')||{available:false});}).catch(()=>{if(live)setAvailability({unknown:true});});
  return()=>{live=false;};
 },[target,check]);
 const integrated=target==='codex'||target==='claude',agentLabel=target==='claude'?'Claude Code':'Codex';
 const wrongProject=created&&candidate?.existingProjectId&&candidate.existingProjectId!==created.bundle.project.id;
 function chooseDirectory(value,found){setDirectory(value);setCandidate(found);if(value&&!created)setName(found?.existingProjectName||value.replace(/\/+$/,'').split('/').at(-1));}
 async function connect(e){e.preventDefault();if(lock.current||uncertain||busy||wrongProject)return;lock.current=true;setBusy(true);onBusyChange(true);setError('');let archive=created,phase='folder';
  try{
   if(!archive){
    try{archive=candidate?.existingProjectId?await api('/projects/'+candidate.existingProjectId):await api('/projects',{name:name.trim(),goal:'',reviewed:true});}
    catch(e){if(/fetch|network|load failed|json|unexpected/i.test(e.message)){setUncertain(true);throw Error('还没收到建立结果。请先关闭此窗口，刷新项目列表确认是否已建立，避免重复创建。');}throw e;}
    setCreated(archive);onChanged();
   }
   if(directory.trim())await api('/projects/'+archive.bundle.project.id+'/workspace',{directory:directory.trim()});
   rememberAI(archive.bundle.project.id,target);
   if(integrated&&enableAgent&&directory.trim()){
    phase='agent';const connection=await api('/projects/'+archive.bundle.project.id+'/'+target);
    if(!connection.configured)await api('/projects/'+archive.bundle.project.id+'/'+target+'/install',{token:connection.token});
   }
  }catch(e){setError((archive?(phase==='agent'?'项目和文件夹已连接，'+agentLabel+' 接续尚未完成。原文件已保留，可重试或先手动交接。 ':'项目已建立，文件夹还没连上。原项目会保留，重试不会重复建立。 '):'')+e.message);return;}
  finally{lock.current=false;setBusy(false);onBusyChange(false);}
  onComplete(archive);
 }
 return <form className="project-setup" onSubmit={connect}>
  <div className="setup-heading"><Icon name="folder" size={32}/><h3>让这个项目接上记忆</h3><p>选择文件夹 → 选择 AI → 连接。之后回到原 AI 中工作。</p></div>
  {!manual&&<FolderChooser directory={directory} onDirectory={chooseDirectory} disabled={busy} onBusyChange={value=>{setBusy(value);onBusyChange(value);}}/>}
  {wrongProject&&<div className="notice"><p>这个位置属于另一已有项目。刚建立的项目会保留，可直接打开已有项目继续。</p><button type="button" disabled={busy} onClick={()=>onExistingProject(candidate.existingProjectId)}>打开已有项目</button></div>}
  {candidate?.existingProjectId&&!wrongProject&&<p className="muted">这个文件夹已经连接过，将继续使用已有记忆，不另建副本。</p>}
  {(directory||manual)&&<label className="field"><span>项目名称</span><input aria-label="项目名称" value={name} maxLength={120} onChange={e=>setName(e.target.value)} disabled={busy||!!created||!!candidate?.existingProjectId}/></label>}
  <fieldset disabled={busy}><legend>常用 AI</legend><div className="setup-ai setup-primary-ai">{['codex','claude'].map(id=><button type="button" key={id} aria-pressed={id===target} onClick={()=>setTarget(id)}>{aiNames[id]}</button>)}</div><details className="setup-other" open={!integrated||undefined}><summary>其他 AI（手动接入）</summary><div className="setup-ai setup-primary-ai">{['grok','other'].map(id=><button type="button" key={id} aria-pressed={id===target} onClick={()=>setTarget(id)}>{aiNames[id]}</button>)}</div></details></fieldset>
  {integrated&&<div className="setup-availability" role="status"><strong>{!availability?'正在检查 '+agentLabel+'…':availability.unknown?'暂时无法检查安装':availability.available?'已找到 '+agentLabel:'还没找到 '+agentLabel}</strong><p>{!availability?'只检查本机是否安装，不读取登录信息。':availability?.available?'只检查了本机安装，登录和使用权限请在原 AI 中完成。':availability?.unknown?'可以重试，或先连接项目，稍后手动打开 AI。':target==='codex'?'请先安装 Codex 桌面应用并打开登录；也可以先连接项目，稍后再接续。':'请先安装 Claude Code，并在终端完成首次登录；也可以先连接项目，稍后再接续。'}</p>{availability&&!availability.available&&<button type="button" disabled={busy} onClick={()=>setCheck(v=>v+1)}>重新检查安装</button>}</div>}
  {integrated&&directory.trim()&&<div className="setup-codex"><label><input type="checkbox" checked={enableAgent} disabled={busy} onChange={e=>setEnableAgent(e.target.checked)}/><span>同时启用 {agentLabel} 项目接续</span></label><p>添加本项目的开工读取、工作后提交指引。原有规则保留，不改全局设置。</p><details><summary>会添加哪些文件？</summary><p>{target==='claude'?'在 CLAUDE.md 中追加段落，添加 memory-station-claude.mjs 和独立的 memory-station-claude.settings.json。':'在 AGENTS.md 中追加记忆站段落，并添加 memory-station-codex.mjs。'}已有同名文件或规则冲突时会停止，不覆盖。</p></details></div>}
  <p className="muted">不读取聊天、不导入文件正文。启用 AI 接续时，会写入上述项目指引；否则只连接文件夹位置。</p>
  {error&&<p className="error" role="alert">{error}</p>}
  {privacyIssues({name}).length>0&&<p className="error" role="alert">项目名称可能含有隐私，请修改后再建立。</p>}
  <button className="primary setup-submit" disabled={busy||uncertain||!!wrongProject||!name.trim()||(!directory.trim()&&!manual)||privacyIssues({name}).length>0}>{busy?'正在连接…':created?'重试连接，继续交接':integrated&&enableAgent&&directory.trim()?'连接并启用 '+agentLabel+' 接续':'连接项目，继续交接'}<Icon name="arrow"/></button>
  {created&&error&&<button type="button" className="text-button" disabled={busy} onClick={()=>{rememberAI(created.bundle.project.id,target);onComplete(created);}}>先进入手动交接</button>}
  {!created&&<button type="button" className="text-button" disabled={busy} onClick={()=>{setManual(v=>!v);if(!manual){setDirectory('');setCandidate(null);}}}>{manual?'返回连接项目':'还没有项目文件夹，只建立记忆'}</button>}
 </form>;
}
