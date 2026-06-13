---
title: 并发编程的“万能钥匙”：一文读懂 AQS 设计哲学
published: 2026-06-12
description: "从 state、同步队列到 Condition 条件队列，理解 ReentrantLock、CountDownLatch 等并发工具背后的统一抽象。"
image: ""
tags: [Java, 并发编程, AQS]
category: Java
draft: false
lang: ""
---

提到 Java 并发编程，`AbstractQueuedSynchronizer`，也就是我们常说的 **AQS**，几乎是绕不开的核心角色。`ReentrantLock`、`Semaphore`、`CountDownLatch` 这些常用并发工具，底层都建立在它之上。

很多人会觉得：“我平时只是在用锁，又不是在造锁，为什么要学 AQS？”  
原因其实很直接：如果只会用 API，我们看到的只是“现象”；而理解了 AQS，才能真正看清这些并发工具为什么能工作、为什么这样设计，以及它们各自的适用边界。

这篇文章就从几个最核心的问题出发，快速建立对 AQS 的整体认知：

- AQS 到底在抽象什么
- `state` 为什么是它的核心
- 同步队列和条件队列分别解决什么问题
- 独占模式和共享模式分别适合哪些场景

## AQS 在解决什么问题

AQS 本质上提供的是一套 **“同步器骨架”**。

它并不直接规定你一定要实现一把什么样的锁，而是提供了一套统一的线程排队、阻塞、唤醒和状态管理机制。基于这套骨架，不同的并发工具只需要定义好“资源如何获取、如何释放”，就能复用整套线程协调能力。

可以把它理解成这样：

- `state` 负责描述当前同步状态
- FIFO 双向队列负责管理获取资源失败的线程
- 模板方法负责组织获取、释放、入队、挂起、唤醒的完整流程

也正因为有了这层抽象，Java 才能在不依赖 `synchronized` 内置监视器的前提下，用纯 Java 代码实现出一整套高性能、可扩展的同步器。

## `state`：AQS 的核心状态位

AQS 内部最关键的成员变量就是：

```java
private volatile int state;
```

这个字段看起来只是一个整数，但它真正厉害的地方在于：**它的含义完全由具体同步器自己定义**。

在不同组件里，`state` 对应的语义并不相同：

- `ReentrantLock`：表示锁是否被占用，以及重入次数
- `ReentrantReadWriteLock`：高 16 位表示读锁状态，低 16 位表示写锁状态
- `Semaphore`：表示当前可用许可数
- `CountDownLatch`：表示剩余计数

也就是说，AQS 不关心“你实现的是锁、信号量还是倒计时器”，它只关心一件事：**你如何基于 `state` 判断资源能不能被获取，以及释放后是否需要唤醒别人。**

这就是它设计上很漂亮的一点：抽象得足够高，但又保留了足够强的扩展能力。

## 同步队列：管理“没抢到资源”的线程

AQS 内部维护的是一个 **FIFO 双向队列**。当线程尝试获取资源失败时，它不会一直自旋浪费 CPU，而是会被包装成队列节点，加入等待队列，随后在合适的时候挂起。

这个队列解决的是一个非常实际的问题：

> 当多个线程同时竞争资源时，失败的线程应该以什么顺序等待，何时被唤醒，以及由谁来接替执行？

AQS 的答案就是：排队。

所以从行为上看，它像是给线程建了一个“候客区”：

- 线程获取资源成功，直接继续执行
- 获取失败，进入同步队列
- 当前持有者释放资源后，按规则唤醒后继节点继续竞争

这也是为什么很多基于 AQS 的同步器，在高并发下依然能保持比较稳定的协调能力。

## 条件队列：管理“拿到锁后主动等待”的线程

如果说同步队列维护的是“**没抢到资源**”的线程，那么条件队列维护的则是“**已经拿到锁，但因为条件不满足而主动等待**”的线程。

这一层能力由 AQS 内部的 `ConditionObject` 提供，也就是 `Condition` 背后的实现基础。

这是理解 `ReentrantLock` 比 `synchronized` 更灵活的关键。

使用 `Condition` 时，我们可以把等待线程拆分到不同的“等待室”里，而不是像 `Object.wait()` 那样把所有等待者都混在一起。这样做的好处非常明显：

- 可以精准唤醒需要被唤醒的那一类线程
- 避免无意义的“全员唤醒”
- 降低竞争和上下文切换成本

下面这个例子就很典型。

## 一个更容易理解的例子：有界阻塞队列

我们用一把锁，配合两个条件队列，模拟一个简单的生产者-消费者模型：

