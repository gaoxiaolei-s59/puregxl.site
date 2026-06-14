---
title: 大模型篇章（3）大模型的常用范式以及代码的实现
published: 2026-06-01
description: ""
image: ""
tags: [大模型, AI]
category: AI
draft: false
lang: ""
---

# 从零构建一个简单智能体：将理论真正落到代码实践

## 一、 引言：走进现代智能体

在上一篇文章中，我们实现了一个简单的原生大模型 API 调用。到这一步，我们已经完成了智能体开发中最基础的一环：让程序具备与大语言模型（LLM）交互的能力。

但仅仅能与大模型对话，还远远称不上是“智能体（Agent）”。从这一篇开始，我们将跨越理论的边界，亲手将大模型包装成一个真正具备“思考与行动”能力的简单智能体。

### 1.1 什么是现代智能体？

现代智能体的核心魅力，在于它**将大模型的推理能力与真实的外部世界连接在了一起**。

它不再局限于被动地“理解输入、生成文本”，而是能够根据目标进行逻辑推理、拆解任务步骤，并在必要时主动调用外部工具（例如代码解释器、搜索引擎、数据库查询接口或第三方 API）。通过这种方式，它能够获取实时信息、执行实际操作，最终闭环完成复杂的任务。

简单来说，智能体实现了从“回答问题”到“思考并行动”的跨越。

举个例子，当面对一个复杂需求时，智能体的完整心智模型通常包含以下过程：

1. 理解用户意图；
2. 将宏大目标拆解为可执行的步骤；
3. 判断当前步骤是否需要借助外部工具；
4. 调用工具，获取外部反馈或执行系统操作；
5. 根据工具的返回结果继续下一步推理；
6. 综合所有信息，生成最终答案或确认任务完成。

这就是智能体之所以比单纯的 LLM 调用更强大的根本原因。

### 1.2 智能体并非“银弹”：认清能力边界

虽然智能体的概念令人兴奋，但它并非无所不能。

由于其大脑依然是基于概率的大语言模型，因此它天然继承了模型的缺陷（如“幻觉”现象）。此外，在应对复杂任务时，智能体在工程侧还面临着诸多挑战：

* **推理迷失**：推理链路过长，导致偏离目标甚至陷入死循环；
* **工具误用**：选择了错误的工具，或生成了不符合格式的工具参数导致报错；
* **反馈理解偏差**：无法正确解析或过度解读工具返回的结果；
* **缺乏终止机制**：无法准确判断任务是否已经达成，导致无休止地运行。

这些挑战共同构成了当前智能体系统的能力边界。因此，构建智能体绝不仅仅是“写个 Prompt 让模型去调 API”，更是**设计一套稳定、可控、具备容错能力的思考与行动机制**。

### 1.3 三种经典的智能体架构范式

为了让智能体的推理与行动更加有序，业界演进出了多种经典的架构范式。在本章接下来的实战中，我们将重点剖析并从零手写三种最具代表性的范式。

* **ReAct：边思考边行动** ReAct（Reasoning and Acting）是目前最主流的范式之一。它的核心理念是不急于给出最终结论，而是在“思考”与“行动”之间不断交替循环。
> **典型链路：** Thought $\rightarrow$ Action $\rightarrow$ Observation $\rightarrow$ Thought $\rightarrow$ Action $\rightarrow$ Observation $\rightarrow$ Final Answer


* **Plan-and-Solve：谋定而后动** 与 ReAct 的“走一步看一步”不同，Plan-and-Solve 偏向于“三思而后行”。它要求智能体在动手前，先基于全局视角生成一个完整的行动计划（Plan），随后严格按照计划分步执行（Solve）。
> **典型链路：** Plan $\rightarrow$ Execute Step 1 $\rightarrow$ Execute Step 2 $\rightarrow$ Execute Step 3 $\rightarrow$ Final Answer


