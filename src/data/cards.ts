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
export const projects: CardItem[] = [
	{
		title: "短链接系统",
		desc: "自建短链生成与跳转服务，已对外提供。",
		tags: ["Java", "Spring"],
		url: "https://link.puregxl.site",
		badge: "在线",
	},
	{
		title: "puregxl.site 博客",
		desc: "你正在看的这个站，基于 Astro 的静态博客。",
		tags: ["Astro", "Fuwari"],
		url: "https://github.com/gaoxiaolei-s59/puregxl.site",
		badge: "本站",
	},
	{
		title: "RAG 知识问答",
		desc: "检索增强生成（RAG）的问答系统实践。",
		tags: ["Java", "LLM"],
		badge: "进行中",
	},
	{
		title: "Apache Kafka 贡献",
		desc: "向开源社区提交的 PR #22544 / #22549。",
		tags: ["开源", "Scala"],
		url: "https://github.com/apache/kafka/pulls?q=is%3Apr+author%3Agaoxiaolei-s59",
		badge: "2 PR",
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
