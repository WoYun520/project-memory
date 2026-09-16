import React,{useEffect,useState} from 'react';
import {api,Check,Field} from './ui.jsx';
import {matchesAgentDeclaration} from '../shared/agent-declaration.js';
const labels={codex:'Codex',claude:'Claude Code',grok:'Grok',other:'其他 AI'};
export default function TaskLinkRepair({archive,busy,onSave,onRefresh}){
 const [tickets,setTickets]=useState([]),[version,setVersion]=useState(null),[error,setError]=useState(''),[batch,setBatch]=useState(''),[ticket,setTicket]=useState(''),[selected,setSelected]=useState([]),[reviewed,setReviewed]=useState(false),[checker,setChecker]=useState('human'),[retry,setRetry]=useState(0);
 const groups=new Map();for(const r of archive.work_imports||[]){if(r.task_link)continue;const m=archive.bundle.memories.find(m=>m.id===r.memory_id&&m.lifecycle==='accepted');if(!m)continue;if(!groups.has(r.session_id))groups.set(r.session_id,{id:r.session_id,at:r.imported_at,by:m.by,records:[]});groups.get(r.session_id).records.push(m);}
 const batches=[...groups.values()].reverse(),group=groups.get(batch),options=tickets.filter(t=>group&&group.records.every(m=>matchesAgentDeclaration({agent:m.by.id,actor:m.by},t.target)));
 useEffect(()=>{let live=true;setReviewed(false);setSelected([]);setTicket('');setVersion(null);api(`/projects/${archive.bundle.project.id}/task-link-repair`).then(r=>{if(live){setTickets(r.tickets);setVersion(r.revision);setError('');}}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[archive.bundle.project.id,archive.revision,retry]);
 const outdated=version!==null&&version!==archive.revision;
 return <section aria-label="补充任务归属"><p>只补充已保存记录的分类，原文和核验状态保留。由你选择对应交接，不按内容相似度猜测。</p>
 {error&&<p role="alert">{error}</p>}{outdated&&<p role="alert">保存版本已变化，请重新加载后检查。</p>}
 <button disabled={busy} onClick={()=>{setRetry(n=>n+1);onRefresh();}}>重新加载记录</button>
 {!batches.length?<p>没有需要补充归属的已保存工作记录。</p>:<>
 <Field label="选择哪次返回的记录"><select disabled={busy} value={batch} onChange={e=>{setBatch(e.target.value);setSelected([]);setTicket('');setReviewed(false);}}><option value="">请选择一批记录</option>{batches.map(g=><option key={g.id} value={g.id}>{g.by.id} · {new Date(g.at).toLocaleString('zh-CN')} · {g.records.length} 条 · {g.records[0].claim}</option>)}</select></Field>
 {group&&<><div className="repair-records">{group.records.map(m=><article key={m.id}><Check disabled={busy} checked={selected.includes(m.id)} onChange={e=>{setSelected(e.target.checked?[...selected,m.id]:selected.filter(id=>id!==m.id));setReviewed(false);}}>{m.claim}</Check><p>{m.data.statement||m.data.detail||m.data.action||''}</p><details><summary>查看原始依据</summary>{m.evidence.map(ref=>{const e=archive.bundle.evidence.find(e=>e.id===ref.evidence_id);return <pre key={ref.evidence_id}>{e?.snapshot?archive.snapshots[e.snapshot.path]:'没有可显示的快照'}</pre>;})}</details></article>)}</div>
 <Field label="归到哪次交接"><select disabled={busy} value={ticket} onChange={e=>{setTicket(e.target.value);setReviewed(false);}}><option value="">请选择对应交接</option>{options.slice().reverse().map(t=><option key={t.id} value={t.id}>{t.task} · {labels[t.target]} · {new Date(t.createdAt).toLocaleString('zh-CN')} · {t.id.slice(0,8)}</option>)}</select></Field>
 {!options.length&&<p>没有与这批整理者对应的已读取交接；不能补猜归属。</p>}
 <p>选择任务表示本次人工补充分类，不表示原草稿自带该编号。交接有读取回执也不代表工作完成。</p>
 <Field label="本次检查者"><select value={checker} disabled={busy} onChange={e=>{setChecker(e.target.value);setReviewed(false);}}><option value="human">用户本人</option><option value="agent">AI 检查者</option><option value="tool">工具检查者</option></select></Field>
 <Check checked={reviewed} disabled={busy} onChange={e=>setReviewed(e.target.checked)}>我已对照记录与所选任务，允许补充归属；不代表核验内容或确认任务完成</Check>
 <button className="primary" disabled={busy||!!error||version===null||outdated||!reviewed||!selected.length||!ticket} onClick={()=>onSave({ticket_id:ticket,memory_ids:selected,reviewed:true,reviewer:{kind:checker,id:checker==='human'?'local-user':checker==='agent'?'AI 检查者':'工具检查者'}})}>保存 {selected.length} 条任务归属</button></>}
 </>}
 </section>;
}