* **Reflection：学会自我反思** Reflection 范式赋予了智能体“审视自我”的能力。在生成初步结果后，智能体不会立刻交卷，而是进入自我审查阶段，评估输出是否存在遗漏、逻辑谬误或优化空间，随后进行迭代修正。
> **典型链路：** Generate $\rightarrow$ Reflect $\rightarrow$ Revise $\rightarrow$ Final Answer



### 1.4 为什么不直接使用 LangChain 或 LlamaIndex？

原因有三：

* **透彻理解底层原理**：高度封装的框架隐藏了太多实现细节。亲手写一遍，是打破黑盒的唯一途径。
* **直面真实的工程挑战**：只有脱离了框架的保护伞，你才会真正遇到“模型输出不按 JSON 格式怎么办”、“工具报错如何重试”、“如何强制熔断死循环”等棘手问题。
* **获得深度定制的自由**：真实的商业业务极其复杂，只有掌握了底层逻辑，你才能从框架的“使用者”蜕变为智能体应用的“创造者”。

---

## 二、 环境搭建与大模型客户端封装

在这个手头项目中，我们将采用 **Java 17 + OkHttp + Gson** 的技术组合，并接入硅基流动（SiliconFlow）的 API，来为我们的智能体构建核心大脑。

首先，在你的 Maven 项目 `pom.xml` 中引入必要的依赖：

```xml
<dependencies>
    <dependency>
        <groupId>com.squareup.okhttp3</groupId>
        <artifactId>okhttp</artifactId>
        <version>4.12.0</version>
    </dependency>
    
    <dependency>
        <groupId>com.google.code.gson</groupId>
        <artifactId>gson</artifactId>
        <version>2.10.1</version>
    </dependency>
</dependencies>

```

接下来，实现大模型交互的核心工具类。我们先定义一个基础的 `Message` 实体，然后编写 `SiliconFlowClient`。

```java
import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import okhttp3.*;
import java.io.IOException;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * 硅基流动 (SiliconFlow) 大模型 API 客户端
 */
public class SiliconFlowClient {

    private static final String API_KEY = System.getenv("SILICONFLOW_API_KEY");
    private static final String API_URL = "https://api.siliconflow.cn/v1/chat/completions";
    private static final String DEFAULT_MODEL = "deepseek-ai/DeepSeek-V2.5";

    private final OkHttpClient httpClient;
    private final Gson gson;

    public SiliconFlowClient() {
        this.gson = new Gson();
        this.httpClient = new OkHttpClient.Builder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(120, TimeUnit.SECONDS)
                .build();
    }

    public String chat(List<Message> messages) {
        if (API_KEY == null || API_KEY.isEmpty()) {
            throw new RuntimeException("请先设置 SILICONFLOW_API_KEY 环境变量");
        }

        JsonObject requestBodyJson = new JsonObject();
        requestBodyJson.addProperty("model", DEFAULT_MODEL);
        requestBodyJson.addProperty("temperature", 0.1); 

        JsonArray messagesArray = new JsonArray();
        for (Message msg : messages) {
            JsonObject msgObj = new JsonObject();
            msgObj.addProperty("role", msg.getRole());
            msgObj.addProperty("content", msg.getContent());
            messagesArray.add(msgObj);
        }
        requestBodyJson.add("messages", messagesArray);

        RequestBody body = RequestBody.create(
                requestBodyJson.toString(), 
                MediaType.get("application/json; charset=utf-8")
        );

        Request request = new Request.Builder()
                .url(API_URL)
                .header("Authorization", "Bearer " + API_KEY)
                .post(body)
                .build();

        try (Response response = httpClient.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException("Unexpected code " + response);
            }

            String responseData = response.body().string();
            JsonObject jsonObject = gson.fromJson(responseData, JsonObject.class);
            
            return jsonObject.getAsJsonArray("choices")
                    .get(0).getAsJsonObject()
                    .getAsJsonObject("message")
                    .get("content").getAsString();

        } catch (IOException e) {
            System.err.println("调用大模型 API 失败: " + e.getMessage());
            return "Error: " + e.getMessage();
        }
    }

    public static class Message {
        private String role;
        private String content;

        public Message(String role, String content) {
            this.role = role;
            this.content = content;
        }

        public String getRole() { return role; }
        public String getContent() { return content; }
    }
}

```

