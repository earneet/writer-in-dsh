# 当前实现审查与优化安排

> **任务来源**: 用户要求先从 Git 更新本项目及引用项目，再审查领域功能复刻情况、架构合理性与优化顺序；随后要求提交恢复点并按建议修复。Agent Loop 由 dsh 宿主插件提供。
> **任务内容**: 核对版本、盘点能力、验证问题与安排优化；记录 R1–R10 修复、审查及验证状态。
> **参考文档**:
> - `AGENTS.md` — 项目边界与审查、验证规范。
> - `references/novel-writer-analysis.md` — 原始功能映射，仅作索引，结论需回查最新源码。
> - `references/dsh-plugin-research.md` — dsh 插件与宿主能力缝。
> - `references/novel-writer/docs/`、`references/novel-writer/packages/writer/` — 更新后的原项目设计与实现。
> - `references/deepseek-harness/` — 更新后的宿主接口与装载实现。
> - `docs/implementation-plan.md` — 历轮实现、裁定与已知限制。
> - `docs/current-state-review-2026-11-17.md`、`docs/p1-fix-plan-2026-11-17.md` — 上轮发现及七项 P1 修复状态。
> - `docs/ui-implementation-2026-11-17.md`、`docs/project-initialization-design-2026-11-17.md` — 当前未提交的工作台与初始化实现依据。
> **生成日期**: 2026-11-18

## 审查计划与进度

- [x] 1. Git 更新与基线：获取主仓及两个引用远端，安全快进；记录提交和本地修改，验证没有覆盖现有工作。
- [x] 2. 三线审查：领域功能与上游差距、领域实现正确性、宿主及客户端集成；明确不复刻 Agent Loop 的职责边界。
- [x] 3. 逐条复核：核对实际调用路径、文件行号和失败条件，必要时用隔离探针复现；丢弃误判和已修项。
- [x] 4. 基线验证：运行类型检查与全量测试，区分单测覆盖、真实宿主和模型效果证据。
- [x] 5. 方案自审与交付：比较优化顺序、成本与副作用，输出能力矩阵、经复核问题和分批验收标准；仅提出实施建议。

## 审查阶段执行约束（后续修复见 §8）

本轮是更新与审查，不修改功能源码，不升级运行依赖，不提交、推送或发布。已有工作区改动属于审查对象，完整保留；引用目录仅执行授权的 Git 更新，不编辑源码。主仓已获取远端，`HEAD=origin/main=a4f377c`，不存在待合并的远端提交。Git 元数据写入受沙箱限制，授权更新命令通过受控提权执行。

## 1. 总体判断与版本基线

架构方向合理，写作领域的主要链路已具备：Markdown 存储、三种生成模式、结构化审稿、伏笔生命周期、人物时间线、维护建议、一致性检查、检索、导出及写作工作台。当前最值得投入的是完成判据、失败恢复和真实宿主入口，随后再增加领域能力。

不能把“包和工具齐备”解释为与原项目全部设计等价。改稿影响分析、新伏笔发现、灵感整理仍只有部分承接；真实模型效果与完整桌面流程也尚缺验收。本报告审查的是包含未提交改动的当前工作区，远端主仓尚未包含这些工作台和初始化改动。

| 对象 | 更新前 | 本次获取远端并更新后的状态 |
|---|---|---|
| 主仓 `origin/main` | `a4f377c21dfded7b30baaf66a3f399107f560627` | 同一提交，与远端一致，无需合并；保留已有未提交修改 |
| `references/novel-writer` | `f42c74a9239488ab12cbe672c8deafb4c2d59bc8` | 同一提交，已是远端 `master` 最新 |
| `references/deepseek-harness` | `39163dd30f703a79079e2d2446545cff3c453738` | 快进 807 个提交至 `ca33fd6843b205e279c7ccb6cb73a472c78f5760`，与远端 `master` 一致 |
| 实际运行依赖 | `@deepseek-ai/*` 为 `0.2.2-rc.1` | 保持原版本；引用源码更新不代表运行环境升级 |

两个引用子模块工作区干净。主仓出现 dsh 子模块指针变更是本次授权更新的结果。没有提交、推送、发布或修改宿主 profile。验证环境为 Windows、Node `v24.15.0`、npm `11.12.1`。

## 2. 功能实现情况

下列判断综合当前代码、更新后的原项目设计和历史裁定，不按工具名称或数量判断等价程度。

