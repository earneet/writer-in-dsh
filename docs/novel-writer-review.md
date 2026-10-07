# novel-writer 实现与工作流对抗审查报告

> 状态：**定稿（四轮对抗审查-复核迭代收敛，终审裁定：可定稿）**
> 审查对象：`references/novel-writer`（v0.4.0-1470-g87a11bb8）
> 审查目的：评估其实现与工作流的合理性，为「以 DeepSeek Harness 插件形式复刻」给出吸纳/改进裁定。
> 方法：三路独立对抗审查（架构 A / 工作流与领域模型 B / 实现质量抽样 C）→ 交叉复核 → 报告 → 迭代复审直至无新有效建议。

## 1. 审查方法与证据基础

- 三路对抗审查各自独立进行，材料含 `docs/` 设计文档、`AGENTS.md`/`CLAUDE.md`、`packages/writer/src/` 抽样代码。
- 复核方（主会话）独立抽查的关键证据（第二轮复审逐条核对属实）：
  - `src/agent/tool-loop.ts:178`：`streamAI(messages, tools)` 仍无 signal 参数——roadmap 问题 1 的 abortSignal 穿透未完整落地（wall-clock 预算已实现）。
  - `src/filesystem/dual-write.ts:10-44`：单连接 SQLite + 全局 Semaphore(1) 串行化为「A-2 短期缓解」，RAG 写/读路径/零散审计写未接入，残余脏读与丢写风险由代码注释自认。
  - `src/agent/tool-loop.ts:290-735`：熔断体系（连续失败/重复调用滑动窗口/业务错误预算/W8 配对补发）实现与文档一致。

## 2. 架构审查结论（A）

**吸纳（7 项）**：① 领域数据模型（章节主序列 + ideas→plot_points→outline 单向流，`architecture.md` §1.1 / `data-model.md` §2.5）；② 伏笔单记录全生命周期 planned→planted→resolved + milestones JSON；③ AI 输出预览不自动持久化原则；④ rewrite 自适应补丁协议（`{find,replace}` 唯一命中才替换）；⑤ read-before-update + 乐观锁双重校验；⑥ 流式首包 watchdog 分层思想（归属待复核，见 §5）；⑦ 窗口化大纲注入 + 前几章分层注入 + principles 全量不截断（领域上下文知识，不与宿主压缩重叠）。

**简化后吸纳（6 项）**：① 双写只留「原子性意图」不留实现——改为 **Markdown 先写成功 + 索引随后更新/失败标脏重建**（原实现单连接 Semaphore 全局写锁自认缺口，见 §4）；② content_hash + 启动校验方向反转为「Markdown 永远赢、索引永远可重建」；③ 章节排序解耦思想保留，排序键只存派生层（文件名序号即 chapter_number）；④ Hook 的「配置式优先 + 核心后处理不可禁用」边界保留，但 llm_task/context_inject 直接映射为 dsh skill，**不建 HookEngine**（优先级 7.5 浮点九档体系过度且 order 未实现）；⑤ pending_facts 确认管道留流程砍规模（6 维度 5 状态机 → 3 维度 3 状态起步）；⑥ key_events stale 标记思想留、实现简化为 frontmatter。

**抛弃（6 项）**：① outbox + 死信队列 + OutboxPoller 全套（进程内推送用微服务三件套，自己开了 7 处豁免清单 + grep 门禁）；② Effect 3.x DI + 30+ Service（三自败信号：ChatService 因割裂事务被删、withWritePermit 需「存量豁免裁定」、40 服务×3 样板；Effect fiber 并发正是单连接事务互踩根源）；③ 记忆 L0-L3 + 两层压缩 + scope 双域全套（1117 行设计九个旋钮；truncateL3 从未按设计生效、召回失败率 83% 自曝；属宿主职责，插件重建违本仓库 AGENTS.md；仅偷 project_state 概念且应改为 Markdown 派生生成物）；④ SubAgent 双重超时/防遗忘/记忆模式/嵌套（936 行设计，宿主原生能力）；⑤ C/S 三通道 + 三客户端 + 写作锁心跳 + 冲突协调（单用户为假设性多端付连锁复杂度，含桌面 sidecar 孤儿进程问题）；⑥ FTS5 辅助表 + sqlite-vec/ChromaDB 常驻双轨（检索策略值得留，基建按「可全量重建的派生缓存」降级，ChromaDB 直接砍）。