---

## 三、 ReAct 范式实战：边思考边行动

### 3.1 工作原理

ReAct 的巧妙之处，在于它认识到**思考（Reasoning）与行动（Acting）是相辅相成的**。

为了实现这种协同，ReAct 范式通过精妙的提示词工程（Prompt Engineering）来规范模型的输出格式，迫使大模型的每一步推理都遵循一条清晰的轨迹：

* **Thought（思考）**：智能体的“内心独白”。它负责分析当前的状况、拆解任务目标、制定下一步计划。
* **Action（行动）**：智能体决定采取的具体动作，通常表现为调用一个外部工具。
* **Observation（观察）**：环境或工具执行 Action 后返回的真实结果（由系统注入）。

#### 核心公式形式化表达

在任意时间步 $t$，智能体的策略（即大语言模型 $\pi$）会根据用户的初始问题 $q$ 以及此前所有步骤沉淀下来的“行动-观察”历史轨迹 $((a_1, o_1), \dots, (a_{t-1}, o_{t-1}))$，来共同推导并生成当前的思考 $th_t$ 和下一步要执行的行动 $a_t$：

$$(th_t, a_t) = \pi(q, (a_1, o_1), \dots, (a_{t-1}, o_{t-1}))$$

随后，外部环境中的工具 $T$ 会实时接收并执行行动 $a_t$，反馈回一个新的观察结果 $o_t$：

$$o_t = T(a_t)$$

#### 实战目标演练

我们将构建一个具备使用“网络天气工具”能力的 Java ReAct 智能体，去攻克一个复杂诉求：**“我想去北京旅游，帮我查查天气，并告诉我需不需要带防晒霜。”**

### 3.2 核心代码实现

```java
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class ReActAgent {

    private final SiliconFlowClient llmClient;
    private final Map<String, Tool> toolRegistry = new HashMap<>();
    
    private static final String SYSTEM_PROMPT = """
            你是一个全能智能体。你可以使用以下工具来解决用户的问题：
            - WeatherTool: 输入城市名称，返回该城市的当前天气情况。
            
            请你务必严格按照以下格式思考和输出（格式极其重要）：
            Thought: 思考为了解决问题，下一步我需要做什么。
            Action: 决定使用的工具名称，必须是 [WeatherTool] 中的一个。如果没有工具，或者不需要工具，直接输出 Final Answer。
            Action Input: 传入工具的参数。
            Observation: 工具执行后的返回结果。（这部分由系统生成，你不需要输出）
            ... (上述流程可以重复多次)
            Final Answer: 最终回答用户的问题。
            """;

    public ReActAgent(SiliconFlowClient client) {
        this.llmClient = client;
    }

    public void registerTool(Tool tool) {
        toolRegistry.put(tool.getName(), tool);
    }

    public void run(String query, int maxIterations) {
        List<SiliconFlowClient.Message> messages = new ArrayList<>();
        messages.add(new SiliconFlowClient.Message("system", SYSTEM_PROMPT));
        messages.add(new SiliconFlowClient.Message("user", query));

        System.out.println("🚀 【任务开始】: " + query + "\n");
        System.out.println("----------------------------------------");

        Pattern actionPattern = Pattern.compile("Action:\\s*(.*)");
        Pattern inputPattern = Pattern.compile("Action Input:\\s*(.*)");

        for (int i = 0; i < maxIterations; i++) {
            System.out.println("🧠 [Agent 思考中...]");
            String response = llmClient.chat(messages);
            System.out.println(response);
            
            messages.add(new SiliconFlowClient.Message("assistant", response));

            if (response.contains("Final Answer:")) {
                System.out.println("----------------------------------------");
                System.out.println("✅ 任务圆满完成！");
                return;
            }

            Matcher actionMatcher = actionPattern.matcher(response);
            Matcher inputMatcher = inputPattern.matcher(response);

            if (actionMatcher.find() && inputMatcher.find()) {
                String toolName = actionMatcher.group(1).trim();
                String toolInput = inputMatcher.group(1).trim();

                String observation;
                if (toolRegistry.containsKey(toolName)) {
                    System.out.println("⚙️ [系统拦截]: 发现工具调用请求 -> 工具: [" + toolName + "], 参数: [" + toolInput + "]");
                    try {
                        observation = toolRegistry.get(toolName).execute(toolInput);
                    } catch (Exception e) {
                        observation = "执行错误: " + e.getMessage(); 
                    }
                } else {
                    observation = "错误: 未找到该工具 [" + toolName + "]";
                }

                System.out.println("🔍 [工具返回]: " + observation + "\n");
                messages.add(new SiliconFlowClient.Message("user", "Observation: " + observation));
            } else {
                System.out.println("⚠️ [系统警告]: 模型未按照要求格式输出，强制纠偏。");
                messages.add(new SiliconFlowClient.Message("user", "格式错误！请严格遵守 Thought / Action / Action Input 或 Final Answer 的格式规范。"));
            }
        }
        System.out.println("❌ 达到最大思考轮数限制 (" + maxIterations + ")，任务被系统强制熔断。");
    }

    public interface Tool {
        String getName();
        String execute(String input);
    }
}

```