| 能力 | 当前实现与判断 | 主要证据 |
|---|---|---|
| 项目、准则、大纲、人物、世界观 | Markdown 实体和起步技能已承接主要工作流；专门的网页向导可以按需省略 | `packages/writer-skills/assets/writer-onboarding/SKILL.md:13`；`packages/writer-domain/src/index.ts:364` |
| 章节写作 | full、assist、rewrite 已实现；manual 复用宿主文件编辑。上轮续写上下文与改写准则修复仍在 | `packages/writer-engine/src/index.ts:100`、`:534`、`:552`；`docs/p1-fix-plan-2026-11-17.md` |
| 审稿、一致性检查 | 结构化建议、按预算分批和权威设定输入已具备；摘要代正文、基准裁剪须继续披露覆盖 | `packages/writer-engine/src/index.ts:280`、`:328`；`packages/writer-domain/src/consistency.ts:38` |
| 伏笔追踪 | 状态机、里程碑、埋设和回收计划锚成立；保存后抽取主要识别已有伏笔动作，新线索发现尚薄 | `packages/writer-domain/src/index.ts:125`、`:451`；`packages/writer-engine/src/prompts.ts:121` |
| 人物状态 | timeline 是人确认的权威记录，维护抽取是待确认建议，分工合理 | `packages/writer-domain/src/timeline.ts:26`；`packages/writer-skills/assets/chapter-writing/SKILL.md:62` |
| 改稿治理 | 指定章节的派生重算可用；尚不等价于跨章、人物关系和伏笔的变更影响清单 | `packages/writer-engine/src/index.ts:437`；上游 `packages/writer/src/service/impact-analysis.ts:33` |
| 灵感整理 | 原文合订本和技能软约束是既定简化；缺少清楚的批量整理结果、来源对应和重复采纳约定 | `packages/writer-skills/assets/writer-onboarding/SKILL.md:17`；`docs/novel-writer-review.md:30`、`:106` |
| RAG | 关键词召回加可选 LLM／external 语义重排；关键词零命中时不会走独立语义召回 | `packages/writer-rag/src/index.ts:150`、`:157` |
| 人确认闭环 | 建议进入 pending，经对话更新权威实体后归档，职责清楚；投递失败恢复仍缺一环 | `packages/writer-skills/assets/chapter-writing/SKILL.md:62`；见 R3 |
| 导出与存档 | TXT／HTML／ePub、显式 Git 存档存在；导出元数据仍读取旧位置 | `packages/writer-export/src/index.ts:62`、`:88`；见 R8 |
| 工作台与初始化 | 七入口、百章目录、正文阅读、请求追加宿主草稿已实现；首轮前入口及空目录增量刷新有缺口 | `packages/writer-ui/src/client/index.tsx:56`；`packages/writer-ui/src/client/useProject.ts:96`；见 R2、R7 |

表中“上游”路径均位于 `references/novel-writer/`。有意简化应继续明确标识，不以缺少 SQLite 表、独立页面或专用工具名称判定失败。

## 3. 架构合理性

建议保持现有包边界：domain 处理纯领域规则，core 声明服务契约，store 管 Markdown，engine 编排领域模型任务，tools／skills 承接操作和工作流，UI 经宿主能力读取与交接。无需为本轮问题增加新的基础设施层。

- **宿主复用成立**：会话、压缩、权限、子代理、模型接入、流式生命周期由 dsh 提供。直接调用宿主 LLM 做章节生成和抽取属于领域编排，不等于重新实现 Agent Loop。
- **存储取舍合理**：Markdown SoT 避开双写事务；派生物可重建；待办归档属于不可重建史料并已移出缓存目录。原子落盘、乐观锁、共享写链和归档先行保留价值。
- **项目隔离已有实证**：共享动态 store／engine、两个会话交错异步保存时，模型请求的 initiator 和两项目派生 hash 隔离通过。事件 receiver 修复也仍在。该探针使用真实 Cordis、磁盘和 initiator 桩，不等同完整宿主会话端到端。
- **复杂度目前可控**：索引、语义腿、导出可降级或独立禁用；建议继续以小批修复现有契约。跨进程锁仅在明确承诺多进程共用同一项目后再设计。

继续沿用已裁定的范围：不重建通用 Agent Loop、权限和会话系统；不恢复 SQLite 双写、独立节拍引擎、自动灵感阈值管线或自动把抽取结果改写成权威事实。日更统计、章节状态机等仍按既有裁定处理。

## 4. 逐条复核后成立的问题

