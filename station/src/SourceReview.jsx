import React,{useEffect,useState} from 'react';
import {api} from './ui.jsx';
import TaskContinuation from './TaskContinuation.jsx';
import './source-review.css';

export default function SourceReview({archive,evidenceId,onDetail,onReceive,onSetup}){
 const [review,setReview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[target,setTarget]=useState('codex'),[working,setWorking]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{let live=true;setReview(null);setError('');setBusy(true);api(`/projects/${archive.bundle.project.id}/source-review`,{revision:archive.revision,evidenceId}).then(r=>{if(live)setReview(r);}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setBusy(false);});return()=>{live=false;};},[archive.bundle.project.id,archive.revision,evidenceId,retry]);
 return <section className="source-review" aria-label="对照来源变化">
  <p>对照原来保存的内容与本次读取的文件，再让 AI 核对哪些记忆需要更新。这里只准备核对材料，原记忆不改变。</p>
  {busy&&<p role="status">正在读取这份文件。若 Mac 询问权限，请处理提示；读取失败不会沿用上次内容。</p>}
  {error&&<p className="error" role="alert">{error}</p>}
  <button disabled={busy||working} onClick={()=>setRetry(n=>n+1)}>重新读取当前文件</button>
  {review&&<>
   <h3>{review.path}</h3><p className="muted">读取于 {new Date(review.capturedAt).toLocaleString('zh-CN')} · 保存版本 {review.revision} · 临时核对材料</p>
   <p className="notice">{review.status==='same'?'本次读取的完整内容标识与旧依据一致。不要只因之前的提醒而修改记忆。':review.old.text===review.current.text?'文件已变化，但展示片段相同，差异可能在未展示部分。':'文件内容已变化。下面并排展示原文，变化不代表旧决定已失效或功能已完成。'}</p>
   <div className="source-review-columns"><section><h4>原来保存的原文</h4><p>{review.old.selector}{review.old.limited?' · 本页进一步节选':''}</p><pre>{review.old.text}</pre></section><section><h4>本次读取的当前原文</h4><p>{review.current.selector}</p><pre>{review.current.text}</pre></section></div>
   <h3>引用这份依据的 {review.memories.length} 条记忆</h3><p className="muted">引用关系只说明需要核对，不代表这些记忆已经错误。</p>
   <ul>{review.memories.map(m=>{const record=archive.bundle.memories.find(item=>item.id===m.id),data=record?.data||{};return <li key={m.id}><details><summary>{m.title}</summary><p>{data.statement||data.rule||data.choice||data.detail||data.objective||data.action||data.desired_outcome}</p><small>{m.note}</small><button className="text-button" disabled={working} onClick={()=>onDetail(record)}>查看完整记忆与依据</button></details></li>;})}</ul>
   <h3>交给 AI 核对，工作仍在原工具里继续</h3><div className="source-review-targets" role="group" aria-label="选择核对工具">{[['codex','Codex'],['claude','Claude Code'],['other','其他 AI']].map(([id,name])=><button key={id} aria-pressed={target===id} disabled={working} onClick={()=>setTarget(id)}>{name}</button>)}</div>
   <TaskContinuation key={review.id} projectId={archive.bundle.project.id} target={target} sourceReview={review} onReceive={onReceive} onSetup={onSetup} onBusyChange={setWorking}/>
   <p className="muted">结果只进入待检查区。AI 需要列出要更新的记忆编号与理由；不会自动覆盖旧原文或废止用户要求。</p>
  </>}
 </section>;
}
