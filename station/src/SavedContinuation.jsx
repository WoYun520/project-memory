import React from 'react';
import TaskContinuation from './TaskContinuation.jsx';
export default function SavedContinuation({continuation,onSetup,onReceive}){
 const {projectId,projectName,revision,target,warnings}=continuation;
 return <section className="saved-continuation" aria-label="保存后的接续状态">
  <h3>{projectName} · 记录已保存</h3><p>已保存版本 {revision}。确认下一步任务，再交给 {target==='claude'?'Claude Code':'Codex'}。</p>
  {warnings?.length>0&&<p className="work-warning">保存后的提示：{warnings.join('；')}</p>}
  {continuation.workTaskLink&&<p>本批结果归属：<strong>{continuation.workTaskLink.task}</strong>。继续这件事会沿用原任务；改变目标请选择开始新任务。</p>}
  <TaskContinuation initialSelection={continuation.workTaskLink?{mode:"continue",parentTicketId:continuation.workTaskLink.ticket_id,workSessionId:continuation.workSessionId}:null} key={projectId} projectId={projectId} target={target} onReceive={onReceive} onSetup={onSetup}/>
  <p className="muted">记录已经保存；打开失败可在这里重试，不会重复保存。</p>
 </section>;
}
