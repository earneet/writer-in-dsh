# writer-in-dsh 当前实现审查与优化安排

> **任务来源**: 用户要求先从 Git 更新本项目及引用项目，再审查领域功能复刻情况、设计合理性与优化顺序；Agent Loop 由 dsh 宿主插件提供。
> **任务内容**: 更新并记录版本基线，对照 novel-writer 设计与 dsh 插件契约检查当前实现，逐条复核发现，形成分阶段优化建议；本轮不实施功能修改。
> **参考文档**:
> - `AGENTS.md` — 项目边界、存储原则与审查流程。
> - `references/novel-writer-analysis.md` — 原功能分析与领域层复刻映射。
> - `references/dsh-plugin-research.md` — 宿主能力缝与插件形式研究。
> - `docs/implementation-plan.md` — 当前包职责、迭代记录与已知限制。
> - `references/novel-writer/docs/` — 更新后的原项目设计与实现参考。
> - `references/deepseek-harness/` — 更新后的宿主源码与契约参考。
> **生成日期**: 2026-11-17
> **后续状态**: 用户已授权执行七项 P1 修复；修复及收敛复审已完成，最终类型检查通过、315/315 测试通过。详见 §9。以下 §1–8 保留原始审查时点的事实与裁定，六项 P2 仍待后续处理。

## 1. 结论与范围

**领域层主干已经搭齐，插件架构方向合理；当前主要问题是关键路径的正确性和验收深度，尚不能把“各阶段收口”理解为全部设计能力已兑现。**

本轮保留 7 项 P1、6 项 P2。P1 表示应优先修复的当前缺陷；P2 表示后续可靠性或交互改进。没有仅凭复杂度或架构偏好立 P0。全量测试通过与这些问题并不矛盾：现有测试没有覆盖相应的真实请求内容、故障组合或宿主行为。

本轮执行了三线并行审查，再由主审重新定位源码、核对影响与复现条件；部分关键探针由主审独立复跑。报告只保留复核成立的结论。本轮未修改功能代码，未应用 .ai-review 中的候选补丁，未提交或推送。

## 2. Git 更新与验证基线

| 对象 | 更新前 | 更新后 / 结果 |
|---|---|---|
| 本项目 main | 22106638b81b12f7f2af8dc45ffd210dccc90309 | 相同。fetch 后 origin/main 为 875fa3d41f84181de4426551d639a00b97b39a75；本地领先 25、落后 0，快进合并返回 Already up to date |
| novel-writer | c784f251e9b32342cccd7717317f65684d0273a2 | f42c74a9239488ab12cbe672c8deafb4c2d59bc8，远端 master |
| deepseek-harness | 22ddee3792402c3e70ec5f86a63c3e3e895a2f60 | 39163dd30f703a79079e2d2446545cff3c453738，远端 master，根包版本 0.2.2-rc.3 |
| 实际运行依赖 | @deepseek-ai/dsh 等 0.2.2-rc.1、Cordis 4.1.0 | 保持原锁定版本；更新参考源码没有改动运行依赖 |
| 环境 | Windows，Node v24.15.0 | 满足最新参考宿主 Node >=24.9.0 的前提 |
| npm run typecheck | 本轮重新运行 | 退出 0，包含全包构建 |
| npm test | 本轮重新运行 | 296/296 通过，0 失败、取消、跳过 |

执行的更新操作为 git fetch origin、git merge --ff-only origin/main、git submodule update --init --remote。两个子模块指针现在是工作区改动，尚未写入父仓提交。

原有未提交文件 .ai-review/2026-11/20261112-writer-core-derived-api-removal/review.md 和同目录 002.patch 均保留。本轮新增本报告，并向 implementation-plan 追加审查记录。验证日志位于忽略目录 .tmp/current-state-review-2026-11-17/。

novel-writer 的上述区间在相关领域实现中有 4 文件、49 增 7 删，主要收紧伏笔自动回写边界、清理反向分析分支、补风格字段校验，没有新增整项领域能力；不能据此要求机械复制自动状态回写或数据库机制。来源：references/novel-writer/packages/writer/src/service/{foreshadow-commit,plot,reverse-analysis,style-reference}.ts。

本轮验证限于构建、类型检查、单测、源码调用链及临时项目/内存桩探针；没有重新完成真实 LLM、真实 embeddings、浏览器审批或完整桌面工作流验收。历史轮次的实测记录不作为本轮重新验证的证据。

