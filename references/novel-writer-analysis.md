# novel-writer 功能与工作流分析（面向 DSH 插件复刻）

> 研究对象：`references/novel-writer` 子模块（v0.4.0-1470-g87a11bb8）。
> 目标：以 DeepSeek Harness 插件形式复刻该项目功能。本文先完整归纳其功能、工作流与子系统，再给出 DSH 复刻映射。
> 依据：仓库 `AGENTS.md`/`CLAUDE.md` 架构摘要 + `docs/` 下 17 份设计文档，关键结论均可溯源。

## 0. 存储澄清（重要）

原设计意图是 Markdown 存储工作信息，**当前实现是「SQLite 元数据 + Markdown 正文」双写**（`bun:sqlite` + Drizzle ORM + `filesystem/dual-write.ts` 事务一致性 + 文件锁），并非 MySQL——`bun.lock` 中 mysql2 只是 Drizzle 的可选 peer，从未使用。SQLite 只存元数据/索引/统计，**创作正文的权威来源（SoT）始终是 Markdown 文件**（git 友好），另有 sqlite-vec 向量存储作为检索索引。复刻时可根据用户原意进一步弱化 SQLite（见 §14）。

## 1. 项目定位与总体架构

AI 驱动的长篇小说写作工具：Agent 对话 + 传统 UI 双模式，覆盖大纲规划→人物塑造→世界观构建→情节编排→章节写作→审稿→导出全流程。

技术栈：Bun + TypeScript + Effect 3.x（DI）+ Hono（HTTP/WS/SSE）+ Vercel AI SDK + Drizzle/SQLite + SolidJS 前端（Web/TUI/Tauri 桌面）。C/S 架构，Server :4097，架构参考 opencode。

分层：Transport（TUI/HTTP/WebSocket）→ Service Layer（30+ Effect Service，统一 CRUD 接口）→ Agent Layer（AgentService + ToolRegistry + PermissionManager + SubAgentService + Memory）→ AI Orchestrator（多 Provider、流式、Prompt 模板引擎、Token 估算）→ Data Layer（SQLite + Markdown 双写 + 向量存储）。**双模式共享同一 Service Layer** 是核心架构决策。

## 2. 创作 8 阶段工作流（docs/writing-workflow.md）

创建项目 → 创作准则 → 大纲规划 → 人物塑造 → 情节编排 → 章节写作 → 审稿优化 → 导出发布。全程可回退，后续阶段自动做变更影响分析。

1. **项目创建**：名称/流派/简介/目标字数（AI 可推荐）→ 生成 `writer.yaml` + 目录（`characters/ chapters/ worldbuilding/ principles.md outline.md .writer/`）+ 初始化 SQLite 与向量库 + AI Provider 配置。
2. **创作准则**：AI 多轮对话（叙事风格/基调/参考作品）→ 流式生成草案 → 用户审阅 → 存 `principles.md` + RAG 索引。准则是独立功能，写作时**全量注入不截断**。
3. **大纲规划**：确认参数 → AI 流式生成梗概 + 章节规划 + 关键情节节点 + 伏笔设计 → 多轮调整 → 存 `outline.md` 并解析写入 `outline_nodes` 树（part/chapter_group/chapter，chapter_id 关联唯一真源）。
4. **人物塑造**：基础信息 → AI 生成草案（背景/性格/形象/关系/成长弧线）→ 交互深化 → 关系网络（AI 查一致性）→ 存 `characters/{姓名}.md` + SQLite + 关系记录。
5. **情节编排**：用户描述情节 → AI 评估（大纲一致性/人物影响/冲突/伏笔回收建议）→ 写入 `plot_points`。另有**灵感碎片**自底向上入口：`ideas`（用户原话不可覆盖）→ AI 消化（阈值 ≥10 条或 >24h 自动 + 手动，append-only `aggregation_runs` 日志）→ `plot_points`（伏笔种子特化）→ 大纲，单向流 + 双向追溯。
6. **章节写作**：见 §3-4。
7. **审稿优化**：选范围（单章/多章/全书）+ 5 维度（情节/人物/设定一致性、文学质量、读者体验）→ AI 流式输出结构化建议（ReviewSuggestion：id/dimension/severity/location/problem/suggestion/rewriteOption）→ 逐条（接受含预览/部分接受/忽略）或批处理 → 保存版本。
8. **导出发布**：TXT / ePub / HTML（打印 PDF），可选章节范围/含人物小传/含大纲。

