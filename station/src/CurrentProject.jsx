import React from 'react';
import {currentProject} from '../shared/current-project.js';
import {actorLabel} from '../shared/attribution.js';
function Rows({items,children,empty}){return items.length?<>{items.slice(0,4).map(children)}{items.length>4&&<details><summary>再看 {items.length-4} 条</summary>{items.slice(4).map(children)}</details>}</>:<p className="muted">{empty}</p>;}
export default function CurrentProject({archive,onDetail,onRevise,onProgress}){
 const x=currentProject(archive.bundle.memories);
 const title=m=><><button className="current-record-title" onClick={()=>onDetail(m)}>{m.claim}</button>{m.scope.condition&&<small className="scope-condition">追加适用条件：{m.scope.condition}</small>}</>;
 return <section className="current-project" aria-label="当前项目情况">
  <div className="section-heading"><div><h2>当前项目情况</h2><p>来自已保存版本 {archive.revision} · 要求已确定，不代表功能已实现</p></div></div>
  <p className="muted">按已有记录与明确关联整理。未自动核对代码，也不会按“谁说得晚”决定谁正确。点记录标题查看原始依据。</p>
  <div className="current-project-grid">
   <article><h3>现在按什么做 <small>{x.current.length}</small></h3><Rows items={x.current} empty="还没有可列为当前目标或已确认完整要求的记录。">{({memory:m,implementation})=><div className="current-record" key={m.id}>{title(m)}<p>{m.data.rule||m.data.choice||m.data.desired_outcome}</p>{implementation?<><small>确认人：{actorLabel(m.approval.by)} · 仅限这条要求</small><p className="current-implementation">{implementation.text}</p>{implementation.memory&&<button className="text-button" onClick={()=>onDetail(implementation.memory)}>查看实施记录</button>}<div className="actions"><button onClick={()=>onRevise(m)}>更新这条要求</button><button onClick={()=>onProgress(m)}>记录实施进度</button></div></>:<small>目标记录，不代表已经实现</small>}</div>}</Rows></article>
   <article><h3>哪些已经改变 <small>{x.changes.length}</small></h3><Rows items={x.changes} empty="还没有明确的替代关系，不会猜测旧要求已失效。">{({memory:m,previous,reason,implementation})=><div className="current-record" key={m.id}><div className="current-revision">{previous.map(p=><React.Fragment key={p.id}>{title(p)}<small> → </small></React.Fragment>)}{title(m)}</div><p>为什么改：{reason}</p><small>新记录：{m.lifecycle==='accepted'?'已收入档案，确认范围见原记录':'已转入历史，不能作为当前要求'}</small>{implementation&&<p className="current-implementation">{implementation.text}</p>}</div>}</Rows></article>
   <article><h3>完成与待做 <small>{x.completed.length+x.openTasks.length}</small></h3><Rows items={[...x.completed,...x.openTasks]} empty="尚无可关联的完成或任务记录。">{({memory:m,target,text,implementation})=><div className="current-record" key={m.id}>{title(m)}<p>{text||implementation.text}</p>{target&&<button className="text-button" onClick={()=>onDetail(target)}>对应：{target.claim}</button>}{implementation?.memory&&<button className="text-button" onClick={()=>onDetail(implementation.memory)}>查看进度依据</button>}</div>}</Rows></article>
   <article><h3>哪些还说不准 <small>{x.uncertain.length}</small></h3><Rows items={x.uncertain} empty="没有上述规则识别出的待核对项，不表示全部准确。">{({memory:m,reasons})=><div className="current-record" key={m.id}>{title(m)}<p>{reasons.join('；')}</p></div>}</Rows></article>
  </div>
 </section>;
}
