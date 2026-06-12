# puregxl.site — XiaoLei's Blog

基于 [Astro](https://astro.build) + [Fuwari](https://github.com/saicaca/fuwari) 主题的静态博客，部署在自有服务器上。
（Fuwari 模板自身的文档见 [docs/](docs/) 目录和上游仓库。）

- 🌐 网站：https://puregxl.site
- 📊 访问统计：https://stats.puregxl.site
- 🔗 短链接管理（同服务器的另一个项目）：https://link.puregxl.site

## ✍️ 日常写文章

```bash
pnpm new-post 文章名        # 生成 src/content/posts/文章名.md
# 编辑这个 md 文件写正文，然后：
git add -A && git commit -m "post: xxx" && git push
```

push 到 main 后 GitHub Actions 会自动构建并部署，约 1~2 分钟生效。
**没带电脑时**：直接在 github.com 仓库页面里新建/编辑 `src/content/posts/` 下的 .md 文件，提交即发布。

> ⚠️ 如果 GitHub Actions 不可用（比如账号 billing 受限），在本机执行 `./deploy.sh` 手动发布，效果相同。

### Frontmatter 字段说明

```yaml
---
title: 文章标题
published: 2026-06-12        # 发布日期
description: '列表页显示的摘要'
image: ''                    # 封面图，如 ./cover.png（相对文章文件）
tags: [标签1, 标签2]
category: 分类名
draft: false                 # true 则不发布
lang: ''                     # 留空跟随站点语言(zh_CN)
---
```

文章配图放在 `src/assets/` 用相对路径引用，或建文章同名目录把图和 `index.md` 放一起。

## 🛠 本地预览与构建

```bash
pnpm install      # 首次
pnpm dev          # 本地预览 http://localhost:4321
pnpm build        # 产物在 dist/
```

需要 Node ≥ 20（pnpm 9，由 package.json 的 packageManager 字段锁定，建议用 corepack）。

## 🚀 部署架构

```
git push → GitHub Actions（pnpm build）→ rsync over SSH → /var/www/blog → nginx
```

- 服务器：腾讯云 101.35.5.210（Ubuntu 22.04），nginx 伺服静态文件
- HTTPS：Let's Encrypt（certbot 自动续期）
- 部署凭证：仓库 Secrets `DEPLOY_SSH_KEY` / `SSH_HOST` / `SSH_USER`
- 工作流：[.github/workflows/deploy.yml](.github/workflows/deploy.yml)
- 统计：自托管 [GoatCounter](https://www.goatcounter.com/)（systemd 服务 `goatcounter`，数据 `/opt/goatcounter/goatcounter.sqlite3`）

## 🎨 常用定制

- 站点标题/副标题/主题色/头像/社交链接：`src/config.ts`
- 关于页：`src/content/spec/about.md`
- 页脚（含 ICP 备案号）：`src/components/Footer.astro`
- 横幅图：`src/config.ts` 里 `banner.enable` 改 true 并放图