### 3.3 运行验证

```java
public class AgentTest {
    public static void main(String[] args) {
        SiliconFlowClient client = new SiliconFlowClient();
        ReActAgent agent = new ReActAgent(client);
        
        agent.registerTool(new ReActAgent.Tool() {
            @Override
            public String getName() { return "WeatherTool"; }

            @Override
            public String execute(String input) {
                if (input.contains("北京")) {
                    return "当前气温 25℃，晴朗，适合户外活动。";
                } else if (input.contains("伦敦")) {
                    return "当前气温 15℃，阴有小雨，建议带伞。";
                }
                return "未查到该城市的天气数据。";
            }
        });

        agent.run("我想去北京旅游，帮我查查天气，并告诉我需不需要带防晒霜。", 5);
    }
}

```

### 3.4 深度复盘：特点与工程痛点

* **核心特点**：极高的**可解释性**，控制台上能直观展现模型的“内心独白”；具备出色的**动态规划与容错纠错**能力，能根据上一步的反馈随时调整方向。
* **固有局限**：对底层大模型的指令遵循能力**强依赖**；由于频繁串行调用大模型，导致**响应延迟（Latency）偏高且 Token 成本大**；此外，容易因为微小的提示词抖动或错误的工具有所偏离，陷入**无限死循环**。
* **调试技巧**：在 HTTP 请求的临界点**打印完整 Prompt 上下文**；当解析报错时，务必捕获并观察未经裁剪的**原始输出（Raw Output）**；严格限制大模型的 `temperature` 在 `0` 附近以抹平随机性。

---

## 四、 Plan-and-Solve 范式实战：谋定而后动

### 4.1 工作原理

与 ReAct 这种“走一步看一步”的动态范式不同，Plan-and-Solve 采取了**解耦**的思想，将智能体的整个认知与执行生命周期划分为了两个阶段：

* **规划阶段（Planning Phase）**：大模型站在全局视角俯瞰问题，对宏大目标进行手术刀式的层层拆解，最终制定出一个结构清晰的**分步行动计划 $P$**。
* **执行阶段（Solving Phase）**：执行模型严格遵循既定计划中的步骤，开启自动化串行履约。

#### 核心公式形式化表达

**第一阶段：战略规划**


$$P = \pi_{\text{plan}}(q) = (p_1, p_2, \dots, p_n)$$

**第二阶段：分步求解**
对于当前处理的第 $i$ 个步骤，其局部解 $s_i$ 的推导不仅依赖于原始问题 $q$ 和全局规划 $P$，还强依赖于此前所有已完成步骤沉淀下来的历史战果 $(s_1, \dots, s_{i-1})$：

$$s_i = \pi_{\text{solve}}(q, P, (s_1, \dots, s_{i-1}))$$

