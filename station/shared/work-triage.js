import {privacyIssues} from './privacy.js';

const detailKeys={goal:'desired_outcome',fact:'statement',task:'objective',decision:'choice',constraint:'rule',state:'detail',attempt:'action'};
const normalize=value=>(value||'').normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim();
const grams=value=>new Set(Array.from(value).slice(0,6000).map((c,i,a)=>c+(a[i+1]||'')));
function similarity(a,b){
 if(a.length<24||b.length<24||Math.min(a.length,b.length)/Math.max(a.length,b.length)<0.75)return false;
 const x=grams(a),y=grams(b);let overlap=0;for(const g of x)if(y.has(g))overlap++;
 return 2*overlap/(x.size+y.size)>=0.88;
}

// Local reading aids only. Never change provenance, receipts, evidence or approval.
export function triageWork(entries,archive,edits={}){
 const existing=(archive.bundle?.memories||[]).map(m=>({id:m.id,title:m.claim,detail:m.data?.[detailKeys[m.kind]]||'',kind:m.kind,lifecycle:m.lifecycle,from:'memory'}));
 const previous=[];
 const rows=entries.map(entry=>{
  const current={...entry,...edits[entry.id]},body=normalize(current.detail);
  const related=[...existing,...previous].filter(item=>item.kind===entry.kind).map(item=>{
   const other=normalize(item.detail);
   const exact=body===other&&(body.length>=24||normalize(current.title)===normalize(item.title));
   return exact||similarity(body,other)?{...item,match:exact?'same':'similar'}:null;
  }).filter(Boolean).sort((a,b)=>(a.match==='same'?0:1)-(b.match==='same'?0:1)).slice(0,3);
  const privacy=privacyIssues(current);
  const suggestion=entry.origin==='inference'||['decision','constraint'].includes(entry.kind);
  const needsAttention=privacy.length>0||entry.status!=='duplicate'&&(related.length>0||entry.status==='conflict'||Boolean(entry.update)||Boolean(entry.mistake)||Boolean(entry.file_notes?.length)||Boolean(entry.file_paths&&!entry.file_evidence&&!entry.file_notes)||entry.stage==='completed');
  previous.push({id:entry.id,title:current.title,detail:current.detail,kind:entry.kind,from:'batch'});
  return {id:entry.id,privacy,suggestion,related,needsAttention,receipt:entry.status};
 });
 const recommended=new Set(rows.filter(r=>r.receipt==='new'&&!r.needsAttention).map(r=>r.id));
 // Do not preselect an error without its correction, including chained links.
 let changed=true;while(changed){changed=false;for(const e of entries){if(recommended.has(e.id)&&e.correction_entry_id&&!recommended.has(e.correction_entry_id)&&entries.find(c=>c.id===e.correction_entry_id)?.status!=='duplicate'){recommended.delete(e.id);changed=true;}}}
 return {rows,recommendedIds:[...recommended],counts:{attention:rows.filter(r=>r.needsAttention).length,similar:rows.filter(r=>r.related.length||r.receipt==='duplicate').length,suggestions:rows.filter(r=>r.suggestion).length,privacy:rows.filter(r=>r.privacy.length).length}};
}
