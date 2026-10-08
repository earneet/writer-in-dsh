# writer-in-dsh 实现规划：插件划分、职责与依赖

> 依据：`references/novel-writer-analysis.md`（功能分析）、`docs/novel-writer-review.md`（五轮审查定稿的吸纳/简化/抛弃/新增裁定）。**审查发现的问题一律改进后实现，不照单复制**（对应改进点在各节标注「R-改进」））。
> 形态约束：全部遵循 dsh 能力缝三分法（Service Definition / Provider / Consumer），见 `references/dsh-plugin-research.md`。

## 0. 总体结构：1 库 + 8 插件 + 1 组合包

```
packages/
├── writer-domain/     # 纯函数域库（无 dsh.bundle，供 import，不出现在 cordis 行）
├── writer-core/       # Service Definition：ctx.writer + 领域事件【插件】
├── writer-store/      # Provider：Markdown SoT 存储 + 派生索引【插件】
├── writer-engine/     # Provider：写作引擎 + 维护 pass + 一致性检查【插件】
├── writer-tools/      # Consumer：面向模型的工具注册【插件】
├── writer-skills/     # bundled skills（技能资产 + 注册插件）【插件】
├── writer-export/     # Consumer：TXT/ePub/HTML 导出【插件】
├── writer-rag/        # Provider：混合检索（关键词 + 可选语义档），发布 ctx.writerRag【插件】
├── writer-guard/      # Consumer：工具业务错误预算（tools/post-execute 观测）【插件】
└── writer-bundle/     # 组合包：cordis.patch.yml 挂载以上全部【bundle】
```

**包计数：10 个包 = 1 个共享库 + 8 个功能插件 + 1 个组合包**（P4 起 rag/guard 入列）。

## 1. 各插件职责

### 1.1 `writer-domain`（纯函数域库，无副作用）

**不含 dsh.bundle**，是其余包的公共依赖（普通 npm 库形态，`dsh plugin` 装它只作依赖）。内容全部为纯函数/类型，可独立单测：

- 实体类型：Project / Principles / OutlineNode（含 volume 卷级）/ Chapter（含 storyline/POV、故事内时间锚）/ Character（含关系邻接、状态时间线条目）/ PlotPoint（伏笔状态机）/ KeyEvent（含 stale）/ Idea / StyleRef / WritingStat。
- frontmatter 解析与序列化（gray-matter 语义自实现，避免依赖）；content_hash 规范化（正文 + frontmatter 稳定序列化）。
- 伏笔状态机 `planned→planted→resolved/abandoned` + milestones 纯转换函数（非法迁移抛错）。
- **领域公理（显式约束函数）**：①「未写章节大纲自由调整 / 已写章节情节变更须一致性检查」二分（`assertOutlineEditable(chapter)`：已写章节的大纲变更必须携带 consistency 标记）；② ideas→plot_points→outline **单向流**（plot 可溯源 idea，反向仅经「整理」入口，禁止 outline 直接改写 ideas 原文）。
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
- **维护 pass（保存后异步）**：**默认两次调用**——①章节摘要（流畅文本）②事实/伏笔/人物状态抽取（分节 JSON schema + 引用存在性校验 + 按节重试）；产出写回派生数据 + Markdown 待办清单（`pending.md`）供人确认（R-改进：不复制六维抽取管道与水位/幂等键体系；**保留轻量收敛语义**——同章 inflight 去重 + 完成 hash 锚定，防重复触发读己之写）。
- **一致性检查**：全书（plot/outline/key_events/principles vs 已写章节）+ 世界观条目间/条目 vs 章节；输出结构化矛盾报告（预览不自动持久化）。**改进原项目已知缺陷**：原实现 12 章/8000 字截断且维度与契约不符（w10 审计）——改为按预算分批检查、维度与 schema 对齐。
- **改稿期一致性（新增，最高优先领域缺口）**：`recomputeDerived(chapterId | range)` 标记/重算下游派生物（摘要、characterStates 建议、伏笔事件建议）；与原 impact-analysis 语义合并。（P5 起：人物状态时间线升格为 frontmatter `timeline` 字段、由人确认维护，不在 recompute 派生面内，见 §8 轮次 10。）
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
| `foreshadow_update(id, action, ...)` | 伏笔状态机（plant/resolve/abandon/milestone，走 domain 纯转换；P2 落地，此处补记） |
| `consistency_check(scope)` | 委托 engine 一致性检查 |
| `recompute_derived(chapter_range)` | 改稿期一致性 |
| `writer_stats()` / `archive_point()` | 统计/日更目标；显式存档点（git commit，默认不自动提交——R-改进） |
| `export_book(format, options)` | 委托 writer-export |
| `writer_search(query, chapter_limit?)` | 委托 writer-rag 混合检索（P4；rag 缺席返回「检索插件未启用」降级；chapter_limit 启用防剧透过滤） |

权限：allow/ask 经 `tools/pre-execute` 类型化决策 + `ctx.tools.guard()`（`writer_update` destructive action、`export_book` 默认 ask；R-改进：不建 PermissionManager，落点在 pre-execute 决策层而非 policy 旋钮）。
`inject: ['writer', 'tools']`（write_chapter/review/consistency/recompute 委托 engine；export 委托 writer-export）。**engine 为可选依赖**：经 `ctx.get('writerEngine')` 获取（dsh 惯例：可选服务用 `ctx.get` 而非 inject 属性代理），缺席时写作类工具正常注册但执行返回「引擎未启用」——保证 P1 仅装 core+store+tools 即可跑通读写闭环（第 1 轮对抗审查修正的注入断链）。

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

`dsh.bundle` + `cordis.patch.yml` 按依赖序挂载：core → store → engine → skills → export → rag → guard → tools（tools 最后，确保注入就绪；rag/guard 可独立禁用——从清单移除即关闭）。用户 profile 一行安装：`dsh plugin add dsh-writer-bundle`。

### 1.9 `writer-rag`（Provider，P4）

default-export `WriterRagService` 发布 `ctx.writerRag`（`inject: ['writer']`），混合检索——关键词先行（domain 自实现 CJK bigram TF-IDF，不引入分词/FTS 重依赖）→ 可选语义档（`embeddingBackend` 三档 Config 驱动：`none` 关键词即止 / `llm` 宿主 llm 缝对关键词候选块打相关性分（宿主无 embedding API 的现实形态）/ `external` OpenAI 兼容 embeddings 端点 + 余弦相似）→ RRF 融合。检索对象 = 章节原文切片 + 新鲜派生摘要（sourceHash 锚定）+ 人物/伏笔/世界观条目；corpus 每查询现建（novel 级规模足够）。防剧透：`chapterLimit` 服务端块级过滤（与组装器同红线：未来章不可见、未回收晚置伏笔剔除）。消费方（engine 组装增强、tools `writer_search`）经 `ctx.get('writerRag')` 可选消费，缺席即检索增强关闭不阻塞写作。

