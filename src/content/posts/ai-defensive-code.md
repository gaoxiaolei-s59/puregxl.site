---
title: 为什么 AI 写的代码总是一股“防御味”？
published: 2026-06-30
description: "AI 生成的代码总爱到处判空、塞默认值、吞异常——防御性编程的边界到底在哪？聊聊 AI 为何这么“小心翼翼”，以及该如何审查它的代码。"
image: ""
tags: [AI, 工程实践, Java]
category: 工程实践
draft: false
lang: ""
---

在大量使用 AI 辅助开发后，我发现了一个非常普遍的现象：**AI 生成的代码，往往带着一种极度缺乏安全感的“防御性风格”。**

它到处判断空值、到处塞默认值、到处包 `try-catch`。特别是在读取环境变量或配置时，它有一种强迫症似的喜欢加 `.trim()` 和 `fallback`。

比如，你经常会看到 AI 甩出类似这样的 Java 代码：

```java
public String getJwtSecret() {
    try {
        String secret = System.getenv("JWT_SECRET");
        if (secret != null && !secret.trim().isEmpty()) {
            return secret.trim();
        }
        // AI 贴心的“兜底”
        return "default_secret_key_for_dev"; 
    } catch (Exception e) {
        // 悄悄吞掉异常
        return null; 
    }
}
```

表面上看，这段代码堪称“滴水不漏”：空值兜住了、字符串清洗了、异常也 catch 了。但在真实的工程里，**这类写法往往不是让系统更可靠，而是把本该尽早暴露的致命问题悄悄藏了起来。**

环境变量确实是不受控的外部输入，AI 认为需要防范，这只对了一半。另一半极其危险的事实是：**不是所有配置缺失都应该给默认值，也不是所有错误都该被自动修正。** 真正的问题不在于 AI 懂不懂防御，而在于它**不知道防御的边界在哪**。

### 为什么 AI 编码如此“小心翼翼”？

AI 写代码为什么总是在“和稀泥”？这主要归结于两个原因：

**1. 上下文缺失导致的“局部自保”**
我们日常使用的 Cursor、Copilot、Claude 等工具，本质上是基于 LLM API 实现的。受限于上下文窗口（Context Window），AI 不可能在写每一行代码时都把整个仓库读进脑子里。
Agent 只能采取“按需读取”的策略，但它很难精准判断哪些全局依赖是必须的。在缺乏对全局异常处理（Global Exception Handler）和系统架构认知的情况下，AI 只能选择最保守的策略：**保证自己写的这几十行代码绝对不报 NPE（空指针异常）。** 这就导致了 AI 在写小型 MVP 时如鱼得水，但在写大型企业级项目时，满屏都是多余的防御。

**2. 训练语料的“幸存者偏差”**
大模型是吃着市面上开源代码、Stack Overflow 问答和官方教程长大的。在这些公开场景里，什么样的代码最受欢迎？是那些“复制粘贴后直接能跑，绝对不崩”的独立代码块。
AI 学到的不是某个具体商业项目的架构约束，而是这些社区里最高频的“单体防御模式”。这就是为什么像 Spring 这样优雅的框架里，核心流转逻辑依然需要人工来把控。

---

### 防御应该留在边界，而不是污染核心

防御性编程本身没错，但**到处兜底，就是在破坏系统的契约。**

真正需要严防死守的地方，是系统的**边界**：

* HTTP 请求参数 / 表单输入
* 上传文件 / 数据导入
* 第三方 API 返回值
* Webhook payload
* CLI 参数 / 环境变量
* 跨租户资源访问 / 权限判断

在这些地方，数据来自外部，必须严格校验、清洗、拒绝非法输入。
**但在业务核心逻辑里，到处兜底反而会制造灾难。** 来看看 AI 在业务层经常写的这种代码：

```java
public String getUserName(String userId) {
    if (userId == null || userId.isEmpty()) {
        return ""; // 埋雷开始
    }
    
    try {
        User user = userRepository.findById(userId);
        if (user != null && user.getName() != null) {
            return user.getName();
        }
        return ""; // 继续埋雷
    } catch (Exception e) {
        log.error("Error", e);
        return ""; // 把异常消化掉，强行返回空字符串
    }
}
```

调用方拿到一个空字符串 `""` 以后，根本不知道发生了什么“凶杀案”：
是 `userId` 没传？用户不存在？数据库挂了？还是数据本身被污染了？统统不知道。

**更好的做法，是把失败的语义清晰地暴露出来，利用 Java 的契约（异常或 Optional）去表达，而不是用空值去掩盖：**

```java
public String getUserName(String userId) {
    // 1. 边界防御：契约断言，非法参数直接 Fail Fast
    if (userId == null || userId.isBlank()) {
        throw new IllegalArgumentException("userId 不能为空"); 
    }

    // 2. 核心逻辑：找不到数据是明确的业务异常，绝不偷偷返回 ""
    User user = userRepository.findById(userId);
    if (user == null) {
        throw new UserNotFoundException("用户不存在: " + userId); 
    }

    return user.getName();
}
```

*(注：如果你的架构规范不推荐用异常做业务控制，这里也应该返回 `Optional<String>` 或者自定义的 `Result<String>` 包装类，而不是直接给个 `""`)*

### 总结：如何审查 AI 的代码？

AI 喜欢写防御性代码，是因为它面对着不完整的上下文，倾向于用空值判断、`try-catch` 和 `trim()` 来掩饰局部逻辑的脆弱。

特别是在处理环境配置时：`server.port` 缺失可以给默认值 8080，但 `JWT_SECRET` 缺失必须抛出 `IllegalStateException` 让应用启动失败；普通的 URL 可以 `.trim()`，但密钥绝对不能偷偷去掉空格，因为空格可能本身就是密钥的一部分。

一个优秀的工程，它的防御性代码应该遵循以下准则：

* **在边界处：** 严阵以待，严格校验。
* **在核心里：** 保持契约清晰，互相信任。
* **对不可恢复的错误：** Fail fast，尽早崩溃。
* **对可恢复的失败：** 使用结构化表达（如业务异常、Optional 或 Result 模式）。
* **对关键配置：** 拒绝弱默认值，非法直接拒绝启动。

在使用 AI 辅助编程的时代，Code Review 的重心已经变了。**AI 生成代码最需要审查的地方，往往不是它有没有考虑异常，而是它有没有把真正应该暴露的问题，悄悄吞掉。**