## 3. 实现覆盖与架构合理性

| 设计能力 | 当前实现 | 判断 |
|---|---|---|
| 项目、准则、大纲、人物、世界观、灵感 | 通用 Markdown 实体读写 + onboarding 等技能 | 合理替代。领域 SoT 保留，专用表和流程状态机被简化 |
| full / manual | 整章生成；手工路径走宿主编辑或 writer_update | 主路径存在；manual 不需要另建引擎 |
| assist | 生成、复述守卫、追加保存 | 存在关键输入缺口，见 P1-5 |
| rewrite | 锚点补丁、全文回退、丢句告警、乐观锁 | 机制齐备，但准则没有实际注入，见 P1-6 |
| 伏笔 | 四态状态机、milestones、种植/回收章锚、写前指令 | 核心能力已落地；人工确认替代上游自动回写是合理取舍 |
| 审稿 | 3+1 维结构化建议、quote 校验、rewrite 闭环 | 领域路径存在；人物/世界观材料完整度仍需结合一致性修复补验 |
| 一致性检查 | 分批、摘要/正文输入、引用校验、截断披露、时间锚和 timeline 体检 | 覆盖声明大于实际提示输入，见 P1-7 |
| 维护与改稿 | 摘要 + 三节抽取、pending 确认/归档、区间重算 | 合理简化；失败恢复与完成判据存在缺口 |
| RAG | CJK bigram TF-IDF + 可选语义候选重排 + RRF、防剧透 | 已实现裁量方案；语义重排不等价于独立向量召回，效果尚待实测 |
| 导出 | TXT / HTML / ePub、按卷组织、转义与控制字符处理 | 目标格式能力已落地 |
| 恢复、统计、参照学习 | git 存档、派生恢复快照、统计、技能 | 合理替代；存档范围必须修复 |
| 写作面板 | 会话标签页、实体扫描、工具卡片、总线和变更订阅 | 信息面已具规模；监听覆盖与决策交互仍需补齐 |

12 包的 domain → core → provider → consumer 分工成立，core 自身不挂插件行，bundle/preset 负责组合，UI 复用宿主客户端扩展。export 消费 writer 并提供 writerExport 符合能力缝约定。未发现自行实现通用 Agent Loop、会话存储、上下文压缩、子代理调度或权限管理器。

本轮认可的设计选择：Markdown 权威来源、派生可重建、维护建议需人确认、LLM 走宿主缝、审批交宿主、技能承接软流程。节拍独立引擎、专用版本表、自动伏笔撤回体系、日更统计、卷子目录布局等既有裁定，不因上游存在就重新计为缺陷。

存储绝对 root 与尚未删除的 deprecated 派生 API 是可维护性债务，但在当前“本地 Markdown 项目”目标下，不应优先于下述正确性修复；尤其不要为未来远程 Provider 提前引入多层抽象。

## 4. 优先修复的问题（P1）

### P1-1 存档点越过小说目录，可能提交父仓无关改动

- 证据：packages/writer-tools/src/index.ts:358 使用无 pathspec 的 git add -A，:373 执行普通 git commit；:350 只确认处于任意 Git 工作树，并未限定 Git 根。
- 情境：默认 novel/ 位于父 Git 仓库中，父仓另有未提交文件或已暂存内容。子目录 cwd 不能限制 add -A 的范围，commit 也会提交整个暂存区。
- 临时父仓实测：committedFiles=["application.txt","novel/project.md"]。
- 最小修复：暂存、检查、提交均限定小说路径，保留父仓已有暂存状态；不要用全仓 reset 清理别人的暂存区。
- 验收：外部文件分别处于未暂存/已暂存状态时，小说存档只包含允许的小说权威文件，外部暂存状态保持；同时保留零提交仓库与 .writer/exports 排除回归。

### P1-2 Windows 大小写别名绕过共享写锁