### 1.10 `writer-guard`（Consumer，P4）

函数插件（`inject: ['tools']`），`tools/post-execute` 观测：按滚动窗口统计受观测写作工具的可分类业务失败率（乐观锁冲突/解析失败/引用拒收/非法迁移/实体不存在/参数校验，分类纯函数在 domain `guard.ts`），超预算向该次工具决策附加纠偏提示（`additionalContexts`，范式参照宿主 repeat-tool-reminder：先委托再折入，block 变体同样携带）。**不熔断**（绝不 deny/block 工具调用）、不重复造宿主轮子（重试/超时/权限归宿主）；软失败（返回错误文案字符串）同样分类计数。可独立禁用：不装包即无观测。

## 2. 共同依赖

| 依赖 | 类型 | 使用方 |
|---|---|---|
| `@deepseek-ai/cordis` | peer + dev（全部插件包） | 所有包（Context/Service/事件） |
| `@deepseek-ai/dsh-tools` | peer + dev | writer-tools（defineTool） |
| `dsh-writer-domain` | workspace 依赖（普通库） | core/store/engine/tools/export |
| `dsh-writer-core` | workspace 依赖 | store/engine/tools/export（engine/tools 对 `ctx.writer` 为必选注入；tools 对 `ctx.writerEngine` 为可选 `ctx.get`） |
| gray-matter 语义 | **不引入**，frontmatter 解析在 domain 自实现 | —（避免外部解析器依赖，掌控规范化） |
| 宿主 `ctx.llm` / `ctx.tools` / skills 机制 / approval | 运行时注入，非包依赖 | engine/tools |

依赖图（无环）：`domain ← core ← store ← engine ← tools`；`export`、`skills` 并列挂 core/store。

## 3. 明确不做（复用宿主，R-改进：复杂度大头全部卸载）

会话持久化/消息历史、上下文压缩、subagent、web_search/web_fetch、流式 watchdog（`streamIdleTimeoutMs`）、超时/重试策略、ask_user、多客户端 UI、outbox/死信、HookEngine、四层记忆、token 微观管理、版本表（git 覆盖）。

## 4. 数据与存储设计要点（R-改进汇总）

1. Markdown SoT；frontmatter 承载状态（伏笔状态、事件 stale、章节卷/线/时间锚、人物关系邻接清单）。
2. 原子写 + content_hash 乐观锁；派生索引可全量重建。
3. 卷级节点、storyline/POV、结构化时间锚从第一版就进 schema（R-改进：原项目结构性缺失，事后补成本高）。
4. 人物状态时间线 = character frontmatter 的 `timeline` 字段（**人确认后的权威 SoT**，随章节维护，P5 起）；维护 pass 的 characterStates 派生缓存是**建议**，经 pending.md 提示升格到 timeline。兼作改稿核对与弧线追踪载体。

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
- 轮次 1（完成）：自我复审修正 3 处（core 改为抽象基类 + 事件声明、store 为服务实现发布方、engine 发布 `ctx.writerEngine` 并明确对外接口）；宿主先例预检（抽象基类 17 例、pre-execute ask 机制、llm 直连路径）。对抗审查（初版委派超时中断后收窄重发）返回 3 组发现，逐条二次确认全部成立并修订：① P1 注入断链——tools 的 engine 改可选 `ctx.get`；② §6.1-14 settle 收敛语义恢复为轻量版（inflight 去重 + hash 锚定）；③ §6.1-7 二分公理与 §6.1-11 单向流补显式领域约束函数。审查同时确认：§6.1/§6.4 无遗漏、§6.3 无偷建、依赖图无环、P1-P3 验收可检验。**裁定：修订后可用（已修订），规划定稿。**
- 轮次 2（完成·P1 实现收口）：P1 四包 + dev overlay + 示例项目落地；环境坑修复（npm workspaces 需与 dsh 同版本 0.2.0-rc.2 否则实例分裂致调度器崩、install-scripts 需 approve）；dsh headless/web 双环境端到端实测通过（读写/乐观锁/陈旧 hash 拒绝/"new" 覆盖拒绝）。对抗审查（1 高 7 中 7 低）逐条复核全部成立并修复：H1 store 显式 create 语义、M1/M2 frontmatter 值 JSON 引号化 + hash 规范化、M4 索引 in-flight 去重、M5 get 直读磁盘、M6 tools 补 core 依赖、M7 worldbuilding kind 补入、L1 rename 清理、L2 Windows 保留名、L5 注释修正；另发现并修复 hash 自锁 bug（指纹以落盘文本回解为准）。测试：domain 12 + store 9 = 21 全过（node --test）。
  - **记录的偏离与已知限制**：① 派生索引为纯内存（规划 §1.3 的 `.writer/index/` 磁盘索引推迟——索引本是可重建缓存，P1 规模内存足够；get 已直读磁盘保证新鲜度）；② P1 验收项 bundle + onboarding skill 未含在本批（下一步 P1.5）；③ 章节命名实现为 `{id}.md`（三位序号即 id，标题在 frontmatter，未做格式强校验）；④ 并发 save 的 TOCTOU（单用户可接受，P2 以 (kind,id) promise 链串行化）；⑤ parseFrontmatter 对「无 frontmatter 但正文以 --- 开头」的外部文档存在已知边界（自产文件恒有结尾换行不触发）；⑥ 工具体暂未观测 exec.signal（P1 全为快速 fs 操作，P2 长工具接入）；⑦ 无 fsync（崩溃掉电窗口，与原子写配合风险极低，记录）。
