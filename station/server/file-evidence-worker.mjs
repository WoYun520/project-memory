import {parentPort,workerData} from 'node:worker_threads';
import {checkedRoot,documentPath,readSelected} from './workspace.mjs';
// Only the explicitly named documents are opened; full-content privacy checks run before excerpts leave.
try{
 const {binding,paths}=workerData,root=checkedRoot(binding.directory);
 if(root!==binding.directory||paths.length>8||paths.some(p=>!documentPath(p)))throw Error();
 const files=paths.map(relative=>{try{const f=readSelected(root,relative);return {path:relative,source:{speaker:{kind:'tool',id:'记忆站本机文件读取器'},text:f.excerpt,redacted:f.truncated,file:{path:relative,content_sha256:f.sha256,selector:f.truncated?`原文开头 ${Array.from(f.excerpt).length} 个字符`:'完整文件'}}};}catch{return {path:relative,unavailable:true};}});
 parentPort.postMessage({files});
}catch{parentPort.postMessage({error:true});}