## 3. 四种写作模式（docs/chapter-writing-design.md）

| 维度 | 整章 full | 分段 segment | 辅助续写 assist | 手动 manual |
|---|---|---|---|---|
| LLM 调用 | 1 次（含工具） | N 次（N=大纲节拍） | 1 次/次 | 0 |
| 输出 | ~3000 字 | 500-800 字/节拍 | 300-500 字 | 用户定 |
| 确认粒度 | 章节级 | 场景级（逐节拍确认，支持 rollbackToBeatIndex） | 段落级 | 直接保存 |
| 上下文 | 完整预注入 | 完整+已确认内容 | 精简 | 无 |
| 后处理 | 完整 | 完整 | 完整 | 完全相同（同一保存端点） |

- 整章：LLM 可中途暂停调工具再继续；无硬编码迭代上限，靠熔断器（连续 5 次失败 / 同参重复 10 次）。
- 分段：大纲无节拍时 AI 先 beat-split；已确认内容动态注入（≤1500 字全注 / 1500-3000 首尾 / >3000 最后 1000 字+大纲锚点）；节拍状态持久化。
- 手动：2s debounce 自动保存；支持外部编辑器（content_hash 对比检测）；伏笔面板手动标记。
- **rewrite 局部改写**：单次调用无 tool-loop，上下文=选区前后各 500 字+principles；Agent 路径为自适应补丁协议——小改（<1/3 句子）LLM 输出 `{"patches":[{find,replace}]}` 代码锚点替换（唯一命中才替换，未提及内容零触碰），大改输出全文+丢句检测守卫（原句保留率≥50% 逐句告警）。

## 4. 章节写作上下文组装（混合方案）

**预注入核心**：principles 全量（500-1500 tok）；梗概 ~200 / 结构位置 ~100；本章大纲+节拍 300-500 tok；前几章内容**分层注入按窗口自适应**（≥128K：前 3 章原文+更早摘要；64-128K：前 2 原文；32-64K：前 1 原文；<32K：仅前 1 章摘要）；人物精简摘要 ~100 字/人（出场人物 = 用户指定 ∪ 大纲正则 ∪ 前一章出场，摘要由 chapter:confirmed hook 自动更新）；伏笔指令（🔴必须设置 + 🔴必须回收 + 🟡活跃列表）；本章+历史 major 事件（未来章节不注入防剧透）；用户特别要求。

**窗口化大纲注入**：当前章完整大纲（永不截断）+ 前 3 章大纲摘要（≤200 字/章）+ 下一章钩子（≤300 字），总预算 2000 tok，降级顺序固定。

**工具按需查询**（不预注入）：完整人物小传、前章原文、世界观设定、非本章事件、关系详情、全部大纲。写作 Agent 工具预算：单次结果截 3000 tok、总 4000。

**风格示范 style_reference**：多条文风样本（manual/ai），与 principles 互补（规则红线 vs 语感腔调）；full/assist 走提示词硬性要求 + Agent 按需 read；rewrite 代码层预注入（`{{#if styleReferences}}` 条件块）。

## 5. Agent 工具体系（docs/interaction-design.md）

架构：**通用 `read(entity)` / `update(entity, {action}, modifications)` + 专用工具 + 运行时工具**；工具 ≠ UI 操作但共享 Service Layer。

**主 Agent（36 个 = 20 领域 + 16 运行时）**：
- 领域：`read`（14 种 entity）/ `update`（8 种实体，read-before-update 防护，updated_at+content_hash 双重校验，返回 diff/snapshot/warnings）/ `move`+`undo_move`（fractional index 排序）/ `write_chapter`（progressive 进度流式）/ `review_chapter`（须先于维护类工具）/ `analyze_impact` / `reverse_analyze`（唯一领域 ask）/ `foreshadow_suggest|detect|plant|resolve` / `save|update|delete|reorder|aggregate_ideas`（灵感碎片）/ `list_pending_facts|confirm_fact|reject_fact`（事实分诊）
- 运行时：`recall_memory` / `exclude_messages` / `save_memory` / `del_memory` / `suggest_memory` / `search_knowledge`（RAG）/ `compact_memory` / `get_context_usage` / `delegate_to_subagent`（异步）/ `run_subagent`（同步）/ `wait_subagent` / `query_subagent_status` / `cancel_subagent` / `ask_user` / `web_search`（限 10 次/对话）/ `web_fetch`（限 5 次/对话）

