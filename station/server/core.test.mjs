import test from 'node:test';
import assert from 'node:assert/strict';
import {createBundle,appendMemory,reviewMemory,validateArchive,compile} from './core.mjs';
import {privacyIssues} from '../shared/privacy.js';
const make=()=>createBundle('测试项目','交接测试，不涉及真实服务器。');
const entry=(extra={})=>({kind:'fact',title:'测试事实',detail:'服务在测试环境中运行。',source:'这是一条虚构的手动检查记录。',reviewed:true,...extra});
test('只读交接不要求回写，生成过程不修改项目和依据',()=>{
 const a=make(),before=JSON.stringify(a);const out=compile(a,'识别真实错误',{readonlyTest:true});
 assert.ok(out.includes('本次为只读测试'));assert.ok(!out.includes('完成后把新结果添加到记忆站'));assert.equal(JSON.stringify(a),before);
});
test('用户录入 AI 观察并由工具核查，三个身份独立保留到交接和备份',()=>{
 const a=make();const m=appendMemory(a,entry({speaker:{kind:'agent',id:'Codex'},checker:{kind:'tool',id:'测试工具'},checked:true,checkNote:'核查此条测试事实'}));
 assert.equal(m.by.kind,'human');assert.equal(m.origin,'observation');assert.equal(m.verification.checks[0].by.kind,'tool');
 assert.equal(a.bundle.evidence.at(-1).locator.speaker.kind,'agent');assert.equal(m.approval,undefined);
 const restored=JSON.parse(JSON.stringify(a));assert.equal(validateArchive(restored),true);
 const out=compile(restored);assert.ok(out.includes('来源：AI（Codex）'));assert.ok(out.includes('核查人：工具（测试工具）'));assert.ok(!out.includes('用户记录了核查结果'));
});
test('AI 记录的核查默认归属该 AI，不冒充用户，也不等于批准',()=>{
 const a=make(),m=appendMemory(a,entry({recorder:{kind:'agent',id:'Codex'},checked:true,checkNote:'本次工具观察'}));
 assert.equal(m.verification.checks[0].by.kind,'agent');assert.equal(a.bundle.evidence.at(-1).privacy.reviewed_by.kind,'agent');assert.equal(m.approval,undefined);
 assert.ok(compile(a).includes('核查人：AI（Codex）'));
});
test('AI 建议无法作为用户确认；用户原话可由 AI 录入而保留真实确认人',()=>{
 const a=make(),before=JSON.stringify(a);
 assert.throws(()=>appendMemory(a,entry({kind:'decision',speaker:{kind:'agent',id:'Codex'},confirmed:true})),/用户/);
 assert.throws(()=>appendMemory(a,entry({speaker:{kind:'tool',id:'测试工具'},origin:'human_statement'})),/用户/);
 assert.equal(JSON.stringify(a),before);
 const m=appendMemory(a,entry({kind:'constraint',recorder:{kind:'agent',id:'Codex'},speaker:{kind:'human',id:'local-user'},confirmed:true}));
 assert.equal(m.by.kind,'agent');assert.equal(m.approval.by.kind,'human');assert.equal(m.verification.status,'unverified');
});
test('交接保留推断标签，不把建议变成用户已确认决定',()=>{const a=make();appendMemory(a,entry({kind:'decision',inference:true}));const out=compile(a);assert.ok(out.includes('整理或推断，不能视为用户原话'));assert.ok(out.includes('这是待确认建议'));assert.equal(a.bundle.memories.at(-1).approval,undefined);});
test('项目目标与依据符合 v0.1，快照被篡改时拒绝',()=>{const a=make();assert.equal(validateArchive(a),true);a.snapshots[Object.keys(a.snapshots)[0]]+=' altered';assert.throws(()=>validateArchive(a),/改动/);});
test('阻止常见凭据，包括原始依据内的值，不将拒绝内容加入档案',()=>{const a=make(),before=JSON.stringify(a);for(const source of ['password: synthetic-not-real','api_key = synthetic-demo-value','Authorization: Bearer synthetic-demo-token',['-----BEGIN RSA ', 'PRIVATE KEY-----'].join('')])assert.throws(()=>appendMemory(a,entry({source})),/隐私/);assert.equal(JSON.stringify(a),before);assert.ok(privacyIssues('address 192.0.2.1').length);});
test('用户采纳与核验独立；修订保存旧决定及原始依据',()=>{const a=make();const old=appendMemory(a,entry({kind:'decision',confirmed:true,detail:'方案甲'}));assert.equal(old.verification.status,'unverified');const next=appendMemory(a,entry({kind:'decision',confirmed:true,detail:'方案乙',replaces:old.id}));assert.equal(old.lifecycle,'superseded');assert.deepEqual(next.supersedes,[old.id]);assert.equal(a.bundle.evidence.length,3);assert.equal(validateArchive(a),true);});
test('待复核与冲突共同进入交接，不挑选一个胜者',()=>{const a=make(),one=appendMemory(a,entry()),two=appendMemory(a,entry({title:'另一个说法'}));reviewMemory(a,one.id,'stale');reviewMemory(a,one.id,'conflict',two.id);const out=compile(a);assert.ok(out.includes('需要复核'));assert.ok(out.includes('存在冲突'));assert.ok(out.includes(one.id)&&out.includes(two.id));assert.deepEqual(two.conflicts_with,[one.id]);});
test('确认错误需核查，纠正引用必须指向真实尝试',()=>{const a=make();const input=entry({kind:'attempt',conditions:'虚构环境',result:'未成功',mistake:'疑似修改错文件',mistakeConfirmed:true});assert.throws(()=>appendMemory(a,input),/核查/);assert.throws(()=>appendMemory(a,{...input,checked:true,checkNote:'查看了日志',correction_id:'missing'}),/关联/);});
test('完成不是默认核验；没有检查不能标成完成',()=>{assert.throws(()=>appendMemory(make(),entry({kind:'state',stage:'completed'})),/核查/);});
test('附件路径和替代循环被拒绝',()=>{const a=make();a.bundle.evidence[0].snapshot.path='../private.txt';assert.throws(()=>validateArchive(a),/路径/);const b=make(),one=appendMemory(b,entry()),two=appendMemory(b,entry());one.supersedes=[two.id];two.supersedes=[one.id];assert.throws(()=>validateArchive(b),/循环/);});
test('归档可恢复，完整交接包含来源且不生成不存在的错误',()=>{const a=make(),m=appendMemory(a,entry());reviewMemory(a,m.id,'archive');assert.ok(compile(a).includes('历史记录'));reviewMemory(a,m.id,'restore');assert.equal(m.lifecycle,'accepted');assert.ok(compile(a).includes('这是一条虚构的手动检查记录。'));assert.equal(a.bundle.memories.some(m=>m.kind==='attempt'),false);});
test('拒绝无法完整恢复的大备份和单向冲突',()=>{const a=make(),one=appendMemory(a,entry()),two=appendMemory(a,entry());one.conflicts_with=[two.id];assert.throws(()=>validateArchive(a),/双方/);const b=make();b.extra='x'.repeat(2_500_001);assert.throws(()=>validateArchive(b),/容量/);});

