import React,{useEffect,useState} from 'react';
import {api} from './ui.jsx';
import './workspace-connect.css';
import FolderChooser from './FolderChooser.jsx';

export default function WorkspaceConnect({projectId,initialDirectory='',onStaged=()=>{},onExistingProject=()=>{}}){
 const [directory,setDirectory]=useState(initialDirectory),[connection,setConnection]=useState(null),[selected,setSelected]=useState([]),[preview,setPreview]=useState(null);
 const [busy,setBusy]=useState(false),[loadingConnection,setLoadingConnection]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reviewed,setReviewed]=useState(false),[candidate,setCandidate]=useState(null);
 const wrongProject=candidate?.existingProjectId&&candidate.existingProjectId!==projectId;
 const base=`/projects/${projectId}/workspace`;
 useEffect(()=>{let live=true;setLoadingConnection(true);setConnection(null);setPreview(null);setSelected([]);setReviewed(false);setDirectory(initialDirectory);setError('');setNotice('');api(base).then(r=>{if(live){setConnection(r);setDirectory(r.binding?.directory||initialDirectory);}}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoadingConnection(false);});return()=>{live=false;};},[projectId,initialDirectory]);
 async function run(action){setBusy(true);setError('');setNotice('');try{await action();}catch(e){setError(e.message);}finally{setBusy(false);}}
 function choose(file,checked){setSelected(items=>checked?[...items,file]:items.filter(p=>p!==file));setPreview(null);setReviewed(false);}
 return <section className="workspace-connect" aria-label="连接项目文件夹">
  <p>连接一次项目文件夹，之后直接勾选说明文件，送到待检查区。原项目里的文件保持原样。</p>
  <div className="workspace-binding-status" aria-live="polite">{loadingConnection?'正在读取连接设置…':connection?.binding?<><strong>只读连接已就绪</strong><code aria-label="当前已连接的文件夹">{connection.binding.directory}</code></>:'尚未连接可读取的文件夹'}</div>
  <form className="workspace-path" onSubmit={e=>{e.preventDefault();if(wrongProject||busy||loadingConnection)return;run(async()=>{const result=await api(base,{directory:directory.trim()});setConnection(result);setDirectory(result.binding.directory);setSelected([]);setPreview(null);setReviewed(false);setNotice('连接设置已保存。现在只列出文件名，还没有读取正文；已有待检查记录保持原样。');});}}>
   <FolderChooser directory={directory} projectId={projectId} onDirectory={(value,found)=>{setDirectory(value);setCandidate(found);}} disabled={busy||loadingConnection} onBusyChange={setBusy}/>
   <button className="primary" disabled={busy||loadingConnection||!directory.trim()||!!wrongProject}>{busy?'处理中…':connection?.binding?'更新连接':'连接这个项目'}</button>
   {wrongProject&&<div className="notice"><p>这个位置属于已有项目“{candidate.existingProjectName||candidate.name}”，不会改绑当前项目。</p><button type="button" disabled={busy} onClick={()=>onExistingProject(candidate.existingProjectId)}>打开已有项目</button></div>}
  </form>
  <p className="muted">文件夹位置保存在本机连接设置里，不进入正式记忆或项目备份。本机接入说明可能带上这个位置，方便 AI 找到项目。</p>
  {connection?.binding&&<>
   <div className="workspace-connected"><strong>已连接：{connection.binding.folderName}</strong><button disabled={busy} onClick={()=>run(async()=>{const result=await api(base);setConnection(result);setSelected([]);setPreview(null);setReviewed(false);setNotice('文件列表已刷新。');})}>刷新文件</button><button disabled={busy} onClick={()=>run(async()=>{const result=await api(base,{disconnect:true});setConnection(result);setSelected([]);setPreview(null);setReviewed(false);setNotice('已断开文件夹连接，已保存的记忆不受影响。');})}>断开连接</button></div>
   <p className="muted">可选项目说明和 docs 中的文字文件。每次最多 8 份；敏感文件、快捷链接和大文件不在列表里。</p>
   {connection.candidates.length?<div className="workspace-files">{connection.candidates.map(file=><label key={file.path} className="workspace-file"><input type="checkbox" checked={selected.includes(file.path)} disabled={busy||(!selected.includes(file.path)&&selected.length>=8)} onChange={e=>choose(file.path,e.target.checked)}/><span>{file.path}</span><small>{Math.max(1,Math.ceil(file.bytes/1024))} KB</small></label>)}</div>:<p className="workspace-empty">这里还没有找到可选说明。请连接包含 README.md 或 docs 文件夹的项目目录。</p>}
   {connection.limited&&<p className="muted">文件较多，只展示本次范围内的说明文件。可以连接更具体的项目子文件夹。</p>}
   <button className="primary" disabled={busy||!selected.length} onClick={()=>run(async()=>{const result=await api(base+'/preview',{paths:selected});setPreview(result);setReviewed(false);setNotice('已读取所选文件并完成基础隐私检查，请再查看下面的原文片段。');})}>预览所选 {selected.length} 份说明</button>
  </>}
  {preview&&<div className="workspace-preview"><h3>将送入待检查区的内容</h3><p>保留文件原文。文档里的计划、完成声明和建议都还没有经过核验。</p>{preview.files.map(file=><details key={file.path} open={preview.files.length===1}><summary>{file.path}{file.truncated?' · 仅开头片段':''}</summary><pre>{file.excerpt}</pre></details>)}
   <label className="workspace-review"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} disabled={busy}/><span>我检查了这些片段，没有密码、密钥或不宜保存的隐私。此操作不确认文档中的结论。</span></label>
   <p className="muted">基础检查不能识别所有隐私。发现疑似内容时会整批拦下，请先在本机准备干净的说明副本。</p>
   <button className="primary" disabled={busy||!reviewed} onClick={()=>run(async()=>{const result=await api(`/projects/${projectId}/work-stage`,{worklog:preview.worklog,sourceReviewed:true});if(result.alreadyImported){setPreview(null);setSelected([]);setReviewed(false);setNotice('这些内容已经导入，无需重复添加。');return;}setNotice('已送到待检查区，尚未写入正式记忆。');try{await onStaged(result);}catch{setError('记录已送达，但页面未能刷新。请关闭窗口后查看“新记录”。');}})}>送到待检查区</button>
  </div>}
  {notice&&<p role="status" className="workspace-notice">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
  {error&&!connection?.binding&&!loadingConnection&&<button disabled={busy} onClick={()=>run(async()=>{setConnection(await api(base,{disconnect:true}));setPreview(null);setSelected([]);setReviewed(false);setNotice('已清除本机连接设置，可以重新连接文件夹。');})}>清除失效的连接设置</button>}
 </section>;
}