**A 的待复核项（转 §5）**：① dsh 宿主是否已有流式 watchdog 等价物；② project_changelog 对宿主 resume 的价值；③ all-MiniLM-L6-v2 384 维对中文小说语料的效果无评测数据；④ 4000 测试对并发竞态的真实覆盖（A 未运行测试）；⑤ .wpb 便携包与「索引可重建」原则的冲突。

## 3. 工作流与领域模型审查结论（B，产品/领域视角）

**吸纳（9 项）**：① Markdown SoT + 派生索引可重建（全项目最正确的设计，writer-store 骨架）；② 伏笔状态机 + 「信任+确认」（三态+放弃建模精准，自动标记可撤回；完整性报告对网文连载是真需求——faq 明言同时活跃伏笔不超 5-8 条）；③ **key_events「事件=已发生的客观事实 vs 情节=计划中的安排」二分——整套设计最好的领域洞察**（防死人复活/时间线错乱），stale 标记一并吸纳；④ rewrite 补丁协议（源于真实丢句事故，普适成立）；⑤ 防剧透（未来章节事件不注入）；⑥ 「未写章节大纲自由调整 / 已写章节情节变更须一致性检查」二分规则（复刻的领域公理）；⑦ 手动写作统一保存链路 + content_hash 外部编辑检测（DSH 场景用户本就用任意编辑器）；⑧ principles 全量注入 + style_reference 概念（规则红线 vs 语感腔调）；⑨ ReviewSuggestion 结构化审稿契约（quote 定位 + rewriteOption 可直接对接补丁协议）。

**简化后吸纳（10 项）**：① 8 阶段流程降级为 onboarding 叙事/checklist（文档自认非线性，两条入口+回退已掏空阶段机；实际写作是大纲滚动细化、人物涌现）；② 分段节拍模式降为可选路径（每章 4-6 次人机往返成本高且依赖大纲有节拍；主流是「整章+选区改写」，节拍后置）；③ 上下文组装保留混合架构、砍精打细算层（≤2000 tok 窗口化/100 字摘要/四档窗口是 32K 时代遗产；128K+ 改为按窗口参数化的预算项，摘要只作兜底——有损摘要注入正是 AI 编造细节来源）；④ 保存后后处理链大幅瘦身（现一次保存 5+ 次 LLM 调用 + settle/节流/幂等/水位整套加固，复杂度自我增强；改为章节摘要 1 次 + 可选统一「保存后维护 pass」一次结构化调用产出 Markdown 待办）；⑤ 伏笔双触发保留写作前建议，保存后检测并入维护 pass；milestones 留自由 JSON 字段；⑥ ideas 保留「灵感箱 + AI 批量整理」，砍 claimRaw/审计/阈值自动触发管道；⑦ style_reference 三路径分叉统一为预注入；⑧ 审稿 5 维 → 3+1 维（文学质量/读者体验空泛，合并为一个可选维度）；⑨ 断更恢复保留分层恢复面板，project_state 落为「从章节/事件派生的项目快照 Markdown」；⑩ read(entity)/update(entity) 通用工具 + 白名单裁剪 + read-before-update/hash 双校验。

