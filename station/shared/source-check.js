export const sourceLabels={changed:'原文已变化',same:'检查时与原文一致',unavailable:'无法安全检查',unsupported:'暂不支持检查',no_baseline:'缺少内容标识',limited:'超出本次检查范围'};

export function sourceCheckSummary(report){
 if(!report)return '来源检查结果暂时未知。';
 if(report.outcome==='failed')return '本次来源检查未完成，已注明无法检查；不沿用上次的通过结果。';
 if(report.outcome==='not_connected')return '尚未连接项目文件夹，本次未检查文件变化。';
 if(!report.rows.length)return '没有可比较的已保存文件依据，本次未检查文件变化。';
 const changed=report.rows.filter(r=>r.status==='changed').length,unknown=report.rows.filter(r=>!['changed','same'].includes(r.status)).length;
 return changed||unknown?[changed?`${changed} 份来源已变化`:'',unknown?`${unknown} 份来源未能完成比较`:''].filter(Boolean).join('，')+'。':`本次比较的 ${report.rows.length} 份来源与保存的内容标识一致。`;
}

// Source references are data. Only the local checker decides which paths it can read.
export function sourceTargets(archive){
 const used=new Map();
 for(const m of archive.bundle.memories.filter(m=>m.lifecycle==='accepted')){
  const ids=new Set([...(m.evidence||[]).map(x=>x.evidence_id),...(m.approval?.evidence_ids||[]),...(m.verification?.checks||[]).flatMap(c=>c.evidence_ids||[])]);
  for(const id of ids){if(!used.has(id))used.set(id,[]);used.get(id).push(m.id);}
 }
 return archive.bundle.evidence.filter(e=>e.kind==='file'&&used.has(e.id)).map(e=>({evidenceId:e.id,path:e.locator?.path||'',baseline:e.locator?.content_sha256||'',repository:e.locator?.repository,memoryIds:used.get(e.id)}));
}

export function sourceCheckMarkdown(report){
 if(!report)return '';
 const lines=['## 文件来源检查（工具观察）',`检查时间：${report.checkedAt}；对应已保存版本：${report.revision}。`,sourceCheckSummary(report),'仅比较曾保存依据的项目说明文件内容标识。结果不是实时监控，不核验主张真假，不表示用户确认；不能据此认定某条要求已被废止。'];
 for(const row of report.rows)lines.push(`- ${sourceLabels[row.status]||'未检查'}：${row.path||'未提供可检查路径'}；依据 ${row.evidenceId}；相关记忆 ${row.memoryIds.join('、')}。`);
 if(!report.rows.length)lines.push('没有可比较的已保存文件依据，不代表项目没有变化。');
 lines.push('变化或无法检查的来源请结合当前任务复核；旧原文仍保留。未列出的文件、代码及外部来源未检查。');
 return lines.join('\n')+'\n\n';
}
