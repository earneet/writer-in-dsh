# writer-in-dsh 实现规划：插件划分、职责与依赖

> 依据：`references/novel-writer-analysis.md`（功能分析）、`docs/novel-writer-review.md`（五轮审查定稿的吸纳/简化/抛弃/新增裁定）。**审查发现的问题一律改进后实现，不照单复制**（对应改进点在各节标注「R-改进」））。
> 形态约束：全部遵循 dsh 能力缝三分法（Service Definition / Provider / Consumer），见 `references/dsh-plugin-research.md`。

## 0. 总体结构：1 库 + 6 插件 + 1 组合包

```
packages/
├── writer-domain/     # 纯函数域库（无 dsh.bundle，供 import，不出现在 cordis 行）
├── writer-core/       # Service Definition：ctx.writer + 领域事件【插件】
├── writer-store/      # Provider：Markdown SoT 存储 + 派生索引【插件】
├── writer-engine/     # Provider：写作引擎 + 维护 pass + 一致性检查【插件】
├── writer-tools/      # Consumer：面向模型的工具注册【插件】
├── writer-skills/     # bundled skills（技能资产 + 注册插件）【插件】
├── writer-export/     # Consumer：TXT/ePub/HTML 导出【插件】
└── writer-bundle/     # 组合包：cordis.patch.yml 挂载以上全部【bundle】
```

**包计数：8 个包 = 1 个共享库 + 6 个功能插件 + 1 个组合包**。RAG 与 guard 为后续增量（见 §8），首版不建空壳。

## 1. 各插件职责

### 1.1 `writer-domain`（纯函数域库，无副作用）

**不含 dsh.bundle**，是其余包的公共依赖（普通 npm 库形态，`dsh plugin` 装它只作依赖）。内容全部为纯函数/类型，可独立单测：

- 实体类型：Project / Principles / OutlineNode（含 volume 卷级）/ Chapter（含 storyline/POV、故事内时间锚）/ Character（含关系邻接、状态时间线条目）/ PlotPoint（伏笔状态机）/ KeyEvent（含 stale）/ Idea / StyleRef / WritingStat。
- frontmatter 解析与序列化（gray-matter 语义自实现，避免依赖）；content_hash 规范化（正文 + frontmatter 稳定序列化）。
- 伏笔状态机 `planned→planted→resolved/abandoned` + milestones 纯转换函数（非法迁移抛错）。
- rewrite 补丁协议：`{find,replace}` 锚点匹配（空白归一、唯一命中才替换）、丢句守卫（原句保留率检测）、补丁不命中降级。
- 上下文组装器（纯函数）：输入实体集 + 模型窗口预算 → 预注入清单（principles 全量、本章大纲永不截断、窗口化大纲降级序、前文按线感知注入、防剧透过滤、人物精简摘要、伏笔指令、事件注入）。预算是**参数**而非常量（R-改进：32K 时代精打细算层不复制，大窗口直接注原文）。
- 维护 pass 的分节 JSON schema 定义 + 抽取引用存在性校验函数（章节/人物/伏笔 id 必须存在于实体集，否则拒收该节——R-改进：堵原项目「引用脏值致入库失败」复发病）。
- 事件/时间锚的矛盾检测纯函数（结构化时间锚比较，供一致性检查用）。

### 1.2 `writer-core`（Service Definition）

导出**抽象服务基类** `WriterService`（Cordis 惯例：定义包导出抽象基类与事件声明，由 Provider 包继承实现——core 自身不发布 `ctx.writer` 实例），含 `ctx.writer` 的接口类型（declaration merging）与 typed events：

- 只读接口：`getProject()` / `listEntities(kind, query)` / `getEntity(kind, id)` / `assembleContext(chapterId, opts)`（委托 domain 组装器）。
- 写接口：`saveChapter()` / `saveEntity()`（统一走 store，返回 diff + 新 content_hash）。
- 领域事件（typed events，进程内同步，无 outbox——R-改进：抛弃微服务三件套）：`writer/chapter-saved`、`writer/entity-updated`、`writer/outline-changed`。
- **本包不实现存储与 LLM**，仅定义契约 + 事件；被 store 继承、被 engine/tools/export 注入。

### 1.3 `writer-store`（Provider）

实现并发布 `ctx.writer`：default-export 继承 core 抽象基类的 `WriterStoreService`（服务就绪后 engine/tools 的 inject 才放行）：