**抛弃（7 项）**：① pending_facts 六维抽取管道整体（复杂度最高单点、收益最不确定；去重依赖「设定保持最新」这一自认会失效的前提；单章可抽 40+ 条待确认作者不会逐条审；用维护 pass + Markdown 待办替代）；② 反向分析 selfcheck 模式 + reverse_analyses 表（同样循环依赖；参照学习一次 prompt 即可，做成 bundled skill 不建表）；③ 四层记忆体系（DSH 宿主已有；key_facts/decisions 落为项目 Markdown 文件）；④ SubAgent 五工具全家（宿主能力）；⑤ token 微观管理设施（4000 预算/3000 截断/15 节点降级/双 Tracker；保留 hash 版本校验语义并入 update 防护）；⑥ 独立 Hook/HookEngine（宿主插件/skill 体系替代，内置后处理写在引擎里）；⑦ 多客户端/server 架构相关。

**建议新增（6 项，复刻补上）**：① **改稿期一致性工具（最高优先）**——修改第 N 章后标记/重算下游派生物（N+1..M 摘要、人物状态、伏笔 milestone、事件描述）；现有 key_events stale 是唯一步入此方向的机制，比六维抽取有价值得多；② 卷/册结构（大纲树有卷但导出/统计/目标不按卷组织）；③ 多线叙事/POV 管理（完全缺失；章节 storyline/POV 元数据 + 按线感知的前文注入，修正「前 3 章摘要」线性假设）；④ 结构化故事内时间（key_events.timestamp 现为自由文本，无法查时间线错乱；补可选结构化时间锚）；⑤ 人物当前状态快照显式化（「人物状态时间线」，兼作弧线追踪素材）；⑥ 写作统计/日更目标（日更型用户核心功能，从 Markdown SoT 派生极廉价）。

**B 的待复核项（转 §5）**：分段模式实际使用率无数据；rewrite 补丁命中率无数据（建议查 review-reports 9-02 后续）；foreshadow-detect 误报率无数据；90 秒合并等待体验；创作准则阶段可否并入项目创建；project_state vs 恢复面板二选一未验证。

**B 总评**：领域洞察（事件vs情节、伏笔状态机、变更二分、补丁协议）是真金；复杂度大头（六维抽取、四层记忆、SubAgent、token 微观管理）是「独立全栈产品 + 小窗口模型时代」的基建税，DSH 复刻借宿主能力全部卸掉，省下的复杂度预算花在真正缺失的改稿期一致性、卷结构、多线 POV 上。

## 4. 实现质量审查结论（C，抽样：tool-loop / dual-write / outbox-poller / hybrid-retriever / subagent / fact-extract / schema / 测试盘点，未全查 382 文件）