- 轮次 3（完成）：第 2 轮裁定收敛但提 N1-N3（坏文件毒化索引/前导零漂移/project store 层只读），复核成立全修；第 3 轮发现 N1 残留入口（单文件实体坏 frontmatter 无隔离），修复 + 回归测试（24 全过）。
- 轮次 4（完成）：第 4 轮发现 package.json 因 PowerShell 反引号换行事故损坏（npm scripts 全不可用，此前测试绕过 npm 掩盖），修复并实证 npm run test/typecheck 恢复。
- 轮次 5（完成·收口）：第 5 轮终验——package.json 合法、npm run test 24/24、typecheck 零错、无新问题，**裁定收敛，P1 收口**。收口前最后 e2e（headless + overlay，character 读取）复验通过。审查循环累计：5 轮对抗审查、每条结论均经逐条复核、修复 12 项（H1×1/M×8/L×3）+ 环境坑 2 项（npm 实例分裂、install-scripts）。
- 轮次 6（完成·P1.5 收口）：补齐 P1 验收缺口并跑通正式分发形态。新增两包：`writer-skills`（bundled skill provider，仿 dsh `skill-badge` 范式；资产 `assets/<name>/SKILL.md` 的 frontmatter 为候选元数据单一真源，apply 期同步加载并严格校验，坏资产响亮失败；含 `writer-onboarding` 技能——8 阶段叙事引导 + read-before-update 写作纪律，阶段 7/8 标注后续版本能力）与 `writer-bundle`（`dsh.bundle.patch` + `cordis.patch.yml` 挂载 store→skills→tools；projectRoot 默认 `!!js process.cwd()`，更高层 patch 可覆盖）。验证三线全过：单测 27/27 + typecheck 零错；overlay + headless（技能发现/加载 + 实体读取）；**正式 profile 分发形态**（`dsh plugin add` 逐包 link: 安装进独立 profile → `--dump-config` 组合树核对 → web profile 启动 200 → headless 变体 profile 下模型实测：bundled 技能加载、实体读取、乐观锁写入闭环）。对抗审查两轮：首轮 2M+4L，逐条复核成立并修复 M1（file URL 手拼跨平台缺陷 → `pathToFileURL`）、M2（技能文档教模型省略 id 读单文件实体 → 补 `id="project"`）、L1（阶段 7/8 标注）、L2（补响亮失败测试 3 例）；L3/L4 记录不改。二轮确认修复正确，新发现 1L（空目录报错消息应引用注入根而非固定常量）已修并复测。**裁定收敛，P1.5 收口。**
  - **记录的偏离与已知限制**：① core 为纯契约包（无 apply），不上 cordis 插件行、仅作依赖安装——与 §1.8 字面挂载序「core → store → …」偏离，实际行序 store→skills→tools；② projectRoot 默认取 dsh 启动目录，用户须在小说项目目录启动（或更高层 patch 显式覆盖）；③ 分发验证采用**本地目录 link: 安装**（npm publish 未做）：writer-bundle 的 `private: true` 与 `*` 依赖阻断 §1.8 的 registry 安装路径，发布前需去 private、依赖改精确范围并补 `lib/` 预构建（当前 main 指 TS 源码，靠宿主 tsx 加载）；④ `isDirectory()` 对 symlink 目录返回 false，特定链接形态下资产目录可能被静默跳过（当前布局不触发）；⑤ 新环境坑三则：pnpm 12 在本机因盘符根锁目录（`C:\pnpm-store-operation-locks`）EPERM 完全不可用，须用 pnpm 10；`plugin add` 新建的 profile 只含 base + 功能 bundle 时**无 app 入口**会无限空转（进程空转无输出、不报错），须另装 app bundle；npm 源上 app 包（dsh-web-app 等）默认解析到不兼容旧版 0.0.1-rc.1，必须钉 `@0.2.0-rc.2`（轮次 2 依赖版本教训的再确认）。
- 轮次 7（完成·P2 收口）：P2 写作阶段落地。**writer-engine** 新包（Provider，`inject: ['writer','llm']`，default-export 继承 core `EngineService`）：`writeChapter` 三模式——full（整章 + 建章 frontmatter）/ assist（轻预算续写追加）/ rewrite（补丁协议优先，`{"patches":[{find,replace}]}` 空白归一唯一命中替换；全不命中降级一次全文；全文路径跑丢句守卫）+ `reviewChapter`（3+1 维：情节/人物/设定一致性 + 文学质量，`ReviewSuggestion` 结构化报告，预览不落盘）；LLM 全经宿主 `ctx.llm.stream`（BlockAssembler + finish 穷尽处理），provider/model/温度/maxTokens/上下文预算全为 Config 字段；落盘走 store 乐观锁，emit `writer/chapter-written`。**domain** 新增纯函数：`applyRewritePatches`（锚点唯一命中、跳过原因记录、链式应用）、`parseRewriteModelOutput`、`splitSentences`/`detectDroppedSentences`（原句保留率逐句告警）、`assembleWritingContext`（预算参数化；principles 全量 + 本章大纲永不截断；伏笔指令 🔴本章必须设置/🔴逾期必须回收/🟡活跃分级；防剧透只注入序号小于本章的章节与未回收伏笔）、`extractChapterOutline`、`parseReviewReport`（栅栏剥离 + 逐条收敛非法项）、`parseMilestones`。**store**：save 以 (kind,id) promise 链串行化（关闭轮次 2 限制④ TOCTOU；失败不阻断后续排队）。**tools**：`write_chapter` / `review_chapter` / `foreshadow_update`（plant/resolve/abandon/milestone，走 domain 状态机 + milestones JSON），三个工具全部观测 `exec.signal` 透传引擎（关闭轮次 2 限制⑥）；engine 仍为可选 `ctx.get`。**skills**：新增 `chapter-writing`（三模式选择、防剧透纪律、伏笔指令格式、审稿先行工作流）与 `foreshadow-guide`（状态机语义、milestones 四类、工具用法、完整性自查）；onboarding 阶段 6/7 更新为实际工具能力。**bundle/overlay**：挂载序 store→engine→skills→tools，engine 默认路由 deepseek-official/deepseek-chat（更高层 patch 可覆盖）。验证：typecheck 零错；单测 46/46（domain 12+12 / store 14 / engine prompts 5 / skills 3）；overlay+headless 实测四场景——full 写第 2 章（大纲两条全落实、green-flame partial_reveal 指令注入生效）、review_chapter 7 条结构化建议、rewrite 命中补丁协议（1 命中 0 跳过、丢句守卫静默、未回退全文）、foreshadow_update 两步闭环（planned→planted + partial_reveal milestone，模型自发加载 foreshadow-guide 技能按纪律执行）；profile 复验（writer/writer-headless 安装 engine、`--dump-config` 组合树核对、headless 实测 review 通过）。对抗审查（3 subagent 并行：引擎代码 / 技能与提示词 / 测试充分性）首轮返回 H×2、M×8、L×10，逐条复核全部成立或裁定记录，修复 17 项：H1 审稿 quote 幻觉透传（prompt 承诺丢弃未实现）→ domain 新增 `filterSuggestionsByQuotes` + `filterSuggestionsByFocus` 接入 reviewChapter 并对齐 prompt 措辞；H2 rewrite 解析回退毁章（寒暄前缀/`{}` 落 fulltext 且无条件落盘）→ `parseRewriteModelOutput` 改宽容提取（栅栏或首{尾}子串 + 条目逐项校验）+ `assertRewriteFullTextPlausible`（全文以 `{` 开头拒绝落盘）；M 级：空补丁路径工具谎报「已保存」→ 未落盘文案、逾期 planned 伏笔指令与状态机矛盾（教模型 resolve 一个 planned）→ 改「必须设置（plant）」+ SKILL 同步、focus 维度不过滤 → 解析后过滤、前一章截断注释-代码矛盾 → 统一保头语义并收紧测试、预算测试空洞断言 → 收紧 + 新增真截断用例、optional 计费不含标题 → 计入、extractChapterOutline 吞后续非章标题 → 任意级别标题终止、rebuildIndex 不走去重 → 共享 indexPromise、parseMilestones 枚举/ note=null → 响亮失败/按省略、「三分之一句子」判据与「合并注入」措辞 → 改写、rewriteOption 简化注明；L 级：planned_chapter 脏值 NaN、丢句守卫无总数、列表短 hash 未标注等全修。engine 本体零测试 → 抽出 `src/logic.ts` 纯决策模块（validateWriteRequest / mergeFullFrontmatter / mergeAssistContent / decideRewritePath / assertRewriteFullTextPlausible / assertFinish，6 用例锁定 P2 核心决策树）。裁定不改：`hint` 字段纯文档化（frontmatter 开放键值，示例项目沿用）；bundle 默认 provider 无启动期可达性探测（adapter 动态注册时机不定，记为已知限制）；部分补丁命中即保存（patchStats 告警为设计选择）。修复后 typecheck 零错、单测 60/60（domain 12+19 / store 15 / engine 5+6 / skills 3）；回归 e2e（overlay+headless rewrite 小改）仍走补丁协议（1 命中 0 跳过）。二轮复审：委派复审员超时未收敛（已中断），改由主线逐项自查修复正确性（engine 三模式/决策树/双守卫/双过滤接线通读复核）+ 四重复读证据收口——typecheck 零错、60/60 单测、overlay 回归（rewrite 补丁协议 1 命中 0 跳过）、profile 回归（writer-headless 实测 assist 续写落盘，模型自发遵守 chapter-writing 技能「审稿先行」纪律）。**裁定收敛，P2 收口。**审查循环累计（本轮次）：2 轮（3 subagent 首轮 + 主线二轮自查），首轮 20 项发现逐条复核全部成立或裁定记录，修复 17 项。
  - **记录的偏离与已知限制（P2 新增）**：① rewrite 部分补丁命中即保存（跳过项经 patchStats 告警、工具输出含核对提示），不自动降级重试——设计选择，防循环放大；② bundle 默认 provider/model（deepseek-official/deepseek-chat）无启动期可达性探测（llm adapter 动态注册时机不定），路由错误延迟到首次引擎调用响亮报错；③ `hint` 为伏笔实体 frontmatter 的纯文档字段（开放键值，示例项目沿用，无代码读写）；④ 二轮复审员超时未收敛，收敛证据由主线自查 + 四重回归承担；⑤ npm test（node --test 多文件）在本开发沙箱因 spawn 受限不可用，单测以逐文件进程内方式执行（node <file>），与 CI/本机直跑等价；⑥ 环境坑再确认：dsh 启动需写 `~/.dsh/profiles`（沙箱外路径），headless 验证须在非工作区沙箱下运行；`--patch` 相对路径按启动目录解析，跨目录启动须用绝对路径。