- 证据：packages/writer-store/src/index.ts:70 仅归一化 projectRoot，:129 允许大小写 ID，:184 把原始 kind/id 用作资源键。
- 情境：大小写不敏感文件系统中，character/ELIN 与 character/elin 指向同一文件，却使用两条串行链。同一旧 hash 能同时通过校验。
- Windows 临时项目实测，主审独立复跑：outcomes=["fulfilled","fulfilled"]，磁盘只保留“改稿乙”。这是同进程路径，不是已裁定的跨进程锁限制。
- 最小修复：按当前文件系统的别名语义统一写锁资源身份；处理 Windows 别名时保留 Linux 不同实体的合法区分，避免要求已有档案全量重命名。
- 验收：同一文件大小写别名并发更新恰有一次成功，另一操作报告乐观锁冲突，未覆盖稿件。

### P1-3 待办/归档读取故障会被当作空文件后覆盖

- 证据：packages/writer-store/src/index.ts:332、:441 对 readFile 使用无差别 catch；:422 的归档迁移目标读取同样吞错，:360 的活跃待办归档读取也混淆缺失与故障。
- 情境：原文件存在，但读取遭遇 EACCES/EBUSY 等短暂错误；随后写临时文件和 rename 成功。
- 故障注入实测：各注入一次 EACCES 后，追加返回成功，pending 仅剩“新增待办”，归档仅剩“新增归档”，旧段被静默覆盖。另据源码推演，迁移目标首次读取及 appendFileAtomic 内重读均失败、随后写入成功时，还可能在覆盖后删除旧来源；单次读取失败而重读恢复时，会保留目标原文。
- 最小修复：仅 ENOENT 按不存在处理；其他读取错误立即失败，不执行任何后续覆盖/删除。沿用现有原子写即可。
- 验收：对待办、归档、迁移目标注入读取错误，原文件逐字节不变，错误明确，重试后原文与新增内容均保留。

### P1-4 领域事件越过 preset 的 isolate 边界

- 证据：packages/writer-core/src/index.ts:31 未声明事件的 Service receiver；packages/writer-store/src/index.ts:239 调用不带 receiver 的 emit；packages/writer-engine/src/index.ts:85 收到任意 chapter 事件后使用自身 writer 维护同 ID。
- 宿主机制：references/deepseek-harness/vendor/cordis/src/events.ts:168、:170 只从显式 thisArg 获取过滤器；service.ts:64 提供服务域过滤。当前安装的 Cordis 4.1.0 与该行为一致。
- 内存 isolate 实测，主审独立复跑：普通 emit 得到 ["A:001","B:001"]；绑定 A 的 WriterService receiver 后得到 ["A:001"]。
- 影响：A 项目保存 001 可让 B 项目的 001 无请求触发 LLM、派生与待办；B 无该章则产生告警。不会直接把 A 正文写成 B 正文，不能夸大为正文串写。
- 最小修复：typed event 声明 this: WriterService，store 用 ctx.emit(this, ...)；engine 发布的两个领域事件也绑定 EngineService，并核对同根多会话维护去重。
- 验收：两个不同项目的 isolate 并存时，A 保存只触发 A；B 的模型调用、派生、pending 均不变。

### P1-5 assist 没有向生成器提供正在续写的本章正文

- 证据：packages/writer-engine/src/index.ts:528 调用 assemble(request, chapter)，但 :607 的 chapter 参数没有被使用；packages/writer-domain/src/index.ts:488 只收当前章之前的前文。提示词却在 packages/writer-engine/src/prompts.ts:43 要求“从正文结尾处续写”。
- 上游设计/实现：references/novel-writer/packages/writer/src/agent/tools/write-chapter-tool.ts:1251 注入当前章末尾 2000 字；ai/prompt/templates/chapter/chapter-assist.ts:12 有独立已有内容块。
- 真实引擎配内存 store/流桩捕获：currentChapterIncluded=false，previousChapterIncluded=true。
- RAG 不能替代这个必需输入：插件可缺席，空查询跳过，packages/writer-domain/src/rag.ts:217 的严格小于章号过滤还会排除当前章。父会话读过正文也不会自动成为内部生成请求的消息。
- 最小修复：assist 必需分节中注入本章已有正文末尾，先预留预算，再填前文章节等可选上下文。
- 验收：短章包含本章已有正文；长章必保真实结尾；当前章续写位置明确，未来章仍不可见，复述守卫保留。

### P1-6 rewrite 要求遵守准则，却没有把准则传给模型

