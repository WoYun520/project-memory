#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 22.12 或更新版本，再打开记忆站。'
  read '?按回车关闭'
  exit 1
fi
if [ ! -d node_modules ]; then
  npm ci --no-audit --no-fund || exit 1
fi
if [ ! -f dist/index.html ]; then
  npm run build || exit 1
fi
echo '请在浏览器打开 http://127.0.0.1:4180'
npm start
