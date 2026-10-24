---
title: "LLM 服务商终将发生故障：熔断器、回退链与降级模式"
published: 2026-10-22
description: "面向生产环境的 LLM 容错设计：识别 HTTP 200 背后的失败，构建按行为一致性排序的回退链，并提前规划缓存、排队与功能降级。附 Go 实现与上线检查清单。"
image: ""
tags: [AI, 大模型, Go, 系统设计, 高可用]
category: AI
draft: false
lang: "zh-CN"
---



## 核心要点

- **标准 API 服务等级不等于可用性承诺。** OpenAI 和 Anthropic 都没有在标准 API 档位提供 SLA；Anthropic 将其称为“尽力提供可用性”。两家的高级档位，正是为了在容量不足时优先保障流量。
- **HTTP 200 并不保证调用成功。** Anthropic 流式传输中途的 `overloaded_error`、OpenAI Fast 模式的静默降级，以及流式传输中途的拒绝，都可能出现在 200 响应中。只看状态码的熔断器会漏掉它们。
- **重试只放在一层。** 两家的官方 Go SDK 默认都已重试两次；额外叠加重试循环会让请求次数相乘。让熔断器观察 SDK 重试之后的最终失败。
- **回退顺序优先保持行为一致。** 先选择其他云平台上的同一个模型，再考虑不同模型。更换模型会改变产品的实际表现。
- **降级方式要提前做产品决策。** 缓存、排队、切换小模型，或明确关闭功能，都应在故障发生前定下来，不能等到凌晨两点状态页一片红时再临场发挥。

2024 年 12 月 11 日，OpenAI API 在太平洋时间下午 3:16 出现故障，服务受损持续了四个多小时：一次遥测系统发布压垮了其最大集群中的 Kubernetes 控制平面，进而破坏了数据平面的 DNS；DNS 缓存又在最初二十分钟掩盖了影响范围。[1]

所有依赖该 API 的聊天功能、智能体工作流和信息抽取流水线，都随之失效。重试循环撑不过四小时的故障，预案才可以。

> [!TIP]
> **先建立三层防线**  
> **熔断器**识别 LLM 特有的失败信号 → **回退链**按“其他平台的同一模型 → 不同模型 → 不使用模型”切换 → **降级模式**兜底用户体验。恢复时还要用重试预算与随机抖动控制队列释放速度，避免服务刚恢复就再次被流量压垮。

## 01 · 决策表：根据失败信号路由

下面的信号都有服务商文档依据。[2–5] 对所有错误、在所有层级都重试，只会把服务商糟糕的一小时变成你自己的事故。

| 失败信号 | 含义 | 首要处理 | 避免的做法 |
| --- | --- | --- | --- |
| 带 `retry-after` 的 429 `rate_limit_error` | 你的配额限制，并非服务商宕机 | 遵守等待时间；丢弃或排队处理超额请求 | 不要熔断或故障转移，流量尖峰会跟着你走 |
| 余额耗尽、支出上限等计费类 429 | 账户状态问题，与负载无关 | 停止继续消耗的调用路径，通知人工处理 | 不要重试，结果不会改变 |
| 500 / 502 / 503 | 临时服务端错误 | SDK 已重试两次，将最终失败计入熔断器 | 不要再套一层重试循环 |
| 529 `overloaded_error`（Anthropic） | 服务商整体容量承压 | 退避，并进入回退链的下一个目标 | 不要当成你自己的配额问题 |
| 503 “Slow Down”（OpenAI） | 流量增长过快，影响服务稳定 | 降到此前速率，保持至少 15 分钟，再逐步提升 | 不要立刻恢复原来的请求速率 |
| 超时 / 流停滞 | 最棘手的信号，原因可能很多 | 通过 context 取消，将其计入熔断器 | 不要依赖 SDK 的默认超时，尤其当它根本没有默认值时 |
| 200 之后流中途出现错误事件 | 已开始输出后发生过载或拒绝 | 丢弃不完整输出，记为失败，并在下个目标重新运行 | 不要拼接半截答案，也不要把 200 算作成功 |
| 熔断器打开 / 状态页报红 | 持续性故障 | 进入回退链，再进入降级模式 | 不要把“继续观察”当预案；先降级，再通知值班人员 |