共保留 2 项 P1、7 项 P2、1 项 P3。P1 表示优先修复的写作正确性或核心入口缺陷；P2 表示明确条件下的正确性、恢复或交互缺口；P3 为执行指引债务。旧报告七项 P1 不重复立案。

以下是恢复点 `56bd030` 前的审查发现，代码定位为当时版本；当前修复状态见 §8。

### R1 · P1：早章写作上下文会包含未来事件

`packages/writer-domain/src/index.ts:513` 将 `events.md` 正文整体交给预算裁剪，`packages/writer-engine/src/index.ts:650` 的组装路径直接提供全书事件。目标第 3 章、事件包含第 1／20 章分节时，独立探针完整保留第 20 章“终局凶手”信息，且 `truncated=false`。该组装结果由 full 和 assist 消费。

这违反 `packages/writer-skills/assets/chapter-writing/SKILL.md:29` 的未来事件纪律。上游 `references/novel-writer/packages/writer/src/ai/context/assembler.ts:299` 明确区分本章事件与更早的重要事件，首部截断不能替代章节过滤。

**建议与验收**：先约定 Markdown 事件章节锚及无锚条目的可见性，再在预算裁剪前过滤。用实际 full／assist 请求验证本章和历史事件保留、未来事实不进入输入。人物历史状态及已回收伏笔的可见性属于后续语义设计，不能据此宣称当前全部防剧透路径均失效。

### R2 · P1：从未发送首轮消息的空会话打不开初始化欢迎页

本仓仅在 `packages/writer-ui/src/client/index.tsx:56` 注册 `conversation.view`。实际安装的 rc.1 在 `node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js:20703` 对 blank 会话直接返回 null，`:20645` 同时传入 `hideChrome:true` 隐藏标签页。主审直接抽取并执行实际产物函数：即使选中 `writer-panel`，blank 时槽调用为 0；非 blank 时为 1。

最新引用仍有相同判断：`references/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/DefaultConversationViews.tsx:31`、`ConversationHeader.tsx:15`、`ConversationSession.tsx:119`。现有浏览器夹具 `packages/writer-ui/scripts/studio-browser-entry.tsx:88` 固定 `blank:false`，未覆盖此入口。已有会话中的初始化能力并未因此失效；用户可先发消息，但这不满足首轮前直接初始化的目标。

**建议与验收**：利用已注册的项目命令或宿主提供的空态扩展缝设置真实可达入口；若需要一键按钮，先核实具体空态槽契约。真实新建写作会话、尚无首轮消息时完成初始化，不伪造消息或修改宿主 blank 判据。

### R3 · P2：待办投递失败后，普通重试不能恢复确认入口

`packages/writer-engine/src/index.ts:253` 先写维护缓存，`:262` 后追加待办；`:182` 和 `:449` 都只按章节 hash 判完成。用真实磁盘错误阻断一次 pending 读取，解除故障后维护与重算均返回 `up-to-date`，模型调用仍为两次，待办文件不存在。建议还在缓存，但没有送达人工确认清单。

**建议与验收**：完成判据包含待办投递状态，以稳定任务键幂等补投。覆盖追加前失败、追加后完成标记失败、已有更新结果三个方向；不得重复、丢失或覆盖新结果。仅交换写入顺序或删除缓存不能解决恢复语义。

### R4 · P2：部分失败的维护被当作完整完成

`packages/writer-engine/src/index.ts:251` 记录 `partial`，但 `:182`、`:449` 仍按 hash 跳过，`packages/writer-tools/src/index.ts:300` 统计也只看 hash。故意产生无效伏笔引用后首次回执 `partial:true`，再次维护和公开重算都返回 `up-to-date`，回执不再披露 partial。

**建议与验收**：区分版本新鲜、抽取完整、待办已投递。明确重算应能修复 partial；正文未变时也应恢复，统计和工作台如实显示不完整。

### R5 · P2：合法 JSON 的坏形状缓存阻断重建

`packages/writer-store/src/index.ts:327` 的 `readMaintenance` 仅作类型断言，`:353` 接受任意 JSON。真实缓存写成 `null` 后，`packages/writer-engine/src/index.ts:449` 抛出读取 `sourceHash` 的 TypeError，模型调用为 0；RAG 等消费者也依赖同一业务记录。

**建议与验收**：在维护记录读取边界做最小形状／版本校验，坏缓存告警后按缺失重建；覆盖 null、数组、缺字段、错误字段类型及旧形状。真正的磁盘读取错误仍须响亮失败。

