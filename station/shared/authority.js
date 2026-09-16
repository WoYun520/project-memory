import {applicabilityLabel} from './applicability.js';
import {actorLabel, originLabel} from './attribution.js';

export const authorityNotice = '确认边界：用户陈述（human_statement）只说明来源；accepted 只说明已收入档案。是否有用户确认，逐条查看“用户确认”及其范围；不能由来源、录入人、收录状态或原文中的同意措辞自动补出批准记录。可以说明某条主张有用户原话支持，但没有批准记录时仍须写“未记录用户确认”。verified 或已有核查记录不等于用户确认，也不自动证明独立核查。';

/** Describe existing authority metadata without inferring approval or check independence. */
export function memoryAuthorityLines(memory) {
  const lifecycleNotes = {
    accepted: '已收入档案，不表示用户采纳、确认或核验',
    proposed: '候选记录，尚未收入当前记录',
    superseded: '已被替代，保留为历史',
    rejected: '已归档或拒绝，保留为历史',
    retracted: '已撤回，保留为历史',
  };
  const lines = [
    `来源性质：${originLabel(memory.origin)}（来源标注不等于用户确认）`,
    `生命周期：${memory.lifecycle}（${lifecycleNotes[memory.lifecycle] || '仅报告档案状态'}）`,
  ];
  if(['decision','constraint'].includes(memory.kind))lines.push('适用期限：'+applicabilityLabel(memory.scope?.applicability));
  const approval = memory.approval;
  if (approval) {
    lines.push(
      '用户确认：已记录用户确认，仅限下列确认范围；不扩展为其他字段的确认或项目验收。',
      `确认人：${actorLabel(approval.by)}；确认时间：${approval.at}`,
      `确认范围：${approval.fields.join('、')}；确认依据：${approval.evidence_ids.join('、')}`,
      '确认身份取自现有记录标注，本次没有进行身份认证。',
    );
    if (memory.lifecycle !== 'accepted') lines.push('历史确认不表示这条记录当前仍被采纳或生效。');
  } else {
    lines.push(
      '用户确认：未记录用户确认。',
      '确认范围：未记录；用户陈述、accepted、录入或保存操作均不能替代批准记录。',
    );
  }
  const checks = memory.verification.checks;
  lines.push(`核查记录：${checks.length ? `已有 ${checks.length} 条，核查人、结果和范围见下方` : '没有核查记录'}；档案核查状态：${memory.verification.status}。`);
  lines.push(checks.length
    ? '独立核查：现有字段未记录核查独立性，无法仅据核查记录、verified 或核查人身份认定已经独立核查。'
    : '独立核查：未记录独立核查依据。');
  if (memory.lifecycle === 'proposed' || (['decision', 'constraint'].includes(memory.kind) && memory.data.stage === 'proposed')) {
    lines.push('注意：这是待确认建议，不能作为生效指令。');
  }
  return lines;
}
