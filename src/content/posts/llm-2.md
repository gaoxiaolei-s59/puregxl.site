---
title: 大模型篇章（2）调用大模型API
published: 2026-05-13
description: ""
image: ""
tags: [大模型, AI]
category: AI
draft: false
lang: ""
---

## OpenAI 接口协议：大模型 API 的“普通话”

### 1. 为什么要了解 OpenAI 协议？

你可能会好奇：既然我们后续实战使用的是 SiliconFlow 平台上的 Qwen 模型，为什么现在要专门讲 OpenAI 的协议？

原因很简单：OpenAI 的 Chat Completions API 已经成为了大模型调用的**事实标准（De facto standard）**。就像 HTTP 协议是 Web 世界的基石一样，OpenAI 的接口格式就是当前大模型 API 领域的“普通话”。

放眼当前生态，无论是国内的 DeepSeek、通义千问、智谱 GLM 和 SiliconFlow，还是国外的 Anthropic (Claude) 与 Google (Gemini) —— 几乎所有主流厂商都提供了对 OpenAI 协议的兼容支持。（注：截至 2025 年 2 月，尽管 Anthropic 和 Google 拥有原生 API，但也均提供了对 OpenAI 协议的兼容层）。

**这意味着什么？** 意味着你只需掌握这一套协议，就能无缝对接市面上绝大多数的大模型。未来在切换不同模型时，往往只需修改底层的 `baseURL` 和 `API Key`，核心代码逻辑即可做到一行不改。

因此，彻底搞懂这套协议是一笔稳赚不赔的“时间投资”。在接下来的系列教程中，我们所有的核心功能调用（包括 Chat API、Embedding API、Reranker API 等）都将建立在这一基础之上。

---

### 2. 请求格式介绍

调用大模型接口，本质上和我们调用普通的第三方 Web 服务没有什么区别，通常就是一个标准的 HTTP POST 请求。其核心的数据负载（Payload）格式如下：

```json
{
    "model": "Qwen/Qwen3-32B",
    "messages": [
        {
            "role": "system",
            "content": "你是一个专业的电商客服助手，只回答和退货、换货、物流相关的问题。"
        },
        {
            "role": "user",
            "content": "买了一周的东西还能退吗？"
        }
    ],
    "temperature": 0.1,
    "max_tokens": 512,
    "stream": false
}
```


### 2. 请求核心参数解析

#### 2.1 `model`：指定调用的模型
`model` 字段是请求中的必填项，它明确告诉平台本次请求需要调用哪一个具体的模型。
需要注意的是，虽然协议是通用的，但不同服务平台的模型 ID 命名规范会有所不同：

| 平台 | 模型 ID 示例 | 命名格式说明 |
| :--- | :--- | :--- |
| **SiliconFlow** | `Qwen/Qwen3-32B` | **厂商名/模型名**（标准路径格式） |
| **OpenAI** | `gpt-4o` | **直接使用模型代号** |
| **DeepSeek** | `deepseek-chat` | **直接使用模型代号** |

---

#### 2.2 `messages`：对话的核心载体（消息数组）
`messages` 是整个 API 请求中最核心、最关键的字段。它是一个数组（Array），内部包含了整个对话的历史记录。

**💡 一个重要的认知：大模型本身是没有记忆的（无状态）。**
模型并不是只看你刚刚发出的最后一句话，而是需要你把**整个对话历史**打包进 `messages` 数组一次性发给它。你可以把它理解为一份完整的“聊天记录文件”——模型会通过阅读这份完整的上下文，来推断并生成下一步的回答。

---

#### 2.3 角色机制（Role）：对话中的“三国鼎立”
在 `messages` 数组中，每一条消息（Message）都由两个关键属性组成：`role`（角色）和 `content`（内容）。
这里的 `role` 共有三种，它们分工明确：

