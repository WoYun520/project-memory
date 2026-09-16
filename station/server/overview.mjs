import {kindNames} from './core.mjs';
import {requireSafe} from '../shared/privacy.js';

export function summarizeProject(archive,draft=null,inboxError=''){
 const records=archive.bundle.memories,active=records.filter(m=>m.lifecycle==='accepted');
 const latest=[...active].sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at))[0];
 const goal=active.find(m=>m.kind==='goal');
 return {...archive.bundle.project,revision:archive.revision,count:active.length,
  goal:goal?.data.desired_outcome||'',goalOrigin:goal?.origin||null,
  needsReview:active.filter(m=>m.freshness.status==='stale'||m.conflicts_with.length).length,
  latest:latest?{id:latest.id,title:latest.claim,at:latest.recorded_at,origin:latest.origin}:null,
  inbox:{count:draft?.worklog.entries.length||0,receivedAt:draft?.receivedAt||null,agent:draft?.worklog.session.agent||'',titles:draft?.worklog.entries.map(e=>e.title)||[],error:inboxError}};
}

function searchableText(value){
 if(typeof value==='string')return ({succeeded:'成功',failed:'失败',partial:'部分完成',proposed:'待确认',effective:'已生效',in_progress:'进行中',awaiting_validation:'等待验证',completed:'已完成',cancelled:'已取消'})[value]||value;
 if(Array.isArray(value))return value.map(searchableText).join(' ');
 if(value&&typeof value==='object')return Object.entries(value).filter(([key])=>!key.endsWith('_id')&&!key.endsWith('_ids')).map(([,item])=>searchableText(item)).join(' ');
 return '';
}

export function searchArchives(archives,query){
 if(typeof query!=='string'||query.length>200)throw Error('搜索词请控制在 200 个字以内。');
 requireSafe(query);
 const term=query.trim().toLocaleLowerCase();if(!term)return {results:[],total:0};
 const results=[];
 for(const archive of archives){for(const m of archive.bundle.memories){
  const text=searchableText(m.data);
  const haystack=(m.claim+' '+text).toLocaleLowerCase();if(!haystack.includes(term))continue;
  const start=Math.max(0,text.toLocaleLowerCase().indexOf(term)-35);
  results.push({id:m.id,projectId:archive.bundle.project.id,projectName:archive.bundle.project.name,title:m.claim,kind:m.kind,kindLabel:kindNames[m.kind],snippet:(start?'…':'')+text.slice(start,start+180)+(text.length>start+180?'…':''),lifecycle:m.lifecycle,origin:m.origin,at:m.recorded_at,score:(m.claim.toLocaleLowerCase().includes(term)?2:0)+(m.lifecycle==='accepted'?1:0)});
 }}
 results.sort((a,b)=>b.score-a.score||b.at.localeCompare(a.at));
 return {results:results.slice(0,40),total:results.length};
}
