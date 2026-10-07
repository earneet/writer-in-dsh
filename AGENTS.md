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
| `docs/implementation-plan.md` | 本项目落地规划（§1 包职责、§5 阶段表、§8 迭代记录——**含全部已知限制与环境坑，动手前必读**） |
| `references/novel-writer/`、`references/deepseek-harness/` | 源码子模块（只读参考，勿改动；它们有自己的 AGENTS.md，不适用于本仓库） |

两个子模块用 `git submodule update --init` 拉取。引用参考结论时注明来源路径。

## 插件架构约定

- 遵循 dsh 能力缝三分法（Service Definition / Provider / Consumer），按 `novel-writer-analysis.md` §14.3 的包规划组织：`writer-domain`（纯函数域库，无插件行）、`writer-core`（`ctx.writer` 抽象基类 + 领域事件声明，纯契约包**不上 cordis 行**）、`writer-store`（Provider：Markdown SoT + 派生索引）、`writer-engine`（P2）、`writer-tools`（Consumer：defineTool 注册）、`writer-skills`（bundled skills）、`writer-rag`（P4）、`writer-export`（P3）、`writer-bundle`（组合包）。
- 插件形态遵守 dsh 规则：函数插件具名导出 `name`/`inject`/`Config`/`apply` 且**无 default export**；服务包 default-export Service 子类；注册一律走 effect；可选服务用 `ctx.get()`；配置用 Schemastery schema，禁止硬编码可调参数，配置错误响亮失败。
- 能用 **skill**（Markdown 指令）解决的不写代码插件；bundled 技能放 `writer-skills/assets/<name>/SKILL.md`（frontmatter 为候选元数据单一真源，范式见 `packages/writer-skills/src/index.ts`）。
- 领域事件用 dsh typed events（declaration merging）；进程内同步场景不建 outbox，仅跨进程/崩溃恢复需求才引入。
- 每个 `dsh.bundle` 组合包：`package.json` 声明 `dsh.bundle.patch` + `cordis.patch.yml` 按包名引用入口。

## 工作流程

1. 动手前先核对参考文档；novel-writer 行为有疑义时以 `references/novel-writer/docs/` 设计文档为准溯源。
2. 多步骤任务先列 todo；研究/盘点类大任务优先派 subagent（同时运行 subagent ≤4，沿用 novel-writer 仓库约定）。
3. 代码改动后必须运行 `npm run typecheck` 与 `npm test`，不得跳过；提交信息用英文祈使句，一次提交一个主题。
4. 阶段完成后按惯例执行**对抗审查 → 逐条复核 → 修复 → 重测**循环，直到一轮审查无新问题再收口；迭代记录追加到 `docs/implementation-plan.md` §8。
5. 新的关键设计决策同步记录到 `docs/` 下对应设计文档，保持文档与代码一致。
6. 所有面向人的文档、注释用简体中文。

## 目录规划

```
AGENTS.md            # 本文件
references/          # 只读参考（两个子模块 + 两份研究文档）
packages/            # dsh 插件包（dsh-writer-*，按能力缝切分；见 implementation-plan §0）
├── writer-domain/   # 纯函数域库（frontmatter/hash/伏笔状态机等，无插件行）
├── writer-core/     # Service Definition：WriterService 抽象基类 + typed events
├── writer-store/    # Provider：Markdown SoT 存储，发布 ctx.writer
├── writer-engine/   # Provider：写作引擎（三模式/审稿），发布 ctx.writerEngine
├── writer-tools/    # Consumer：writer_read / writer_update / write_chapter / review_chapter / foreshadow_update / consistency_check / recompute_derived / writer_stats / archive_point / export_book / writer_search
├── writer-skills/   # bundled skill provider + assets/<name>/SKILL.md
├── writer-export/   # Consumer：TXT/HTML/ePub 导出（发布 ctx.writerExport）
├── writer-rag/      # Provider：混合检索（关键词 + 可选语义档），发布 ctx.writerRag
├── writer-guard/    # Consumer：工具业务错误预算（tools/post-execute 观测，只注入纠偏提示）
└── writer-bundle/   # 组合包：cordis.patch.yml 挂载 store→engine→skills→export→rag→guard→tools
example-project/     # 验证用示例小说项目（Markdown SoT）
dev.cordis.yml       # 本地开发 overlay（绝对路径引用各包 src/index.ts）
docs/                # 本项目设计文档（落地规划、审查裁定）
.dsh/skills/         # 项目级技能（开发期临时技能也可放这里）
```

