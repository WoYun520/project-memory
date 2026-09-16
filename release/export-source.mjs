#!/usr/bin/env node
// Export source by allowlist, never by copying a working directory wholesale.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const trees=['station/src','station/shared','station/server','spec'];
const files=['LICENSE','station/package.json','station/package-lock.json','station/index.html','station/vite.config.js','station/.gitignore','station/THIRD-PARTY-NOTICES.txt',
 'station/bridge.mjs','station/claude-bridge.mjs','station/claude-wrap.mjs','station/codex-bridge.mjs','station/connect-project.mjs','station/desktop-mcp.mjs','station/hub.mjs','station/memory.mjs','station/submit-work.mjs',
 'station/启动记忆站.command','station/打开工作台.command','station/desktop/MemoryStation.swift','station/desktop/StartupPolicy.swift','station/desktop/StartupPolicyTests.swift','station/desktop/build-app.py','station/desktop/make-icon.swift','station/desktop/test-app.py',
 'release/export-source.mjs','release/export-source.test.mjs'];
const allowedExtensions=new Set(['.mjs','.js','.jsx','.css','.json','.html','.md','.swift','.py','.command','.txt','.svg']);
const forbiddenParts=new Set(['node_modules','data','history','evidence','inbox','work','outputs','desktop-release','.git','.DS_Store']);

export function auditFile(relative,bytes,{home=os.homedir()}={}){
 const parts=relative.split('/'),name=parts.at(-1);
 if(parts.some(part=>forbiddenParts.has(part))||name.startsWith('.env')||name.endsWith('.worklog.json')||['desktop.json','local-tools.json'].includes(name))throw Error('Disallowed release path: '+relative);
 const text=bytes.toString('utf8');
 if(home.length>1&&text.includes(home+'/'))throw Error('Personal home path in: '+relative);
 // Pattern checks are intentionally limited; manual inspection is still required.
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)||/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{32,}|ghp_[A-Za-z0-9]{30,})\b/.test(text))throw Error('Possible credential in: '+relative);
}
export function exportSource({source=root,destination}){
 source=fs.realpathSync(source);destination=path.resolve(destination);
 if(destination===source||destination.startsWith(source+path.sep))throw Error('Destination must be outside the source tree');
 if(fs.existsSync(destination))throw Error('Destination already exists; choose a new directory');
 const selected=new Map();
 function collect(from,to=from){
  const file=path.join(source,from),stat=fs.lstatSync(file);
  if(stat.isSymbolicLink())throw Error('Symlink in release source: '+from);
  if(stat.isDirectory()){
   for(const name of fs.readdirSync(file).sort())collect(from+'/'+name,to?to+'/'+name:name);
  }else{
   if(!stat.isFile())throw Error('Non-regular release source: '+from);
   const name=path.basename(from);
   if(!allowedExtensions.has(path.extname(from))&&!['LICENSE','.gitignore'].includes(name))throw Error('Unexpected source file: '+from);
   const bytes=fs.readFileSync(file);auditFile(to,bytes);selected.set(to,{bytes,executable:Boolean(stat.mode&0o111)});
  }
 }
 for(const file of files)collect(file);
 for(const tree of trees)collect(tree);
 // Curated user-facing documents only; no historical development notes or local AGENTS.
 collect('release/public','');
 collect('release/public');
 selected.set('station/README.md',{bytes:Buffer.from('# 记忆站源码\n\n请从仓库根目录的 [README](../README.md) 开始。\n'),executable:false});
 const manifest={format:'project-memory-source-manifest',version:JSON.parse(selected.get('station/package.json').bytes).version,files:[...selected].sort(([a],[b])=>a.localeCompare(b)).map(([name,item])=>({path:name.replace(/^\//,''),sha256:createHash('sha256').update(item.bytes).digest('hex')}))};
 // All validation precedes writes; a failure never deletes an existing destination.
 fs.mkdirSync(destination,{recursive:true});
 for(const [name,{bytes,executable}]of selected){const target=path.join(destination,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{mode:executable?0o755:0o644,flag:'wx'});}
 fs.writeFileSync(path.join(destination,'SOURCE-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args.length!==2||args[0]!=='--out'){console.error('Usage: node release/export-source.mjs --out <new-directory>');process.exitCode=1;}
 else try{const result=exportSource({destination:args[1]});console.log(JSON.stringify({version:result.version,files:result.files.length,output:path.resolve(args[1]),note:'Allowlist export passed. Manual release review remains required.'}));}catch(error){console.error(error.message);process.exitCode=1;}
}