- **abortSignal 现状（roadmap 问题 1）：修了一半**。provider 层已完整支持 externalSignal 并联动 abort fetch（`src/ai/providers/provider-utils.ts:338-348`、`ai-service.ts:186`，openai/deepseek/anthropic 均接线有测试）；SubAgent 路径已用（`subagent/service.ts:453`）。但主 tool-loop 三入口仍不传 externalSignal（`tool-loop.ts:475-477` 注释自认），`executeTool` 仍无 signal；externalSignal/watchdog/Fiber.interrupt 三种取消语义并存。（与复核方自查 `tool-loop.ts:178` 一致，**确认**。）
- **tool-loop 质量：文档所述全部落实且超出**。业务/基础设施错误二分（`tool-loop.ts:40-51`）+ 纠正预算（:35,:725）+ 重复检测 JSON 键序归一化（:138-149）+ 乒乓滑动窗口（:300-301,:684-687）+ dedup 豁免防假熔断（:669）+ 熔断/breakLoop 补发 batch_aborted 防孤儿 tool_call（:604-623）。815 行单 Effect.gen，复杂度热点也是精华。
- **双写一致性**：acquireUseRelease 全退出路径回滚（:96-130）、withWritePermit 死锁不变量（:42-44）、跨进程目录锁（:136-138）。**未发现全局启动一致性校验**（仅 outline-drift 标记与导入时 FTS rebuild）——与文档宣称的启动校验有出入（待 A 复核）。残余缺口代码注释自述：RAG 写、读路径脏读（:38-40）。（与复核方自查一致，**确认**。）
- **outbox-poller 质量高**：租约式 claim 回收（:88-97）、次级排序（:105-108）、死信迁移同事务（:196-209）、guarded 防守护死亡。但修复编号层积（A-2/D-4/D-5/W-18…），补丁考古严重。
- **hybrid-retriever 小缺陷**：chunkId 缺失时 fallback key `${documentId}-fts${i}` / `-vec${i}`（`rag/hybrid-retriever.ts:91,:107`）导致同一 chunk 在两路无法合并去重；RRF + 单边失败静默降级（`Promise.allSettled`）实现良好。
- **复杂度热点**：`service/chapter.ts` 51KB、`outline.ts` 49KB、`pending-fact.ts` 35KB、`plot.ts` 35KB、`subagent/service.ts` 1021 行、`memory/compression.ts` 30KB、`schema.ts` 673 行 27 表。事实抽取的纯函数域拆分（`fact-extract.ts:26-29` re-export 保持路径稳定）值得学。
- **值得照抄 5 模式**：① 错误二分 + 纠正预算的 agent loop 熔断；② 孤儿 tool_call 配对收尾（任何提前 return 为同批未执行工具补发合成结果）；③ settle「读己之写」收敛原语（取消防抖 + hash 锚定 + inflight 去重，`service/fact-extract.ts:37-52,100-105`）+ 启动对账（`subagent/service.ts:32-63` 僵尸任务统一 failed）；④ dualWrite acquireUseRelease 全退出路径回滚语义；⑤ 事故驱动注释文化（每个 workaround 注明真实事故日期与现象）。
- **避开 3 坑**：① 单连接 SQLite 事务跨异步 fs 写 → 全局 Semaphore 排队一切写 + 手工死锁不变量 + 大量未包裹残余缺口——复刻应 Markdown 先写、索引异步可重建，勿跨 fs 持事务；② abort/取消语义应设计期统一（三套并存 + 主循环未接线 + 「重试外部取消」陷阱是前车之鉴）；③ 巨型单函数 + 补丁考古（runToolLoop 815 行），纯函数域拆分起步就该做。
- **测试印象**：400 个 .test.ts 按模块镜像 src + 少量 colocate，约 4000 用例；关键路径（provider 取消透传、双写、outbox）有针对性测试，覆盖印象良好。仅抽样印象。

## 5. 交叉复核：分歧、确认与修正

**三路独立审查的收敛点（高置信）**：
- Markdown SoT + 索引可重建是全项目最正确设计（A/B 一致，复核方确认）。
- 伏笔状态机、key_events「事件vs情节」二分、rewrite 补丁协议、「未写自由调/已写须检查」二分——领域洞察真金（A/B 独立均列吸纳）。
- 六维事实抽取管道、四层记忆、SubAgent 基座、Hook 引擎、token 微观管理——复杂度大头应抛弃或交宿主（A/B 独立裁定一致；C 的实现证据支持：pending-fact.ts 35KB、memory/compression.ts 30KB、subagent/service.ts 1021 行均为复杂度热点）。
- 双写实现的残余缺口（C 发现 + 复核方独立确认 dual-write.ts:38-40 自述）。
- abortSignal 半修复（C 发现 + 复核方独立确认 tool-loop.ts:178）。

**复核方解决的开放项**：
1. 【A-⑥ watchdog 归属】**已裁定：属宿主职责，不吸纳为插件自建**。dsh 宿主 llm 层自带流空闲 watchdog：`references/deepseek-harness/docs/subsystems/llm-streaming.md` L302——两个发行 remote adapter 均暴露有限 `streamIdleTimeoutMs`（默认 5 分钟），仅在 `next()` 未决时武装，超时映射 TIMEOUT、更早的调用方中止保持 ABORTED。A 的「吸纳 watchdog 思想」修正为「确认宿主已覆盖」。
2. 【B-rewrite 命中率】**有实测数据**：`docs/review-reports/writing-pipeline-log-review-20260903-1333.md` L46——三章共 8 次 rewrite 全走补丁模式（命中 2/3、3/4、1/1、5/5），未命中仅告警不误替换，丢句守卫零误报。补丁协议吸纳裁定获得实证支持。
3. 【C-启动一致性校验】C 未发现全局启动校验，与 `docs/data-model.md` 宣称存在出入——采信 C 的代码证据（仅 outline-drift 标记 + 导入时 FTS rebuild 两个局部机制）。对复刻无影响：我们的原则是「索引永远可重建」，全局对账属必做项而非可选项。