**429 的例外：** OpenAI 折扣版 Flex 档位会用 429 表示容量不足。文档给出的处理方式，是以 `service_tier: "auto"` 重新提交；失败的 Flex 尝试不收费。[6]

## 02 · 故障记录是公开的

两家服务商都没有把故障当成假设。按原文引用的 OpenAI 状态页统计，2026 年 5 月至 8 月 API 汇总可用率为 **99.94%**，折算成每月大约 26 分钟不可用；这些时间集中出现，不会均匀分布。[7] 2024 年 12 月的事故有完整的公开复盘；2025 年 6 月的一次错误率升高事件持续约十五小时，却没有公开披露根因。[1][8] 截至 2026 年 8 月中旬，Anthropic 状态页在此前三个半星期中记录了 25 起事件，并提供机器可读的状态接口。[9]

更深层的信号藏在定价页中。Anthropic 将标准档位描述为“尽力提供可用性”；Priority Tier 的目的，是“即使在高峰期，也尽量减少服务器过载错误”，其可用性目标为 99.5%。[10] OpenAI 则通过 Scale Tier 向企业客户提供 99.9% 可用性的 SLA。[11]

高级产品把“过载时优先分配容量”作为卖点，本身就在说明：对于你很可能正在使用的普通档位，过载是正常运行中需要考虑的情况。

LLM 服务商与其他依赖的区别在于**故障相关性**。数据库故障转移可能影响某一个服务；LLM 服务商性能下降时，跨多个服务的所有 AI 功能可能同时失败，而且你无法切到自己掌控的副本。故障域覆盖的是整个能力，这必须由你的错误预算承受。

还要保持克制：2025 年 9 月，Anthropic 复盘了三个叠加的基础设施缺陷，它们导致持续数周的**回答质量下降**，而非可用性下降。最严重的一小时，16% 的 Sonnet 4 请求受到影响。[12] 这些请求全部返回了 200。

> [!IMPORTANT]
> **熔断器能观察错误和延迟，却无法判断答案是否正确。** 回答质量问题属于输出评测的职责范围，这也限定了本文这些模式能够提供的保障。

## 03 · “不可用”究竟是什么样子

### 你已经拥有的重试层

两家的官方 Go SDK 默认针对同一组错误重试两次：连接错误、408、409、429，以及大于等于 500 的状态码。它们使用指数退避，并遵守 `retry-after`。[13][14] 这带来两个结果。

**第一，熔断器看到的是重试后的失败。** 错误进入业务代码之前，SDK 已经花了几秒钟完成两次重试。这是熔断器合适的输入，但你观察到的“第一次错误”，实际上已经是“第三次尝试失败”。

**第二，简单叠加重试会让尝试次数相乘。** 如果处理器、SDK 和前置网关每层都进行三次尝试，一个用户操作就会变成 **3 × 3 × 3 = 27 次上游请求**。Google SRE 一书用 4³ = 64 的例子提醒过这种分层重试放大现象。[15]

重试只应由一层负责：让 SDK 处理传输重试，你自己的这一层负责错误分类、熔断器和回退链。退避与抖动机制见前篇《LLM API Integration Patterns》；OpenAI 自己也建议使用带随机抖动的退避。[16] 如果经常遇到 429，应增加客户端限流，而非继续加重试。

SDK 默认超时值得在事故前检查。按原文所述，`anthropic-sdk-go` 对非流式 Messages 调用设置十分钟默认超时，而 `openai-go` 完全没有默认超时：停滞连接会一直挂着，直到 context 要求停止。[14][13] 如果处理器没有设置 context 截止时间，故障不会表现为干净的错误，只会留下静静停在失效 socket 上的 goroutine。

### 那些并不代表成功的 200

有三类文档明确记录的失败，不会返回错误状态码。

**① 流式传输中途过载。** Anthropic 的流式文档说明，在高流量期间，200 响应之后仍可能收到携带 `overloaded_error` 的 SSE `error` 事件；在非流式场景中，这通常对应 HTTP 529。[5]

```text title="HTTP 200 之后仍可能到达的 SSE 错误"
event: error
data: {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}
```

