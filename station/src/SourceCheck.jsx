import React,{useEffect,useState} from 'react';
import {api} from './ui.jsx';
import {sourceLabels,sourceCheckSummary} from '../shared/source-check.js';

export default function SourceCheck({archive,onDetail,onConnect,onCompare,refreshToken}){
 const id=archive.bundle.project.id,revision=archive.revision;
 const [state,setState]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let live=true;setState(null);setError('');api(`/projects/${id}/source-check`).then(r=>{if(live)setState(r);}).catch(()=>{if(live)setError('来源检查暂时不可用。');});return()=>{live=false;};},[id,revision,refreshToken]);
 async function check(){setBusy(true);setError('');try{setState(await api(`/projects/${id}/source-check`,{revision}));}catch(e){setError(e.message);}finally{setBusy(false);}}
 const report=state?.report?.revision===revision?state.report:null,attention=report?.rows.filter(row=>row.status!=='same')||[];
 return <section className="source-check" aria-label="文件来源变化">
  <div className="source-check-heading"><div><h2>文件来源有没有变化？</h2><p>切换 AI 时自动检查已存为依据的项目说明，也可在这里手动检查。不扫描聊天或其他文件。</p></div><button disabled={busy||!state||state.checking} onClick={state?.connected?check:onConnect}>{busy?'正在检查…':state?.connected?'检查来源变化':'连接项目文件夹'}</button></div>
  {state?.count===0&&<p>还没有可比较的文件依据。<button className="text-button" onClick={onConnect}>选择项目说明，预览并保存</button></p>}
  {error&&<p role="alert" className="error">{error}</p>}
  {!error&&state?.error&&<p role="status">{state.error}</p>}
  {(busy||state?.checking)&&<p role="status">如果 Mac 询问读取权限，请在电脑上处理提示；检查结束前不会显示通过。</p>}
  {report&&<div aria-live="polite"><p><strong>{sourceCheckSummary(report)}</strong> · {new Date(report.checkedAt).toLocaleString('zh-CN')}</p>
   <p className="muted">结果会随同一保存版本的后续交接带给 AI。它只是这次检查的观察，不判断记忆对错；旧原文仍保留。</p>
   <details open={attention.length>0}><summary>查看 {report.rows.length} 份来源的结果</summary>{report.rows.map(row=><div className="source-check-row" key={row.evidenceId}><strong>{sourceLabels[row.status]}</strong><span>{row.path||'不支持的来源路径'}</span><div>{row.memoryIds.map(mid=>{const m=archive.bundle.memories.find(m=>m.id===mid);return m&&<button key={mid} className="text-button" onClick={()=>onDetail(m)}>查看记忆与旧原文：{m.claim}</button>;})}</div>{row.status==='changed'&&<button className="text-button" disabled={busy} onClick={()=>onCompare(row.evidenceId)}>对照变化并交给 AI 核对</button>}{row.status==='unavailable'&&<small>可能是文件已移走、权限受限或内容不适合读取；未取得比较结果。</small>}</div>)}</details>
  </div>}
 </section>;
}