### R6 · P2：frontmatter 键无法往返时仍报告保存成功

`packages/writer-domain/src/index.ts:68` 按第一个冒号解析键，`:102` 却直接拼接未转义键。真实 store 保存键 `title: fake\nother`、值 `abc`，成功返回的元数据变成 `title=fake`、`other=abc`，原键消失。`packages/writer-tools/src/index.ts:607` 的值规范化没有覆盖键。

**建议与验收**：在序列化／保存边界拒绝不能无损往返的键，无需字段大白名单。覆盖冒号、换行、注释前缀、边缘空白和定界符；非法更新应失败且保留原文件字节。

### R7 · P2：已有空实体目录中的第一个文件不触发刷新

`packages/writer-ui/src/client/useProject.ts:96` 仅在实体数量非零时加入人物、伏笔、世界观、风格目录；章节目录也来自已有章节路径。初始化 `packages/writer-store/src/project.ts:62` 创建的这些目录最初为空。安装版 `node_modules/@deepseek-ai/dsh-fs-local/lib/index.js:777`、最新引用 `references/deepseek-harness/packages/fs/fs-local/src/index.ts:83` 均为 `depth:0`，根监听不覆盖现有子目录内部新增。

**触发与验收**：保持面板打开，仅在空 `characters/` 新建人物文件，不同时修改根文件，面板会保持空列表直到手动刷新。应按实际存在的实体目录建立订阅，覆盖首文件新增、修改、删除，并验证卸载退订。工具卡片回执不能代替实体扫描更新。

### R8 · P2：导出的书名与作者未使用项目元数据

`packages/writer-export/src/index.ts:62` 没有读取 project，`:88`、`:89` 仍从 outline 取 title／author。新初始化已在 `packages/writer-store/src/project.ts:77` 将标题写进 `project.md`，工作台也从 project 展示书名。真实 Context＋store＋导出服务探针显示：project 有书名、作者而 outline 无元数据时，TXT／HTML／ePub 全部出现“未命名作品”，缺少真实作者。

**建议与验收**：统一采用 project 元数据，明确旧布局 outline 的兼容回退顺序。三格式产物和旧项目分别验证；避免要求用户在两个文件重复维护同一书名。

### R9 · P2：维护排空的生命周期与取消语义不完整

`packages/writer-engine/src/index.ts:527` 只等待当前 inflight 快照，外层 `:164` 的版本检查和补跑不在同一等待对象中。门控探针在首轮维护期间改正文，单次 flush 返回后又启动补跑，缓存仍锚旧 hash。快照限制已在代码注释留痕，本轮将其列为既知可靠性债；工具 `packages/writer-tools/src/index.ts:410` 的“等待全部”表述比实际保证更强。

同一工具 `:417` 只在入口检查取消信号，`:421` 的等待不消费 signal。独立探针 abort 后等待仍不结束，直到后台任务释放才返回成功。

**建议与验收**：跟踪完整维护生命周期，等待本项目在飞任务收敛；支持只取消当前等待者，不取消共享后台维护。覆盖同章运行期改稿的单次 flush、等待者中止、后台继续及失败回执。无需添加新的 Agent Loop 或后台调度框架。

### R10 · P3：当前发布指引仍指导安装旧宿主

`docs/release-checklist.md:9`、`:10`、`:18`、`:32`、`:42` 仍将 `0.2.0-rc.2` 作为当前依赖／app 安装版本；实际根 `package.json:15` 与 preset `package.json:19` 已为 `0.2.2-rc.1`。照表操作可能混装，尤其会错过本轮依赖的命令、草稿和客户端能力。

**建议与验收**：发布前统一当前安装矩阵、Node 门槛及发布命令，保留历史迭代记录原样。用文档提供的命令在干净 profile 安装，确认全部宿主运行包无版本分裂；不能仅检验文档中的字符串一致。

## 5. 宿主更新与升级安排

对更新后 `ca33fd6843` 的实际消费面核对，未发现 defineTool、命令注册／执行、技能 Provider、preset isolate、槽注册、sessions.binding、草稿追加、workspace changes 的调用形状发生直接破坏。这是静态兼容核对，不是新宿主上的运行验收。

保留一个升级适配项：`packages/writer-guard/src/index.ts:110` 手工重建 block 决策；最新 `references/deepseek-harness/packages/core/tools/src/contracts.ts:389` 的 block 允许附带 `info`，这一路会丢失该字段。实际安装 rc.1 的 `node_modules/@deepseek-ai/dsh-tools/lib/types/contracts.d.ts:352` 尚无该字段。升级时应保留下游字段再附加提示；本报告不把它算作当前 rc.1 的运行故障。