**保留为开放项（无数据，不阻塞裁定）**：
- 分段节拍模式实际使用率（B 推测「整章+改写是主流」合理但无埋点数据；复刻把节拍后置即可规避）。
- foreshadow-detect 误报率（影响维护 pass 的提示词设计，实现期再调）。
- all-MiniLM-L6-v2 对中文小说语料效果（无评测；复刻应把 embedding 后端做成可换配置，先用后评）。
- 4000 测试对并发竞态的真实覆盖（C 未运行；双写残余缺口的存在已说明上限）。
- .wpb 便携包与「索引可重建」的冲突（倾向抛弃便携包；DSH 场景项目即 git 仓库，打包需求弱化）。
- 外部变更的反应式通道（FileWatcher + 500ms 合并事件注入）是否可复用 dsh 宿主文件监听未核查——当前裁定只依赖被动 hash 检测（update 前对比），实现期需确认宿主 workspace/fs 是否提供变更事件（第二轮复审补充）。
- project_changelog 对宿主 resume 的价值（低优先，复刻用 git log + 派生快照可覆盖大部分需求）。

## 6. 综合裁定：吸纳 / 简化后吸纳 / 抛弃 / 建议新增

### 6.1 吸纳（直接进入复刻设计基线）

| # | 项 | 证据 |
|---|---|---|
| 1 | Markdown SoT + 派生索引可重建 | A/B 一致；product-vision.md 原则二 |
| 2 | 伏笔状态机 planned→planted→resolved/abandoned + 信任+确认 + milestones（自由 JSON） + 完整性报告 | B；data-model.md §2.5 |
| 3 | key_events「事件=已发生事实 vs 情节=计划」二分 + stale 标记（frontmatter 化） | B（最佳领域洞察）；A-简化⑥ |
| 4 | rewrite 自适应补丁协议 `{find,replace}` 唯一命中才替换 + 大改回退全文 + 丢句守卫 | A/B 一致；且有实测数据（§5.2） |
| 5 | read(entity)/update(entity) 通用工具 + 白名单裁剪 + read-before-update + content_hash 双校验 | A/B 一致 |
| 6 | 防剧透（未来章节事件不注入） | B |
| 7 | 「未写章节大纲自由调整 / 已写章节变更须一致性检查」二分公理 | B；product-vision.md |
| 8 | principles 全量注入 + style_reference 概念（统一预注入） | B-吸纳⑧+简化⑦ |
| 9 | 手动写作统一保存链路 + 外部编辑 hash 检测 | B |
| 10 | ReviewSuggestion 结构化审稿契约（3+1 维） | B-简化⑧ |
| 11 | 领域数据模型骨架：章节主序列 + ideas→plot_points→outline 单向流 | A |
| 12 | 混合上下文架构：预注入核心 + 工具按需查（预算按模型窗口参数化） | B-简化③ |
| 13 | Agent loop 错误二分 + 纠正预算 + 重复检测 | C（实现模式①②）。**实现形态注记（第 5 轮确认）**：工具循环属宿主所有，不自建 loop；宿主已内置 `dsh-repeat-tool-reminder`（精确重复 3/5/8 次建议性提醒，`PostToolDecision` 支持阻止）、`dsh-tool-call-timeout-policy`、`agent/request-error` 重试（llm-streaming.md L300）；「业务/基础设施错误二分 + 纠正预算」应以 **dsh guard 插件形态**实现（挂 `tools/post-execute`；guard 本就是插件形态，见 `packages/guard/repeat-tool-reminder/README.zh.md`），孤儿 tool_call 配对收尾归宿主 loop 职责 |
| 14 | settle「读己之写」收敛 + 启动对账 | C（实现模式③，用于维护 pass） |
| 15 | **全书一致性检查**（ConsistencyCheckService：拉 plot_points/outline/key_events/principles + 已写章节正文，AI 比对输出结构化矛盾报告，预览不自动持久化）+ 世界观一致性检查（条目间冲突 / 条目 vs 章节） | `architecture.md:89`、2026-06-21-phase2 spec（第二轮复审补充，与 §6.4-1 改稿期一致性协同设计） |
| 16 | **导出子系统**：TXT / ePub / HTML（打印 PDF）+ XSS 转义；补按卷组织 | `README.md` 特性表、`src/export/`（第二轮复审补充，ePub 生成是有实现量的交付物） |