- 轮次 8（完成·P3 收口）：P3 治理阶段落地，8 包形态补全（新增 `writer-export`）。**domain** 新增纯函数：`maintenance.ts`（维护 pass 分节 schema——facts/foreshadowEvents/characterStates 三节；`parseMaintenanceExtraction` 宽容提取；`validateExtractionSections` 引用存在性校验，引用不存在的实体 id 拒收该节并给出可读原因；`MaintenanceDerived` 含 sourceHash 锚）与 `consistency.ts`（`planConsistencyBatches` 按预算参数化贪心分批——无章数/字数硬截断，改进原项目 12 章/8000 字缺陷；`parseConsistencyBatchOutput` 引用全不存在的条目按幻觉丢弃计数；`detectTimeAnchorInversions`「第 N 日」锚倒序确定性检测）。**core**：EngineService 抽象扩展 `maintenancePass`/`consistencyCheck`/`recomputeDerived`；新增 `ExportService` 抽象（`ctx.writerExport`）与 `writer/maintenance-pass` typed event；WriterService 扩展派生缓存读写（`readDerived`/`writeDerived`/`deleteDerived`/`listDerived`）、`appendPending`、`root` getter。**store**：派生数据落 `.writer/derived/<kind>/<id>.json`（纯缓存，坏 JSON 按缺失处理不阻塞；kind/id 路径安全校验）；`appendPending` 原子追加 `pending.md`。**engine**：`maintenancePass`——同章 inflight Map 去重 + 完成 hash 锚定（派生 sourceHash 与当前章节一致返回 up-to-date 不调模型，防读己之写重复触发）；两次调用：①摘要（流畅文本）②抽取（分节校验 + 按节重试，`extractionRetries` 配置默认 2，重试预算耗尽保留已通过条目并告警）；产出写回派生 + `pending.md` 待办（伏笔事件/人物状态建议**不自动**改实体）；`autoMaintenance` 配置（默认开）挂 `writer/entity-saved` 异步触发。`consistencyCheck`——基准（principles 全量 + 大纲半预算截断 + 伏笔/事件摘要）+ 派生摘要新鲜则代正文扩批容量，逐批调 LLM 合并 issues，末尾并时间锚倒序确定性检测；报告预览不持久化。`recomputeDerived(range)`——mark（仅删过期派生）/recompute（强制重跑维护 pass）双模式，新鲜派生报 up-to-date。**tools** 新增五工具：`consistency_check`（scope 区间过滤 + 批次/截断标注渲染）、`recompute_derived`、`writer_stats`（卷分布/伏笔状态分布/维护派生覆盖率）、`archive_point`（git add+commit 显式存档点；`status --porcelain` 预检工作区干净优雅返回；默认一切路径不自动提交）、`export_book`（委托 `ctx.get('writerExport')`，缺席返回「导出未启用」）；`tools/pre-execute` 对 export_book 返回 `{kind:'ask'}` 默认确认路径（不自带 PermissionManager，审批策略与通道由宿主裁断）。**writer-export** 新包（Consumer，inject writer，发布 `ctx.writerExport`）：TXT/HTML（内嵌打印 CSS，浏览器打印 PDF）/ePub 2.0.1 三格式；按卷组织（frontmatter volume 缺省归「正文」卷）；全部动态值过 `escapeHtml`（XSS/XML 防线，正文为模型产物不可信）；ePub 用自实现 stored-only ZIP 构建器（CRC32 + 本地头 + 中央目录，mimetype 首条且不压缩满足 OCF）；可独立禁用（不装包即关闭，不阻塞核心写作）。**bundle/overlay**：挂载序 store→engine→skills→export→tools。验证：typecheck 零错；单测 94/94（新增 34：domain 14 / store 4 / engine 5 / export 11）；overlay+headless 实测——writer_stats 统计、recompute_derived 触发维护 pass 闭环（摘要 + 8 事实 + 伏笔/人物建议落 pending.md）、hash 锚定复跑 up-to-date、consistency_check 全书 1 批 6 条结构化矛盾（预览未持久化）、autoMaintenance 保存后异步生效（003 派生在改稿后自动刷新）、archive_point 成功存档 + 工作区干净幂等返回、export_book ask 路径 fail-closed（无审批通道时拒绝且不产生文件）；profile 复验（writer/writer-headless 安装 dsh-writer-export、`--dump-config` 组合树含 writer-export、headless 实测 export_book 走 ask 而非「导出未启用」）。对抗审查（3 subagent 并行：引擎/域库、工具/导出、测试/组合）首轮返回 H×3 / M×11 / L×7 + 测试缺口，逐条复核全部成立并修复：**H1** 按节重试却整轮覆盖三节（模型只回修正节时已通过节被清空；domain 的 mergeExtractionSections 为死代码）→ 重试只更新被拒收节（retrySections 集合），提示词同步「可只含这些节」；**H2** 一致性分批只标记截断从未真正截断（批次可远超预算、truncated 标记语义颠倒）→ domain 新增 `truncateBatchBodies`（水fill 公平分配 + 码点安全截断），engine 对每批正文实际截断后才进提示词；**H3** 维护 pass 运行中章节被改写：重触发被 inflight 去重吞掉且 pending.md 写入旧版待办 → 包装器 run 结束后重读 hash 不一致则 force 补跑（depth 限一层），落盘前重读章节、变更则跳过 pending 追加并在结果标 `superseded`；**M 组**：force 请求不再共享非 force 执行；重试耗尽显式 `partial`/`rejected` 标记（派生 + 结果 + pending 三处可见）；EPUB 三连修复（NCX content src 去掉 OEBPS/ 前缀、navMap 顺序对齐 spine、meta 值移入 content 属性）+ `dc:identifier` 改真 UUID；recompute_derived mode 未知值响亮抛错（防 typo 触发批量重算）；writer_stats 覆盖率改按 sourceHash 新鲜度；archive_point 区分 git ENOENT、`git reset -- .writer exports` 防派生/导出产物入库；store `appendPending` 以 saveChains 同款 promise 链串行（key `pending.md` 与 `${kind}/${id}` 空间不相交）；`writer/maintenance-pass` 事件注释改为不含 up-to-date（实现不 emit）；`export_book` ask 决策带 reason；`parseScope` 委托 domain `parseChapterRange`（收敛双实现）；**L 组**：一致性提示词措辞对齐「全部引用都不存在才丢」；`truncateCodePoints` 码点安全截断替换 UTF-16 slice；recompute mark 在 pending.md 追加旧待办作废提示；validRefs 补 `event/event` 与 style 双形态；outputPath 项目根内校验（防绝对路径/`..` 逃逸）；zip 4GB/65535 溢出断言 + EOCD 冗余清理；renderTxt 恒真 filter 清理；export 包 devDeps 风格统一。测试补齐 14 项（总 94→108）：引擎 P3 编排集成测试（llm 桩 + 真实 store，覆盖 inflight 去重/hash 锚定/按节重试合并（H1 回归）/partial 标记/TOCTOU 补跑/一致性分批截断与时间锚/摘要代正文/recompute 四分支）、zip 中央目录往返解析（EOCD→目录→本地头→数据→CRC 比对）、renderPendingSection 格式回归、truncateBatchBodies/parseChapterRange 纯函数。修复后全量回归 108/108 + typecheck 零错；EPUB 产物经系统解压器完整解开 + NCX 结构断言复验；headless 复验维护 pass/锚定/一致性检查闭环。二轮复审（fix-focused subagent）超时未收敛（与轮次 7 限制④同模式，已中断）；收敛证据由主线自查承担——逐项核验修复关键点（saveChains 键空间 `pending.md` 与 `${kind}/${id}` 不相交、`truncateBatchBodies` 水fill 终止性与预算收敛、`renderTocNcx` 签名变更后全部调用点（buildEpub + 测试）已同步、`maintenancePass` 的 depth 限内部递归不进公共契约、TOCTOU 补跑与 autoMaintenance 监听交互闭环）+ 四重回归（108/108 单测 / typecheck / EPUB 解压复验 / headless 双场景）。**裁定收敛，P3 收口。**
  - **记录的偏离与已知限制（P3 新增）**：① autoMaintenance 为保存后异步：headless 任务结束即进程退出时在飞的维护 pass 会被截断（派生缺失由下次保存或 recompute_derived 补齐，设计上可接受）；② store 每次 `list()` 全量重建索引（P1 语义未变），writer_stats/一致性检查多次 list 存在重复磁盘扫描，大项目待优化为快照读；③ export_book 的 ask→批准→执行全路径未在带人工审批通道的环境实测（headless 无通道 fail-closed 已验证、服务层与组合树有测试覆盖）；④ 一致性检查批输出解析失败整批抛错不跳过（半批结果不可信，宁可响亮失败）；⑤ pending.md 只追加不归档清理（作废语义靠 mark 模式追加提示行）；⑥ 人物状态时间线实现为 characterStates 派生缓存 + pending.md 建议（§1.4「人物状态时间线维护」的结构化时间线实体形态降级，后续需要再升格）；⑦ §1.4 对外接口清单中的 `recoverySnapshot()` 推迟（断更恢复快照不在本轮需求，显式顺延）；⑧ ePub 未跑官方 epubcheck（以系统解压器完整解开 + NCX/OPF 结构断言替代）；zip 为 stored-only 无压缩（体积换实现面）、DOS 时间戳为 0（解压器普遍容忍）；⑨ 维护 pass 两调用的合并优化维持不做（§6 开放项，实测延迟可接受）。
