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

`dsh.bundle` + `cordis.patch.yml` 按依赖序挂载：core → store → engine → skills → export → tools（tools 最后，确保注入就绪）。用户 profile 一行安装：`dsh plugin add dsh-writer-bundle`。

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
- 轮次 1（完成）：自我复审修正 3 处（core 改为抽象基类 + 事件声明、store 为服务实现发布方、engine 发布 `ctx.writerEngine` 并明确对外接口）；宿主先例预检（抽象基类 17 例、pre-execute ask 机制、llm 直连路径）。对抗审查（初版委派超时中断后收窄重发）返回 3 组发现，逐条二次确认全部成立并修订：① P1 注入断链——tools 的 engine 改可选 `ctx.get`；② §6.1-14 settle 收敛语义恢复为轻量版（inflight 去重 + hash 锚定）；③ §6.1-7 二分公理与 §6.1-11 单向流补显式领域约束函数。审查同时确认：§6.1/§6.4 无遗漏、§6.3 无偷建、依赖图无环、P1-P3 验收可检验。**裁定：修订后可用（已修订），规划定稿。**
- 轮次 2（完成·P1 实现收口）：P1 四包 + dev overlay + 示例项目落地；环境坑修复（npm workspaces 需与 dsh 同版本 0.2.0-rc.2 否则实例分裂致调度器崩、install-scripts 需 approve）；dsh headless/web 双环境端到端实测通过（读写/乐观锁/陈旧 hash 拒绝/"new" 覆盖拒绝）。对抗审查（1 高 7 中 7 低）逐条复核全部成立并修复：H1 store 显式 create 语义、M1/M2 frontmatter 值 JSON 引号化 + hash 规范化、M4 索引 in-flight 去重、M5 get 直读磁盘、M6 tools 补 core 依赖、M7 worldbuilding kind 补入、L1 rename 清理、L2 Windows 保留名、L5 注释修正；另发现并修复 hash 自锁 bug（指纹以落盘文本回解为准）。测试：domain 12 + store 9 = 21 全过（node --test）。
  - **记录的偏离与已知限制**：① 派生索引为纯内存（规划 §1.3 的 `.writer/index/` 磁盘索引推迟——索引本是可重建缓存，P1 规模内存足够；get 已直读磁盘保证新鲜度）；② P1 验收项 bundle + onboarding skill 未含在本批（下一步 P1.5）；③ 章节命名实现为 `{id}.md`（三位序号即 id，标题在 frontmatter，未做格式强校验）；④ 并发 save 的 TOCTOU（单用户可接受，P2 以 (kind,id) promise 链串行化）；⑤ parseFrontmatter 对「无 frontmatter 但正文以 --- 开头」的外部文档存在已知边界（自产文件恒有结尾换行不触发）；⑥ 工具体暂未观测 exec.signal（P1 全为快速 fs 操作，P2 长工具接入）；⑦ 无 fsync（崩溃掉电窗口，与原子写配合风险极低，记录）。
- 轮次 3（完成）：第 2 轮裁定收敛但提 N1-N3（坏文件毒化索引/前导零漂移/project store 层只读），复核成立全修；第 3 轮发现 N1 残留入口（单文件实体坏 frontmatter 无隔离），修复 + 回归测试（24 全过）。
- 轮次 4（完成）：第 4 轮发现 package.json 因 PowerShell 反引号换行事故损坏（npm scripts 全不可用，此前测试绕过 npm 掩盖），修复并实证 npm run test/typecheck 恢复。
- 轮次 5（完成·收口）：第 5 轮终验——package.json 合法、npm run test 24/24、typecheck 零错、无新问题，**裁定收敛，P1 收口**。收口前最后 e2e（headless + overlay，character 读取）复验通过。审查循环累计：5 轮对抗审查、每条结论均经逐条复核、修复 12 项（H1×1/M×8/L×3）+ 环境坑 2 项（npm 实例分裂、install-scripts）。
- 轮次 6（完成·P1.5 收口）：补齐 P1 验收缺口并跑通正式分发形态。新增两包：`writer-skills`（bundled skill provider，仿 dsh `skill-badge` 范式；资产 `assets/<name>/SKILL.md` 的 frontmatter 为候选元数据单一真源，apply 期同步加载并严格校验，坏资产响亮失败；含 `writer-onboarding` 技能——8 阶段叙事引导 + read-before-update 写作纪律，阶段 7/8 标注后续版本能力）与 `writer-bundle`（`dsh.bundle.patch` + `cordis.patch.yml` 挂载 store→skills→tools；projectRoot 默认 `!!js process.cwd()`，更高层 patch 可覆盖）。验证三线全过：单测 27/27 + typecheck 零错；overlay + headless（技能发现/加载 + 实体读取）；**正式 profile 分发形态**（`dsh plugin add` 逐包 link: 安装进独立 profile → `--dump-config` 组合树核对 → web profile 启动 200 → headless 变体 profile 下模型实测：bundled 技能加载、实体读取、乐观锁写入闭环）。对抗审查两轮：首轮 2M+4L，逐条复核成立并修复 M1（file URL 手拼跨平台缺陷 → `pathToFileURL`）、M2（技能文档教模型省略 id 读单文件实体 → 补 `id="project"`）、L1（阶段 7/8 标注）、L2（补响亮失败测试 3 例）；L3/L4 记录不改。二轮确认修复正确，新发现 1L（空目录报错消息应引用注入根而非固定常量）已修并复测。**裁定收敛，P1.5 收口。**
  - **记录的偏离与已知限制**：① core 为纯契约包（无 apply），不上 cordis 插件行、仅作依赖安装——与 §1.8 字面挂载序「core → store → …」偏离，实际行序 store→skills→tools；② projectRoot 默认取 dsh 启动目录，用户须在小说项目目录启动（或更高层 patch 显式覆盖）；③ 分发验证采用**本地目录 link: 安装**（npm publish 未做）：writer-bundle 的 `private: true` 与 `*` 依赖阻断 §1.8 的 registry 安装路径，发布前需去 private、依赖改精确范围并补 `lib/` 预构建（当前 main 指 TS 源码，靠宿主 tsx 加载）；④ `isDirectory()` 对 symlink 目录返回 false，特定链接形态下资产目录可能被静默跳过（当前布局不触发）；⑤ 新环境坑三则：pnpm 12 在本机因盘符根锁目录（`C:\pnpm-store-operation-locks`）EPERM 完全不可用，须用 pnpm 10；`plugin add` 新建的 profile 只含 base + 功能 bundle 时**无 app 入口**会无限空转（进程空转无输出、不报错），须另装 app bundle；npm 源上 app 包（dsh-web-app 等）默认解析到不兼容旧版 0.0.1-rc.1，必须钉 `@0.2.0-rc.2`（轮次 2 依赖版本教训的再确认）。