- 证据：packages/writer-engine/src/index.ts:551、:584 的补丁与全文回退只传 chapter/instruction/selection；packages/writer-engine/src/prompts.ts:32 宣称遵守准则，:49 的实际输入没有准则或风格材料。
- 上游对照：references/novel-writer/packages/writer/src/agent/tools/write-chapter-tool.ts:1366、:1374 读取准则/风格，:1379 共用改写上下文；ai/prompt/templates/chapter/chapter-rewrite-patch.ts:53 声明准则必填。
- 强制全文回退的真实引擎流桩实测：两次调用都含原章，principleIncluded=false、styleIncluded=false。
- 影响：用户仅给“加强紧张感”等改稿指令时，模型不知道视角、时代、内容红线；补丁和丢句守卫无法防止这类新增冲突。
- 最小修复：读取完整准则与受预算约束的风格材料，补丁及全文回退复用同一份输入。
- 验收：两条生成路径均包含完整准则，风格材料按预算注入，原有补丁唯一命中和乐观锁行为不变。

### P1-7 一致性检查没有消费权威世界观与人物设定内容

- 证据：packages/writer-engine/src/index.ts:281 虽读取人物/世界观，:301 的 baseline 只有准则、大纲、伏笔和事件；:321、:323 仅把人物/世界观 ID 加入合法引用集合。:385 的 timeline 检查仅校验格式与章序，无法比较“失明却看见”等状态语义。prompts.ts:177 的接口也没有这些内容。
- 上游对照：references/novel-writer/packages/writer/src/service/worldbuilding-ai.ts:109、:130 注入条目全文做条目间检查，:153、:177 做设定与章节比对；本仓 docs/implementation-plan.md §1.4 已承诺这两类覆盖。
- 真实引擎请求捕获：含准则，不含人物设定、世界观规则、timeline 状态标记；桩返回后仍可产生零 issue 报告。该探针证明输入缺失，不用它评价真实模型检错率。
- 情境：“不可复活”的世界规则与章节复活情节冲突，或权威人物状态与动作冲突；无章节的纯世界观项目还会在 :296 提前拒绝检查。
- 最小修复：按预算注入权威世界观和人物状态基准；世界观条目间检查允许无章节执行；区分摘要检查与全文检查的覆盖口径。
- 验收：三类矛盾分别有端到端输入断言与固定场景验收；无章节也能检查设定，报告披露摘要、截断及未覆盖范围。

## 5. 后续可靠性与交互项（P2）

| 编号 | 复核成立的现状与证据 | 最小优化及验收 |
|---|---|---|
| P2-1 维护确认环不能从中途失败恢复 | engine/src/index.ts:252 先提交派生，:261 后追加待办；:181、:428 仅按 hash 判完成。注入一次追加失败后，主审复跑得到 maintenancePass=up-to-date、recomputeDerived=up-to-date、llmCalls=2、pendingExists=false | 把待办投递纳入完成判据，允许用现存结果幂等补投；普通重试补齐恰一节，不要求用户删缓存。追加成功而完成标记失败后重试仍只有一节；并发产生较新派生时，旧任务恢复不得删除或覆盖新结果。不以调整写入顺序或无条件删除派生代替完整恢复语义 |
| P2-2 partial 被算作完整维护 | engine/src/index.ts:250 写 partial，但 :427 与 tools/src/index.ts:294 只看 hash；实测 partial 当前缓存重算仍 up-to-date | 区分版本新鲜与维护完整；明确重算能修复 partial，统计如实披露部分失败 |
| P2-3 合法 JSON 的坏形状缓存阻断重建 | store/src/index.ts:259 只有类型断言，:285 JSON.parse 返回任意形状；null 缓存使 engine/src/index.ts:181 抛 sourceHash TypeError | 在 readMaintenance 业务边界做最小形状/版本校验，告警后按缺失重建；覆盖 null、数组、缺字段和旧形状 |
| P2-4 frontmatter 键不能无损往返 | domain/src/index.ts:63、:99 解析和序列化规则不对称，tools/src/index.ts:607 只收敛值。主审纯函数及真实 store 实测：a:b 变成 a，#memo 整键消失，保存仍成功 | 在序列化/保存边界拒绝无法往返的键；保留开放元数据，不用庞大字段白名单替代。验收无静默改名/丢键，原文件不变 |
| P2-5 面板根目录浅监听漏掉实体子目录变化 | ui/src/client/Panel.tsx:210 只监听 novel 根；宿主 fs/fs-local/src/index.ts:83 是 depth:0，当前 rc.1 产物一致，api/workspace-files/src/changes.ts:94 的观察事件也不能补全后代。watch 就绪不代表全项目已覆盖 | 继续使用宿主 changes，监听实际消费目录集合并统一去抖；仅修改已有章节/人物/伏笔而不写根文件时，面板自动更新，卸载能完整退订 |
| P2-6 maintenance_flush 等待不可取消 | tools/src/index.ts:420 只入口检查 signal，:424 无信号等待；core/src/index.ts:210、engine/src/index.ts:504 没有等待者取消接口。挂起任务探针：abort 后 flushSettled=false，释放后台 Promise 才结束 | 只取消当前等待者，不随之取消共享后台维护；验收停止后等待及时结束，后台任务仍按 Provider 生命周期收敛 |