- 轮次 9（完成·P4 收口）：P4 增量落地，包形态 8→10（新增 `writer-rag` / `writer-guard`）。**domain** 新增三组纯函数：`rag.ts`（CJK bigram 分词 `tokenizeForSearch`、章节切片 `chunkChapterText`、语料构建 `buildRagCorpus`（章节原文切片+新鲜摘要块+人物/伏笔/世界观条目块）、TF-IDF 关键词打分 `keywordScores`、`rrfFuse`（k=60）、防剧透过滤 `filterChunksBySpoiler`（未来章块不可见 + 未回收晚置伏笔块剔除，与组装器同红线）、`renderRagSection`/`snippetOf`）；`guard.ts`（业务错误分类 `classifyBusinessError` 六类模式表、滚动窗口 `ErrorBudgetWindow`/`recordAttempt`/`failureRate`/`shouldInjectHint`（预热满才评估）、`buildCorrectiveHint` 按当前类别给行动指引）；`recovery.ts`（`renderRecoverySnapshot`：章节倒序+摘要优先正文兜底+git 时间锚+伏笔现状/人物/事件/恢复建议）。**core**：新增 `RagService` 抽象（发布 `ctx.writerRag`，`search(query, {maxResults, chapterLimit, signal})`）；EngineService 扩展 `recoverySnapshot(range)`。**writer-rag**（Provider，inject writer）：关键词先行 → 语义档三档（`embeddingBackend`: none/llm/external，构造期白名单+必填校验响亮失败）→ RRF 融合；llm 档一次调用对关键词前 N 候选打 0-10 分（输出不可解析静默退化单路——语义是增强不是依赖）；external 档 OpenAI 兼容 /embeddings + 余弦 + 进程内向量缓存 + apiKeyEnv 未设响亮失败；摘要语料只采用 sourceHash 新鲜派生。**writer-guard**（Consumer，inject tools）：post-execute 先委托再折入（repeat-tool-reminder 范式），软失败文本同样分类计数，`windowSize`/`failureBudget`/`watchedTools` 全 Config 化。**engine**：`recoverySnapshot`（渲染 + git log 逐章最后提交时间 + 原子写 `.writer/recovery-snapshot.md`）；组装路径接入检索增强（`ctx.get('writerRag')` 缺席静默降级；查询=本章大纲+指令；`chapterLimit`=当前章号服务端防剧透；分节预算上限=组装预算 1/4）。**tools**：新增 `writer_search`（rag 缺席返回「检索插件未启用」降级；`chapter_limit` 可选启用防剧透过滤）。**store**：`scanKind` 走 mtime+size 锚定的解析快照缓存（save 落盘同步刷新缓存锚——同刻 mtime+同尺寸改写在 stat 锚下不可区分）；「list 恒反映磁盘现状」语义不变（外部编辑 mtime/size 变化即失效重读，单测覆盖）。**bundle/overlay**：挂载序 store→engine→skills→export→rag→guard→tools（rag 默认 `embeddingBackend: none`）；rag/guard 均可独立禁用（不装包即关闭，tools/engine `ctx.get` 检测缺席降级，已实测）。验证：typecheck 零错；单测 140/140（净增 32 例；轮次 8 记录的「94/94」系当时统计口径误差，git 史核对 HEAD 顶层测试实为 108——此处更正，当前总量以工作树全量为准）；overlay+headless 实测四场景——writer_search 关键词档命中（「绿焰 雨夜」命中第 1 章切片/伏笔/摘要块，score 排序合理）、writer-guard 纠偏注入（窗口 5 预热满后第 5 次乐观锁失败注入 `[writer-guard]` 提示，与宿主 repeat-tool-reminder 组合无冲突）、rag 缺席降级（writer_search 返回「检索插件未启用」）、export_book 批准路径（见下）；profile 复验（writer/writer-headless 安装 rag+guard、`--dump-config` 组合树核对、writer-headless 实测 writer_search+writer_stats、writer web profile 启动 HTTP 401 token 门可达）。
  - **顺延项清偿**：轮次 8 限制②（store list 快照读）→ 已清偿（解析快照缓存）；限制⑦（recoverySnapshot 推迟）→ 已清偿（引擎实现 + 集成测试：倒序/新鲜摘要优先/过期摘要不采用/git 时间锚/range 过滤）；限制③（export_book 批准路径）→ **seam 级复验**：临时 approval 应答插件（对 export_book 返回 allowed-once）挂 overlay 后 ask→批准→执行→`exports/verify-approve.txt` 落盘成功；同 overlay 移除应答插件对照运行返回「requires approval, but no approval channel is available」fail-closed 无产物。真实 Web UI 人工点击路径仍属宿主客户端行为，不做自动化复验（web profile 已启动确认 401 token 门可达）。人物状态时间线结构化升格（限制⑥）继续顺延，记录在案。
  - **§6 开放项「embedding 对中文小说语料效果」裁定**：宿主 llm 缝无 embedding API（dsh-llm 仅 stream 生成，查证 references/deepseek-harness/packages/llm）；关键词档（CJK bigram TF-IDF）在示例项目实测检索质量可接受（专有名词/事件线查询命中相关章节切片与新鲜摘要，摘要块（信息密度高）稳定靠前）；llm 档（相关性打分后验）与 external 档（OpenAI 兼容端点）作为可选增强保留，external 档本机无 API key 未实测效果。**裁定：默认档 none（关键词先行）作为基线交付；语义档按部署选配，external 档效果待有 key 环境补测。**
  - **节拍模式评估（§1.4「降为可选后置」的最终裁定：不做独立引擎）**。证据：原项目节拍实现 = SSE segment 端点 + `BeatSession`（`.writer/tmp/beat-{chapterId}.json` 持久化 confirmedBeats、`rollbackTo`、`restore`；references/novel-writer/packages/writer/src/ai/context/beat-manager.ts:114-217）+ 前端 beat-session 镜像/beat-panel + 逐拍确认回退合并（references/novel-writer/docs/superpowers/specs/2026-06-14-app-v2-chapter-editor-sse-design.md §5.7）+ 每章 N 次 LLM 调用（N=节拍数）+ writingLock。裁定理由：①节拍的核心价值在**场景级人工确认/回退**交互，属客户端 UI 职责——dsh 插件无客户端 UI，宿主 ask 通道一次一问低吞吐，逐拍确认体验劣化；②分段生成本身可由现有 assist 模式 + skill 指引覆盖（模型逐场景续写、人工 writer_read 审阅、rewrite 修正），无需服务端节拍状态机；③回退语义由 Markdown SoT + git 存档点（archive_point）天然覆盖。若未来确需：最小形态 = writer-skills 新增 beat-writing 技能（教模型按大纲节拍逐段 assist 并自报进度），零新代码包。
  - **记录的偏离与已知限制（P4 新增）**：① RAG corpus 每次查询现建（novel 级规模足够；未建持久倒排/向量索引，超大项目再评估）；② external 档向量缓存仅进程内（跨进程不共享，重启重嵌入）；③ llm 档打分输出不可解析时静默退化关键词单路（增强非依赖，不响亮失败）；④ guard 观测窗口按 agent 分窗（WeakMap，进程内；重启清零，不跨会话持久——一轮审查修复，原「全局单窗」实现已废弃）；⑤ guard 分类模式表与本仓工具/engine 错误措辞强耦合（行首锚定 + 软失败白名单前缀，措辞变更须同步 domain guard.ts 模式表）；⑥ recoverySnapshot 时间锚依赖 git 仓库（无 git/未跟踪章节显示「时间未知」）；⑦ 环境坑再增一则：**overlay 挂载仓库根目录的裸 .ts 插件文件会致首次模型调用 REQUEST_EXTENSION 失败**（插件清单解析需包身份，插件文件必须位于有 package.json 的包目录内；临时插件放包目录即可）——已实测定位；⑧ export_book 真人 Web UI 点击审批路径未自动化（seam 级已复验，见上）。