*   **`system`（系统角色 / 旁白指导）**
    *   **作用**：用来定义模型的行为边界、人设和全局规则，相当于给模型发了一份“员工手册”。模型在整个对话中都会潜意识地遵守这条指令。
    *   **示例**：当你设置了 `"content": "你是一个专业的电商客服助手，只回答退换货及物流问题"`，那么当用户问它“今天天气如何”时，它就会尽职地拒绝回答。
    *   **🌟 进阶预告**：`system` 消息在 **RAG（检索增强生成）系统**中极为关键。后续我们会通过它来下达硬性指令：“*请严格根据以下提供的参考资料来回答问题，若资料中没有相关信息，请如实回答不知道。*”

*   **`user`（用户角色 / 提问者）**
    *   **作用**：代表使用者的输入，也就是用户向模型提出的具体问题或下达的指令。

*   **`assistant`（助手角色 / AI 回答）**
    *   **作用**：代表模型之前回复过的内容。将过往的 `assistant` 消息塞回数组，是为了帮模型“回忆”起之前的聊天记录，从而实现上下文连贯的**多轮对话**。

**多轮对话的形态长什么样？**
把这三个角色串联起来，一段典型的多轮对话 `messages` 数组就像一个排练好的剧本：

```json
{
    "messages": [
        {"role": "system", "content": "你是一个电商客服助手。"},
        {"role": "user", "content": "你们支持七天无理由退货吗？"},
        {"role": "assistant", "content": "支持的。自签收之日起7天内，商品未使用且不影响二次销售的，可以申请七天无理由退货。"},
        {"role": "user", "content": "那运费谁出？"}
    ]
}
```

**💡 延伸思考：为什么每次都要把前面的废话再发一遍？**

你可能要问了：既然是同一个用户在对话，为什么每次发请求时，都要这么麻烦地把之前的聊天记录完整传过去？

这就涉及到一个核心概念：**大模型的原生 API 本质上是“无记忆”的（无状态，Stateless）。**

平时我们使用 ChatGPT 的网页版，或者像 Cursor、GitHub Copilot 这样的 AI 编程助手时，总感觉它们很聪明，能“记住”你刚才交代过的事情。但实际上，**这种“记忆”并不是大模型自带的**。

那些好用的网页端和 Agent 工具，其实都在底层做了一层封装：也就是帮你实现了**“记忆窗口”**。每当你发出一句新话时，这些软件会在后台默默地把你之前的聊天记录打包，拼接成完整的 `messages` 数组，然后一次性发给大模型。

因此，当我们今天脱离了那些封装好的外壳，亲自写代码调用 API 时，就必须像那些软件一样，自己来维护和传递这段对话历史。这就是 `messages` 数组必须存在的根本原因。

### 2.4 控制生成的“调音台”：常用可选参数

除了必填的 `model` 和 `messages`，这几个参数就像调音台上的旋钮，决定了模型输出的质量和风格：

| **参数名称**          | **数据类型**  | **功能说明**                                                   | **RAG 场景推荐值**           |
| ----------------- | --------- | ---------------------------------------------------------- | ----------------------- |
| **`temperature`** | `float`   | **随机性控制**：取值 0~2。数值越低，回答越严谨固定；数值越高，回答越有创意。                 | `0.0` ~ `0.3`（追求事实准确）   |
| **`max_tokens`**  | `int`     | **长度上限**：限制模型生成内容的最多 Token 数，防止消耗过大或无限输出。                  | `512` ~ `2048`（视业务场景而定） |
| **`top_p`**       | `float`   | **核采样控制**：另一种控制随机性的方式。通常与 `temperature` **二选一**使用，不建议同时修改。 | `0.7` ~ `0.9`           |
| **`stream`**      | `boolean` | **流式传输开关**：决定响应是一次性全量返回，还是像打字机一样逐字跳出。                      | 根据交互需求而定                |

> **💡 小贴士：**
>
> 虽然 `temperature` 和 `top_p` 都能影响结果的随机性，但开发者社区的习惯是：如果你想要结果更稳定（如逻辑推理、写代码），就调低 `temperature`；如果你想要结果更多元，则微调其中之一。在 RAG（检索增强生成）场景下，我们通常追求确定性，所以 `temperature` 一般设得很低。