**写作 Agent（8 个）**：复用 `read(entity)` 白名单裁剪 9 种 entity（character_detail/chapter_content/worldbuilding/events/relations/outline_section/plots/ideas/style_reference）+ `web_search` + `web_fetch`。WebTracker 去重（结果已在上下文则引用不重取）。

**SubAgent 工具权限两层 AND**：类型白名单∪额外授权−黑名单，再按主 Agent 权限解析。

## 6. 权限系统

三级动作：**allow** / **ask**（暂停展示内容等确认，超时 5 分钟默认拒绝）/ **deny**。合并优先级（低→高）：内置 BUILTIN_RULES → 项目 `writer.yaml ai.permissions` → Session 临时规则；最后匹配优先，无匹配默认 ask。ask 红线仅剩：save_memory(L0) / del_memory(L0/project) / import_project / reverse_analyze。配套：ReadTracker 版本追踪 + 外部变更双通道通知（500ms 合并事件注入 + 被动 hash 检测）；死循环检测（同工具同参 10 次终止）；错误分类（业务错误反馈 LLM 不熔断 / 基础设施错误连续 5 次熔断）。

## 7. 数据模型（docs/data-model.md + src/storage/schema.ts）

**三轨存储**：SQLite（元数据）+ Markdown（正文 SoT）+ sqlite-vec（检索索引）。全部 ULID 主键 + Unix ms 时间戳。

核心表：`projects`、`characters`（summary 动态精简摘要 + file_path + content_hash）、`character_relations`、`chapters`（chapter_number 文件名序号与 sort_order fractional index 解耦；status draft/review/final）、**`plot_points`**（统一伏笔+情节：plot_type 七种；伏笔状态机 planned→planted→resolved/abandoned + milestones 四类中间事件 + planned_resolution_hint）、`ideas`（claimRaw 原子认领，单向流）、`aggregation_runs`、`style_references`、`versions`（content_before/after + diff）、`writing_stats`（按日）、`outline_nodes`（树）、`ai_sessions`、`chat_messages`（turn_number 统一递增，压缩可精确引用）+ `chat_message_parts`（text/tool_call/tool_result/confirmation/status 五种 part）、`agent_memories`（L0-L3 + scope project|session）、`project_changelog`（EventBus 自动写，5000 条）、`key_events`（不可遗忘事实 + stale 追踪）、`pending_facts`（章节保存后 LLM 六维度抽取：events/characters/relations/foreshadows/outline_deviation/style_deviation，data_hash 去重）、`reverse_analyses`、`subagent_tasks`、`tool_call_logs`、`dead_letter_events`、`undo_log`；FTS5 独立虚拟表 ×3；RAG 三表（documents/chunks/embeddings，index_status 状态机 + retryFailed 自愈）。世界观无表，纯 Markdown+RAG。

**双写一致性**：写流程 = 写 Markdown → 更新 SQLite → 更新 FTS5 → 异步向量索引，`withWritePermit` 包事务，事件经 outbox 同事务落库、提交后 at-least-once 投递。启动一致性校验：扫描 Markdown 算 hash 对比 SQLite，Markdown 新→重建索引，SQLite 新→提示冲突。大纲走 Markdown→解析重建 outline_nodes（事务内全量替换）。

**版本机制**：updated_at + content_hash 双重校验，Agent update 前必须 read。

## 8. RAG / 知识库（docs/ai-and-rag.md）

管线：内容变更事件 → chunker（按类型选策略：章节滑动窗口 500/overlap 100、中文句号断句；人物字段拼接切分；outline/memory 单切片）→ embedder（本地 transformers all-MiniLM-L6-v2 384 维，可选 ollama/openai）→ indexer upsert（sqlite-vec）。

检索 = 向量 + FTS5 关键词（bm25，jieba 分词降级 Intl.Segmenter，异常兜底 LIKE）**RRF 融合** + 源类型权重（chapter 1.0 / character 0.9 / outline 0.85 / worldbuilding 0.8 / memory 0.7）+ 可选时效衰减（半衰期 7 天）+ token 预算裁剪。scenarioSearch("writing"/"review") 跨类型竞争合并。触发时机：写章节/审稿/世界观工具；未配 embedding 退化纯关键词，降级链完整。结果注入走「预注入核心 + 工具按需查」混合方案，ContextAssembler 按优先级裁剪（系统 Prompt/准则/本章大纲/伏笔指令必须 → 人物摘要/前章摘要重要 → 梗概/结构位置一般）。

