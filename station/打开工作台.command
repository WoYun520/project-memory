#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 22.12 或更新版本，再打开工作台。'
  read '?按回车关闭'
  exit 1
fi
node hub.mjs
status_code=$?
if [ "$status_code" -ne 0 ]; then
  read '?按回车关闭'
fi
exit "$status_code"