宿主升级单列批次：统一所有 `@deepseek-ai/*` 钉版与 lock、核对 Node ≥24.9，然后验证 bundle／preset 装载、真正的空会话、草稿追加、审批／问答与导出。工作台隐藏整个 composer seat 的局部 CSS 仍需真实宿主交互验收，当前没有足够证据将其列为新增阻断故障。

## 6. 自审后的优化安排

本次比较了先追平上游功能、先重构存储层、先修当前闭环三条路线。推荐先修闭环：能够改善生成内容、元数据和使用入口，改动边界可控。其余两条路线会增加迁移和验收成本，目前未见足够证据支撑优先投入。以下是建议排期，尚未执行功能修改。

| 批次 | 内容与拆分建议 | 验收出口 |
|---|---|---|
| A：写作正确性与基础恢复 | 独立处理 R1 未来事件、R2 空会话入口、R3 待办补投、R5 坏缓存、R6 元数据键；每个主题独立提交 | 失败场景先有回归；full／assist 请求无未来事实；首轮前可初始化；普通重试恢复待办；坏缓存可重建；非法键不改文件 |
| B：治理与日常使用闭环 | R4 partial、R9 完整排空与取消、R7 空目录订阅、R8 导出元数据；状态定义统一后同步工具与工作台 | partial 可修复且如实显示；单次排空等待补跑；停止等待不杀共享任务；首人物自动出现；三格式书名作者正确 |
| C：领域能力增强 | 先做变更影响核对技能，再补未建档伏笔候选和灵感批量整理技能；保持人工确认 | 改早章承诺能定位后章引用与权威记录；无 plots 也能提出带引句的新候选；灵感建议能追溯原话、重复整理不重复采纳 |
| D：效果评测、宿主升级与发布 | 固定中文小说语料测试 RAG 和写／审／改效果；宿主升级独立实施；清偿 R10，重做干净安装与真实客户端验收 | 记录命中、漏召回、未来信息泄露、延迟及调用成本；tarball／link、headless、真实 Web／桌面、审批与导出有可复现证据 |

批次 C 应先用 skill 表达工作流，只有稳定的数据或验证需求确实出现时再加服务接口：

- **改稿影响核对**：当前 `recomputeDerived` 只处理指定章派生，不能替代上游 `impact-analysis.ts:33` 的 affectedChapters／affectedRelations／affectedForeshadows。先按“变更描述→检索相关正文与权威记录→只读影响清单→人确认→重算”落地，禁止自动覆盖 timeline／events／plots。
- **新伏笔候选**：当前 `packages/writer-domain/src/maintenance.ts:151` 要求引用现有 plot；上游 `references/novel-writer/packages/writer/src/service/foreshadow-detect.ts:21` 有 isNew／matchedPlotId。可以增加带正文引句的待确认候选，不必恢复自动建档和回写管线。
- **灵感批量整理**：补稳定来源标识、整理范围、原文对应及确认后写入约定，保持原话，不恢复 SQLite 认领状态机和定时触发。

RAG 先建立同义表达、人名别称、远章事实、长人物档案和未来剧透查询集，再比较关键词／LLM 重排／external 三档。只有证实关键词候选导致漏召回后，再评估独立语义候选；目前不建议先引入向量数据库。人物历史状态、已回收伏笔的按章可见性需要独立语义约定，开放 frontmatter 键本身不构成完整实现。

每个修复批次按仓库要求运行 `npm run typecheck` 和 `npm test`，执行对抗审查、逐条复核、修复和重测。当前工作区已有大量未提交的工作台与初始化改动，开始下一批前应先明确这些成果的版本边界，避免把审查修复与既有功能混成一个主题。

## 7. 证据与验证边界

本节记录最初的审查阶段，该阶段没有修改功能源码。新结论先由三线审查形成，随后主审逐条回查实际代码，并独立复跑关键探针。后续修复另见 §8。

报告成稿后再经领域／集成两路独立对抗复核，修正一处上游接口引用行号后收敛，无新实质问题；宿主升级风险同时与实际安装版类型声明交叉核对。