### 6.2 简化后吸纳

| # | 项 | 简化方向 |
|---|---|---|
| 1 | 双写原子性 | 只留意图：Markdown 先写成功 → 索引异步更新/失败标脏重建；绝不跨 fs 持事务 |
| 2 | 8 阶段流程 | onboarding checklist skill，不做流程状态机 |
| 3 | 分段节拍模式 | 可选路径后置；整章+选区改写优先 |
| 4 | 保存后处理链 | **默认裁定（第 5 轮确认）：保守两次调用为基线**——①章节摘要（流畅文本）②事实/伏笔/人物状态抽取（精确引用），两者目标函数不同；单次合并方案作为后续优化项，仅当实测两次调用的延迟/成本不可接受且合并输出质量达标时启用。任一方案的硬约束：分节 JSON schema + 抽取引用（章节/人物/伏笔 id）存在性校验 + 按最大子任务预算 maxTokens + 失败按节重试。实证依据：fact-extract maxTokens 8000→12000 仍截断、伏笔检测需独立 240s 超时档、抽取引用脏值致入库失败为复发性问题（`writing-pipeline-log-review-20260903-1333.md`）。**宿主注记（第 5 轮确认）**：dsh llm 缝直连路径不提供 provider 级 JSON-schema 强制，校验是插件侧责任（可复用 `assertSupportedJsonSchema`/`validateJsonSchemaValue`；subagent `outputSchema` 有「请求 schema 不保证得到」语义，subagent.md:288） |
| 5 | ideas 灵感 | Markdown 清单 + 一次 LLM 批量整理，砍 claimRaw/审计/阈值触发 |
| 6 | pending_facts | 整体并入维护 pass 的待办产出（3 维度起步） |
| 7 | project_state | 从章节/事件派生的项目快照 Markdown（维护 pass 顺带更新） |
| 8 | 卷/册 | 大纲树加卷级节点（node_type 现为自由文本、无显式卷语义，`schema.ts:283`），统计/导出/目标按卷组织 |
| 9 | 检索基建 | 向量+关键词混合检索策略保留；FTS5/向量库均为可全量重建的派生缓存，ChromaDB 砍 |
| 10 | 断更恢复分层面板（进度/前情提要/变更提醒，按时距分级） | 纯展示逻辑从 SoT 派生（原 B-简化⑨，自 §6.1 移入）。**时间来源注记（第 5 轮确认）**：Markdown SoT 不含时间戳、file mtime 换机失真，「时距」以 git log 提交时间为准 |
| 11 | 版本历史/回滚 | **git 覆盖章节版本史**（复刻场景项目即 git 仓库，versions 表/undo_log 不重建）；仅留 content_hash 乐观锁语义用于 update 防护。**提交策略注记（第 5 轮确认）**：插件默认不自动 commit；提供可选「存档点」工具（显式触发 git commit，配置开关），派生索引进 .gitignore |
| 12 | 权限三级合并（allow/ask/deny） | 映射 dsh approval 子系统 + 插件 config，不建独立 PermissionManager。**落点注记（第 5 轮确认）**：ApprovalPolicy 旋钮仅 ask/never 两值（config-catalog.md:4089）；三级表达落在 `tools/pre-execute` 类型化决策（return `ask` 经 `ctx.approval` 应答）+ `ctx.tools.guard()` 单调 deny，勿误写为 policy 旋钮 |
| 13 | 人物关系网络（relations） | **简化后吸纳**（第三轮复审补充）：落为 Markdown（人物 frontmatter 邻接清单或独立关系文件），按需查询注入；不建 character_relations 独立表。证据：`service/relation.ts` 13KB + `schema.ts:60-79` + relations 为写作 Agent read(entity) 白名单 9 entity 之一（AGENTS.md 模块 5「人物引擎——关系网络」） |

