// Local heuristic checks only. No detector can prove arbitrary prose contains no secrets.
export function privacyIssues(value) {
  const source = typeof value === 'string' ? value : JSON.stringify(value);
  const rules = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/i, '私钥'],
    [/\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16})\b/, '访问密钥'],
    [/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/i, '访问令牌'],
    [/(?:password|passwd|pwd|secret|api[_ -]?key|access[_ -]?token|authorization|cookie|密码|口令|密钥)["']?\s*(?:[:=：]|是|为)\s*["']?[^\s"',;，。；}{]{3,}/i, '疑似凭据赋值'],
    [/https?:\/\/[^\s/@:]+:[^\s/@]+@/i, '链接中的登录凭据'],
    [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/, '会话令牌'],
    [/\b(?:\d{1,3}\.){3}\d{1,3}\b/, '服务器或网络地址'],
    [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, '邮箱地址'],
    [/\b1[3-9]\d{9}\b/, '手机号码'],
  ];
  return rules.filter(([pattern]) => pattern.test(source)).map(([,label]) => label);
}
export function requireSafe(value) {
  if (privacyIssues(value).length) throw new Error('发现疑似凭据或隐私，请先替换为不含原值的说明。内容没有保存。');
}
