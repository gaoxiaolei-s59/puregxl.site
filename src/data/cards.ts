// 卡片墙数据 —— /projects /games /share 三个页面的内容都在这里编辑。
// 加一张卡 = 在对应数组里加一个对象。字段说明见下方 CardItem。

export interface CardItem {
	title: string; // 卡片标题
	desc: string; // 一句话描述
	tags: string[]; // 标签（胶囊），可留空数组 []
	url?: string; // 可选：点击跳转的链接，不填则卡片不可点
	badge?: string; // 可选：右下角小徽章，如 "本站" "进行中" "2 PR"
	category?: string; // 仅 /share 用：所属分类，要和页面 tabs 里的某一项一致
}

// ===== 项目 =====
// category 用于项目页的分类标签：「项目」或「开源」（要和 src/pages/projects.astro 的 tabs 对应）
export const projects: CardItem[] = [
	{
		title: "短链接系统",
		desc: "自建短链生成与跳转服务，已对外提供。",
		tags: ["Java", "Spring"],
		url: "https://link.puregxl.site",
		badge: "在线",
		category: "项目",
	},
	{
		title: "puregxl.site 博客",
		desc: "你正在看的这个站，基于 Astro 的静态博客。",
		tags: ["Astro", "Fuwari"],
		url: "https://github.com/gaoxiaolei-s59/puregxl.site",
		badge: "本站",
		category: "项目",
	},
	{
		title: "RAG 知识问答",
		desc: "检索增强生成（RAG）的问答系统实践。",
		tags: ["Java", "LLM"],
		badge: "进行中",
		category: "项目",
	},
	{
		title: "JobBright",
		desc: "求职方向的个人项目，1.0 预览版。",
		tags: ["项目", "求职"],
		url: "https://github.com/gaoxiaolei-s59/JobBright",
		badge: "预览",
		category: "项目",
	},
	{
		title: "Apache Kafka",
		desc: "参与社区贡献，关注消息流平台的工程实践。",
		tags: ["消息队列", "Apache"],
		url: "https://github.com/apache/kafka/pull/22544",
		badge: "2 PR",
		category: "开源",
	},
	{
		title: "Apache RocketMQ",
		desc: "关注消息队列的文档完善、测试覆盖与工程实践优化。",
		tags: ["消息队列", "Apache"],
		url: "https://github.com/apache/rocketmq/pull/10440",
		badge: "2 PR",
		category: "开源",
	},
	{
		title: "Apache Dubbo",
		desc: "了解 RPC 框架、服务治理与微服务生态。",
		tags: ["RPC", "微服务"],
		url: "https://github.com/apache/dubbo/pull/16324",
		badge: "1 PR",
		category: "开源",
	},
	{
		title: "AgentScope-Java",
		desc: "Java Agent 框架贡献，关注工具调用、Agent 工程化与 AI 应用落地。",
		tags: ["AI Agent", "Java"],
		url: "https://github.com/agentscope-ai/agentscope-java/pull/1684",
		badge: "1 PR",
		category: "开源",
	},
	{
		title: "maven-lockfile",
		desc: "Maven 生态贡献，了解构建工具、依赖管理与工程规范。",
		tags: ["构建工具", "Maven"],
		url: "https://github.com/chains-project/maven-lockfile/pull/1595",
		badge: "1 PR",
		category: "开源",
	},
];

// ===== 热爱的游戏 ===== （占位，替换成你自己的）
export const games: CardItem[] = [
	{
		title: "游戏名一",
		desc: "一句话点评：为什么喜欢它（占位）。",
		tags: ["动作"],
	},
	{
		title: "游戏名二",
		desc: "一句话点评（占位）。",
		tags: ["RPG"],
	},
	{
		title: "游戏名三",
		desc: "一句话点评（占位）。",
		tags: ["策略"],
	},
];

// ===== 分享 ===== （占位，替换成你收藏的资源）
// category 要和 share 页面的 tabs（见 src/pages/share.astro）对应
export const shares: CardItem[] = [
	{
		title: "技术笔记合集",
		desc: "平时整理的学习笔记与文档（占位）。",
		tags: ["笔记"],
		category: "文章",
	},
	{
		title: "收藏的好文",
		desc: "值得反复读的文章（占位，待补充）。",
		tags: ["阅读"],
		category: "文章",
	},
	{
		title: "常用工具",
		desc: "顺手的在线工具（占位）。",
		tags: ["效率"],
		category: "工具",
	},
	{
		title: "友情链接",
		desc: "朋友们的小站（占位）。",
		tags: ["友链"],
		category: "网站",
	},
];