表中短路径均位于 packages/writer-*/；宿主路径位于 references/deepseek-harness/packages/。P1-3、P2-1、P2-4 等与既有 .ai-review 待处理材料重叠；本轮重新验证现状，并不把候选补丁当作已修复。

## 6. 宿主兼容与升级策略

实际消费的 defineTool/ToolRunContext.signal、LLM GenerateOptions/BlockAssembler、skill provider、agent-preset Config/isolate、客户端 factory 加载、slots、conversation.view、workspaceFiles list/read/changes，在最新参考源码仍保留本仓使用的调用形状。此次审查未发现要求立刻强升运行依赖的接口破坏；这属于消费面静态核对，不等于新版宿主完整运行验收。

建议先保持 rc.1 修复当前缺陷，再单列宿主升级批次：统一迁移全部 @deepseek-ai/* 与 lock，做干净安装、preset/bundle 装载与真实 Web/桌面冒烟。避免新宿主下嵌套旧 tools/llm/skill 副本。

已发现的升级适配项：最新 PostToolDecision.block 增加 info，而 packages/writer-guard/src/index.ts:110 手工重建 block 会丢新增字段。升级时保留 downstream 字段后再附加纠偏上下文；这不是当前 rc.1 的故障。

## 7. 建议的优化顺序

方案自审比较了三条路线：先追平上游全部功能、先重构存储抽象、先修正确性并建立真实验收。建议第三条：能直接改善当前写作结果和数据完整性，修改边界小，也不会把 Agent Loop 搬回插件。前两条分别扩大范围、增加迁移成本，尚无足够收益支撑。

以下是建议排期，尚未作为已批准的实现方案执行。

| 批次 | 范围与建议提交拆分 | 验收出口 |
|---|---|---|
| A：先修当前正确性 | A1 存档范围；A2 Windows 写锁身份；A3 待办/归档读错处理；A4 领域事件隔离；A5 assist 输入；A6 rewrite 准则。每项独立主题，可分别审查回滚 | 对应 P1 回归复现先失败后通过；两域不串触发；跨目录不提交；失败不丢旧文；生成请求含必需材料。每批运行 typecheck + test |
| B：兑现治理能力 | B1 一致性输入与覆盖；B2 维护完成/补投/partial 语义；B3 坏缓存与 frontmatter 边界 | 权威设定矛盾确实进入检查；失败后普通重试收敛；统计无假完整；删除/损坏派生不会阻断恢复 |
| C：补真实使用闭环 | 先修目录监听与 flush 取消，验收已有全文阅读和审稿明细展示，再增强问题定位、逐条裁定、待办确认工作台，并同步过期 roadmap；操作结果经对话交给领域工具执行 | 不靠根 pending 变化也能刷新；可停止等待；用户能完成“看全文→定位问题→接受/忽略→改稿→确认维护”，不增加第二套文件写入口 |
| D：效果评测、宿主升级、发布验收 | 中文长篇固定语料检索评测；真实模型写/审/改回归；宿主统一升级单独执行；最后验证 tarball/link、headless、Web/桌面审批与导出 | 记录召回/相关性、延迟和成本；全工作流从干净项目可复现，再按 release-checklist 进行发布 |

批次 A、B 先于新增复杂功能；宿主升级不与领域正确性修复混成一个大提交。跨进程锁只有在明确支持多个 dsh 进程共用同项目时再设计，不能用进程内锁宣称覆盖它。

RAG 下一步先测而不是换数据库：固定“人名别称、无共享关键词的同义设定、跨章旧事、未来剧透”四类查询，比较关键词/LLM 重排/external 三档的相关命中、无关召回、时延、成本。确有语义漏召回再考虑独立向量候选；所有索引继续可从 Markdown 全量重建。

长期再按实测需求决定 storyline/POV 强类型、世界观与人物历史状态的可见性语义、灵感消化的稳定标识。它们需要独立小设计，不能仅靠新增 frontmatter 键就宣称功能完整。

## 8. 本轮收口与下一轮成功标准

- 本轮完成 Git 更新、当前实现盘点、三线审查、逐条复核、类型检查和全量单测；交付结论与排期建议。
- 功能代码没有修改，报告中的问题仍未修复；测试 296/296 不代表这些故障场景已被覆盖。
- 建议下一轮以批次 A 为范围，先把现有错误场景变成有意义的回归测试，再做最小修复；不同时扩功能或大规模重构。
- 每个修复阶段继续执行对抗审查、逐条复核、修复、重测，且必须包含真正的宿主契约或真实请求捕获，避免仅用宽松桩再次制造假通过。
- 报告对抗复核已纠正过期 roadmap 引出的重复实施建议：当前全文阅读及审稿原文/建议/改写方案展示已有实现（ui/src/client/Panel.tsx:813、Cards.tsx:328），后续工作聚焦定位、裁定和确认闭环；另补齐读取失败推演边界与幂等恢复的反向失败验收。

## 9. 七项 P1 修复验收（轮次 44，2026-11-17）

用户后续要求执行全部七项 P1，本轮在 codex/fix-seven-p1-review 分支完成代码与回归。具体执行计划和记录见 docs/p1-fix-plan-2026-11-17.md；没有应用无关候选补丁，也没有修改运行依赖。

| 问题 | 最终实现与验证 |
|---|---|
| P1-1 存档范围 | Git add/status/commit 均使用小说目录相对 pathspec，排除 .writer/exports，commit --only 不带入外部暂存。已有提交及首次提交两种父仓测试均验证只提交 novel/project.md，外部与排除目录的既有暂存字节保持 |
| P1-2 Windows 写锁 | 资源键在 Windows 折叠大小写；真实同旧 hash 大小写别名并发，恰一次成功，另一操作返回乐观锁失败 |
| P1-3 读取失败 | 四条待办/归档/迁移目标读取统一仅吞 ENOENT，其余响亮退出；故障回归验证旧字节不变，独立复核补验迁移二次读取 EBUSY 后安全重试 |
| P1-4 事件隔离 | core 三事件声明 receiver，store/engine 全部发布点绑定服务实例；真实 Cordis 双 isolate 监听及自动维护探针验证仅 A 触发模型，B 无新增派生或待办 |
| P1-5 续写起点 | assist 预留本章已有正文末尾的必需分节预算，短章完整、长章保尾、空章明确说明，未来章不进入输入；真实请求捕获与最终保存回归通过 |
| P1-6 改写准则 | 改写前读取完整准则及预算内风格，补丁与全文回退复用相同 user 输入；两种真实生成路径请求断言通过 |
| P1-7 一致性输入 | 按预算注入人物正文、timeline 与世界观，允许缺省或空范围对象的无章节设定检查；提示及报告披露基准截断、摘要代正文；工具空批次回执显示世界观设定 |

新增 19 个回归，原有归档迁移测试从固定睡眠 50ms 改为有界等待“新文件含原文且旧文件已删除”的真实条件。首轮全量测试确实发现该既有时序假设；没有通过放宽断言或仅增加固定等待掩盖问题。

对抗审查分数据/事件与引擎两路，主审对发现逐条复核。修复两项本轮边界问题：空范围对象与缺省范围不等价、空章节批次回执 undefined-undefined；各自先红后绿并经收敛复审。最终契约检查还发现局部成功格式化模板被软失败静态提取器误识为 XX；改用等价分支拼接，保留契约与白名单约束，复审通过。

最终证据：npm run typecheck 退出 0；npm test 315/315，失败/跳过/取消均为 0；git diff --check 通过。日志保存在 .tmp/current-state-review-2026-11-17/final-typecheck-2.log、final-test-2.log。代码与文档未提交或推送，原有用户改动及参考子模块更新保留。

验收基于真实文件系统/Git/Cordis 与脚本化模型请求，没有重新执行真实 LLM、embeddings 或完整桌面 UI 验收；六项 P2 保持原独立排期。
