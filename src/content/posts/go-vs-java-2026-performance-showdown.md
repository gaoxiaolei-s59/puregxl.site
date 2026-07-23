---
title: Go vs Java：2026 年后端服务性能的诚实对比
published: 2026-07-10
description: "从真实 API 负载出发，对比 Go 与现代 Java 在吞吐量、内存、冷启动、GC 尾延迟、容器密度和生态成熟度上的差异，并给出可复现的测试方法。"
image: ""
tags: [Go, Java, 性能, 后端开发]

draft: false
lang: "zh-CN"
---



> “我们要不要用 Go 重写？”

某个支付类服务在 JVM 垃圾回收期间，p99 延迟从约 40 ms 飙升到约 400 ms。后端团队因此分成两派：一派希望换成 Go，获得更稳定的延迟下限；另一派则主张使用 Java 21 与 [ZGC](https://wiki.openjdk.org/spaces/zgc/overview)，在不重写服务的前提下解决停顿问题。

本文试图诚实地终结这场争论：依据各运行时真正公开的技术说明，给出决策框架，并提供一套可以直接放进代码仓库的基准测试工具。最终做决定的应该是你自己的测量数据，而不是某篇博客给出的数字。

## 核心结论

- 真实 API 负载下，并不存在微基准测试暗示的 10 倍差距。公开的多框架测试显示，经过调优的 Go 与现代 Java 服务处于同一吞吐量级；真正不同的是内存、启动速度与 GC 尾延迟。
- Java 的 ZGC 被设计为把 GC 停顿控制在 1 ms 以内，足以消除许多推动团队重写 Go 的 p99 延迟尖峰，但需要付出一定吞吐量代价，必须在你的负载上测量。
- 内存差距来自结构，而非魔法：使用 `-Xms/-Xmx` 固定堆的 JVM 会在第一次请求到来前提交整块堆；Go 的 RSS 则随“存活堆 × `GOGC`”浮动。估算成本前，应在稳定负载下测量两者。
- GraalVM Native Image 缩小了 Java 与 Go 的冷启动差距，却放弃了 JIT 的峰值吞吐优势。选择应由流量形态决定，并用本文的冷启动工具验证。

简而言之：

- **Go 胜在：**更低的内存基线、近乎即时的启动、更简单的并发模型和更高的容器密度。
- **Java 胜在：**成熟的 ORM 与企业生态、预热后的 JIT 峰值吞吐。
- **成本取决于密度：**请用自己的 RSS 与 RPS 套用本文公式，而不是照搬别人的表格。

## 真正的差异，以及每项说法的依据

本文采用商品目录 API 作为参考负载：缓存 → 数据库 → 外部定价服务。这是一种混合 I/O 的请求—响应模型，也最接近多数后端服务。

默认技术栈为 Go 1.24（Gin），以及 Java 21（Spring Boot 3.4、[虚拟线程](https://openjdk.org/jeps/444)，必要时启用 ZGC）。Java 以 `-Xmx512m` 为基线，Go 以 `GOGC=100` 为基线。下表中的每一项要么是运行时文档明确说明的行为，要么可以由文末工具在你的机器上测量。

| 指标 | Go（Gin） | Java VT（JVM） | Java Native Image | 验证方式 |
| --- | --- | --- | --- | --- |
| 吞吐量 | 混合 I/O API 上与现代 Java 同量级 | 虚拟线程弥合了并发差距 | 设计上低于 JIT 峰值 | 下文 k6 脚本 |
| GC 停顿上限 | 并发 GC 的 STW 阶段以亚毫秒为目标 | G1 默认目标 200 ms；ZGC 目标低于 1 ms | 使用相同收集器，但堆更小 | JFR / pprof |
| 内存模型 | RSS 随存活堆与 `GOGC` 浮动 | 堆、元空间和代码缓存形成更高基线 | GraalVM 称最多比 JVM 低 5 倍 | 稳态 RSS |
| 冷启动 | 毫秒级，无虚拟机预热 | Spring 上下文构建与 JIT 预热通常为秒级 | 数十毫秒 | 下文冷启动工具 |
| 容器密度 | 跟随较低 RSS 基线 | 跟随已提交堆大小 | 介于两者之间 | 下文密度公式 |

相关依据包括 [TechEmpower Framework Benchmarks](https://www.techempower.com/benchmarks/)、[JEP 444](https://openjdk.org/jeps/444)、[Go GC 指南](https://go.dev/doc/gc-guide)、[GraalVM Native Image 文档](https://www.graalvm.org/latest/reference-manual/native-image/)、[Oracle G1 调优指南](https://docs.oracle.com/en/java/javase/21/gctuning/garbage-first-g1-garbage-collector1.html)以及 [Spring Boot CDS / AOT 说明](https://spring.io/blog/2024/08/29/spring-boot-cds-support-and-project-leyden-anticipation/)。

## 内存与启动

内存是两种运行时之间最稳定、最容易观察到的差异，而且它来自结构。

如果 JVM 以 `-Xms512m -Xmx512m -XX:+AlwaysPreTouch` 启动，它会在处理第一条请求前把整块堆提交到物理内存。`AlwaysPreTouch` 的目的正是提前完成这件事，避免之后承受缺页延迟。再加上元空间、线程栈、JIT 代码缓存和 GC 元数据，一个 Spring 服务即便只保存很少的数据，常驻内存也可能达到数百 MB。

Go 没有同样的固定基线。它的 RSS 大致跟随存活堆乘以 `GOGC` 所允许的增长比例。默认 `GOGC=100`，意味着堆可在下一轮回收前增长到约两倍存活集，因此工作集较小的 API 往往只占几十 MB。

这个差距无需刻意构造的测试也能看到，但倍数完全取决于堆配置与工作集。定价前必须测量自己的稳定态 RSS。

启动方面，Go 二进制没有虚拟机需要预热，通常在毫秒级开始服务。Spring Boot 需要构建应用上下文，包括组件扫描、Bean 装配和连接池，之后 JIT 还要把热点路径编译到峰值状态。Spring 团队正是为了缩短这段秒级过程，持续建设 CDS 与 AOT 支持。

[Native Image](https://www.graalvm.org/latest/reference-manual/native-image/) 改变了权衡：启动可降到数十毫秒，但不再拥有 JIT 的峰值投机优化。对于缩容到零和激进自动扩缩，Go 的即时就绪很重要；对长时间运行的进程，JIT 优势会在数小时中持续累积。

### GC 停顿的现实

生产环境的延迟差异最容易在这里显现。

JVM 默认的 G1 以 200 ms 为默认停顿目标，调优后常见停顿可降至数十毫秒，但这些 STW 尖峰仍会出现在 p99.9，并经常触发“重写成 Go”的讨论。

Java 21+ 的 ZGC 几乎把所有工作并发执行，目标是把停顿控制在 1 ms 内，代价是损失部分吞吐量。Go 的并发三色标记收集器同样以亚毫秒 STW 阶段为设计目标。

诚实的总结是：**Go 与 ZGC 都能给出亚毫秒级的停顿上限，默认 G1 不能。** 原文图中的数字只是设计目标的示意值，必须用后文的 JFR 和 pprof 命令确认自己的结果。

## GC 调优：选择你愿意承担的代价

**Go：**主要旋钮只有两个。`GOGC=100` 表示堆翻倍时触发回收；`GOMEMLIMIT=256MiB` 设置软内存上限。配置面很小。

**Java G1GC：**可使用 `-XX:MaxGCPauseMillis=50` 指定停顿目标，但它只是尽力而为，不是保证。多数服务可以使用 G1；如果数十毫秒停顿不可接受，就切换到 ZGC。

**Java ZGC：**使用 `-XX:+UseZGC` 获得亚毫秒级停顿。并发回收会消耗原本可用于业务逻辑的 CPU 周期，因此通常以部分峰值吞吐换取平坦的尾延迟。当 p99.9 是明确 SLO 时才值得使用。

分代 ZGC 在 JDK 21–22 需要 `-XX:+ZGenerational` 显式启用，JDK 23 成为默认模式，JDK 24 起成为唯一模式，旧参数也随之废弃。因此在新版本中仅使用 `-XX:+UseZGC` 即可。分代模式会缩小短命对象密集负载下的吞吐差距，不应继续套用旧的非分代 ZGC 数据。

Go 无需太多调优就能保持一致延迟；Java 则要求你明确选择吞吐量还是尾延迟。

## 代码示例：两种技术栈都只需约 30 行

### Go（Gin）

```go
func (h *ProductHandler) Get(c *gin.Context) {
    id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
    ctx := c.Request.Context()

    // 缓存 → 数据库 → 定价 API
    cached, _ := h.redis.Get(ctx, fmt.Sprintf("p:%d", id)).Bytes()
    if len(cached) > 0 {
        c.Data(http.StatusOK, "application/json", cached)
        return
    }
    product, _ := h.repo.GetByID(ctx, id)
    price, _ := h.pricing.Get(ctx, product.SKU)
    product.Price = price

    data, _ := json.Marshal(product)
    h.redis.Set(ctx, fmt.Sprintf("p:%d", id), data, 5*time.Minute)
    c.JSON(http.StatusOK, product)
}
```

### Java（Spring Boot 3.4）

```java
@RestController
@RequestMapping("/products")
public class ProductController {
    @GetMapping("/{id}")
    public ResponseEntity<ProductDto> get(@PathVariable Long id) {
        Cache cache = cacheManager.getCache("products");
        ProductDto dto = cache.get(id, ProductDto.class);
        if (dto != null) return ResponseEntity.ok(dto);
        Product p = repo.findById(id).orElseThrow();
        BigDecimal price = pricing.get(p.getSku());
        dto = ProductDto.from(p, price);
        cache.put(id, dto);
        return ResponseEntity.ok(dto);
    }
}
```

两者完成同一件事。Go 的 API 表面更直接，Java 依赖注解驱动的依赖注入；认知负担并没有数量级差异。

## Java（Spring Boot）与 Go（Gin）的框架对比

1. **框架重量：**Spring Boot 是完整的企业级框架，内置依赖注入、ORM、安全和事务管理，也会带来类加载与已提交堆的额外开销。Gin 是专注路由与中间件的轻量 HTTP 框架，内存占用更接近 Go 的低基线。
2. **执行模型：**Spring Boot 使用注解和反射构造应用上下文，这也是多秒冷启动的主要组成部分。Gin 直接执行编译后的 Go 代码，热点路径没有同样的反射和预热阶段。
3. **吞吐量与简单性：**在真实混合 I/O API 中，两者处在同一吞吐量级。虚拟线程消除了 Java 过去在阻塞 I/O 并发模型上的劣势；剩余差异主要是框架复杂度、内存和启动特征，而不是每秒请求数。

## 成本与容器密度

对内存受限的服务，成本可以归结为一个公式：

```text
instances_per_host = floor(host_usable_memory / per_instance_RSS)
monthly_cost       = ceil(peak_concurrent_instances / instances_per_host)
                     × host_monthly_price
```

关键变量是 `per_instance_RSS`，两种运行时恰恰在这里分化。假设一台主机有约 7 GB 可用内存：一个 RSS 约 70 MB 的 Go 服务可放约 100 个实例；一个使用 `-Xmx512m` 与 `AlwaysPreTouch` 的 JVM 服务，加上元空间与代码缓存后约占 600 MB，同一主机只能放约 11 个。

这个 8～9 倍的密度差并非实测基准，而是已提交堆模型进行装箱计算后的结果。它是否真的转化为成本，取决于三点：

- 只有内存是瓶颈时才重要。若服务受 CPU 限制，或者为了可用性而固定少量副本，单实例 RSS 并不决定资源上限，成本差异会缩小。
- JVM 堆必须合理配置。若 Spring 服务确实需要 512 MB 存活堆，它当然无法缩小；但很多服务只是过度配置。得出“Go 更便宜”前，先测量负载下的存活堆并调整 `-Xmx`。
- Native Image 会改变输入数据。较低内存占用可以把 Java 的密度推向 Go，同时牺牲 JIT 峰值吞吐。

| 决策驱动因素 | 建议方案 | 核心权衡 |
| --- | --- | --- |
| 内存密度、即时启动 | Go | 低 RSS、毫秒级启动、亚毫秒 GC 停顿 |
| 缩容到零、冷启动 SLO | Java Native Image | 极快启动、低于 JIT 峰值吞吐 |
| 长期运行、尾延迟 SLO | JVM + ZGC | 亚毫秒停顿、消耗部分吞吐 |
| 长期运行、吞吐优先 | JVM + G1 | JIT 峰值更高、承受数十毫秒尾部停顿 |

所以，“哪个更快”在确定 SLO 前没有答案。请运行文末工具，在自己的负载上为每个选项填入真实数字。

## 生态深度

**Java 的优势：**Hibernate / Spring Data 适合拥有大量实体类型和复杂关联的领域模型；Spring AI 适合 LLM / RAG；Spring Kafka / Camel 适合事件流；SOAP、EDI 和大型机等遗留集成也更加成熟。

**Go 的优势：**单一 `go` 工具链即可完成构建、测试、格式化和静态检查，配置面较小。Goroutine 对多数并发场景更简单，单个静态二进制也很适合 CLI、边车或代理。

**基本相当：**HTTP 框架（Gin 与 Spring MVC）、gRPC、数据库访问（pgx 与 JDBC）、测试（testify 与 JUnit）。

## 生产选型清单

- 如果服务以大规模请求—响应为主，多数需求是 HTTP + 数据库 + 缓存，内存密度是实际成本，而且团队具备 Go 经验，选择 Go。
- 如果业务拥有复杂领域模型，计划集成 LLM / 向量数据库，或者团队长期以 Java 为主，选择 Java。团队交付速度远比同量级吞吐差异重要。
- 如果自动扩缩比峰值吞吐更重要，尤其是无服务器或缩容到零场景，选择 Java Native Image。
- 如果 p99.9 是 SLO，而且 CPU 有余量承担吞吐损失，选择 Java ZGC。
- 不要只根据同量级的吞吐差异做决定。真正应决定语言切换的，是内存基线、GC 尾延迟、冷启动等结构性原因。资深团队更换语言往往会付出数月生产力成本。

### 一次偏离重点的 Go 重写

原作者曾见过一个团队，因为某个纯 JSON 序列化微基准显示“吞吐高 3 倍”，便把 Spring 服务重写成 Go。Go 版本确实构建更快、启动更快、占用更少内存，但实际服务的 CPU 瓶颈是 PDF 渲染：Java 有成熟、高度优化的库，Go 对应库却维护不足。

结果 Go 版本在热点路径上的 p99 反而上升 40%。团队又花两个月编写 CGo 封装，最后放弃并回滚。教训是：只有真实热点路径的吞吐差异才重要，框架级微基准没有决定意义。

## 基准测试方法：让你自己测量的工具

不要盲信无法复现的硬件数字。下面提供负载驱动器、受控环境、剖析命令与冷启动工具。

### k6 负载脚本

脚本在 60 秒内把并发用户从 0 提升到 500，保持 8 分钟，再用 1 分钟降到 0。只报告中间 8 分钟的稳定窗口。

```javascript
import http from "k6/http";
import { check } from "k6";

export const options = {
  scenarios: {
    catalog_read: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "60s", target: 500 },
        { duration: "8m", target: 500 },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    http_req_duration: ["p(99)<500"],
    http_req_failed: ["rate<0.005"],
  },
};

const BASE = __ENV.TARGET || "http://api:8080";

export default function () {
  const id = 1 + (__ITER % 10000);
  const res = http.get(`${BASE}/products/${id}`);
  check(res, { "status is 200": (r) => r.status === 200 });
}
```

### 受控环境

- **服务：**商品目录 REST API。`GET /products/{id}` 先读 Redis，未命中则读 PostgreSQL，再调用模拟定价服务。两端使用相同 schema 和种子数据。
- **硬件：**使用同一种主机规格，例如 2 vCPU / 4 GB，并给 Go 和 Java 相同任务预算。单可用区可减少跨区抖动。
- **依赖服务：**共享并预热 PostgreSQL 与 Redis。冷缓存会让先测试的技术栈吃亏。
- **驱动方式：**从另一台主机运行 k6，舍弃预热和降载阶段，只报告 8 分钟稳定窗口。
- **JVM 参数：**基线为 `-Xms512m -Xmx512m -XX:+UseG1GC -XX:MaxGCPauseMillis=50 -XX:+AlwaysPreTouch`；ZGC 版本改用 `-XX:+UseZGC`。虚拟线程通过 `spring.threads.virtual.enabled=true` 开启。
- **Go 参数：**`GOGC=100`、`GOMEMLIMIT=512MiB`，使用默认调度器。在平台能正确暴露 CPU 限制时，不设置 `GOMAXPROCS`。
- **不适用范围：**重 CPU 循环、4 GB 以上大堆、重反射、批处理与流处理管线。这里仅针对微服务请求—响应负载。
- **统计要求：**至少运行 5 次，报告中位数与波动范围；排除 Spot 中断、嘈杂邻居等环境故障。单次运行只是轶事，不是测量。

### 两种技术栈的剖析命令

```bash
# Java：负载下采集 30 秒 JFR
jcmd <pid> JFR.start name=loadtest duration=30s filename=loadtest.jfr settings=profile
jmc loadtest.jfr

# Java：分配剖析
java -XX:StartFlightRecording=duration=30s,filename=alloc.jfr,settings=profile \
     -XX:+UnlockExperimentalVMOptions \
     -jar app.jar

# Go：CPU、堆与 goroutine
go tool pprof -http=:8081 http://localhost:6060/debug/pprof/profile?seconds=30
go tool pprof -http=:8082 http://localhost:6060/debug/pprof/heap
curl http://localhost:6060/debug/pprof/goroutine?debug=2 > goroutines.txt
```

两端都能生成 CPU 与内存分配火焰图，并能以很低开销运行在生产环境。

## 可以直接放进仓库的测试工具

### Docker Compose

以下配置让两种服务共享 PostgreSQL、Redis 与相同 CPU 预算：

```yaml
version: "3.9"
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: bench
      POSTGRES_DB: catalog
    volumes:
      - ./seed.sql:/docker-entrypoint-initdb.d/seed.sql:ro
    deploy:
      resources:
        limits: { cpus: "2.0", memory: 1G }
  redis:
    image: redis:7-alpine
    command: ["redis-server", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]
    deploy:
      resources:
        limits: { cpus: "0.5", memory: 320M }
  catalog-go:
    image: ghcr.io/example/catalog-go:1.24
    environment:
      DB_DSN: "postgres://postgres:bench@postgres:5432/catalog?sslmode=disable"
      REDIS_ADDR: "redis:6379"
      GOGC: "100"
      GOMEMLIMIT: "512MiB"
    ports: ["8080:8080"]
    depends_on: [postgres, redis]
    deploy:
      resources:
        limits: { cpus: "2.0", memory: 512M }
  catalog-java:
    image: ghcr.io/example/catalog-spring:21
    environment:
      JDK_JAVA_OPTIONS: >-
        -Xms512m -Xmx512m -XX:+UseZGC
        -XX:+AlwaysPreTouch -XX:+UseStringDeduplication
      SPRING_THREADS_VIRTUAL_ENABLED: "true"
      SPRING_DATASOURCE_URL: "jdbc:postgresql://postgres:5432/catalog"
      SPRING_REDIS_HOST: "redis"
    ports: ["8081:8080"]
    depends_on: [postgres, redis]
    deploy:
      resources:
        limits: { cpus: "2.0", memory: 768M }
```

CPU、内存和依赖服务形态必须受控。随意提高 Java 容器内存上限，会改变 ZGC 行为并让对比偏向 Java。

### Vegeta 开环压测

固定速率的开环负载非常关键。闭环工具会等待前一个请求结束，慢响应会减少后续请求，从而低估尾延迟，掩盖 GC 停顿。

```bash
#!/usr/bin/env bash
set -euo pipefail
NAME="${1:?stack name (go|java)}"
PORT="${2:?port}"
OUT="results/${NAME}-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "${OUT}"

echo "GET http://localhost:${PORT}/products/$((RANDOM % 10000 + 1))" \
  | vegeta attack -duration=60s -rate=200 > /dev/null

jq -nc --argjson n 10000 \
  '[range(1; $n)] | map({method:"GET", url:"http://localhost:'"${PORT}"'/products/\(.)"})' \
  | vegeta attack -targets=- -rate=2500 -duration=8m -workers=200 \
  | tee "${OUT}/raw.bin" \
  | vegeta report -type=hist -buckets='[0,5ms,10ms,25ms,50ms,100ms,250ms,500ms]' \
  | tee "${OUT}/histogram.txt"

vegeta report -type=json < "${OUT}/raw.bin" > "${OUT}/summary.json"
echo "Wrote ${OUT}/{raw.bin,histogram.txt,summary.json}"
```

### 把成本指标放进 Prometheus

成本/RPS 应存在服务使用的监控系统中，而不是下一次部署就会过期的表格。下面的记录规则根据容器 CPU 使用量与每 vCPU 小时单价，计算每百万请求成本：

```yaml
groups:
  - name: cost_per_rps
    interval: 30s
    rules:
      - record: service:cpu_seconds:rate5m
        expr: sum by (service, runtime) (
                rate(container_cpu_usage_seconds_total{container!="POD",service!=""}[5m])
              )
      - record: service:requests:rate5m
        expr: sum by (service, runtime) (
                rate(http_requests_total{status!~"5.."}[5m])
              )
      - record: service:fargate_usd_per_vcpu_second
        expr: vector(0.04048 / 3600)
      - record: service:cost_per_million_requests
        expr: (service:cpu_seconds:rate5m * service:fargate_usd_per_vcpu_second * 1e6)
              / clamp_min(service:requests:rate5m, 1)
      - alert: RuntimeCostRegression
        expr: (service:cost_per_million_requests
                / on(service) group_left()
                avg_over_time(service:cost_per_million_requests[7d])) > 1.25
        for: 30m
        labels: { severity: warning }
        annotations:
          summary: "{{ $labels.service }} cost-per-Mreq is 25% above its 7-day baseline"
          description: "Likely causes: GC tuning regression, heap leak, or a hot path
                        that allocates per request. Check the JFR/pprof flame graph."
```

`RuntimeCostRegression` 能发现周报容易错过的回归：Spring Boot 升级改变默认 GC、新接口每次请求都分配字节数组，或者 Go 版本改变了 `GOGC` 行为。每百万请求成本也是财务最容易理解的单一指标。

### 冷启动基准

`wrk` 与 Vegeta 假设服务已经启动，无法测冷启动。下面的 JMH 风格工具会在每次迭代中启动全新 JVM，并持续探测真实健康端点：

```java
@BenchmarkMode(Mode.SingleShotTime)
@OutputTimeUnit(TimeUnit.MILLISECONDS)
@Fork(value = 25, jvmArgs = {"-Xms512m", "-Xmx512m", "-XX:+UseZGC"})
@Warmup(iterations = 0)
@Measurement(iterations = 1)
@State(Scope.Benchmark)
public class ColdStartBench {
    @Benchmark
    public void timeToFirstSuccessfulRequest(Blackhole bh) throws Exception {
        long start = System.nanoTime();
        Process p = new ProcessBuilder(
                "java", "-Xms512m", "-Xmx512m",
                "-XX:+UseZGC",
                "-jar", "build/libs/catalog-spring.jar")
            .redirectErrorStream(true)
            .start();
        try (HttpClient client = HttpClient.newHttpClient()) {
            HttpRequest probe = HttpRequest.newBuilder(
                    URI.create("http://localhost:8080/health"))
                .timeout(Duration.ofMillis(200))
                .build();
            while (true) {
                try {
                    if (client.send(probe, BodyHandlers.discarding()).statusCode() == 200) break;
                } catch (Exception ignore) { /* 尚未就绪 */ }
                Thread.sleep(25);
            }
            long elapsedMs = (System.nanoTime() - start) / 1_000_000;
            bh.consume(elapsedMs);
        } finally {
            p.destroy();
            p.waitFor(5, TimeUnit.SECONDS);
        }
    }
}
```

常见测试会漏掉两个细节：

1. JVM 日志出现 “Started Application” 并不等于第一次返回 HTTP 200。连接池预热可能让两者相差数百毫秒，所以必须探测真正的 `/health`。
2. 25 次 fork 比 3 次更能暴露长尾；冷文件系统缓存可能给某一次运行增加一秒以上。

应同时报告中位数和 p95。如果自动扩缩器的就绪超时接近 p95，导致 502 突发的是这条长尾，而不是中位数。

## 常见问题

### 2026 年 Go 比 Java 快吗？

取决于负载。Go 冷启动更快、内存开销更低，适合 CLI、无服务器以及高并发 I/O。带 JIT 的 Java 在长期运行、计算密集型负载中可以追平甚至超过 Go；Project Loom 虚拟线程又进一步降低了并发开销。

### 微服务应该选择 Go 还是 Java？

如果服务轻量、高并发，而且快速启动、小镜像与低内存很重要，例如边缘服务和 API 网关，选择 Go。如果服务包含复杂业务逻辑，成熟的 Spring、Hibernate 与测试生态能显著提高开发和维护效率，选择 Java。