## 开发与验证环境（踩坑记录，详见 implementation-plan §8）

- **依赖版本**：所有 `@deepseek-ai/*` 运行时依赖必须与 dsh 严格同版本 `0.2.0-rc.2`，否则实例分裂致调度器崩；npm install-scripts 需在根 `package.json` 的 `allowScripts` 审批。
- **包管理器**：本仓库用 **npm workspaces**；dsh `plugin add` 内部转发 **pnpm**——本机必须用 **pnpm 10**（pnpm 12 因盘符根锁目录 `C:\pnpm-store-operation-locks` EPERM 完全不可用）。
- **profile 安装**：`dsh plugin --profile <name> add <绝对路径>` 逐包按依赖序安装（link: 形态，兄弟包依赖经本仓库根 node_modules 解析）；**新建 profile 只含 base+功能 bundle 时无 app 入口会无限空转**（进程空转无输出不报错），须另装 app bundle 且钉版本：`@deepseek-ai/dsh-headless@0.2.0-rc.2` 或 `@deepseek-ai/dsh-web-app@0.2.0-rc.2`（npm 源默认解析到不兼容旧版 0.0.1-rc.1）。
- **本地功能验证**：overlay 方式跑 headless 即可——`npx @deepseek-ai/dsh --profile headless --patch ./dev.cordis.yml "<任务>"`；最终形态验证再走 profile 安装路径（`--dump-config` 核对组合树 + web/headless 启动）。
- **临时插件位置**：overlay 里挂载的临时 .ts 插件文件**必须放在有 package.json 的包目录内**（如 packages/ 下）；放仓库根目录会导致首次模型调用 REQUEST_EXTENSION 失败（插件清单解析需要包身份）。
- **projectRoot**：writer-bundle 默认 `!!js process.cwd()`，验证时须从 `example-project/` 目录启动 dsh。

## 当前状态

**P1 + P1.5 + P2 + P3 + P4 已收口**（迭代记录见 `docs/implementation-plan.md` §8 轮次 0-9）：

- 10 包可用：domain / core / store / engine / tools / skills / export / rag / guard / bundle；示例项目 + dev overlay 就绪。
- P3（治理）：维护 pass（保存后异步，摘要 + 事实/伏笔/人物状态抽取两次调用；分节 schema + 引用存在性校验 + 按节重试；同章 inflight 去重 + 完成 hash 锚定；产出写回 `.writer/derived/` + `pending.md` 待办）；一致性检查（按预算分批全书覆盖 + 维度/schema 对齐 + 引用校验 + 时间锚倒序检测，报告预览不持久化）；recompute_derived（mark/recompute）；writer_stats / archive_point（git 显式存档点）；writer-export（TXT/HTML/ePub，XSS/XML 转义，export_book 默认 ask 权限路径）。
- P4（增量）：writer-rag（混合检索：关键词先行 CJK bigram TF-IDF + 可选语义档 none/llm/external + RRF 融合；语料=章节切片+新鲜摘要+人物/伏笔/世界观；防剧透 chapterLimit 块级过滤；engine 组装增强注入 + writer_search 工具，缺席降级）；writer-guard（tools/post-execute 业务错误预算，滚动窗口超预算注入纠偏提示，不熔断）；engine recoverySnapshot（断更恢复快照，git 时间锚）；store list() 解析快照缓存；节拍模式评估裁定**不做独立引擎**（理由与替代路径见 §8 轮次 9）；export_book 批准路径 seam 级复验通过。
- 已验证：单测 140/140、typecheck 零错；overlay+headless 与 profile 双形态实测（检索命中/guard 纠偏注入/rag 缺席降级/export 批准与 fail-closed 对照/恢复快照）。
- 已知限制见 §8 轮次 2/6/7/8/9。

**下一步**：人物状态时间线结构化升格（§8 轮次 8 限制⑥，继续顺延）；external embedding 档实测（待有 key 环境）；发布前清理（去 private、依赖精确范围、lib/ 预构建，见 §8 轮次 6 限制③）。