**② 服务档位静默降级。** 流量提升过快时，OpenAI 可能以标准速度和标准价格处理部分 Fast 模式请求，响应中会携带 `service_tier: "default"`。[17] 原文引用的经验规则是：当每分钟输入超过一百万 token 时，每十五分钟增长不超过 50%；具体触发条件随模型和流量而变。

**③ 流式传输中途拒绝。** 在最新 Claude 模型中，安全分类器的拒绝表现为正常的 200，附带 `stop_reason: "refusal"`。拒绝可能在任何输出之前发生，也可能在已输出部分内容后发生；文档要求将部分输出视为不完整内容并丢弃。[18]

因此，检测逻辑必须读取**响应体和流事件**，不能只看状态码。用一层包装将这三类情况归入统一的错误分类，是后续所有设计的前提。

## 04 · 能理解 LLM 调用的熔断器

教科书里的三种状态仍然适用：**关闭（closed）→ 打开（open）→ 半开（half-open）**。不过，有四点需要重新考虑。

| 需要考虑的特点 | 对设计的影响 |
| --- | --- |
| 失败信号来得晚 | LLM 请求正常执行也可能耗时 10–120 秒；只数错误的熔断器，可能在故障发生几分钟后才动作。主动设置较紧的 context 截止时间，并把超时计为失败 |
| 半开探测需要花钱 | 每次探测都是付费 API 调用。可用该服务商最便宜的模型，发出 `max_tokens: 1` 的请求，以极低成本检查是否恢复 |
| 粒度应为“服务商 × 模型” | Anthropic 按模型类别限流，事故也经常只影响某个模型。全局熔断器会把单模型性能下降扩大成全站故障 [4][9] |
| 并非所有错误都代表故障 | 429 可能是你的配额，400 可能是你的程序错误。它们都不能说明服务商不可用，也不应触发熔断 |

对于 `sony/gobreaker v2`，分类工作由 `IsSuccessful` 钩子完成，其余都是配置。原文给出的配置说明为：打开保持 60 秒、连续五次失败触发熔断、半开允许一次探测。[19] 下列 `Provider`、`CompletionRequest`、`APIError` 等类型，以及 Prometheus 指标注册，来自前篇的服务商抽象层。

```go title="按错误类型判断是否计入熔断"
import (
    "context"
    "errors"

    "github.com/sony/gobreaker/v2"
)

// 判断错误是否说明服务商出现问题。
// 调用方自身的问题不应打开熔断器。
func isTripSignal(err error) bool {
    var apiErr *APIError
    if errors.As(err, &apiErr) {
        switch apiErr.StatusCode {
        case 500, 502, 503, 504, 529:
            return true
        case 429:
            // 配额、计费或 Flex 容量问题：限流、排队、告警，
            // 或切换服务档位重新提交；不作为熔断信号。
            return false
        }
        // 流读取器将中途 SSE 错误转换为
        // APIError{StatusCode: 529}，见前文错误分类。
        return false
    }
    // 超时是 LLM 调用能产生的最强故障信号之一。
    return errors.Is(err, context.DeadlineExceeded)
}

func newProviderBreaker(name string) *gobreaker.CircuitBreaker[*CompletionResponse] {
    return gobreaker.NewCircuitBreaker[*CompletionResponse](gobreaker.Settings{
        Name:        name, // 如 "anthropic/claude-sonnet"
        MaxRequests: 1,    // 半开时只允许一次付费探测
        ReadyToTrip: func(c gobreaker.Counts) bool {
            return c.ConsecutiveFailures >= 5
        },
        IsSuccessful: func(err error) bool {
            return err == nil || !isTripSignal(err)
        },
        OnStateChange: func(name string, from, to gobreaker.State) {
            // 对状态迁移发出告警：熔断器打开就是故障告警，
            // 往往早于错误率仪表盘反映问题。
            breakerState.WithLabelValues(name).Set(float64(to))
        },
    })
}
```

`OnStateChange` 并不是装饰。“熔断器 `anthropic/claude-sonnet` 已打开”才是值班人员真正想要的告警：它在做出熔断决策时触发，并明确指出影响范围。

## 05 · 回退链：先考虑行为，再考虑成本

熔断器打开之后，流量需要有地方可去。排序原则是：**优先选择对产品行为改变最小的路径。**

