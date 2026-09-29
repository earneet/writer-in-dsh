# AGENTS.md — writer-in-dsh

以 DeepSeek Harness（dsh）插件形式复刻 novel-writer（AI 长篇小说写作工具）的功能。本仓库是插件的开发仓库。

## 目标与范围

- **做什么**：把 novel-writer 的**领域层**做成 dsh 插件组合（写作引擎、伏笔追踪、领域存储、RAG 检索、导出等，见下方规划）。
- **不做什么**：不重建通用 agent 基座。会话持久化、上下文压缩、subagent、web_search/web_fetch、权限确认、ask_user、多客户端 UI 一律用 dsh 宿主自带能力；禁止在插件里重复造这些轮子。
- **存储原则**：小说正文与工作信息以 **Markdown 为权威来源（SoT）**；索引/缓存（hash、摘要、状态）是派生物，可删除后重建。不引入 MySQL；SQLite 仅当派生缓存使用且必须可从 Markdown 全量重建。

## 必读参考（动手前先读）

| 文档 | 用途 |
|---|---|
| `references/novel-writer-analysis.md` | 被复刻项目的功能/工作流/子系统分析 + DSH 复刻映射（§14 是包规划） |
| `references/dsh-plugin-research.md` | dsh 插件定义形式、bundle/profile 分发、skill 格式、能力缝清单 |
| `references/novel-writer/`、`references/deepseek-harness/` | 源码子模块（只读参考，勿改动；它们有自己的 AGENTS.md，不适用于本仓库） |

两个子模块用 `git submodule update --init` 拉取。引用参考结论时注明来源路径。

## 插件架构约定

- 遵循 dsh 能力缝三分法（Service Definition / Provider / Consumer），按 `novel-writer-analysis.md` §14.3 的包规划组织：`writer-core`（`ctx.writer` 服务 + 领域事件）、`writer-store`（Markdown SoT + 索引）、`writer-tools`（defineTool 注册）、`writer-rag`、`writer-skills`（bundled skills）、`writer-bundle`（组合包）。
- 插件形态遵守 dsh 规则：函数插件具名导出 `name`/`inject`/`Config`/`apply` 且**无 default export**；服务包 default-export Service 子类；注册一律走 effect；配置用 Schemastery schema，禁止硬编码可调参数，配置错误响亮失败。
- 能用 **skill**（Markdown 指令，`.dsh/skills/<name>/SKILL.md`）解决的不写代码插件；需要新工具/服务/事件时才写插件。
- 领域事件用 dsh typed events（declaration merging）；进程内同步场景不建 outbox，仅跨进程/崩溃恢复需求才引入。
- 每个 `dsh.bundle` 组合包：`package.json` 声明 `dsh.bundle.patch` + `cordis.patch.yml` 按包名引用入口。

## 工作流程

1. 动手前先核对两份参考文档；novel-writer 行为有疑义时以 `references/novel-writer/docs/` 设计文档为准溯源。
2. 多步骤任务先列 todo；研究/盘点类大任务优先派 subagent（novel-writer 仓库约定同时运行 subagent ≤4，此处沿用）。
3. 代码改动后运行相关检查（后续建立 `pnpm test/typecheck` 后不得跳过）；提交信息用英文祈使句，一次提交一个主题。
4. 新的关键设计决策同步记录到 `docs/` 下对应设计文档，保持文档与代码一致。
5. 所有面向人的文档、注释用简体中文。

## 目录规划

```
AGENTS.md            # 本文件
references/          # 只读参考（两个子模块 + 两份研究文档）
packages/            # dsh 插件包（dsh-writer-*，按能力缝切分）
docs/                # 本项目设计文档（复刻方案、决策记录）
.dsh/skills/         # 项目级技能（开发期临时技能也可放这里）
```

## 当前状态

仓库刚初始化：仅有参考材料，插件代码尚未开始。下一步建议：按 §14.3 规划先做 `writer-core` + `writer-store` 的最小骨架（项目/章节/人物的 Markdown SoT 读写 + read/update 两个工具），跑通一个 dsh profile 加载闭环，再逐块补写作引擎、伏笔、RAG。