### 6.3 抛弃（交宿主或不做）

| # | 项 | 理由 |
|---|---|---|
| 1 | outbox + 死信队列 + OutboxPoller | 进程内同步用微服务三件套；本仓库 AGENTS.md 明令 |
| 2 | Effect DI + 30+ Service | 三自败信号（A）；dsh 的 Cordis ctx 即服务层 |
| 3 | 四层记忆 L0-L3 + 两层压缩 + recall 体系 | 宿主 compaction 职责；truncateL3 未按设计生效、召回失败率 83% 自曝 |
| 4 | SubAgent 五工具 + 双重超时 + 记忆模式 | 宿主 subagent 原生能力 |
| 5 | C/S 三通道 + 三客户端 + 写作锁心跳 | 单用户假设性多端税；DSH web client 即 UI |
| 6 | 独立 HookEngine | dsh skill + 插件事件替代；核心后处理写在引擎里 |
| 7 | token 微观管理（预算/截断/降级/双 Tracker） | 128K+ 时代过度；留 hash 版本校验语义 |
| 8 | 流式 watchdog 自建 | **宿主已覆盖**（llm-streaming `streamIdleTimeoutMs` 默认 5min，§5.1 实证） |
| 9 | 反向分析 selfcheck + reverse_analyses 表 | 循环依赖；**参照学习模式保留为 bundled skill 交付物**（列入实现盘点，勿因在本表而漏） |
| 10 | abort 体系自建 | 第一版就把 abort 语义交给宿主（Turn signal 贯穿 llm 层与工具执行），避免三套并存的前车之鉴 |

### 6.4 建议新增（复刻要补的，按优先级）

1. **改稿期一致性工具**（B-新增①，最高优先）：修改第 N 章 → 标记/重算 N+1..M 的派生物（摘要、人物状态、伏笔 milestone、事件描述）；与原项目保留的只读 impact-analysis 工具（`architecture.md:89`）合并考虑，免实现者疑惑归属。**依赖注记（第 5 轮确认）**：人物状态的重算载体是 #4 人物状态时间线——实现顺序上 #4 的数据结构先于 #1 的人物状态部分落地。
2. 多线叙事/POV：章节 storyline/POV 元数据 + 按线感知前文注入。
3. 结构化故事内时间锚：可选相对天数/日期，审稿才能真正查时间线矛盾。
4. 人物状态时间线显式化（人物弧线追踪素材）。
5. 写作统计/日更目标（从 SoT 派生，廉价且是日更用户核心）。

## 7. 对复刻方案的直接启示