| 检查 | 本轮结果与证据 |
|---|---|
| 类型检查／构建 | `npm run typecheck` 退出 0；`.tmp/current-state-review-2026-11-18/typecheck.log` |
| 全量单测 | `npm test`：337/337，失败、取消、跳过均为 0；`.tmp/current-state-review-2026-11-18/test.log` |
| 未来事件、导出元数据 | 两个独立探针复现 R1、R8；同目录 `context-probe.mjs`／`.log`、`export-probe.mjs`／`.log` |
| 实际安装版空会话渲染 | 执行 rc.1 产物中的真实视图函数，复现 R2；同目录 `blank-view-probe.mjs`／`.log`。使用受控 hooks，未执行完整 React／Electron |
| 维护、坏缓存、键、排空、动态根 | 主审复跑 `.tmp/domain-review-2026-11-18/probe.mjs`，六组断言通过；结果在 `.tmp/current-state-review-2026-11-18/domain-recheck.log` |
| 等待者取消 | 主审复跑 `.tmp/domain-review-2026-11-18/flush-cancel.mjs`，复现取消后仍等待；结果在 `.tmp/current-state-review-2026-11-18/flush-cancel-recheck.log` |

真实 LLM 写作质量、external embeddings 效果、完整空会话浏览器／Electron 流程、真人审批、发布后 registry 安装均未在本轮验证。337 个单测通过不能替代这些验收，也不能否定已由故障注入复现的缺口。

## 8. R1–R10 修复与验收

用户批准先提交再修复。恢复点 `56bd0302817430ab30ae882debcec56baea4e00c` 已提交，修复位于 `codex/fix-review-2026-11-18`；计划与审查过程见 `docs/review-fixes-plan-2026-11-18.md`。批次 C 新领域能力及宿主升级未混入本轮。

| 问题 | 修复结果与行为验证 |
|---|---|
| R1 | 二级事件章标题按目标章过滤，支持0–3个Markdown前导空格；子标题继承、围栏示例不改变章锚。full／assist实际请求及纯函数反例验证 |
| R2 | 复用安装版 `conversation.hero.options`，首轮前可执行初始化；同一会话切换预设会重检。真实命令/磁盘桥验证11项 |
| R3 | 待办按章hash与partial／complete阶段幂等；核对活跃及新旧归档，缓存重建不回流。显式mark通过持久轮次重新投递；在待办→章节锁内复核正文及维护记录指纹，旧恢复不能占用新轮次 |
| R4 | partial不按完整维护跳过，公开重算能修复；同版本重抽不要求省略已通过条目，工具与面板统计继续提示待维护。同版迟到partial不能覆盖完整缓存 |
| R5 | 维护业务读取校验记录及抽取条目的最小形状，坏JSON形状按缺失重建；真正IO故障保持响亮失败 |
| R6 | 序列化拒绝不能往返的键；writer_update保留JSON自有键交给领域校验，`__proto__`不被吞掉。真实保存拒绝且原文件字节不变 |
| R7 | 按实际存在目录监听，覆盖空实体目录与一层空卷；修正卷文件读取路径遗漏。首文件新增/改删/卸载退订共23项专项通过 |
| R8 | 三格式均优先使用project书名作者，旧outline元数据兼容回退；7项导出服务测试通过 |
| R9 | 排空登记完整维护生命周期及连续版本补跑，等待者可取消且不取消共享后台；双项目、重复改稿及取消回归通过 |
| R10 | 当前发布矩阵与命令对齐0.2.2-rc.1、cordis4.1.0、schemastery3.19.0、Node≥24.9，说明会话根语义与独立升级验收；十二包打包入口检查通过 |

独立审查发现的事件边界、阶段幂等、partial完整性、双实例新版覆盖、显式mark和排队旧投递均先补反例观察失败，再修复并复审。回归没有用放宽断言或固定睡眠代替条件门控。最终检查结果由实施计划末条记录。

最终 `npm run typecheck` 退出0，`npm test` **366/366**（净增29，失败/跳过/取消均0），十二包打包入口及 `git diff --check` 通过；独立审查已收敛。修复提交为 `4b95786`、`e0833dc`、`b6c18be`、`2ae9648`、`436a633`，未推送。

客户端使用安装版宿主外壳/React/基元、真实命令运行时和临时磁盘验证；普通工作台28页面/宽度组合、亮暗主题、旧初始化、宿主输入区恢复及Node harness均通过。完整Electron profile、干净profile重装和真实模型/embedding效果未在本次修复复验，不以受控夹具冒充这些验收。证据保留在 `.tmp/review-fixes-2026-11-18/`。