| 层级 | 路由 | 行为变化 | 与主路径的故障相关性 |
| --- | --- | --- | --- |
| 1 | 同一模型、同一服务商，不同容量档位 | 无 | 高：共用基础设施 |
| 2 | 同一模型、不同云平台，如 Bedrock / Vertex / Foundry | 接近于零：同一模型，加一层轻量 API 适配 | 低：控制平面和容量池不同 |
| 3 | 不同模型，可来自任一服务商 | 明显变化：提示词、格式和评测结果都会漂移 | 低 |
| 4 | 不使用模型，进入降级模式 | 用户可见，但已提前设计 | 无模型依赖 |

第一层往往不需要自己额外搭建，服务商已提供相应能力：Anthropic 的 `service_tier: "auto"` 在有优先容量时使用优先容量，否则自动回落标准档位，并在 `usage.service_tier` 中报告实际档位。[10] OpenAI 的 Flex 回退机制也采取类似思路。[6]

**第二层是团队经常没有充分利用的选项。** 同样的 Claude 模型可以通过 Claude API、Amazon Bedrock 和 Google Vertex AI 使用；它们有官方 SDK 支持，Messages API 也几乎相同。[20][21] Bedrock 还通过推理配置文件提供跨区域路由。[22] 你的提示词、输出解析器和评测基线都能保留下来，而第三层无法作出同样的承诺。

这些托管服务的底层系统确实不同，而这恰恰是价值所在：Anthropic 在 2025 年的路由缺陷，最严重时影响了官方 API 上 16% 的 Sonnet 4 请求，但 Bedrock 上的峰值仅为 0.18%。[12] 微软对 Azure OpenAI 的建议也相似：并不自动故障转移，参考架构是在具有熔断能力的网关后建立容量回退链。[23]

第三层看起来是基础设施决策，实质却是产品决策。不同模型会给出不同答案：格式会漂移、拒绝边界会移动，评测套件必须覆盖两个模型，回退才值得信任。要么有意识地采用这一层，要么不要使用。

### 回退路径一览

下面将原文的流程图整理成逐级路由表；每个目标都由独立熔断器保护。

| 顺序 | 目标 | 成功时 | 不可用时 |
| --- | --- | --- | --- |
| A | Claude API | 返回结果 | 进入 B |
| B | Bedrock 上的同一模型 | 返回结果 | 进入 C |
| C | 已验证的低成本模型 | 返回结果 | 进入 D |
| D | 缓存 / 队列 / 功能关闭 | 提供预定降级体验 | — |

回退链本身，就是遍历这些经过熔断器包装的目标。

```go title="遍历由独立熔断器保护的回退目标"
type Target struct {
    Name     string // 指标和日志标签，如 "bedrock/claude-sonnet"
    Provider Provider
    Model    string
    Breaker  *gobreaker.CircuitBreaker[*CompletionResponse]
}

type FallbackChain struct {
    targets []Target
}

func (c *FallbackChain) Complete(ctx context.Context, req *CompletionRequest) (*CompletionResponse, error) {
    var lastErr error
    for _, t := range c.targets {
        reqCopy := *req
        reqCopy.Model = t.Model
        resp, err := t.Breaker.Execute(func() (*CompletionResponse, error) {
            return t.Provider.Complete(ctx, &reqCopy)
        })
        if err == nil {
            fallbackServes.WithLabelValues(t.Name).Inc()
            return resp, nil
        }
        lastErr = err
        // 熔断器已打开时立即返回 gobreaker.ErrOpenState，
        // 无需等待超时即可推进到下一个目标。
        // 如果调用方已取消或超时，则停止，避免浪费下游容量。
        if ctx.Err() != nil {
            return nil, ctx.Err()
        }
    }
    return nil, fmt.Errorf("all fallback targets failed: %w", lastErr)
}
```

有两条纪律，能防止回退链引发新的事故。

**跨服务商保持幂等。** 在服务商 A 上超时的请求，实际上可能已经执行。如果模型调用会产生副作用，例如智能体下单、发送邮件，那么在服务商 B 上重新执行，就会重现经典的重复操作问题。让同一个幂等键贯穿所有目标，并在业务层去重，处理原则与支付重试相同。