1. **复杂度预算再分配**：原项目约 60% 复杂度花在通用基座（记忆/SubAgent/事件/多端），复刻全部卸给宿主；省下的预算投给 §6.4 的领域缺口。
2. **存储纪律**：一切写路径 = Markdown **原子写（temp + rename）**先落盘（含 frontmatter 状态）→ 派生索引异步更新；任何 DB/索引损坏不阻塞写作，重建命令一键恢复。半写文件是「索引可重建」的隐性破坏者，原子写是硬要求。
3. **LLM 后处理收敛为「维护 pass」单一入口**，但遵守 §6.2-4 的实证约束（分节 schema / 引用校验 / 按最大子任务预算 / 按节重试，必要时摘要与抽取分两次调用）；settle 收敛语义（C-模式③）保证读己之写；产出 Markdown 待办清单由人确认——「AI 建议、人裁决」。
4. **取消/超时/重试信任宿主**，前提是**所有 LLM 调用（含维护 pass）必须走宿主 llm 能力缝**——插件内直连 SDK 会使 watchdog/abort 论证失效。中止传播的宿主实证（第 5 轮补引）：`ctx.tools.execute()` 必填调用方 signal、注册表将任何信号替换与调用方信号熔合、around-dispatch 承载 timeout/retry（`docs/subsystems/tools.md` L182/L314-323/L631；`exec.signal` 必须被工具体观测）。另注：dsh watchdog 实证仅覆盖两个发行 remote adapter，reasoning 模型长思考行为（novel-writer 曾因 600s 总帽整段丢弃后提额 1800s）实现期需实测一次。插件工具只须「在中止时尽快结算」。
5. **实现风格**：纯函数域拆分起步就做（fact-extract 模式）；事故驱动注释；禁 800 行单函数。
6. **迭代与收敛**：审查-复核迭代过程见 §8。

## 8. 迭代记录

- 轮次 1（完成）：三路独立对抗审查（A 架构 / B 工作流与领域 / C 实现质量抽样）→ 复核方独立抽查三项关键证据（abortSignal、双写缺口、熔断体系）交叉验证 → 解决 2 个开放项（dsh 宿主 watchdog 实证覆盖；rewrite 补丁命中率实测数据）→ 形成 v1。
- 轮次 2（完成）：独立复审员对报告本身对抗复审——核心事实断言抽查全部属实；提出 5 条必改（一致性检查与导出子系统结构性遗漏、维护 pass 合并方案实证风险对策缺失、占位符残留、断更恢复归类错误）+ 4 条可选（git 覆盖版本史裁定、宿主 llm 缝前提、FileWatcher 开放项、原子写），全部采纳修订为 v2。另由复核方补充验证：83% 出处（`memory-and-context-design.md:344`）、POV 缺失（全文档 grep 无机制）、outline 无显式卷类型（`schema.ts:283`）。
- 轮次 3（完成）：独立复审员对 v2 对抗复审——7 项二轮修订全部正确落地；5 条裁定抽查全部属实（watchdog/补丁命中率/streamAI 签名/一致性检查/卷语义）；提出 1 条必改（relations 裁定结构性缺失，全文零处提及）+ 1 条可选（impact-analysis 归属标注），均采纳，修订为 v3。复核方同步验证 `architecture.md:89` ConsistencyCheckService 断言属实。
- 轮次 4（完成·终审）：独立终审员核验第三轮 2 处修订均正确落地（relations 裁定证据抽查属实、impact-analysis 双向引用闭环）；全文通读无相互冲突条目；**无新有效建议，裁定收敛可定稿**。未验证项（如实标注）：README 特性表全文、manual 7 份手册逐份扫描、C 路抽样代码行级复核未重跑。
- 轮次 5（完成·用户委托代审）：两位独立审阅人（D1 决策者视角 / D2 事实与可实现性）+ 复核方逐条二次确认。D2：novel-writer 侧断言抽查 6 项全部属实（一致性检查字段/worldbuilding spec/export 实现/relation.ts/断更恢复 §11），dsh 宿主假设核查通过（skill 可承担 onboarding），内部一致，**无必改项**；2 条低严重度实现注记（approval 三级落点、宿主不强制结构化输出）已并入 §6.2-12/§6.2-4。D1：7 条发现全部二次确认成立（1 条部分驳回其结论——guard 即插件形态，熔断语义可实现，但措辞修正为 guard 插件形态；abort 传播断言成立并补引 tools.md；维护 pass 定默认方案；git 提交策略/依赖标注/bundled skill 交付物/时间来源 4 条注记），全部修订落地。附带信息级发现：原项目自身审计 w10 记录一致性检查实现有 12 章/8000 字截断与 5 维度契约出入，复刻设计时参考。
