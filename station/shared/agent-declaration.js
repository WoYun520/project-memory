// Compare explicit display-name aliases only. Never rewrite the source identity
// or treat a matching declaration as authentication.
const names={codex:['Codex','Codex AI'],claude:['Claude Code','Claude Code AI'],grok:['Grok','Grok AI']};
export function matchesAgentDeclaration(session,target){
 const allowed=Object.hasOwn(names,target)?names[target]:null;
 return !!allowed&&session?.actor?.kind==='agent'&&allowed.includes(session.agent)&&allowed.includes(session.actor.id);
}
