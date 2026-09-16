export function actorLabel(actor) {
  if (!actor) return '未记录';
  const role = {human:'用户',agent:'AI',tool:'工具'}[actor.kind] || '未知身份';
  return actor.kind==='human' && actor.id==='local-user' ? role : `${role}（${actor.id}）`;
}

export function originLabel(origin) {
  return {human_statement:'用户陈述',observation:'观察记录',inference:'整理或推断，不能视为用户原话'}[origin] || '未记录';
}
