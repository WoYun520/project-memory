import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {auditFile,exportSource} from './export-source.mjs';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('source export is allowlisted, reproducible and does not overwrite a destination',t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'memory-source-test-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const out=path.join(base,'clean'),first=exportSource({destination:out}),again=exportSource({destination:path.join(base,'again')});assert.deepEqual(first,again);
 for(const item of first.files){assert.equal(createHash('sha256').update(fs.readFileSync(path.join(out,item.path))).digest('hex'),item.sha256);assert.ok(!item.path.startsWith('/'));assert.ok(!/(^|\/)(data|work|node_modules|desktop-release)(\/|$)/.test(item.path));}
 assert.ok(fs.existsSync(path.join(out,'LICENSE')));assert.ok(fs.existsSync(path.join(out,'README.md')));assert.ok(!fs.existsSync(path.join(out,'AGENTS.md')));assert.ok(!fs.existsSync(path.join(out,'memory-station-codex.mjs')));
 assert.throws(()=>exportSource({destination:out}),/exists/);assert.throws(()=>exportSource({destination:path.join(source,'unsafe-export')}),/outside/);
});
test('release gate rejects runtime artifacts, local paths, private keys and source symlinks',t=>{
 for(const name of ['station/data/project.json','desktop.json','local-tools.json','draft.worklog.json','.env.local'])assert.throws(()=>auditFile(name,Buffer.from('synthetic')),/Disallowed/);
 assert.throws(()=>auditFile('file.md',Buffer.from('/synthetic-home/private/file'),{home:'/synthetic-home'}),/Personal home/);
 assert.throws(()=>auditFile('file.md',Buffer.from(['-----BEGIN ','PRIVATE KEY-----'].join(''))),/credential/);
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'memory-export-link-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));fs.symlinkSync(path.join(source,'LICENSE'),path.join(base,'LICENSE'));
 assert.throws(()=>exportSource({source:base,destination:base+'-output'}),/Symlink/);assert.equal(fs.existsSync(base+'-output'),false);
});
