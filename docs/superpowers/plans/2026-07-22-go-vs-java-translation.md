# Go vs Java 2026 授权转载翻译实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已获授权的 BackendBytes 原文完整翻译为简体中文，并通过项目当前目录的部署脚本发布到 puregxl.site。

**Architecture:** 仅新增一篇 Astro Content Collection Markdown 文章，不修改站点组件。译文遵循现有转载文章的 frontmatter 与提示块格式；本地内容检查后，由 `./deploy.sh` 统一安装依赖、构建并同步服务器，最后访问线上 URL 验证。

**Tech Stack:** Astro 5、Markdown、pnpm、Pagefind、项目自带 Bash 部署脚本

---

### Task 1: 创建完整授权译文

**Files:**
- Create: `src/content/posts/go-vs-java-2026-performance-showdown.md`

- [ ] **Step 1: 获取并核对原文结构**

核对原文的标题、作者、发布日期、章节、表格、代码块、公式、引用链接与结论，确保译文覆盖所有实质性段落。

- [ ] **Step 2: 写入 frontmatter 与转载声明**

使用以下元数据：标题 `Go vs Java：2026 年后端服务性能的诚实对比`，发布日期 `2026-07-10`，分类 `转载`，标签 `[Go, Java, 性能, 后端开发]`，`draft: false`。正文首段明确标注授权转载翻译、作者、原文日期、原文链接及版权归属。

- [ ] **Step 3: 完成忠实中文翻译**

保留原文章节顺序、Markdown 表格、公式、Go/Java 示例、k6、Docker Compose、Vegeta、Prometheus、JFR、pprof 与冷启动测试内容。技术标识符和命令不翻译；原文链接继续指向原始资料。

- [ ] **Step 4: 检查正文结构**

运行：

```bash
rg -n '^## |^### |BackendBytes|2026-02-12|backendbytes.com/articles/go-vs-java-2026-performance-showdown' src/content/posts/go-vs-java-2026-performance-showdown.md
```

预期：输出转载声明、来源信息以及所有二三级标题；没有缺失的主要章节。

- [ ] **Step 5: 提交文章**

```bash
git add src/content/posts/go-vs-java-2026-performance-showdown.md
git commit -m "post: 发布 Go 与 Java 2026 性能对比译文"
```

### Task 2: 验证并发布

**Files:**
- Verify: `src/content/posts/go-vs-java-2026-performance-showdown.md`
- Use: `deploy.sh`

- [ ] **Step 1: 检查格式与工作区差异**

运行：

```bash
git diff --check HEAD^ -- src/content/posts/go-vs-java-2026-performance-showdown.md
git status --short
```

预期：无空白错误；只有预期内的任务文件状态。

- [ ] **Step 2: 使用当前目录脚本构建并部署**

运行：

```bash
./deploy.sh
```

预期：依赖安装、`astro build` 与 Pagefind 索引成功，随后 rsync/ssh 部署成功并输出 `已部署: https://puregxl.site`。

- [ ] **Step 3: 验证线上文章**

访问：

```text
https://puregxl.site/posts/go-vs-java-2026-performance-showdown/
```

预期：返回成功状态，页面包含中文标题、授权转载声明、原作者、原文链接及完整正文。

- [ ] **Step 4: 报告结果**

汇报文章文件、线上链接、构建结果、部署结果及 Git 提交；若服务器连接或线上缓存导致验证失败，准确报告失败环节和命令输出。