```java
import java.util.LinkedList;
import java.util.Queue;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.Lock;
import java.util.concurrent.locks.ReentrantLock;

/**
 * AQS 多 Condition 演示：自定义阻塞队列
 * 核心优势：一把锁，两个队列（"不满"队列 和 "不空"队列），实现精准唤醒
 */
public class BoundedBuffer<T> {
    private final Lock lock = new ReentrantLock();
    // 队列满时，生产者在 notFull 条件队列等待
    private final Condition notFull = lock.newCondition();
    // 队列空时，消费者在 notEmpty 条件队列等待
    private final Condition notEmpty = lock.newCondition();

    private final Queue<T> queue = new LinkedList<>();
    private final int capacity;

    public BoundedBuffer(int capacity) {
        this.capacity = capacity;
    }

    public void put(T item) throws InterruptedException {
        lock.lock();
        try {
            while (queue.size() == capacity) {
                System.out.println("【生产者】队列满了，我去 notFull 房间排队睡觉...");
                notFull.await();
            }

            queue.add(item);
            System.out.println("【生产者】生产了一个: " + item);

            // 只唤醒等待消费的线程
            notEmpty.signal();
        } finally {
            lock.unlock();
        }
    }

    public T take() throws InterruptedException {
        lock.lock();
        try {
            while (queue.size() == 0) {
                System.out.println("【消费者】队列空了，我去 notEmpty 房间排队睡觉...");
                notEmpty.await();
            }

            T item = queue.poll();
            System.out.println("【消费者】消费了一个: " + item);

            // 只唤醒等待生产的线程
            notFull.signal();
            return item;
        } finally {
            lock.unlock();
        }
    }
}
```

这个例子的价值不在于代码多复杂，而在于它非常清楚地体现了 `Condition` 的设计思想：

- `notFull` 管理生产者
- `notEmpty` 管理消费者
- 生产后只唤醒消费者
- 消费后只唤醒生产者

这种“按职责拆队列、按条件精确唤醒”的模式，是原生 `synchronized + wait/notify` 很难优雅做到的。

## 为什么这比 `wait/notify` 更强

如果只用 `Object.wait()` / `notify()`，所有等待线程通常都挂在同一个监视器队列上。这样一来，你经常会遇到两个问题：

- 唤醒的人不一定是当前真正需要被唤醒的人
- 为了保险，很多时候只能 `notifyAll()`，导致大量无效竞争

而 `Condition` 的优势就在于：**一把锁可以挂多个条件队列。**

这意味着你可以把“队列不满”“队列不空”“任务完成”“资源可用”这些不同条件分别建模，让等待和唤醒更加精确。

这也是为什么很多 JUC 组件会更偏向这种设计。

## JDK 里的典型案例：`ArrayBlockingQueue`

这种思路并不是示例代码里的小技巧，而是 JDK 并发容器中的常见模式。比如线程池常用到的 `ArrayBlockingQueue`，内部就是“一把锁 + 两个条件队列”的经典实现。

```java
public class ArrayBlockingQueue<E> extends AbstractQueue<E>
        implements BlockingQueue<E>, java.io.Serializable {

    final Object[] items;
    int takeIndex;
    int putIndex;
    int count;

    /** Main lock guarding all access */
    final ReentrantLock lock;

    /** Condition for waiting takes */
    private final Condition notEmpty;

    /** Condition for waiting puts */
    private final Condition notFull;
}
```

它的语义非常直接：

- `notFull`：队列满了，生产者等待
- `notEmpty`：队列空了，消费者等待

通过这种拆分，线程唤醒就能做到“点对点”，而不是“广播式”通知。  
这背后体现的，其实就是 AQS 提供的条件队列能力。

## AQS 的两种资源模式

理解完 `state` 和两类队列之后，再看 AQS 的两种资源模式就会顺很多：它本质上是在回答“资源是给一个线程独占，还是可以被多个线程共享”。

### 1. 独占模式

独占模式下，同一时刻资源只能被一个线程持有。

最典型的代表就是 `ReentrantLock`。它的基本逻辑可以概括为：

- 如果 `state == 0`，说明资源空闲，线程尝试通过 CAS 抢占
- 抢占成功后，把当前线程记录为持有者
- 如果持有者再次获取锁，只需要增加 `state`，这就是可重入
- 释放时递减 `state`，直到归零后再唤醒后继线程

这套机制把“线程身份”和“同步状态”结合了起来，所以特别适合实现互斥锁。

### 2. 共享模式

共享模式下，资源允许多个线程同时获取，但能获取多少、获取条件是什么，取决于具体实现。

典型代表包括：

- `Semaphore`
- `CountDownLatch`
- `ReentrantReadWriteLock` 中的读锁

和独占模式相比，共享模式更强调“剩余资源量”或“是否满足传播唤醒条件”。  
也正因为如此，共享模式在释放资源后，往往会继续向后传播唤醒，而不是只让单个后继节点参与竞争。

## 理解 AQS，真正得到的是什么

学习 AQS 的意义，不只是为了面试时能背出几个源码细节，而是为了建立一种更底层的并发认知：

- 锁的本质，是对状态的竞争与协调
- 阻塞和唤醒的本质，是队列管理
- 更灵活的同步工具，本质上来自更细粒度的等待条件拆分

当你带着这套视角再回头看 `ReentrantLock`、线程池阻塞队列、读写锁、信号量这些组件时，会明显感觉它们不再是零散的 API，而是建立在同一套设计哲学上的不同实现。

## 结语

AQS 之所以重要，不在于它“难”，而在于它几乎定义了 Java 并发包里一大类工具的共同底层模型。

如果你刚开始接触并发源码，不必一上来就死磕每个细节。先抓住这几个主线就够了：

- `state` 是状态核心
- 同步队列负责竞争失败后的排队
- 条件队列负责拿到锁后的条件等待
- 独占模式和共享模式决定资源如何被占用

把这四件事想明白，再去看 `ReentrantLock`、`CountDownLatch`、`Semaphore` 的源码，你会轻松很多。

如果后面继续展开，我也很想再写几篇，把 `ReentrantLock`、`Condition`、线程池阻塞队列这些具体组件一篇篇拆开讲透。
