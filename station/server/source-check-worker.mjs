import {parentPort,workerData} from 'node:worker_threads';
import {checkedRoot,documentPath,readSelected} from './workspace.mjs';

// No file text, exception text, or new content hashes leave this worker.
export function compareSources(binding,targets,projectId){
 const rows=[],read=new Map();let root;
 if(targets.some(t=>documentPath(t.path)&&t.repository===projectId&&/^[a-f0-9]{64}$/.test(t.baseline)))try{root=checkedRoot(binding.directory);if(root!==binding.directory)root=null;}catch{}
 for(const target of targets){
  let status;
  if(!documentPath(target.path)||target.repository!==projectId)status='unsupported';
  else if(!/^[a-f0-9]{64}$/.test(target.baseline))status='no_baseline';
  else if(!root)status='unavailable';
  else{
   if(!read.has(target.path)&&read.size>=80)status='limited';
   else{
    if(!read.has(target.path)){try{read.set(target.path,readSelected(root,target.path).sha256);}catch{read.set(target.path,null);}}
    const hash=read.get(target.path);status=hash===null?'unavailable':hash===target.baseline?'same':'changed';
   }
  }
  rows.push({evidenceId:target.evidenceId,path:documentPath(target.path)?target.path:'',memoryIds:target.memoryIds,status});
 }
 return rows;
}
if(parentPort){try{parentPort.postMessage({rows:compareSources(workerData.binding,workerData.targets,workerData.projectId)});}catch{parentPort.postMessage({error:true});}}