### 4.2 核心代码实现

```java
import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import java.util.ArrayList;
import java.util.List;

public class PlanAndSolveAgent {

    private final SiliconFlowClient llmClient;
    private final Gson gson = new Gson();

    private static final String PLANNING_PROMPT_TEMPLATE = """
            你是一个顶层的战略规划专家。面对用户的问题，你的任务是将其拆解为多个逻辑严密、环环相扣的执行步骤。
            【限制条件】
            你必须且只能输出一个标准的 JSON 字符串数组，不能包含任何 markdown 标记（如 ```json）、任何前导词或解释性文字。
            【输出示例】
            ["步骤1：收集A数据","步骤2：对比B数据并分析差异","步骤3：总结并输出最终结论"]
            现在，请拆解以下用户任务：
            %s
            """;

    private static final String SOLVING_PROMPT_TEMPLATE = """
            你是一个严谨的执行者。目前我们正在携手完成一个宏大任务。
            【原始任务】: %s
            【全局规划】: %s
            【历史已完成步骤及结果】:
            %s
            ----------------------------------------
            现在，请专注于执行当前步骤：【%s】
            请基于上述历史上下文，给出这一步的详细执行结果。
            """;

    public PlanAndSolveAgent(SiliconFlowClient client) {
        this.llmClient = client;
    }

    public void run(String query) {
        System.out.println("🚀 【Plan-and-Solve 任务启动】: " + query + "\n");

        // ==========================================
        // 阶段一：战略规划 (Planning Phase)
        // ==========================================
        System.out.println("📝 [Phase 1: 正在制定全局战略计划...]");
        String planningPrompt = String.format(PLANNING_PROMPT_TEMPLATE, query);
        List<SiliconFlowClient.Message> planMessages = new ArrayList<>();
        planMessages.add(new SiliconFlowClient.Message("user", planningPrompt));
        
        String rawPlanJson = llmClient.chat(planMessages).trim();
        List<String> planSteps = parsePlanJson(rawPlanJson);
        
        System.out.println("🧭 [系统生成的行军路线图]:");
        for (int i = 0; i < planSteps.size(); i++) {
            System.out.printf("  %d. %s\n", i + 1, planSteps.get(i));
        }
        System.out.println("----------------------------------------\n");

        // ==========================================
        // 阶段二：分步履约 (Solving Phase)
        // ==========================================
        System.out.println("🛠️ [Phase 2: 正在按照计划步步推进...]");
        StringBuilder contextHistory = new StringBuilder();

        for (int i = 0; i < planSteps.size(); i++) {
            String currentStep = planSteps.get(i);
            System.out.printf("\n🏃 [正在执行第 %d/%d 步]: %s\n", i + 1, planSteps.size(), currentStep);

            String solvingPrompt = String.format(
                    SOLVING_PROMPT_TEMPLATE, 
                    query, 
                    planSteps.toString(), 
                    contextHistory.length() == 0 ? "（暂无）" : contextHistory.toString(), 
                    currentStep
            );

            List<SiliconFlowClient.Message> solveMessages = new ArrayList<>();
            solveMessages.add(new SiliconFlowClient.Message("user", solvingPrompt));

            String stepResult = llmClient.chat(solveMessages);
            System.out.println("🎨 [本步产出]:\n" + stepResult);

            contextHistory.append(String.format("[已完成步骤 %d] %s -> 结果:\n%s\n\n", i + 1, currentStep, stepResult));
        }
        System.out.println("----------------------------------------");
        System.out.println("🏁 所有规划步骤执行完毕，长任务圆满闭环！");
    }

    private List<String> parsePlanJson(String rawJson) {
        List<String> steps = new ArrayList<>();
        try {
            if (rawJson.startsWith("```json")) {
                rawJson = rawJson.replace("```json", "").replace("```", "").trim();
            }
            JsonArray array = gson.fromJson(rawJson, JsonArray.class);
            for (JsonElement element : array) {
                steps.add(element.getAsString());
            }
        } catch (Exception e) {
            System.err.println("❌ 计划解析失败，降级采用兜底单步计划。错误原因: " + e.getMessage());
            steps.add("直接根据原始诉求尝试生成最终答案");
        }
        return steps;
    }
}

```

### 4.3 运行验证

```java
public class PlanAndSolveTest {
    public static void main(String[] args) {
        SiliconFlowClient client = new SiliconFlowClient();
        PlanAndSolveAgent agent = new PlanAndSolveAgent(client);
        
        String complexTask = "帮我撰写一份《2026年第一季度新能源汽车行业洞察短报》。" +
                "要求包含三个核心模块：1. 全球销量宏观大势；2. 固态电池技术的突围进展；3. 当前车企出海面临的关税壁垒挑战。";
        
        agent.run(complexTask);
    }
}

```

### 4.4 深度复盘：固有缺陷与工程痛点

* **计划的僵化性（Plan Rigidity）**：核心假设是环境静态不变。一旦第一步的外部数据发现全新线索，执行器没有能力中途重构计划，只能“刻舟求剑”盲目向前。
* **错误级联效应（Error Propagation）**：由于采用滚动上下文（Rolling Context）机制，一旦前面的某一步骤模型产生了“幻觉”，这个错误就会作为既定事实无条件注入后续链路，导致错误像雪球一样越滚越大。
* **上下文膨胀压力**：随着步骤推进，`contextHistory` 在内存中呈线性膨胀，投递给 API 的请求由于文本过长会导致响应变慢，甚至产生“Lost in the Middle（迷失在中央）”现象。
* **工业级折中方案**：业界常采用 **Plan-Then-ReAct** 混合范式：由 Planner 生成宏观骨架步骤（Plan），但在执行每个具体子步骤时，其内部运行着一个微型的 ReAct 状态机。

---

## 五、 Reflection 范式实战：自我进化回路

### 5.1 工作原理

**Reflection（反思）机制**的核心思想，是为智能体引入一种**事后（post-hoc）的自我校正闭环**。它赋予了智能体像人类一样审视自身工作、在挫败中总结经验、并完成阶段性版本迭代的能力。整个工作流程可以精简地概括为“执行 $\rightarrow$ 反思 $\rightarrow$ 优化”的三阶段循环。

#### 核心公式形式化表达

反思模型 $\pi_{\text{reflect}}$ 负责对当前的输出进行质量审计，生成批判性反馈 $F_i$：

$$F_i = \pi_{\text{reflect}}(\text{Task}, O_i)$$

随后，优化模型 $\pi_{\text{refine}}$ 接收所有的上下文历史，完成定向重构，产出下一代新样本 $O_{i+1}$：

$$O_{i+1} = \pi_{\text{refine}}(\text{Task}, O_i, F_i)$$

### 5.2 记忆模块设计与核心实现

由于 Reflection 强依赖于“记住过去的失败”，因此一个结构化的**短期记忆（Memory）模块**是不可或缺的。这里我们使用 Java 17 的 `record` 特性来实现：

```java
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

public class AgentMemory {
    public record MemoryRecord(String type, String content) {}
    private final List<MemoryRecord> records = new ArrayList<>();

    public void addRecord(String type, String content) {
        records.add(new MemoryRecord(type, content));
        System.out.printf("📝 记忆仓更新：成功归档一条 [%s] 类型的核心快照。\n", type);
    }

    public String getTrajectory() {
        List<String> trajectoryParts = new ArrayList<>();
        for (MemoryRecord record : records) {
            if ("execution".equals(record.type())) {
                trajectoryParts.add("--- 上一轮尝试的代码 ---\n" + record.content());
            } else if ("reflection".equals(record.type())) {
                trajectoryParts.add("--- 严格评审员反馈 ---\n" + record.content());
            }
        }
        return String.join("\n\n", trajectoryParts);
    }

    public Optional<String> getLastExecution() {
        for (int i = records.size() - 1; i >= 0; i--) {
            MemoryRecord r = records.get(i);
            if ("execution".equals(r.type())) {
                return Optional.of(r.content());
            }
        }
        return Optional.empty();
    }
}

```

接下来构建 `ReflectionAgent` 核心类：

```java
import java.util.ArrayList;
import java.util.List;

public class ReflectionAgent {

    private final SiliconFlowClient llmClient;
    private final AgentMemory memory = new AgentMemory();
    private final int maxIterations;

    private static final String INITIAL_PROMPT_TEMPLATE = """
            你是一位资神的 Python 程序员。请根据以下要求，编写一个 Python 函数。
            你的代码必须包含完整的函数签名、文档字符串，并遵循 PEP 8 编码规范。
            【要求】: %s
            请直接输出代码，绝对不要包含任何额外的Markdown包裹框之外的文字解释。
            """;

    private static final String REFLECT_PROMPT_TEMPLATE = """
            你是一位极其严格的代码评审专家和首席算法工程师，对代码的运行时性能和空间复杂度有极致的追求。
            你的任务是严厉审查以下 Python 代码，并专注于找出其在【算法效率】上的致命瓶颈。
            # 原始任务: %s
            # 待审查的代码:
            %s
            请冷酷分析该代码的时间复杂度，并思考是否存在一种算法上更优的解法来带来量级上的性能提升。
            如果有，请清晰指出当前算法的软肋，并给出明确、具体的改进算法路线（例如提示其使用某种筛法）。
            【极其重要】: 只有当代码在算法、工程层面均已达到无懈可击的最优状态时，你才能回答“无需改进”。
            请直接输出你的反馈意见，不要带任何前导客套话。
            """;

    private static final String REFINE_PROMPT_TEMPLATE = """
            你是一位追求极致的 Python 程序员。现在你需要根据代码评审专家的专业意见，对你上一轮的代码进行彻底的重构重写。
            # 原始任务: %s
            # 你上一轮尝试的代码:
            %s
            # 评审员给你的修改意见:
            %s
            请严格基于上述反馈，生成一个完全优化后的全新版本代码。
            代码必须包含完整的函数签名、详细的注释，并遵循 PEP 8 规范。直接输出代码，不包含任何废话。
            """;

    public ReflectionAgent(SiliconFlowClient client, int maxIterations) {
        this.llmClient = client;
        this.maxIterations = maxIterations;
    }

    public void run(String task) {
        System.out.println("🚀 【Reflection 自我进化任务启动】: " + task);
        
        System.out.println("\n🎬 [Round 0] 正在生成初始初稿...");
        String initPrompt = String.format(INITIAL_PROMPT_TEMPLATE, task);
        String initialCode = callLLM(initPrompt);
        memory.addRecord("execution", initialCode);
        System.out.println("🤖 [初版产出]:\n" + initialCode);

        for (int i = 1; i <= maxIterations; i++) {
            System.out.printf("\n🔄 [进行第 %d / %d 轮自我进化循环]\n", i, maxIterations);

            System.out.println("🔍 [评审员上线]: 正在进行深度代码审计...");
            String lastCode = memory.getLastExecution().orElse("");
            String reflectPrompt = String.format(REFLECT_PROMPT_TEMPLATE, task, lastCode);
            String feedback = callLLM(reflectPrompt);
            memory.addRecord("reflection", feedback);
            System.out.println("👺 [批判性意见]:\n" + feedback);

            if (feedback.contains("无需改进")) {
                System.out.println("\n🎉 【进化终止】: 评审员认为当前代码已臻完美，无懈可击！");
                break;
            }

            System.out.println("🛠️ [程序员上线]: 接收反馈，正在进行代码重构...");
            String refinePrompt = String.format(REFINE_PROMPT_TEMPLATE, task, lastCode, feedback);
            String refinedCode = callLLM(refinePrompt);
            memory.addRecord("execution", refinedCode);
            System.out.println("✨ [进化版代码产出]:\n" + refinedCode);
        }
        System.out.println("\n🏁 【最终交付代码】:\n" + memory.getLastExecution().orElse("无产出"));
    }

    private String callLLM(String prompt) {
        List<SiliconFlowClient.Message> msgs = new ArrayList<>();
        msgs.add(new SiliconFlowClient.Message("user", prompt));
        return llmClient.chat(msgs);
    }
}

```

### 5.3 运行验证与成本收益分析

我们可以通过传入任务：`“编写一个 Python 函数，找出 1 到 n 之间所有的素数。”` 来运行。在运行中，由于黑脸评审员提示词发挥作用，大模型会敏锐发现试除法的 $O(n\sqrt{n})$ 性能瓶颈，并在下一轮重构出无懈可击的埃拉托斯特尼筛法 $O(n \log \log n)$ 方案。

#### 成本收益盘点

* **物理成本**：每进化一轮，至少需要**额外消耗 2 次全量 API 请求**，Token 消耗呈乘数级上升；且属于**串行阻塞流**，无法应用于强实时 C 端高并发场景。
* **工程收益**：完成了从“能用”到“好用”的**质量跃迁**；能在内网沙盒中提前捕获边界条件和潜在 Bug，具有极高的**工业可靠性**。
* **适用场景**：AI 自动代码审计与修复（CI/CD）、高价值法律文书/合同合规性死磕、企业级复杂财务报表比对交叉审计。

---

## 六、 本章小结

本章我们彻底抛开了市面上各种厚重的开源框架，纯粹基于 **Java 17 + OkHttp + Gson** 基础设施，亲手实现并解构了三种最经典的智能体架构范式。所谓的智能体，本质上就是一套**精心设计的提示词工程与一套严密的本地代码状态机深度缝合的产物**。

### 三大智能体范式横向大比拼
| 架构范式               | 核心心智模型                                            | 核心优势                                    | 固有缺陷                                        | 最佳适用场景                        |
| ------------------ | ------------------------------------------------- | --------------------------------------- | ------------------------------------------- | ----------------------------- |
| **ReAct**          | 边思考，边行动<br><br>`Thought -> Action -> Observation` | - 动态容错与纠错能力强<br><br>- 非常适合与外部工具进行实时交互   | - 容易因模型输出格式不稳定而失败<br><br>- 可能陷入局部最优或无限循环    | 实时信息检索、算术审计、数据库自动化读写、客服多轮交互   |
| **Plan-and-Solve** | 谋定而后动<br><br>`Plan -> Solve Step by Step`         | - 宏观结构清晰，目标一致性强<br><br>- 适合长文本、长链路任务    | - 计划相对僵化，动态应变能力弱<br><br>- 前期计划错误会导致后续错误级联放大 | 多源信息聚合报告撰写、多步数学应用题求解、代码架构设计   |
| **Reflection**     | 审视自我，迭代优化<br><br>`Execute -> Reflect -> Refine`   | - 能显著提升初始答案质量<br><br>- 具备一定的自我检查与短期修正能力 | - 串行执行会带来明显延迟<br><br>- Token 成本会随着反思轮数快速上升  | AI 自动代码审计与修复、高价值合同合规审查、核心财报校验 |




### 核心工程启示录

1. **驯服不确定性是 Java 工程师的核心基本功**：通过强迫模型输出标准的 JSON Array、利用预编译正则匹配进行行为拦截、以及利用 `try-catch` 将本地异常转化为 `Observation` 喂回给大模型，这些都是将大模型成功驯服并融入确定性微服务架构的必经之路。
2. **商业落地需“混合双打”**：在真实的工业级生产环境中，资深的 AI 架构师很少纯粹孤立地使用某种范式。更普遍的做法是采用混合范式（如 **Plan-Then-ReAct**）：由 Planner 模型在顶层制定宏观骨架计划，而在执行每一个具体子节点时，内部则运行着一个微型的 ReAct 状态机，兼顾全局与细节。
3. **看清开源框架的“糖衣炮弹”**：开源组件确实能提升效率，但一开始就过度依赖它们，就会被困在“调包侠”的黑盒里。掌握了底层的 Prompt 约束、记忆滚动机制和工具路由调度，你才能在面对极端业务瓶颈时，随时甩开框架独立构建。
