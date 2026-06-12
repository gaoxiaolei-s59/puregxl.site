#!/usr/bin/env bash
# 手动部署脚本：GitHub Actions 不可用时（或想立即发布时）在本机执行 ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

# pnpm 9 需要 Node >= 18；本机默认 node 是 v20 但 brew 的 pnpm 11 要 22，统一走 node@22 + corepack
if [ -d /opt/homebrew/opt/node@22/bin ]; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

corepack pnpm install
corepack pnpm build
rsync -az --delete dist/ ubuntu@101.35.5.210:/var/www/blog-incoming/
ssh ubuntu@101.35.5.210 'rsync -a --delete /var/www/blog-incoming/ /var/www/blog/'
echo "✅ 已部署: https://puregxl.site"