test('用户陈述、accepted 和同意原话均不自动成为用户确认',()=>{
 const a=make();
 appendMemory(a,entry({kind:'decision',title:'用户说可以试试的方案',source:'用户：可以试试这个合成方案。',detail:'先试用合成方案。'}));
 const candidate=appendMemory(a,entry({title:'人工提供的候选事实'}));candidate.lifecycle='proposed';
 const archived=appendMemory(a,entry({title:'已归档的用户陈述'}));reviewMemory(a,archived.id,'archive');
 const before=JSON.stringify(a),out=compile(a);
 assert.equal((out.match(/^用户确认：未记录用户确认。$/gm)||[]).length,a.bundle.memories.length);
 assert.match(out,/生命周期：accepted（已收入档案，不表示用户采纳、确认或核验）/);
 assert.match(out,/来源性质：用户陈述（来源标注不等于用户确认）/);
 assert.match(out,/这是待确认建议，不能作为生效指令/);
 assert.ok(!out.includes('已明确确认选择或要求'));
 assert.ok(out.includes('> 用户：可以试试这个合成方案。'));
 assert.equal(JSON.stringify(a),before);
});

test('仅有理由范围的人工确认，不扩展为选择生效或独立核查',()=>{
 const a=createBundle('合成范围项目','');
 const m=appendMemory(a,entry({kind:'decision',title:'理由单独获得确认',reason:'便于合成演示',confirmed:true,source:'用户：这个理由描述可以保留，方案还要讨论。'}));
 m.approval.fields=['/data/rationale'];m.data.stage='proposed';
 const before=JSON.stringify(a),out=compile(a);
 assert.equal((out.match(/^用户确认：已记录用户确认/gm)||[]).length,1);
 assert.match(out,/确认范围：\/data\/rationale；确认依据：/);
 assert.match(out,/不扩展为其他字段的确认或项目验收/);
 assert.match(out,/核查记录：没有核查记录；档案核查状态：unverified/);
 assert.match(out,/独立核查：未记录独立核查依据/);
 assert.match(out,/这是待确认建议，不能作为生效指令/);
 assert.ok(!out.includes('已明确确认选择或要求'));
 assert.equal(JSON.stringify(a),before);
 reviewMemory(a,m.id,'archive');
 assert.match(compile(a),/历史确认不表示这条记录当前仍被采纳或生效/);
});

test('AI 自查或另一工具核查保留实际检查者，不升级为独立核查或人工确认',()=>{
 const a=createBundle('合成核查项目','');
 appendMemory(a,entry({title:'AI 自查记录',recorder:{kind:'agent',id:'synthetic-agent'},checked:true,checkNote:'检查了合成输出。'}));
 appendMemory(a,entry({title:'工具核查记录',recorder:{kind:'agent',id:'synthetic-agent'},checker:{kind:'tool',id:'synthetic-checker'},checked:true,checkNote:'运行了合成检查。'}));
 const before=JSON.stringify(a),out=compile(a);
 assert.equal((out.match(/^用户确认：未记录用户确认。$/gm)||[]).length,2);
 assert.equal((out.match(/^核查记录：已有 1 条/gm)||[]).length,2);
 assert.equal((out.match(/^独立核查：现有字段未记录核查独立性/gm)||[]).length,2);
 assert.match(out,/核查人：AI（synthetic-agent）/);
 assert.match(out,/核查人：工具（synthetic-checker）/);
 assert.match(out,/结果：supports；范围：\/data；依据：/);
 assert.equal(JSON.stringify(a),before);
});