- 轮次 10（完成·P5 收口）：人物状态时间线结构化升格（轮次 8 限制⑥清偿）+ 发布前清理（轮次 6 限制③清偿）+ P4 尾巴择要。**时间线升格**：character frontmatter 新增 `timeline` 字段（`[{chapter,state}]` JSON 内联，**人确认后的权威 SoT**；characterStates 派生缓存降为「建议」，经 pending.md 提示升格——pending 建议行现给出可直接提交的条目 JSON 与 writer_update 指引）。**domain** 新增 `timeline.ts` 纯函数：`parseTimeline`（非法 JSON/形状响亮抛错）、`appendTimelineEntry`（同章覆盖、按章序插入、入参先整体校验防毒化）、`validateTimeline`（三位章锚/state 非空/章序单调不减/同章唯一）、`inspectTimelines`（一致性检查数据源：倒序对=相邻**合法锚**比较（脏锚跳过、prev 链跨脏锚延续，倒序被脏锚隔断不漏报）；malformed=解析失败；invalid=形状/重复错误且剔除与 inversions 同因的倒序文本行防双报）、`arcCoverageOf`（弧线覆盖统计：lastChapter 只取合法锚最大值、坏值不毒化统计）。**engine**：consistencyCheck 末尾并入 inspectTimelines 确定性检测（倒序/invalid→medium、malformed→high；刻意不随 scope 过滤——timeline 是人物级全书数据）。**tools**：writer_stats 增加人物弧线覆盖（x/y + 条目总数 + 逐人物一览 + ⚠ 非法 timeline）；**writer_update 对 character.timeline 写入前过 parseTimeline+validateTimeline 响亮拒绝坏值**（堵模型手写 JSON 的脏值逃逸；非 character 的同名键不拦截）。**RAG 分词缓存**（轮次 9 限制①轻量清偿）：domain 拆出 `tokenCountsOf`/`keywordScoresFromCounts`（TF-IDF 与拆分前逐行等价），rag 服务按 sha256(块id+NUL+块文本) 缓存频次表（章节块等价 chapter.hash 锚定，内容一变键即失效；5000 上限满即**先清后插**防溢出点抖动；同策略回修 external 档 vectorCache 的同型抖动）。**发布前清理**：10 包去 private、依赖全部钉精确版本（workspace 互依 0.1.0；@deepseek-ai 运行时依赖 0.2.0-rc.2/cordis 4.0.4/schemastery 3.18.4）、每包 engines.node>=20 + files 声明（维持 main=src/index.ts 宿主 tsx 加载形态，**风险与证据已在 checklist 留痕**——tsx 加载属宿主实现细节非稳定契约，registry 安装复验为强制项）；**运行时直接 import 的宿主包（engine/rag→dsh-llm、tools/guard→dsh-tools、skills→dsh-skill）移入 dependencies 钉 0.2.0-rc.2**（不依赖 pnpm auto-install-peers 默认行为）；新增 `docs/release-checklist.md`（版本/打包/双安装路径/环境坑/发布序全清单）。验证：typecheck 零错；单测 169/169（净增 29 例：timeline 域 21 + engine 一致性时间线 1 + rag 分词缓存 1 + tools writer_update 4 + 既有断言更新）；overlay+headless 两场景实测（writer_stats 弧线覆盖展示；writer_update 由模型读改写 timeline JSON 往返成功且章序正确）；**双安装路径实测**——npm 形态：`npm pack` writer-domain tarball 经 `dsh plugin add <tgz>` 安装成功（file: 协议落 profile），link 形态：全新 profile writer-p5 逐包 link: 安装 + `@deepseek-ai/dsh-headless@0.2.0-rc.2`，`--dump-config` 组合树核对（`# == dsh-writer-bundle` 分节行序正确）+ headless 实跑 writer_stats 通过；web 形态：writer profile `dsh --profile writer --no-open --port` 启动 401 token 门可达。对抗审查四轮收敛：首轮 4 subagent 并行（时间线/RAG 缓存/发布清理/测试与文档）返回 H0/M7/L12，逐条复核全部成立或裁定记录，修复 M7（engine 接入形状校验、同章唯一、弧线覆盖抽纯函数 arcCoverageOf、writer_update 写入校验、缓存身份断言、先清后插、运行时宿主依赖入 deps）+ L 大部；二轮复核确认五组修复正确、新发现 1M（vectorCache 同型抖动）+3L（'000' 退化/双报/校验无单测）；三轮修复后仍出 1M（倒序被脏锚隔断双通道漏报）+1L（全脏锚展示话术）；四轮确认无新问题收口（审查员边界自查：混合脏锚/重复+倒序并存/相等章号均无漏报误报）。
  - **记录的偏离与已知限制（P5 新增）**：① timeline 追加仍经 writer_update 手工合并 JSON（模型实测可正确执行），专用 `timeline_update` 工具（走 appendTimelineEntry 服务端合并）评估面小、暂不建——写入侧已有响亮校验 + 读出侧 stats/一致性检查双兜底；② external embedding 档效果实测继续挂账（本机仍无 API key 环境；二轮审查顺修其 vectorCache 抖动属代码正确性非效果验证）；③ 发布形态维持 TS 源（宿主 tsx 加载），lib/ 预构建与真实 npm registry 发布复验顺延到正式发布时（checklist 已列为强制项）；④ writer-tools 测试面仍薄（本轮新增 writer-update 4 例为首块 tools 层单测，其余工具依赖 overlay 手测覆盖）；⑤ broken 人物在弧线一览的字面「（无时间线）」与 ⚠ 标记并存（审查确认可接受，未改）。