- **Markdown SoT**：项目目录布局 `writer.yaml`、`principles.md`、`outline.md`、`chapters/{NNN}-{title}.md`、`characters/{name}.md`、`worldbuilding/*.md`、`plots/*.md`、`events.md`、`ideas.md`、`style/*.md`、`.writer/index/`（派生索引目录，gitignore）。
- **原子写**（temp + rename，R-改进：半写文件是索引可重建的隐性破坏者）+ content_hash 乐观锁（update 前强制 read，双校验）。
- **派生索引**：`.writer/index/index.json`（实体清单、hash、章节卷/线归属、字数统计）——**纯缓存，删除后 `writer.rebuildIndex()` 全量重建**（R-改进：不复制 SQLite 双写事务，索引失败标脏不阻塞写作）。
- 外部编辑检测：read 时 hash 对比 + 依赖宿主 workspace 文件事件（若可用；开放项，被动 hash 兜底——见 review §5）。
- `inject: ['writer']`（core 的服务定义）。

### 1.4 `writer-engine`（Provider）

default-export `WriterEngineService` 发布 `ctx.writerEngine`（写作/审稿/一致性/维护 pass 的领域 LLM 编排；全部 LLM 经宿主 `ctx.llm` 缝调用——R-改进：插件内直连 SDK 会使 watchdog/abort 论证失效）：

- **write_chapter 三模式**：full（整章 + 工具白名单上下文）/ assist（轻上下文续写）/ rewrite（补丁协议优先、大改回退全文）。manual 无需引擎（直接 store 保存）。**节拍模式不做**（R-改进：降为可选后置，首版不实现）。
- **维护 pass（保存后异步）**：**默认两次调用**——①章节摘要（流畅文本）②事实/伏笔/人物状态抽取（分节 JSON schema + 引用存在性校验 + 按节重试）；产出写回派生数据 + Markdown 待办清单（`pending.md`）供人确认（R-改进：不复制六维抽取管道与 settle/水位/幂等全套加固；抽取节做存在性校验根治引用脏值）。
- **一致性检查**：全书（plot/outline/key_events/principles vs 已写章节）+ 世界观条目间/条目 vs 章节；输出结构化矛盾报告（预览不自动持久化）。**改进原项目已知缺陷**：原实现 12 章/8000 字截断且维度与契约不符（w10 审计）——改为按预算分批检查、维度与 schema 对齐。
- **改稿期一致性（新增，最高优先领域缺口）**：`recomputeDerived(chapterId | range)` 标记/重算下游派生物（摘要、人物状态时间线、伏笔 milestone、事件描述）；与原 impact-analysis 语义合并。
- 人物状态时间线维护（新增 #4 缺口）；断更恢复快照（从章节/事件派生项目快照 Markdown，时距取 git log 时间）。
- `inject: ['writer', 'llm']`；对外接口：`writeChapter()` / `reviewChapter()` / `consistencyCheck()` / `maintenancePass()` / `recomputeDerived()` / `recoverySnapshot()`。

### 1.5 `writer-tools`（Consumer）

`defineTool` 注册面向模型的工具（全部工具体观测 `exec.signal`，中止时尽快结算）：

| 工具 | 说明 |
|---|---|
| `writer_read(entity, params?)` | 通用读，entity 白名单裁剪（写作子代理白名单单独配置） |
| `writer_update(entity, {action}, modifications)` | 通用写，read-before-update + content_hash 双校验，返回 diff/warnings |
| `write_chapter(mode, ...)` | 委托 engine；progressive 进度经 tool 输出 |
| `review_chapter(chapter_id, focus?)` | 3+1 维审稿（ReviewSuggestion 结构化契约，quote 定位 + rewriteOption） |
| `consistency_check(scope)` | 委托 engine 一致性检查 |
| `recompute_derived(chapter_range)` | 改稿期一致性 |
| `writer_stats()` / `archive_point()` | 统计/日更目标；显式存档点（git commit，默认不自动提交——R-改进） |
| `export_book(format, options)` | 委托 writer-export |

权限：allow/ask 经 `tools/pre-execute` 类型化决策 + `ctx.tools.guard()`（`writer_update` destructive action、`export_book` 默认 ask；R-改进：不建 PermissionManager，落点在 pre-execute 决策层而非 policy 旋钮）。
`inject: ['writer', 'writerEngine', 'tools']`（write_chapter/review/consistency/recompute 委托 engine；export 委托 writer-export）。

### 1.6 `writer-skills`（bundled skills + 注册插件）

注册 bundled skill provider（`BUNDLED_SKILL_RANK` + `resourceBase` 指向资产目录）：