## 9. 记忆分级（docs/memory-and-context-design.md）

四层：**L0 永久**（用户确认的偏好/元决策，配置注入 system prompt）/ **L1 工作**（current_task/key_facts/decisions/pending_todos；scope 解析单一真源：key_facts/decisions→project 跨会话，current_task/pending_todos→session）/ **L2 对话**（conversation_summary 增量 + project_state 项目快照：章节进度/伏笔状态/人物状态/时间线）/ **L3 临时**（tool_result，超轮批量摘要化，原文保留可 recall_memory({toolCallId}) 精确召回）。

两层压缩：①轻量排除（exclude_messages，零 LLM 成本，DB 保留可召回）②全局压缩（异步 fire-and-forget，LLM 结构化输出 kept/new_summary/project_state_update/l1_updates/l0_suggestions，temperature=0）。触发阈值分窗口档，≥1M 窗口走 compressionPolicy 四档预设。存储层与上下文层分离：对话数据永不删除，压缩只影响发给 LLM 的内容。

## 10. SubAgent 委派（docs/subagent-design.md）

异步回调：`delegate_to_subagent` 立即返回 taskId 主 Agent 不阻塞；结果进 pending_results 队列按 taskContextId 匹配；消费时机 = tool-loop 每轮迭代前注入 + 每轮注入在跑列表。双重超时：hard 300s 不可逾越 + 调用方可选，取 min。防遗忘：60 分钟未消费→stale→一句话摘要降级到 L1。6 种预定义类型（character_creator/outline_planner/chapter_writer/chapter_reviewer/foreshadow_analyzer/principles_generator）+ `.writer/subagents/*.yaml` 自定义。三种记忆模式：independent/inherit/readonly。嵌套≤2，失败重试 1 次（副作用需幂等）。

## 11. Hook / 插件系统（docs/plugin-design.md）

配置式优先（YAML + Prompt 模板），四种类型：programmatic（内置代码回调）/ **llm_task**（事件触发渲染模板调 LLM，output display/store/silent）/ **context_inject**（上下文组装时注入文件，默认优先级 7.5、token_budget 500，参与裁剪）/ script（远期）。触发事件：chapter:confirmed/created/deleted、writing:start、outline:updated、character:created/updated/deleted、agent:idle、session:start/end。核心后处理硬编码不可禁用，用户 Hook 在其后；错误隔离 + 超时 60s + YAML 热重载。

## 12. 事件总线（src/bus/）

**Outbox 模式**：业务写与事件插入同一 SQLite 事务，提交后 OutboxPoller 轮询（3s/批 50/认领 10s 超时）at-least-once 投递，崩溃可重投。重试 3 次耗尽→死信队列 `dead_letter_events`（payload 保留，管理端点手动重试，dead 终态保 7 天）。作用：业务事务成功与事件送达解耦。

## 13. 伏笔追踪（writing-workflow.md §6.2/§10）

生命周期 `planned → planted → resolved/abandoned`（+消化产生的 seed 态），一条记录全程跟踪：planned/planted/resolved 三章 ID + 描述 + milestones（reinforcement/partial_reveal/callback/red_herring）+ planned_resolution_hint。**双触发**：写作前 foreshadow-suggest（基于大纲节拍建议本章设/收）+ 保存后 foreshadow-detect（扫正文检测未追踪伏笔 + 已有伏笔中间事件）。自动管线（chapter:content_finalized 触发）：幂等键 plotId+chapterId+type、仅强化不改状态、单次保存≤5 条。状态更新「信任+确认」：AI 自动标记用户可撤回。完整性报告红黄灰三色。已 planted 不可删需先 abandon。

**章节确认后异步后处理链**：摘要生成（懒生成兜底）/ 人物摘要 hook / 伏笔状态+检测 / RAG 索引 / 事件建议；同内容 120s 冷却节流；维护前强制 settle 收敛（读己之写：取消防抖 + hash 锚定 + inflight 轮询）。

## 14. DSH 复刻映射

### 14.1 dsh 已有对应物（直接复用，不重建）