**成本保护必须覆盖整条链。** 回退路径的每 token 价格可能更高；故障叠加激进切换，很容易让糟糕的一天变成一张五位数账单。OWASP 将这类风险归为“无界消耗”。[24] 成本熔断器必须包裹整条链，而不仅是主服务商。对话中途切换时，还会把全部历史重新发送给没有这段记忆的新服务商；原文的成本计算器展示了每轮重发的成本。

## 06 · 降级模式：没有模型响应时，产品还能交付什么

所有熔断器可能同时打开。接下来发生什么，是产品决策；唯一错误的选择，是在事故中临时决定。

SRE 一书将优雅降级定义为：减少每个请求执行的工作，例如用缓存回答，而非完成全部计算。[15] 对 LLM 功能，可以按成本从低到高建立下面的阶梯。

### ① 从缓存提供结果

重复或近似重复的问题，例如客服答复、商品问答，可以返回上一次有效回答，并明确标注来源于缓存。它用一次查询替代一次推理，是典型的降级方式。

### ② 排队并告知用户

对于摘要任务、数据补全流水线、报告生成等异步工作，可以接受任务、持久化保存，并告知用户预计何时得到结果。Outbox 模式适合承接这类可靠入队需求。

### ③ 切换到更小的模型

使用已经为该功能验证过的更小或更便宜的模型，也就是回退链的第三层。它必须事先获准用于这个场景。

### ④ 明确关闭功能

通过功能开关，配合一句直白的提示：“AI 辅助功能暂时不可用。”比起未经验证的备用模型自信地输出错误答案，用户更容易接受功能暂时缺席。

### 恢复阶段，同样需要设计

降级模式常常在恢复时悄悄失效。服务商恢复后，所有排队任务和等待中的客户端同时涌入；此时上游容量本身仍在恢复，流量增长限制又可能让快速爬升触发 429。[3]

队列释放应受**重试预算**约束：SRE 一书建议将重试控制在请求量约 10% 的水平。[25] 再通过令牌桶控制节奏，防止放大尚未完全恢复的上游压力，并加入随机抖动，避免客户端同步唤醒。[26][16]

半开探测是你的恢复检测器。服务商状态源，例如 Anthropic 的机器可读状态接口，只能作为补充，不能替代它。[9] 无论故障发生还是恢复，状态页都可能滞后于真实情况。

## 07 · 什么时候只用一家服务商才是正确选择

前面的设计都有成本。以下是值得认真考虑的反例。

- **内部工具和批处理流水线未必需要回退链。** 如果人可以等一小时，或任务可以今晚执行，一张表加一个定时任务构成的队列，就能吸收整场故障。
- **评测完整性可能比可用性更重要。** 如果输出质量受到合同或监管约束，未经评测的备用模型可能比停机风险更大。“可以暂时不可用，但绝不输出错误”是一种合理立场。
- **每增加一跳回退，就增加一个依赖。** 它有自己的鉴权、配额和失败方式，也需要自己的熔断器。Hystrix 十年前就明确了这一点：如果回退动作还要发起网络调用，它本身也必须由 command 包装。[27] 三家服务商意味着要维护三套健康的集成，评测矩阵也会扩大。
- **提示词维护工作会成倍增加。** 采用第三层，就意味着每次提示词变更都要同时在两个模型上验证，否则其中一套会悄悄失效。

**一个熔断器、一个队列和一个功能开关，即使完全不引入第二家服务商，也是一种站得住脚的生产方案。** 真正站不住脚的，是把教程中的默认假设直接上线：无限期地相信 `client.Complete()` 总会返回。

## 08 · 生产上线检查清单

- [ ] 每个“服务商 × 模型”拥有独立熔断器；5xx、529、超时和流中途错误触发熔断，你自身的配额类 429 不触发。
- [ ] 针对熔断器状态变化告警，而不仅监控错误率；打开事件就是事故通知。
- [ ] 每次调用都有 context 截止时间；按原文所述，`openai-go` 没有默认超时，遗漏截止时间可能带来 goroutine 泄漏和账单。
- [ ] 只保留一层重试，由 SDK 负责；业务层负责分类、熔断和回退链。
- [ ] 流读取器将 SSE 错误事件和拒绝，与 HTTP 失败纳入同一套错误分类。
- [ ] 回退顺序有文档、有评测；优先切换到其他平台的同一模型，第三层由产品质量负责人预先认可。
- [ ] 同一个幂等键贯穿全部目标；有副作用的调用在业务层去重。
- [ ] 成本熔断器覆盖整条回退链，而不只是主路径。
- [ ] 每个功能都有明确的降级模式：缓存、队列、小模型或关闭，并通过故障演练验证实际呈现。
- [ ] 恢复流量通过重试预算和带抖动的节奏控制释放，避免自己制造第二轮过载。