* * *

### 2.5 `stream`：决定用户感知的“流式开关”

`stream` 参数直接影响了 API 的响应模式，这在构建用户界面时至关重要：

-   **`stream: false`（默认值：一次性返回）**

    -   **表现**：服务器会等模型生成完**所有**内容后，才将一个完整的 JSON 数据包返回给客户端。
    -   **感受**：用户需要等待一段“空白期”（Loading），然后整段答案突然出现。
    -   **场景**：适合后台任务处理、自动化脚本或对实时性要求不高的场景。

-   **`stream: true`（流式推送）**

    -   **表现**：服务器每生成一小段 Token，就会立即通过 **SSE (Server-Sent Events)** 协议推送给客户端。
    -   **感受**：前端可以看到“打字机”般的流畅效果，用户几乎能即时看到第一个字，**体感响应速度极快**。
    -   **场景**：对话机器人、AI 助手等所有需要与人类直接交互的界面。

### 3. 响应结果解析：拆解大模型的“回信”

当我们成功发起请求后，服务器会返回一段标准的 JSON 响应。以下是一个典型的非流式（`stream: false`）返回结果示例：

JSON

```
{
    "id": "chatcmpl-abc123",
    "object": "chat.completion",
    "created": 1700000000,
    "model": "Qwen/Qwen3-32B",
    "choices": [
        {
            "index": 0,
            "message": {
                "role": "assistant",
                "content": "你好，我是Qwen，有什么可以帮到你的吗？"
            },
            "finish_reason": "stop"
        }
    ],
    "usage": {
        "prompt_tokens": 52,
        "completion_tokens": 68,
        "total_tokens": 120
    }
}
```

这段 JSON 看起来字段很多，但在实际的后端开发中，我们通常只需要提取并关注以下三个核心模块：

-   **`id`**：本次请求的全局唯一标识。在复杂的业务架构中，它可以作为日志的 Trace ID，方便你进行链路追踪和问题排查。
-   **`choices`**：模型的回答数组。默认情况下（除非专门设置了生成多个回答），这个数组只有一个元素，也就是 `choices[0]`。
-   **`usage`**：账单与计费依据，记录了本次调用的 Token 消耗量。

下面我们重点拆解最关键的 `usage` 和 `finish_reason` 字段。

#### 3.1 `usage`：Token 用量统计（你的“计费表”）

API 服务的底层计费逻辑是按 Token 数量收费的。`usage` 字段就是这次调用的“消费明细”，它能帮你精准监控成本：

| **字段名称**                | **含义**   | **对应内容**                                                        |
| ----------------------- | -------- | --------------------------------------------------------------- |
| **`prompt_tokens`**     | **输入消耗** | 你发送的所有内容（包括 `system`、历史 `assistant` 和当前 `user` 消息）所占据的 Token 数。 |
| **`completion_tokens`** | **输出消耗** | 模型本次生成的回答内容所消耗的 Token 数。                                        |
| **`total_tokens`**      | **总消耗**  | 整体调用的总开销（`prompt_tokens` + `completion_tokens`）。                |

*(注：在上面的 JSON 示例中，输入消耗了 52 个 Token，输出消耗了 68 个 Token，本次请求总共被计费 120 个 Token。)*

#### 3.2 `finish_reason`：模型为什么停下来了？

`choices[0].finish_reason` 字段非常重要，它告诉你的程序：模型的这句话到底有没有说完。处理该字段是保证业务逻辑健壮性的关键一步。

它最常见的有两个值：

| **状态值**      | **含义**        | **详细说明**                                           |
| ------------ | ------------- | -------------------------------------------------- |
| **`stop`**   | **正常结束**      | 完美状态。模型认为自己已经把话说完了，主动停止了生成。此时 `content` 是一段完整的话。   |
| **`length`** | **触发长度限制被截断** | 异常状态。模型的话还没说完，但触发了你在请求参数中设置的 `max_tokens` 上限，被迫闭嘴。 |

