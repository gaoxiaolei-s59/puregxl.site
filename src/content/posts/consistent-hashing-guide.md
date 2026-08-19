---
title: 一致性哈希：支撑可扩展分布式系统的核心算法
published: 2026-08-17
description: "从 hash % N 的扩容灾难讲起，系统理解哈希环、虚拟节点、有限负载一致性哈希、Jump Hash 与生产环境调优，并附 Go、Java 实现。"
image: ""
tags: [一致性哈希, 分布式系统, 系统设计, Go, Java, 缓存]
category: 转载
draft: false
lang: "zh-CN"
---

> [!NOTE]
> **本文为经许可发布的中文翻译，版权归原作者所有。**
> 原文《[Consistent Hashing: The Algorithm Behind Every Scalable Distributed System](https://backendbytes.com/articles/consistent-hashing-guide/)》由 **BackendBytes Engineering Team** 撰写，最初发布于 2026 年 3 月 6 日，更新于 2026 年 8 月 14 日。中文由 XiaoLei 翻译整理；如中英文表述存在差异，请以原文为准。

> 在一个拥有 12 台服务器的缓存集群里增加 1 个节点，可能会瞬间让 92% 的缓存失效。
>
> 假设一个 12 节点的 Redis 缓存层使用 `hash(key) % N` 选择服务器。当 N 从 12 变成 13 时，这个公式会把 92% 的键重新分配到其他节点。每一次重新分配都会造成一次缓存未命中，而数据库恰好会在你试图扩容时承受完整的缓存穿透洪峰。真正的解决办法是一致性哈希，而不是“更快地增加容量”。

这是一个**哈希问题**，不是容量问题。原来的算法假设 N 固定不变；一旦增加或移除服务器，这个假设在数学上便不再成立。Karger 等人于 1997 年发表的一致性哈希算法，正是为了解决这个问题。

> [!NOTE]
> **核心结论**
>
> 一致性哈希把键和服务器都映射到同一个哈希环上，位置范围为 0 到 2<sup>32</sup>−1。增加或移除服务器时，只需重新映射 K/(N+1) 个键——这是 Karger 等人在 1997 年证明的理论最小值；而取模哈希需要重新映射约 N/(N+1) 的键。生产系统通常还会为每个物理节点设置多个虚拟节点，以保证负载均匀。
>
> - 增加或移除一台服务器时，只重新映射约 1/(N+1) 的键：12 节点集群约为 7%～8%，而 `hash % N` 约为 92%。
> - 虚拟节点能显著降低负载方差；方差大致会随虚拟节点数量的平方根缩小。
> - Cassandra（4.0 起默认 16 个虚拟节点，旧版安装通常为 256 个）、Akamai CDN 和 Memcached 集群都使用了这一思路。Kafka 使用的是取模哈希，即 `murmur2(key) % partitions`，并非一致性哈希。

## 什么时候该用一致性哈希

| 使用场景 | 一致性哈希 | 取模哈希 | 最高随机权重哈希 | 说明 |
| --- | :---: | :---: | :---: | --- |
| 频繁增加或移除节点 | ✓ | ✗ | ✓ | 一致性哈希是标准方案；最高随机权重哈希适合小集群（少于 20 个节点） |
| 大型集群（100+ 节点） | ✓ | ✗ | △ | 一致性哈希查询为 O(log N)；最高随机权重哈希每个键需要 O(N)，规模大时成本较高 |
| 集群规模固定 | △ | ✓ | ✗ | 拓扑稳定时，`hash % N` 足够简单有效 |
| 需要天然负载均衡 | ✗ | ✗ | ✓ | 最高随机权重哈希无需虚拟节点也能均匀分布 |
| 尽量少维护状态 | ✓ | ✓ | ✗ | 一致性哈希需要维护有序数组；最高随机权重哈希需要知道全部节点位置 |

**决策规则：** 如果集群成员会变化且节点数在 10 个以上，使用一致性哈希。对于规模固定的小集群，`hash % N` 已经足够；对于节点数少于 20、但需要频繁扩缩容的微型集群，最高随机权重哈希可能更简单。

## 问题根源：为什么 `hash % N` 无法平滑扩容

最简单的数据分配方式是：

```text
server = hash(key) % N
```

N 固定时，键可以均匀分布，查询复杂度也是 O(1)。但 N 一旦变化，几乎所有键都会被重新映射：

```text
增加一台服务器（12 → 13）：12/13 = 92% 的键需要重新映射
增加一台服务器（100 → 101）：100/101 = 99% 的键需要重新映射
```

这种大规模重映射会触发级联故障：每个被重新映射的键都会变成缓存未命中，后端存储被瞬间压垮，最终造成超时和用户可见的错误。

## 一致性哈希如何工作

服务器和键都会被哈希到一个固定大小的环上，位置范围为 0 到 2<sup>32</sup>−1。Amazon 的 Dynamo 论文将这种结构描述为高可用键值存储的经典分区机制。

查找某个键所属的服务器只需三步：

1. 对键做哈希，将它映射到环上的一个位置。
2. 从该位置开始沿顺时针方向行走。
3. 遇到的第一台服务器就是这个键的所有者。

当一台服务器加入环上的 P 点时，只有原本属于顺时针方向下一台服务器的部分键需要迁移到 P；其他键仍留在原服务器上。假设共有 K 个键、N 台服务器，增加一台服务器时大约只会重映射 **K/(N+1)** 个键——这已经是理论上的最小值。相比之下，`hash % N` 会重映射全部键中的 N/(N+1)。

```text
哈希环顺序：Server A (0x1A3F) → Server B (0x5E02) → Server C (0x9B7D) → Server A

user:42    (0x3C11) ──顺时针──> Server B
session:99 (0x7F20) ──顺时针──> Server C
cart:17    (0x0E55) ──顺时针──> Server A（越过环尾后回绕）
```

下面是一个朴素的 Go 实现：

```go
package chash

import (
	"hash/crc32"
	"sort"
	"sync"
)

type Ring struct {
	mu     sync.RWMutex
	nodes  map[uint32]string // 哈希位置 → 节点 ID
	sorted []uint32          // 用于二分查找的有序位置
}

func New() *Ring {
	return &Ring{nodes: make(map[uint32]string)}
}

func (r *Ring) GetNode(key string) string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if len(r.sorted) == 0 {
		return ""
	}

	h := crc32.ChecksumIEEE([]byte(key))

	// 二分查找：找到第一个大于等于 h 的节点位置
	idx := sort.Search(len(r.sorted), func(i int) bool {
		return r.sorted[i] >= h
	})

	// 超过环尾时回绕到环首
	if idx == len(r.sorted) {
		idx = 0
	}

	return r.nodes[r.sorted[idx]]
}

func (r *Ring) AddNode(nodeID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	h := crc32.ChecksumIEEE([]byte(nodeID))
	r.nodes[h] = nodeID
	r.sorted = append(r.sorted, h)
	sort.Slice(r.sorted, func(i, j int) bool { return r.sorted[i] < r.sorted[j] })
}
```

这个实现的问题在于：只有 3 个物理节点时，环上也只有 3 段。哈希函数几乎不可能让节点等距分布，因此负载会很不均匀，例如一台节点处理 60%，另一台却只处理 10%。

## 虚拟节点：让负载均匀分布

生产系统会把每台物理服务器映射到环上的多个位置，通常每台设置 150～300 个虚拟节点。Dynamo 为了同样的目的引入了这种“每台物理节点持有多个 token”的设计。它能抚平分布差异，避免朴素实现中单一位置造成的负载倾斜。

没有虚拟节点时，3 台物理服务器只会产生 3 个环上位置。哈希函数很难把它们均匀分布在 40 多亿个位置上，于是负载方差可能非常大：一台处理 60%，另一台只有 10%。加入虚拟节点后，每台物理服务器都会在环上拥有许多副本。

```text
朴素哈希环：3 个物理节点，3 个位置
A（约 60%） → B（约 30%） → C（约 10%） → A

虚拟节点哈希环：3 个物理节点 × 每台 150 个虚拟节点
A1…A150、B1…B150、C1…C150 均匀散布在整个环上
```

对于一个拥有 10 台物理节点、每台 150 个虚拟节点的集群：

- 环上共有 1,500 个位置。
- 每台物理节点占据约 150 个位置。
- 键会均匀分布到全部 150 个位置上。
- 每个位置大约处理 0.1% 的键。
- 标准差约为 4%，属于较好水平；目标通常是 ±4%～5%。

下面是带虚拟节点的 Java 实现：

```java
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.zip.CRC32;

public class ConsistentHashRing {
    private final SortedMap<Long, String> ring = new TreeMap<>();
    private final int vnodes;

    public ConsistentHashRing(int vnodeCount) {
        this.vnodes = vnodeCount;
    }

    private long hash(String key) {
        CRC32 crc = new CRC32();
        crc.update(key.getBytes(StandardCharsets.UTF_8));
        return crc.getValue();
    }

    public void addNode(String nodeId) {
        for (int i = 0; i < vnodes; i++) {
            String vnode = nodeId + ":" + i;
            ring.put(hash(vnode), nodeId);
        }
    }

    public void removeNode(String nodeId) {
        for (int i = 0; i < vnodes; i++) {
            ring.remove(hash(nodeId + ":" + i));
        }
    }

    public String getNode(String key) {
        if (ring.isEmpty()) return null;

        long h = hash(key);
        SortedMap<Long, String> tail = ring.tailMap(h);
        long nodeHash = tail.isEmpty() ? ring.firstKey() : tail.firstKey();
        return ring.get(nodeHash);
    }
}
```

每台物理节点会向环中加入 `vnodes` 个条目；移除物理节点时，也会一次性移除它的全部虚拟副本。

## 有限负载一致性哈希

Google 在 2016 年提出了一项改进：把每个节点能够承载的键数限制在 `K/N × (1 + epsilon)`。如果一个键被哈希到已经过载的节点，就继续尝试顺时针方向的下一台节点，从而避免任何单个节点成为热点。

实践中可以取 `epsilon = 0.25`，即每台节点最多容纳理论平均值的 125%。对于一个拥有 100 台节点、1,000 万个键的集群，平均每台节点持有 10 万个键；过载节点最多可以容纳 12.5 万个键，超过后便将键交给顺时针方向的下一台节点。

## 生产环境检查清单

- 使用 MurmurHash3、xxHash 或 FNV-1a，而不是 CRC32 或密码学哈希。CRC32 会让连续输入产生聚集，密码学哈希则没有必要。
- 缓存环可以为每台物理节点设置 150～256 个虚拟节点，150 是安全的基线。Cassandra 4.0 起默认使用 16 个，旧版为 256 个；超过 256 后收益会逐渐减小。
- 使用读写锁保护所有哈希环操作。写操作（增加、移除节点）需要阻塞读操作（查找节点）。
- 测试负载分布：采样环上位置并计算标准差，目标为 ±4%～5%。
- 规划重平衡窗口。增加节点会触发约 K/(N+1) 个键迁移，批量扩容应安排在非高峰期。
- 监控单节点热键。一致性哈希分散的是键，而不是访问负载；某个每秒被访问 1,000 次的键仍然只会命中一台节点。
- 优雅处理节点故障：故障节点的键应迁移到顺时针下一台节点；有副本时则迁移到接下来的 N 个副本节点。

### 线程安全的生产级哈希环与分布测试

下面这个完整的 `Ring` 类型使用一把读写锁保护整个哈希环。这里没有必要给每个槽位单独加锁，那对这种访问模式属于过度设计。

```go
package consistenthash

import (
    "hash/fnv"
    "sort"
    "strconv"
    "sync"
)

type Ring struct {
    mu     sync.RWMutex
    vnodes int
    slots  []uint32          // 排序后的槽位
    owners map[uint32]string // 槽位 → 物理节点
}

func NewRing(vnodes int) *Ring {
    return &Ring{vnodes: vnodes, owners: make(map[uint32]string)}
}

func hash(s string) uint32 {
    h := fnv.New32a()
    _, _ = h.Write([]byte(s))
    return h.Sum32()
}

func (r *Ring) AddNode(node string) {
    r.mu.Lock()
    defer r.mu.Unlock()
    for i := 0; i < r.vnodes; i++ {
        slot := hash(node + ":" + strconv.Itoa(i))
        r.slots = append(r.slots, slot)
        r.owners[slot] = node
    }
    sort.Slice(r.slots, func(i, j int) bool { return r.slots[i] < r.slots[j] })
}

func (r *Ring) GetNode(key string) string {
    r.mu.RLock()
    defer r.mu.RUnlock()
    if len(r.slots) == 0 {
        return ""
    }
    h := hash(key)
    // 二分查找：找到第一个大于等于 h 的槽位；没有则回绕到 slots[0]。
    idx := sort.Search(len(r.slots), func(i int) bool { return r.slots[i] >= h })
    if idx == len(r.slots) {
        idx = 0
    }
    return r.owners[r.slots[idx]]
}
```

移除节点与增加节点相反：删除该节点对应的每个虚拟槽位。重建时最昂贵的操作是 `sort.Slice`；如果哈希环的成员变化非常频繁，可以换成有序映射结构，例如 `github.com/igrmk/treemap`。

```go
func (r *Ring) RemoveNode(node string) {
    r.mu.Lock()
    defer r.mu.Unlock()
    keep := r.slots[:0]
    for _, s := range r.slots {
        if r.owners[s] != node {
            keep = append(keep, s)
        } else {
            delete(r.owners, s)
        }
    }
    r.slots = keep
    // 删除操作会保留原有顺序，因此无需重新排序。
}
```

每个哈希环都应该配备负载分布测试，并把它作为回归保护放进测试套件。虚拟节点数量减少或哈希函数发生变化时，标准差会立即显著上升。

```go
func TestRing_LoadDistribution(t *testing.T) {
    r := NewRing(150) // 150 个虚拟节点是生产环境中的常用平衡点
    nodes := []string{"a", "b", "c", "d", "e", "f", "g", "h", "i", "j"}
    for _, n := range nodes {
        r.AddNode(n)
    }

    counts := make(map[string]int)
    const N = 1_000_000
    for i := 0; i < N; i++ {
        counts[r.GetNode(strconv.Itoa(i))]++
    }

    expected := float64(N) / float64(len(nodes))
    var sumSqDiff float64
    for _, c := range counts {
        d := float64(c) - expected
        sumSqDiff += d * d
    }
    stdDev := math.Sqrt(sumSqDiff/float64(len(nodes))) / expected
    if stdDev > 0.06 { // 6%：对于 10 个节点、每个 150 个虚拟节点已经较为宽松
        t.Errorf("load distribution stddev %.4f > 0.06; check vnode count", stdDev)
    }
}
```

节点加入或离开时，可以发出结构化重平衡事件，让依赖方预热或清理迁移范围内的缓存，而不是等到冷缓存未命中发生后再处理：

```go
type RebalanceEvent struct {
    Type       string // "node_added" | "node_removed"
    Node       string
    Migrated   int    // 迁入或迁出的键数量
    OccurredAt time.Time
}

// AddNodeWithEvent 包装 AddNode，并在哈希环形成新布局后发送事件。
func (r *Ring) AddNodeWithEvent(node string, sink chan<- RebalanceEvent) {
    r.AddNode(node)
    sink <- RebalanceEvent{
        Type: "node_added", Node: node, OccurredAt: time.Now(),
    }
}
```

订阅方自行维护自己的状态，哈希环仍然保持为纯数据结构。相比把通知逻辑直接塞进哈希环，这种模式更好，因为每个使用方需要的语义都不同：有的在新增节点时预热，有的在移除时失效缓存，还有的只需要记录日志。

虚拟节点数量是团队最容易配置错误的参数。Cassandra 4.0 将默认值从 256 降到 16，是因为重平衡成本会随虚拟节点数量超线性增长。服务侧可以把哈希环参数集中放在配置文件中：

```yaml
# ring.yaml
ring:
  vnodes_per_node: 150          # 150 = 均衡缓存环；16 = Cassandra 风格
  hash_function: murmur3        # CRC32 会让连续键产生聚集
  rebalance_batch_size: 100     # 拓扑变化时允许的最大并发迁移数
  rebalance_off_peak_only: true # 业务高峰期间跳过重平衡
```

## Jump Consistent Hash：当哈希环显得过重

Lamping 和 Veach 于 2014 年在 Google 发表了 Jump Consistent Hash。整个算法只有 7 行，不分配内存，查询吞吐量比基于哈希环的实现高 5～10 倍。

它的限制是只支持从 0 到 N−1 连续编号的桶。假设有 100 个桶，你无法单独移除 7 号桶而不重新编号，因为算法假定桶 ID 连续。

它的数学原理是一段概率游走：桶数量从 1 增长到 N 的过程中，算法使用由键决定的确定性随机序列，判断这个键是否“跳到”新桶。期望跳转次数为 O(ln N)，所以即使有 1,000 个桶，循环通常也只执行约 5 次。

```go
// JumpHash 为给定的键返回 [0, numBuckets) 范围内的桶编号。
// 来源：Lamping & Veach, "A Fast, Minimal Memory, Consistent Hash Algorithm" (2014)
func JumpHash(key uint64, numBuckets int32) int32 {
    var b, j int64 = -1, 0
    for j < int64(numBuckets) {
        b = j
        key = key*2862933555777941757 + 1
        j = int64(float64(b+1) * (float64(int64(1)<<31) / float64((key>>33)+1)))
    }
    return int32(b)
}
```

当桶只会追加、不会任意删除时，例如分片数据库的 shard ID，或手动重平衡的 Kafka partition ID，并且你需要亚微秒级查询，适合使用 Jump Hash。节点可能故障、需要从任意位置替换时则应避免使用，因为重新编号的成本会抵消这个算法的简洁优势。Google 在节点 ID 稳定的内部桶分配层中使用了 Jump Hash。

## 真实系统中的调优：Memcached、DynamoDB 与 Cassandra

后端工程师常见的三种生产级哈希环，实际差异比教科书描述得更大。它们的调优选择也揭示了各自真正优化的目标。

**Memcached（libketama）：** 每台节点使用 160 个虚拟节点，并以 MD5 派生 32 位位置。`pylibmc`、`spymemcached` 和 `mcrouter` 中的 `libketama` 算法早于有限负载一致性哈希，因此不会限制节点负载，热键落在哪里就会一直打到哪里。生产部署通常会在每个应用服务器上增加一级进程内 LRU，在进入哈希环查找之前先吸收热键流量。Twemproxy 和 mcrouter 都实现了兼容 libketama 的分布方式，从而让不同客户端库做出一致的路由决定。

**DynamoDB：** 内部实现未公开，但最初的 Dynamo 论文描述了每台节点 128 个 token、沿顺时针方向保存 3 个副本的方案。当前托管版 DynamoDB 完全隐藏了哈希环；当某个分区持续超过 3,000 RCU 或 1,000 WCU 时，自适应容量会自动拆分热分区。换句话说，AWS 通过把哈希环做成黑盒并提供自动拆分分区的 `OnDemand` 模式，让用户不再需要调整虚拟节点。

**Cassandra：** 4.0 将每台节点的虚拟节点数量从 256 降到了 16。原因是重平衡成本：虚拟节点越多，引导新节点加入集群所需的时间会超线性增长，因为流式传输子系统必须为每一组“源虚拟节点—目标虚拟节点”协商数据传输。在 100 节点集群中，每台使用 256 个虚拟节点时，一次节点引导会涉及 25,600 个源数据范围；降低到 16 后只涉及 1,600 个。数据仍然是分散的，但引导过程从数天缩短到数小时。

## 有限负载与“两次随机选择”

这两种算法都在解决朴素一致性哈希负载不均的问题，但权衡不同。如何选择取决于你能否接受逐键状态，以及尾延迟目标有多严格。

**有限负载一致性哈希（Mirrokni 等，Google，2016）：** 把每个节点限制在 `K/N × (1 + epsilon)` 个键；溢出后沿顺时针方向寻找下一台节点。每个请求的成本是一次哈希环查询，最坏情况下再进行最多 `1/epsilon` 次顺时针探测。`epsilon = 0.25` 时，最坏会多探测 4 次；负载率低于 80% 时，实践中的平均值约为 1.05 次查询。

**两次随机选择（Power of Two Choices）：** 使用两个独立哈希函数为键选择两个候选节点，然后选择负载较低的一个，成本永远是两次查询。相比随机放置，它能显著降低方差：最大负载从 O(log N / log log N) 降至 O(log log N)。这一思想源于 Mitzenmacher 1996 年的工作，也被应用在 Maglev 和 Vimeo 的 Vitess 中。

下面是 50 节点哈希环在每秒 100 万个键下的一组具体数据：

| 算法 | 平均查询次数 | P99 查询次数 | 最大负载比 | 每节点状态 |
| --- | ---: | ---: | ---: | --- |
| 朴素一致性哈希 | 1.00 | 1.00 | 1.45 | 无 |
| 有限负载（ε = 0.25） | 1.05 | 2.00 | 1.25 | 计数器（原子整数） |
| 两次随机选择 | 2.00 | 2.00 | 1.10 | 每副本一个计数器 |
| Maglev（Google L4） | 1.00 | 1.00 | 1.01 | 65,537 项查找表 |

当键的写入频率远高于读取频率时，有限负载方案更合适，因为计数器只在插入键时更新，而不是每次查询都更新。当读流量占主导，并且你希望成本稳定为两次查询时，两次随机选择更合适。当你控制数据平面，例如 Google 的 L4 负载均衡器，并且能够承担拓扑变化时重建查找表的成本，Maglev 更合适。

下面是在虚拟节点哈希环上实现的最小“两次随机选择”节点选择器。`h1` 和 `h2` 使用不同的种子，使两次结果同时碰撞的概率很低：

```go
type LoadAwareRing struct {
    *Ring
    load map[string]*atomic.Int64 // 节点 → 当前负载键数量
}

func (r *LoadAwareRing) PickNode(key string) string {
    a := r.GetNode(key + ":a")
    b := r.GetNode(key + ":b")
    if r.load[a].Load() <= r.load[b].Load() {
        return a
    }
    return b
}
```

对 `r.load` 的两次读取可能与并发更新发生竞争，但最坏的结果只是选到略差的节点，不会选到不安全的节点。若需要严格记账，可以把原子计数器换成分片计数器，同时接受额外的缓存行抖动。

## 常见问题

### 什么是一致性哈希？

一致性哈希把键和服务器映射到固定大小的环上。增加或移除服务器时，只需重新映射 K/(N+1) 个键——这是理论最小值；而取模哈希 `hash % N` 会让几乎所有键重新映射。

### 每台物理节点应该设置多少个虚拟节点？

负载方差大致会随虚拟节点数量的平方根缩小。对于缓存环，每台物理节点使用 150～256 个虚拟节点，通常能把方差控制在几个百分点以内。Cassandra 4.0 起默认为 16 个，这是用更大的负载方差换取更快的引导与拓扑变更；旧版 Cassandra 默认为 256 个。超过 256 后收益会逐渐减小，内存成本却会继续增长。DynamoDB 没有公开虚拟节点数量，因此你仍应对自己的哈希环进行实测。

### 一致性哈希和最高随机权重哈希有什么区别？

两者都能在节点变化时尽量减少键的重新分配。一致性哈希使用哈希环，查询复杂度为 O(log N)，但需要虚拟节点来平衡负载。最高随机权重哈希会针对每个键为每台节点计算分数，查询复杂度为 O(N)，不过无需虚拟节点也能自然均衡。100 个以上节点的大集群适合一致性哈希，小集群则更适合最高随机权重哈希。

### 一致性哈希应该使用哪种哈希函数？

推荐 MurmurHash3、xxHash 或 FNV-1a。CRC32 对连续输入会产生明显聚集；MD5、SHA-256 等密码学哈希又过于昂贵，因为这里需要的是均匀分布，而不是抗碰撞能力。Cassandra 默认使用 MurmurHash3。

## 参考资料与出处

- BackendBytes Engineering Team：[Consistent Hashing: The Algorithm Behind Every Scalable Distributed System](https://backendbytes.com/articles/consistent-hashing-guide/)
- David Karger 等：[Consistent Hashing and Random Trees: Distributed Caching Protocols for Relieving Hot Spots on the World Wide Web](https://www.akamai.com/site/en/documents/research-paper/consistent-hashing-and-random-trees-distributed-caching-protocols-for-relieving-hot-spots-on-the-world-wide-web.pdf)（1997）
- Giuseppe DeCandia 等：[Dynamo: Amazon’s Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf)（2007）
- Michael Mitzenmacher、Rasmus Pagh、Stefan V. Tetali 等：[Consistent Hashing with Bounded Loads](https://arxiv.org/abs/1608.01350)
- John Lamping、Eric Veach：[A Fast, Minimal Memory, Consistent Hash Algorithm](https://arxiv.org/abs/1406.2294)
- Apache Cassandra：[Token allocation](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html#token-allocation)