- 轮次 11（完成·P6 收口）：发布冲刺 + timeline_update 工具（清偿轮次 10 限制①）。**lib/ 预构建**：放弃照搬宿主 tsc -b + tsdown 重机器，采用 TS 5.7+ `rewriteRelativeImportExtensions`（根 `tsconfig.build.base.json` + 每包 `tsconfig.build.json`，tsc 产出 `lib/` JS + d.ts，`.ts` 相对导入重写 `.js`）——**零新增构建依赖**；9 个代码包 main/types/files 切 `lib/`（skills 加 `assets`，`../assets` 相对解析从 lib 出发不变，实测确认）；`lib/` 进 .gitignore；根 scripts 新增 `build`（逐包）。**构建先行约定**：工作区裸导入（如 `from 'dsh-writer-domain'`）经 main 解析到 lib，故根 `test`/`typecheck` 均串 `npm run build`（删 lib 实测自动恢复）；overlay/profile 下改 domain/core 等被裸导入包源码须先 build（AGENTS 开发环境 + checklist 留痕）。**发布 guard 与元数据**：9 代码包 `prepublishOnly: npm run build`（防新 clone 直接 publish 产出无 lib 坏包）；10 包 LICENSE(MIT) + README + description + license 字段；checklist 补五项留痕（repository 待仓库上线、**不支持 git 直装**（lib 不入库且无 prepare，分发仅 registry/tarball/link）、非 scoped 无需 publishConfig.access、版本升级 npm version -w + grep 复核流程、engines 与宿主核对（宿主未声明，本仓 >=20 保守））。**timeline_update 工具**：writer-tools 注册——read character → parseTimeline → appendTimelineEntry（服务端同章覆盖/按章序合并，免模型手工拼 JSON）→ serializeTimeline → save 带 expectHash；软失败（人物不存在）与响亮失败（脏章锚/空 state/现有 timeline 非法防毒化）分层同 foreshadow_update 范式；成功消息有界（本章条目 + 总数）；pending.md 建议行与 chapter-writing 技能维护清单同步指向。验证：build 零错；typecheck + test 172/172（timeline_update 4 例，save 桩断言 expectHash 透传）；**预构建形态双安装路径实测**——npm pack tarball（含 lib/LICENSE/README）file: 安装 + 其余 link 装进全新 profile writer-p6 + `--dump-config` 组合树 + headless 实跑 writer_stats 全过；overlay（src+tsx）writer_stats / timeline_update 两场景过（模型走新工具闭环：read → hash → 服务端合并落盘）；裸 Node 加载 lib 产物过（peer 从根 node_modules 解析）。对抗审查两轮收敛：首轮 3 subagent 并行（预构建方案 / timeline_update / 发布链路）返回 M6+L6，逐条复核全部成立或裁定（license/README 经用户裁定 MIT + 十包各一份），修复 M6（test/typecheck 串 build、prepublishOnly guard、expectHash 透传断言、元数据补齐、git 直装留痕、「本地开发不受影响」表述纠正）+ L 大部（SKILL 维护清单、有界输出、版本流程、engines、access 留痕）；二轮确认六组修复正确，新发现仅 1 条 L 级管道伪象观察（无需行动），裁定收口。
  - **记录的偏离与已知限制（P6 新增）**：① d.ts 内保留 `.ts` 相对说明符（TS 不重写声明文件属预期；临时消费者工程实测 NodeNext 解析到同目录 .d.ts 零错；个别非 tsc 工具链可能报怨，留意）；② 真实 `npm publish`（需凭据与 2FA）与发布后 registry 安装复验待用户配合执行（checklist §5 强制项）；③ external embedding 档继续挂账；④ engine/guard 的 @deepseek-ai/* 同置 dependencies+peerDependencies 略冗余（同版本 dedupe 无风险，审查裁定可接受）。
- 轮次 12（完成·P7 清欠收口）：六项挂账清偿。**① pending.md 归档语义**（轮次 8 限制⑤）：domain `pending.ts` 纯函数（切节/归属/重建/按章分区——**归属只认节头行**（正文跨章引用不算，防过度归档）、跳过 ``` 围栏、CRLF 归一）；store `archivePending`（pending.md 链锁定区内：mutator 分区 → **先**原子追加归档 → **再**原子重写清单，失败方向安全——归档先落则 pending 重写失败时待办仍在、重试只多副本；归档写入走 appendPendingArchive 串行链防并发丢段）；工具 `pending_cleanup`（按章归档 + 幂等 no-op + `# [已归档]` 时间戳头分层）。**② 维护 pass 排空**（轮次 8 限制①缓解）：engine `drainMaintenance`/`pendingMaintenanceCount`（快照语义，TOCTOU 补跑逃逸已注释——连续两次 flush 收敛）+ 工具 `maintenance_flush`（模型收尾前可调）。**③ guard 措辞契约测试**（轮次 9 限制⑤防护）：扫四包全部 throw 消息（模板插值占位 + 代表实参重试），全部须可分类或命中基建白名单（白名单逐条裁定：IO/模型/内部不变量/用户级），软失败全量 return 扫描同构——**措辞漂移即红**；顺带修模式表真实缺口（timeline/milestones 家族、「未知X」无空格变体、人物实体不存在软失败、rewrite 疑似 JSON→parse）。**④ external 档代码路径集成测试**（轮次 9 限制②部分清偿）：本地 OpenAI 兼容 stub（确定性向量/请求计数/Bearer 累计断言/unref 防挂起）——检索走 embeddings、向量缓存（同查询+未变语料零新请求）、改写后语料键失效（查询固定已缓存词，新增请求只能来自新块文本）、无 key 响亮失败。**⑤ writer-tools 测试面补强**（轮次 10 限制④）：tools.test.ts 九用例（writer_read 清单/单体、writer_stats 全分支+真实 store 冒烟、foreshadow_update 四动作+终态拒绝、引擎缺席降级×5、export/rag 缺席降级、archive_point 非 git、pending_cleanup、maintenance_flush）。**⑥ broken 人物弧线话术**（轮次 10 限制⑤）：改「（timeline 无法解析，请修复 frontmatter）」。验证：typecheck 零错、单测 195/195（净增 23）；overlay 实测 pending_cleanup（真实归档落盘）+ maintenance_flush（空排空）。对抗审查两轮收敛：首轮 2 subagent 返回 6M+11L，逐条复核全部成立或裁定记录，修复 6M（归档两步原子性→archive-first 锁定区、归属只认头行、drain 快照语义注释、external 失效断言锁语料、软失败契约全量化、白名单死条目清理）+ L 大部（围栏/CRLF/Bearer 累计/# 级归档头/L1 并发缝根治为走归档链）；二轮确认五组修复正确，新发现 3L（L1 已根治；L2 成功前缀弱锚为白名单机制固有取舍、L3 未闭合围栏单节化不丢数据——均记录）。
  - **记录的偏离与已知限制（P7 新增）**：① external 档**效果**实测仍待有 key 环境（本轮只清偿代码路径，检索质量未验）；② guard 软失败契约的成功前缀（已/没有/当前…）是语义弱锚——防「漏报红」不防「错误文案伪装成成功」，新增错误型软失败应避免这些开头（机制固有取舍）；③ pending.md 未闭合围栏会使其后 `## ` 头全部并入当前节（单节化不丢数据，重开围栏即恢复）；④ maintenance_flush 非协作退出（进程被杀）仍无法覆盖（原限制①只缓解非根治）；⑤ npm publish / repository / export_book 真人审批 / external key 四项用户介入挂账不变。