> **🛠️ 开发避坑指南：**
>
> 如果你在测试时，发现前端展示的回答总是“说到一半戛然而止”（比如代码只写了一半，或者句子没标点符号），且日志里打印的 `finish_reason` 是 `"length"`，这就说明你的 `max_tokens` 设置得太小了。此时，只需在请求参数中把 `max_tokens` 调大（例如从 512 调到 2048），问题即可迎刃而解。



* * *

### 4. 开启实战：发起你的第一次大模型调用

理论准备就绪，接下来我们进入实战环节。

为了让大家能够零成本、快速地完成第一次 API 调用，我们选择 **阿里通义千问 (DashScope)** 平台。

1.  **极速上手**：其最新版本 API 已全面兼容 OpenAI 协议。
1.  **大厂保障**：无论是稳定性还是响应速度，在国产模型中都属于第一梯队。
1.  **免费额度**：新用户注册并在百炼平台开通模型服务后，通常会获得大量的免费 Token，非常适合学习和测试。

#### 4.1 本系列核心模型清单（阿里 DashScope 版）

在接下来的 RAG 实战中，我们将使用阿里提供的以下核心模型：

| **模型名称 (Model ID)**     | **模型类型**         | **核心用途**   | **本系列实战场景**          |
| ----------------------- | ---------------- | ---------- | -------------------- |
| **`qwen-plus`**         | **Chat 模型**      | 对话、推理、文本生成 | 基础 API 调用、RAG 最终答案生成 |
| **`text-embedding-v3`** | **Embedding 模型** | 文本向量化      | 知识库构建：将文档转为向量坐标      |
| **`gte-rerank`**        | **Reranker 模型**  | 检索结果重排序    | 精度优化：对检索到的原始资料进行精准筛选 |

* * *

#### 4.2 准备工作（Checklist）

在编写 Java 代码之前，请务必完成以下“入场券”的申领：