| novel-writer 子系统 | dsh 对应物 |
|---|---|
| ai_sessions + chat_messages/parts 消息存储 | dsh session 持久化（SessionEventMap，Part 级） |
| 两层压缩 / exclude_messages / compact_memory | dsh compaction 子系统 |
| SubAgent 委派（delegate/run/wait/cancel） | dsh subagent + workflow（in-process/acp 等 provider） |
| web_search / web_fetch + 去重限速 | dsh 内置同名工具 |
| ask_user / 权限确认 | dsh ask_user_question + approval 子系统（tools/pre-execute waterfall） |
| 文件读写 / 外部编辑检测 | dsh fs 工具（read/write/edit）+ workspace 子系统 |
| YAML Hook 的 context_inject / SubAgent 类型 prompt | dsh **skill**（Markdown 指令，`<name>/SKILL.md` + frontmatter） |
| 灵感/准则等操作指引 | dsh skill（项目 `.dsh/skills/`，rank 最高） |
| 多 Provider / 流式 / Token 估算 | dsh llm 能力缝（deepseek/pi-ai adapter） |
| 桌面/Web/TUI 多客户端 | dsh web client + host（无需自建前端） |
| 日志三通道 / requestId | dsh otel/telemetry |

### 14.2 需要自建的领域层（做成插件包）

1. **领域存储 Service**（核心）：projects/chapters/characters/plot_points（伏笔状态机）/ideas/key_events/pending_facts/versions 等 Repository。可借 dsh storage 缝（json/sqlite provider）；是否保留 SQLite 由原设计意图（Markdown 优先）决定——最小方案：Markdown 为 SoT + 旁挂索引（hash/摘要/状态），即把 SQLite 角色降为派生缓存，重启可重建。
2. **写作引擎插件**：write_chapter 工具（四模式 + rewrite 补丁协议）、ContextAssembler（预注入清单 + 分层注入 + 窗口化大纲 + 优先级裁剪）、Prompt 模板引擎。
3. **伏笔子系统**：双触发 + 状态机 + milestones + 完整性报告；可挂 dsh 事件（工具执行后钩子）+ 领域 Service。
4. **RAG 检索**：chunker/embedder/sqlite-vec+FTS5 hybrid+RRF（dsh 无向量检索，需自建或做 storage provider 扩展）。
5. **领域记忆模型**：L0-L3 + project_state 快照 + 跨会话 project scope——dsh compaction 之上叠加语义（可用 sessionProjections 持久化 project_state）。
6. **领域事件**：chapter:confirmed 等领域事件 + outbox/死信——若全部进程内同步，可简化为 dsh typed events + waterfall；outbox 仅在需要跨进程/崩溃恢复时保留。
7. **审稿/反向分析/世界观一致性/灵感消化**：独立 LLM 任务，做成工具 + skill 指令。
8. **导出**：TXT/ePub/HTML 工具。
9. **统计**：writing_stats（按日字数）。

### 14.3 建议的插件切分（遵循 dsh 能力缝）

- `dsh-writer-core`（Service Definition）：`ctx.writer` 领域服务 + 领域事件（writer/chapter-confirmed 等）
- `dsh-writer-store`（Provider）：Markdown SoT + 索引/缓存实现
- `dsh-writer-tools`（Consumer）：read/update/write_chapter/review/foreshadow/ideas 等 defineTool 注册
- `dsh-writer-rag`（Provider）：向量+FTS5 混合检索服务
- `dsh-writer-skills`（bundled skills）：写作流程指令（章节写作规范、审稿维度、伏笔规则、灵感消化流程）
- `dsh-writer-bundle`：组合包，cordis.patch.yml 挂载以上全部

关键取舍：novel-writer 的通用运行时能力（会话/压缩/子代理/网络/权限/多客户端）**全部让位给 dsh 宿主**，只复刻领域层；Hook 系统尽量用 skill + 事件钩子替代，减少自建面。

## 15. 溯源索引

| 主题 | 路径（相对 references/novel-writer/） |
|---|---|
| 架构摘要（最全） | `AGENTS.md`、`CLAUDE.md` |
| 产品愿景 | `docs/product-vision.md` |
| 8 阶段流程 | `docs/writing-workflow.md` |
| 章节写作 | `docs/chapter-writing-design.md` |
| 交互/工具/权限 | `docs/interaction-design.md` |
| 数据模型 | `docs/data-model.md`、`packages/writer/src/storage/` |
| AI 与 RAG | `docs/ai-and-rag.md` |
| 记忆分级 | `docs/memory-and-context-design.md` |
| SubAgent | `docs/subagent-design.md` |
| Hook/插件 | `docs/plugin-design.md` |
| Agent Pipeline | `docs/agent-pipeline-design.md` |
| 用户手册 | `docs/manual/`（7 份） |
