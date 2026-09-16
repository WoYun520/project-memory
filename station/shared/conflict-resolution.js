export function conflictPairs(memories){
 const seen=new Set(),pairs=[];
 for(const m of memories)for(const id of m.conflicts_with){const key=[m.id,id].sort().join(':');const other=memories.find(x=>x.id===id);if(other&&!seen.has(key)){seen.add(key);pairs.push([m,other]);}}
 return pairs;
}
export function conflictResolutionMarkdown(memories){
 const records=memories.filter(m=>m.conflict_resolution);
 if(!records.length)return '';
 const latest=new Map();for(const m of records)latest.set([...m.conflict_resolution.memory_ids].sort().join(':'),m);
 const lines=['### 冲突处理记录','处理选择不等于核验内容正确；采用原建议不会自动新增用户确认，分别适用也不会扩大原授权。'];
 for(const m of latest.values()){
  const r=m.conflict_resolution,pair=r.memory_ids.map(id=>memories.find(x=>x.id===id));
  lines.push(`- ${pair.map((x,i)=>`${x?.claim||r.memory_ids[i]}〔${r.memory_ids[i]}〕`).join(' / ')}：${r.action==='choose'?'曾选择采用 '+r.retained_id:r.action==='coexist'?'已记录分别适用条件':'暂时无法判断'}。处理依据：${m.evidence.map(e=>e.evidence_id).join('、')}。`,m.data.statement);
  if(pair.some(x=>x?.conflicts_with.some(id=>r.memory_ids.includes(id))))lines.push('当前双方仍标有冲突，请继续核对，不能仅凭历史处理记录认定已解决。');
  for(const x of pair)if(x)lines.push(`  当前状态：${x.id} = ${x.lifecycle}；核验 ${x.verification.status}；追加适用条件：${x.scope.condition||'无'}。`);
 }
 return lines.join('\n')+'\n\n';
}
