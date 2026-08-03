#!/bin/zsh

set -euo pipefail

SCRIPT_DIRECTORY="${0:A:h}"
cd "$SCRIPT_DIRECTORY"

STARTUP_LOG="$(mktemp "${TMPDIR:-/tmp}/vizruna-web-startup.XXXXXX.log")"
trap 'rm -f "$STARTUP_LOG"' EXIT

run_quietly() {
  local action="$1"
  shift
  if "$@" >"$STARTUP_LOG" 2>&1; then
    return 0
  fi
  echo ""
  echo "$action失败，错误信息如下："
  tail -n 120 "$STARTUP_LOG"
  echo ""
  read -r "?按回车键关闭..."
  exit 1
}

echo "Vizruna-web 本地启动器"
echo "======================"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo ""
  echo "未找到 Node.js 22。请先安装 Node.js 22.19.x，然后重新双击本文件。"
  echo "下载地址：https://nodejs.org/"
  echo ""
  read -r "?按回车键关闭..."
  exit 1
fi

NODE_VERSION="$(node -p 'process.versions.node')"
NODE_MAJOR="${NODE_VERSION%%.*}"
if (( NODE_MAJOR < 22 )); then
  echo ""
  echo "当前 Node.js 版本为 $NODE_VERSION，Vizruna-web 至少需要 Node.js 22。"
  echo "请安装 Node.js 22.19.x 后重新启动。"
  echo ""
  read -r "?按回车键关闭..."
  exit 1
fi

if [[ "$NODE_MAJOR" != "22" ]]; then
  echo "提示：当前 Node.js 为 $NODE_VERSION；推荐使用已经完整验收的 22.19.x。"
fi

if [[ "${VIZRUNA_WEB_SKIP_UPDATE:-0}" != "1" ]]; then
  echo ""
  node scripts/update-vizruna-web-source.mjs
fi

ELECTRON_BINARY="node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [[ ! -x "$ELECTRON_BINARY" || ! -f node_modules/.package-lock.json || package-lock.json -nt node_modules/.package-lock.json ]]; then
  echo ""
  echo "正在安装或更新本地运行环境，首次使用可能需要几分钟..."
  run_quietly "本地运行环境安装" npm ci --no-audit --no-fund
  echo "本地运行环境准备完成。"
fi

echo ""
echo "正在构建 Vizruna-web 页面..."
run_quietly "Vizruna-web 页面构建" npm run build:web
echo "Vizruna-web 页面构建完成。"

echo ""
echo "即将在默认浏览器中打开 Vizruna-web。"
echo "保持此窗口开启；要停止服务，请按 Control+C。"
echo ""
npm run start:web