- `writer-onboarding`：创作起步 checklist（8 阶段降为叙事引导，非流程状态机——R-改进）。
- `chapter-writing`：章节写作规范（含防剧透规则、伏笔指令格式、风格示范用法）。
- `foreshadow-guide`：伏笔状态机语义、milestones 类型、完整性报告使用。
- `review-guide`：审稿 3+1 维度定义与建议格式。
- `reverse-reference`：参照小说学习流程（原反向分析参照模式，不建表）。

### 1.7 `writer-export`（Consumer）

TXT / HTML（打印 PDF）/ ePub 导出；按卷组织、可选含人物小传/大纲；XSS/XML 转义；可独立禁用（不阻塞核心写作）。`inject: ['writer']`。

### 1.8 `writer-bundle`（组合包）

`dsh.bundle` + `cordis.patch.yml` 按依赖序挂载：core → store → engine → skills → export → tools（tools 最后，确保注入就绪）。用户 profile 一行安装：`dsh plugin add dsh-writer-bundle`。

## 2. 共同依赖

| 依赖 | 类型 | 使用方 |
|---|---|---|
| `@deepseek-ai/cordis` | peer + dev（全部插件包） | 所有包（Context/Service/事件） |
| `@deepseek-ai/dsh-tools` | peer + dev | writer-tools（defineTool） |
| `dsh-writer-domain` | workspace 依赖（普通库） | core/store/engine/tools/export |
| `dsh-writer-core` | workspace 依赖 | store/engine/tools/export（注入 `ctx.writer`） |
| gray-matter 语义 | **不引入**，frontmatter 解析在 domain 自实现 | —（避免外部解析器依赖，掌控规范化） |
| 宿主 `ctx.llm` / `ctx.tools` / skills 机制 / approval | 运行时注入，非包依赖 | engine/tools |

依赖图（无环）：`domain ← core ← store ← engine ← tools`；`export`、`skills` 并列挂 core/store。

## 3. 明确不做（复用宿主，R-改进：复杂度大头全部卸载）

会话持久化/消息历史、上下文压缩、subagent、web_search/web_fetch、流式 watchdog（`streamIdleTimeoutMs`）、超时/重试策略、ask_user、多客户端 UI、outbox/死信、HookEngine、四层记忆、token 微观管理、版本表（git 覆盖）。

## 4. 数据与存储设计要点（R-改进汇总）

1. Markdown SoT；frontmatter 承载状态（伏笔状态、事件 stale、章节卷/线/时间锚、人物关系邻接清单）。
2. 原子写 + content_hash 乐观锁；派生索引可全量重建。
3. 卷级节点、storyline/POV、结构化时间锚从第一版就进 schema（R-改进：原项目结构性缺失，事后补成本高）。
4. 人物状态时间线 = 显式派生数据（随章节维护），兼作改稿重算与弧线追踪载体。

## 5. 分阶段落地

| 阶段 | 内容 | 验收 |
|---|---|---|
| P1 骨架 | domain + core + store + tools(writer_read/writer_update) + bundle + onboarding skill | 一个 profile 安装后，模型能读写示例项目的 Markdown 实体，索引可重建 |
| P2 写作 | engine 三模式 + 上下文组装 + review + 伏笔工具 + chapter-writing/foreshadow skill | 模型按准则+大纲生成一章，rewrite 走补丁协议 |
| P3 治理 | 维护 pass（两次调用）+ 一致性检查 + recompute_derived + stats + export | 保存章节点亮派生数据与待办清单；改稿后可重算下游 |
| P4 增量 | RAG 检索包（混合检索、可换 embedding 后端）+ guard（业务错误预算，tools/post-execute）+ 节拍模式评估 | 按需，验收另定 |

## 6. 风险与开放项（承接 review §5）

- 宿主文件变更事件是否可复用（FileWatcher）→ P1 用被动 hash 兜底。
- reasoning 模型长思考与宿主 watchdog 的相容性 → P2 实测一次。
- embedding 对中文小说语料效果 → P4 先关键词（FTS/grep）后向量，后端可换。
- 维护 pass 单次合并优化 → 仅当两次调用实测不可接受时评估。

## 7. 自我复审（规划完成后执行）

见 §8 迭代记录；对抗审查结论逐条二次确认后修订。

## 8. 迭代记录

- 轮次 0（完成）：初稿（本文档）。
- 轮次 1（进行中）：自我复审修正 3 处（core 改为抽象基类 + 事件声明、store 为服务实现发布方、engine 发布 `ctx.writerEngine` 并明确对外接口）；对抗审查进行中。