1.  **注册与开通**：访问 [阿里云百炼控制台](https://bailian.console.aliyun.com/)，开通“模型服务灵积”或“百炼”服务。

1.  **获取 API Key**：在控制台的“API-KEY 管理”页面创建你的 Key。**提示：阿里支持设置 API Key 的有效期和范围，安全性做得不错。**

1.  **确定 Base URL**：阿里兼容 OpenAI 协议的官方地址通常为：

    `[https://dashscope.aliyuncs.com/compatible-mode/v1](https://dashscope.aliyuncs.com/compatible-mode/v1)`

* * *

#### 4.3 为什么一定要用 API？

你可能会想：我直接在通义千问的网页端（或者 App）聊天不就行了吗？

对于开发者来说，**API 调用**和**网页对话**有着本质区别：

-   **无状态性**：正如前文所说，API 需要我们手动管理 `messages` 数组，这给了我们极大的自由度去精细控制“对话记忆”。
-   **系统指令（System Prompt）** ：在网页端你很难完全消除大模型的“幻觉”，但在 API 中，我们可以通过 `system` 角色下达硬性指令，让它变身为专业的“代码助手”或“客服机器人”。
-   **程序化集成**：只有通过 API，大模型才能真正接入你的 Java 后端系统，参与到数据库查询、业务流转中去。

### 4.4 代码实现：Java 快速调通

虽然现在有很多大模型的 SDK，但为了让你理解协议本质，我们先用最基础的 **HTTP 客户端**来实现。这里我们选用后端开发中常用的 **OkHttp** 处理请求，**Gson** 处理 JSON。

#### 1. 添加依赖

在你的 `pom.xml` 中引入以下坐标：

XML

```
<dependencies>
    <!-- OkHttp：高性能 HTTP 客户端 -->
    <dependency>
        <groupId>com.squareup.okhttp3</groupId>
        <artifactId>okhttp</artifactId>
        <version>4.12.0</version>
    </dependency>
    <!-- Gson：轻量级 JSON 处理工具 -->
    <dependency>
        <groupId>com.google.code.gson</groupId>
        <artifactId>gson</artifactId>
        <version>2.11.0</version>
    </dependency>
</dependencies>
```

#### 2. 核心调用逻辑

这段代码演示了如何构造一个符合 OpenAI 协议的请求体，并解析返回结果。
```java
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import okhttp3.*;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

public class QwenApiDemo {
    private static final Gson GSON = new Gson();
    private static final String API_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
    // 建议：实际开发中请将模型 ID 抽离为配置
    private static final String MODEL_ID = "qwen-plus"; 

    public static void main(String[] args) throws IOException {
        // 🚨 安全提醒：生产环境严禁在代码中硬编码 API Key
        // 建议通过环境变量获取：System.getenv("DASHSCOPE_API_KEY")
        String apiKey = "你的_API_KEY_在这里";

        // 1. 构建请求体 (符合 OpenAI 协议格式)
        Map<String, Object> payload = Map.of(
            "model", MODEL_ID,
            "messages", List.of(
                Map.of("role", "system", "content", "你是一个幽默的 Java 架构师。"),
                Map.of("role", "user", "content", "简单解释一下什么是大模型 API 的无状态性？")
            ),
            "temperature", 0.7,
            "stream", false
        );

        RequestBody body = RequestBody.create(
            GSON.toJson(payload), 
            MediaType.get("application/json; charset=utf-8")
        );

        // 2. 构造 HTTP 请求
        Request request = new Request.Builder()
                .url(API_URL)
                .header("Authorization", "Bearer " + apiKey)
                .post(body)
                .build();

        // 3. 发起调用 (设置超时防止挂死)
        OkHttpClient client = new OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .build();

        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                System.err.println("请求失败，错误码：" + response.code() + "，信息：" + response.body().string());
                return;
            }

            // 4. 解析响应
            String responseBody = response.body().string();
            JsonObject jsonResponse = GSON.fromJson(responseBody, JsonObject.class);
            
            // 按照 OpenAI 响应结构层层提取内容
            String content = jsonResponse
                    .getAsJsonArray("choices")
                    .get(0).getAsJsonObject()
                    .get("message").getAsJsonObject()
                    .get("content").getAsString();

            System.out.println("AI 回答：\n" + content);
            
            // 顺便打印一下本次消耗，养成监控 Token 的好习惯
            System.out.println("\n--- 消耗明细 ---");
            System.out.println(jsonResponse.get("usage"));
        }
    }
}
```


### 4.5 实现流式调用：告别“死等”，打造极致体验

流式调用（Streaming）本质上是对产品交互体验的一次降维打击。

试想一下，如果一个复杂的问题需要大模型思考并生成几千字，而非流式接口会让前端死死卡住几十秒。在这漫长的“空白期”里，用户完全不知道后台到底是卡死了、断网了，还是在正常处理，这无疑是反人类的体验。

而流式输出利用了 **SSE (Server-Sent Events)** 协议，让服务器像“打字机”一样，生成几个词就立刻推给前端。

下面是极其健壮的流式调用实现。我在你的代码基础上对排版和注释进行了优化，并且注意到了你测试用的 Prompt 是一道非常经典的后端面试题（Redis 缓存穿透），这在实际开发中也是 AI 助手最常被问到的场景。


```java
import com.google.gson.*;
import okhttp3.*;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

public class StreamingChat {
    private static final Gson GSON = new Gson();

    private static final String DEFAULT_API_URL =
            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

    private static final String MODEL = "qwen3.5-plus";

    private static final MediaType JSON_MEDIA_TYPE =
            MediaType.parse("application/json; charset=utf-8");

    private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            // 流式接口不能设置太短，否则模型还没输出完连接就断了
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .callTimeout(0, TimeUnit.MILLISECONDS)
            .build();

    public static void main(String[] args) throws Exception {
        String apiKey = System.getenv("DASHSCOPE_API_KEY");

        if (apiKey == null || apiKey.isBlank()) {
            throw new IllegalStateException("请先设置环境变量 DASHSCOPE_API_KEY");
        }

        List<Message> messages = new ArrayList<>();
        messages.add(new Message("system", "你是一个专业的 Java 后端助手。"));
        messages.add(new Message("user", "请用简单的话解释一下什么是 Redis 缓存穿透。"));

        String answer = streamChat(apiKey, messages);

        System.out.println();
        System.out.println("========== 完整回复 ==========");
        System.out.println(answer);
    }

    public static String streamChat(String apiKey, List<Message> messages) throws IOException {
        JsonObject requestJson = new JsonObject();

        requestJson.addProperty("model", MODEL);
        requestJson.add("messages", GSON.toJsonTree(messages));
        requestJson.addProperty("stream", true);

        // 可选：让最后一个 chunk 返回 token 用量
        JsonObject streamOptions = new JsonObject();
        streamOptions.addProperty("include_usage", true);
        requestJson.add("stream_options", streamOptions);

        String jsonBody = GSON.toJson(requestJson);

        RequestBody requestBody = RequestBody.create(jsonBody, JSON_MEDIA_TYPE);

        Request request = new Request.Builder()
                .url(DEFAULT_API_URL)
                .addHeader("Authorization", "Bearer " + apiKey)
                .addHeader("Content-Type", "application/json")
                .post(requestBody)
                .build();

        StringBuilder fullContent = new StringBuilder();

        try (Response response = CLIENT.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                String errorBody = response.body() == null ? "" : response.body().string();
                throw new IOException("请求失败，HTTP 状态码：" + response.code() + "，响应内容：" + errorBody);
            }

            if (response.body() == null) {
                throw new IOException("响应体为空");
            }

            System.out.println("========== 流式输出 ==========");

            try (BufferedReader reader = new BufferedReader(response.body().charStream())) {
                String line;

                while ((line = reader.readLine()) != null) {
                    line = line.trim();

                    // SSE 中可能有空行
                    if (line.isEmpty()) {
                        continue;
                    }

                    // 只处理 data: 开头的数据
                    if (!line.startsWith("data:")) {
                        continue;
                    }

                    String data = line.substring("data:".length()).trim();

                    // OpenAI 兼容接口一般会用 [DONE] 表示结束
                    if ("[DONE]".equals(data)) {
                        break;
                    }

                    JsonObject chunk;
                    try {
                        chunk = JsonParser.parseString(data).getAsJsonObject();
                    } catch (Exception e) {
                        System.err.println("JSON 解析失败，原始数据：" + data);
                        continue;
                    }

                    // 如果开启 include_usage，最后一个 chunk 可能 choices 为空
                    if (!chunk.has("choices") || chunk.get("choices").isJsonNull()) {
                        continue;
                    }

                    JsonArray choices = chunk.getAsJsonArray("choices");
                    if (choices == null || choices.isEmpty()) {
                        printUsageIfExists(chunk);
                        continue;
                    }

                    JsonObject choice = choices.get(0).getAsJsonObject();

                    if (!choice.has("delta") || choice.get("delta").isJsonNull()) {
                        continue;
                    }

                    JsonObject delta = choice.getAsJsonObject("delta");

                    // 普通文本增量：delta.content
                    if (delta.has("content") && !delta.get("content").isJsonNull()) {
                        String content = delta.get("content").getAsString();

                        System.out.print(content);
                        System.out.flush();

                        fullContent.append(content);
                    }

                    // 有些思考模型可能会返回 reasoning_content，可以按需打开
                    if (delta.has("reasoning_content") && !delta.get("reasoning_content").isJsonNull()) {
                        String reasoning = delta.get("reasoning_content").getAsString();

                        // 不想打印思考过程的话，可以注释掉
                        // System.out.print(reasoning);
                        // System.out.flush();
                    }
                }
            }
        }

        return fullContent.toString();
    }

    private static void printUsageIfExists(JsonObject chunk) {
        if (chunk.has("usage") && !chunk.get("usage").isJsonNull()) {
            JsonObject usage = chunk.getAsJsonObject("usage");
            System.out.println();
            System.out.println("========== Token 用量 ==========");
            System.out.println(GSON.toJson(usage));
        }
    }

    static class Message {
        private final String role;
        private final String content;

        public Message(String role, String content) {
            this.role = role;
            this.content = content;
        }
    }
}

```

* * *

### 💡 核心进阶认知：为什么流式调用在后端至关重要？

运行这段代码，你会发现控制台里的信息真是一个字一个字蹦出来的。

在实际的复杂业务架构中（比如处理高并发请求的 SaaS 平台），如果一个普通的 HTTP 接口被大模型动辄几十秒的生成过程完全阻塞，应用服务器底层的处理线程（Worker Threads）很快就会被打满。这会导致系统彻底瘫痪，无法响应其他用户的请求。

因此，采用这种基于流式解析的机制，不仅仅是为了给前端用户提供视觉上的流畅感，更是为了解放后端。通过配合异步回调或者响应式编程，可以有效缓解长耗时任务对后台吞吐能力的拖累。
* * *

### 4.6 架构选型：非流式 vs 流式，到底怎么选？

经历了前面的代码实战，你可能会纠结：以后在项目里到底该用哪种方式？

其实，这两种调用方式没有绝对的优劣，只有**适用场景的不同**。流式赢在“前端体验”，而非流式赢在“后端易用”。下面这张选型表能帮你快速做决定：

| **对比维度**          | **📦 非流式 (stream: false)**         | **🌊 流式 (stream: true)**                   |
| ----------------- | ---------------------------------- | ------------------------------------------ |
| **响应机制**          | “憋大招”：全文生成完毕后，一次性返回                | “打字机”：边想边说，通过 SSE 逐块推送                     |
| **首字响应时间 (TTFT)** | **极高**（需等待数十秒直到全文完结）               | **极低**（几乎立刻开始输出第一个字）                       |
| **用户体验**          | 等待感极强，容易让用户以为系统卡死                  | 体验丝滑，用户能直观感受到 AI 的“思考过程”                   |
| **后端开发复杂度**       | **极简**。标准的 HTTP 请求，直接解析完整的 JSON 即可 | **较高**。需要处理网络长连接，并逐块拼接 JSON 碎片             |
| **Token 账单统计**    | 极其直观，响应体末尾直接自带 `usage` 字段          | 稍显繁琐（需通过 `stream_options` 开启，且仅在最后一个数据块返回） |
| **最核心的适用场景**      | 后台跑批、自动化脚本、数据清洗等**无需人类实时查看**的任务    | 聊天机器人、智能客服、Copilot 等**强人机交互**的界面

## 自己动手
你可以设计一些有趣的系统提示词，感受system prompt的乐趣，比如我下面这个例子

```java
 List<Message> messages = new ArrayList<>();
        messages.add(new Message("system", "你是一个菲比，所有回答后面加上菲比啾比这一个语气词"));
        messages.add(new Message("user", "Java 和 c语言 哪个好？"));

        String answer = streamChat(apiKey, messages);

        System.out.println();
        System.out.println("========== 完整回复 ==========");
        System.out.println(answer);
```


回答如下：

```bash
哇～这个问题好难选呀

其实呀，Java 和 C 语言都是超级厉害的编程魔法哦！✨

🛠️ **C 语言**就像是打地基的大功臣，它离硬件很近很近，跑起来飞快飞快的，适合做操作系统或者嵌入式设备呢～
☕ **Java**呢，就像是一个到处都能跑的小精灵，"一次编写，到处运行"，做网站、安卓 app 都很擅长哦！

所以呀，没有绝对的哪个更好，要看你想做什么样的项目呢！如果是初学者，菲比觉得先从哪个入手都可以哒，重要的是保持热爱哟～💕

不管选哪个，菲比都会为你加油打气哒！菲比啾比～(づ｡◕‿‿◕｡) づ 🌟
```