## 09 · 常见问题

### 熔断器应该被 429 限流错误触发吗？

不应该。429 通常说明你的配额已耗尽，而非服务商宕机；故障转移只会把同一波流量尖峰送往第二家服务商。应遵守 `retry-after`，丢弃或排队处理超额请求，把熔断留给 5xx、529、超时和流中途失败。

另外两类要单独处理：OpenAI 计费类 429 应停止继续消耗的调用路径并通知人工；Flex 容量类 429 则应以 `service_tier: "auto"` 重新提交。

### 为同一个模型建立多服务商回退，值得吗？

对于面向用户、与收入相关的功能，通常值得。同样的 Claude 模型可通过 Claude API、Amazon Bedrock 和 Google Vertex AI 使用，并有官方 SDK 支持。第二条路径既能保留提示词和评测，又能降低基础设施故障相关性。

对于内部或批处理任务，恢复后再消费的队列更简单，也常常足够。

### 如何在真正故障之前测试这条路径？

在服务商集成边界注入故障。用测试替身返回 529、让流在响应中途停滞，或制造超时，以此验证熔断器会打开、回退链会推进、降级界面会正确显示。

定期进行故障演练，并对熔断器状态变化告警，让第一次真实熔断能被及时观察到，而不是事后才发现。

---

## 延伸阅读与参考资料

原文还推荐以下主题，可通过[原文的 Keep Reading 与 Sources 章节](https://backendbytes.com/articles/llm-provider-outage-resilience/#sources)查看：

- **Building Resilient Distributed Systems with Go**：熔断器内部机制、舱壁隔离，以及慢依赖导致的级联故障。
- **LLM API Integration Patterns**：服务商抽象、重试、流式背压、token 预算和成本熔断器。
- **Idempotency Patterns: Building Retry-Safe Distributed Systems**：跨服务商重试为什么需要幂等键，以及队列通知背后的 Outbox 模式。

下面保留正文引用编号对应的资料名称。编号沿用原文，完整链接见[原文参考资料列表](https://backendbytes.com/articles/llm-provider-outage-resilience/#sources)。

| 编号 | 资料 |
| --- | --- |
| [1] | OpenAI Status：2024-12-11 API、ChatGPT 与 Sora 故障复盘 |
| [2] | OpenAI API：错误码指南 |
| [3] | Claude API：Errors |
| [4] | Claude API：Rate limits |
| [5] | Claude API：Streaming messages |
| [6] | OpenAI API：Flex processing |
| [7] | OpenAI Status：可用性与事件历史 |
| [8] | OpenAI Status：2025-06-10 错误率升高事件 |
| [9] | Claude Status：可用性与事件历史 |
| [10] | Claude API：Service tiers |
| [11] | OpenAI：Scale Tier for API Customers |
| [12] | Anthropic Engineering：A postmortem of three recent issues |
| [13] | GitHub：openai-go 官方 SDK |
| [14] | Anthropic Go SDK 文档 |
| [15] | Google SRE：Addressing Cascading Failures |
| [16] | OpenAI API：Rate limits guide |
| [17] | OpenAI API：Fast mode，原 Priority processing |
| [18] | Claude API：Refusals and fallback |
| [19] | GitHub：sony/gobreaker |
| [20] | Claude in Amazon Bedrock |
| [21] | Claude on Google Cloud（Vertex AI） |
| [22] | Amazon Bedrock：跨区域推理 |
| [23] | Microsoft Learn：High availability and resiliency for Microsoft Foundry |
| [24] | OWASP Top 10 for LLM Applications 2025 |
| [25] | Google SRE：Handling Overload |
| [26] | AWS Builders’ Library：Timeouts, retries, and backoff with jitter |
| [27] | Netflix Hystrix：How it Works |
