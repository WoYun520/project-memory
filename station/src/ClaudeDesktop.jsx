import React,{useState,useEffect} from 'react';import {api} from './ui.jsx';
export default function ClaudeDesktop({projectId,projectName,onBusyChange=()=>{}}){
 const [status,setStatus]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{let live=true;api(`/projects/${projectId}/claude-desktop`).then(s=>{if(live)setStatus(s);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[projectId]);
 async function change(action){setBusy(true);onBusyChange(true);setError('');try{const s=await api(`/projects/${projectId}/claude-desktop/${action}`,{});setStatus(s);setNotice(action==='install'?'已配置。请完全退出再打开 Claude，在普通聊天中使用记忆站连接。':'已移除此项目。请完全退出再打开 Claude，让旧进程停止使用原配置。');}catch(e){setError(e.message);}finally{setBusy(false);onBusyChange(false);}}
 return <section className="task-continuation" aria-label="Claude桌面聊天连接"><h4>在 Claude 普通聊天里接上记忆</h4><p>首次连接一次，以后直接告诉 Claude 你要继续哪个项目。只提供这个项目的已保存记忆和提交草稿工具。</p>
 <button className="primary" disabled={busy||!status||!status.ready||!!status.conflict||status.configured} onClick={()=>change('install')}>{status?.configured?'此项目已配置到 Claude':busy?'正在配置…':'连接这个项目到 Claude 桌面聊天'}</button>
 <p className="muted">配置完成后需重新打开 Claude；“已配置”不代表模型已经读取。Claude 里的工具许可由你选择。</p>
 {status?.configured&&<><p>在 Claude 新聊天里可以这样说：</p><blockquote>请通过记忆站连接读取“{projectName}”的最新已保存记忆，说明进度和未确认事项。先不要修改代码或提交记录。</blockquote><button disabled={busy} onClick={()=>change('remove')}>断开这个项目</button></>}
 {!status?.ready&&status&&<p className="error">连接组件尚未就绪，请先安装最新版记忆站。</p>}
 {notice&&<p role="status">{notice}</p>}{(error||status?.conflict)&&<p role="alert" className="error">{error||status.conflict}</p>}
 <p className="muted">这项连接不提供代码执行、正式保存或删除工具。工作仍在 Claude；生成的文字记录送回记忆站后由你检查。</p></section>;
}
