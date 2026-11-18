---
schema_version: 1
audit_id: 20261118-103917-repo
created_at: '2026-11-18T10:39:17Z'
base_revision: f822f384d33d686a890d9edfc3ddff5217633d7a
scope: .
trigger: manual
previous_audit: 20261112-015026-repo
candidates: []
items:
  - finding_id: f-b72eb0b768
    kind: confirm
    title: 空 frontmatter 块被当成正文解析
    summary: '`---\n---\n正文` 的两条定界符会整段进入 content，污染正文、hash、导出与检索切片。'
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-9f03b76cec
    kind: confirm
    title: RAG 防剧透对未知 status 提前放行
    summary: 同一伏笔在组装器被跳过、在检索过滤却可见，未来伏笔正文可被提前检索。
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-cba698b9f3
    kind: confirm
    title: writer_update 传 null 落盘成字符串 "null"
    summary: 清空意图变成永久脏值，且保存成功不报错。
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-6982a698c2
    kind: confirm
    title: 导出面板承诺的"章节范围"没有任何承接
    summary: UI 收集范围并让助手传给 `export_book`，但工具与服务都没有该参数，额外参数被静默接受后忽略。
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-802a06d6be
    kind: confirm
    title: 伏笔详情把"实际埋设章"回填成"计划埋设章"
    summary: 缺 `planned_chapter` 时凭空造出计划，生命周期出现同章两次。
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-446114a037
    kind: confirm
    title: 章节扫描接受写路径拒绝的文件名
    summary: '`chapters/序章.md`、`chapters/001-副本.md` 会进入章节清单与导出，却无法按 id 读取或更新。'
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-44692322e4
    kind: confirm
    title: 写串行链按字面路径取键，别名路径并发不互斥
    summary: 同一物理项目经 junction/symlink 打开时，两会话仍可能都通过乐观锁并互相覆盖。
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-127a732a09
    kind: confirm
    title: chapter-writing 技能仍说待办含"可直接提交的 JSON"
    summary: 引擎实际只产出散文建议加 `timeline_update(...)` 配方，没有 JSON 块。
    target_files: []
    depends_on: null
    status: pending
    candidate: null
---

# 仓库审查报告

- 基线：f822f384d33d686a890d9edfc3ddff5217633d7a
- 范围：全仓库（packages/ 12 包 + 根配置/CI；references/ 子模块与 example-project 内容只读不审）
- 执行时间：2026-11-18T10:39:17+00:00

## A 类：已生成候选

- 无（本会话 shell 不可用，`gate_checks` 与 `git diff` 均无法执行；按准则不生成无法自证的候选，详见「验证与说明」）

## B 类：需人工确认（未改代码）

- **空 frontmatter 块被当成正文解析**：`---\n---\n正文` 的两条定界符会整段进入 content，污染正文、hash、导出与检索切片。
  - 位置：`packages/writer-domain/src/index.ts:53-59`（`indexOf('\n---\n', 4)` 从偏移 4 起找，空块的闭合定界符在偏移 3）
  - 风险：手编或模板生成的空元数据章节会带上两行 `---` 正文；仓库自身夹具 `---\n---\nB`（`writer-tools/tests/tools.test.ts:327`）正命中该形态，但测试只断言字段不断言 content。
  - 需要决定：把搜索起点改为 3（或显式识别空块）属解析边界修正；是否把"空 frontmatter 块合法"写入域契约，请拍板。
- **RAG 防剧透对未知 status 提前放行**：同一伏笔在组装器被跳过、在检索过滤却可见，未来伏笔正文可被提前检索。
  - 位置：`packages/writer-domain/src/rag.ts:219-227`（status 非 planned/planted 直接 `return true`）对照 `packages/writer-domain/src/index.ts:458-462`（同值直接跳过）
  - 风险：手编或 `writer_update` 写入 `status: "Planted"`、`planned_chapter: "020"` 后，第 3 章调用 `writer_search(chapter_limit=3)` 可返回第 20 章才该揭晓的伏笔块，chapterLimit 红线被绕过。
  - 需要决定：未知状态按"不可见"保守处理，还是抽出"活跃伏笔"单一谓词同时供组装与过滤；脏 status 是否在写入端加白名单（与既有候选 foreshadow-dirty-entry 的 status 治理同题）。
- **writer_update 传 null 落盘成字符串 "null"**：清空意图变成永久脏值，且保存成功不报错。
  - 位置：`packages/writer-tools/src/index.ts:604-610`（`JSON.stringify(null) === 'null'`）；入口 schema 见同文件 `:73`，允许任意 JSON 值
  - 风险：`frontmatter: {milestones: null}` 写成 `milestones: "null"`，随后 `foreshadow_update(milestone)` 在 `parseMilestones` 抛"必须是 JSON 数组"；`status: null` 则让伏笔静默退出全部活跃判断（组装器与 RAG 均不认 "null"）。
  - 需要决定：null 是响亮拒绝，还是定义为"删除该键"——当前 `save` 只合并 frontmatter，没有删键语义，两种取舍都要定公开契约。
- **导出面板承诺的"章节范围"没有任何承接**：UI 收集范围并让助手传给 `export_book`，但工具与服务都没有该参数，额外参数被静默接受后忽略。
  - 位置：`packages/writer-ui/src/client/StudioPages.tsx:119,127`；`packages/writer-tools/src/index.ts:500-508`；`packages/writer-core/src/index.ts:247-255`；要求见 `docs/ui-redesign-2026-11-17.md:125`
  - 风险：用户填 `001-025` 后实际导出全书，回执仍报"已导出 N 章"成功；已核对安装版 `node_modules/@deepseek-ai/dsh-tools/lib/index.js:274-283`，参数根是隐式开放对象，未知参数不报错，所以失败是静默的；即使模型不传该参数，助手也已被要求转述范围，结果同为全量导出。
  - 需要决定：给 `ExportRequest`/`export_book` 增加章区间（并理清与卷过滤的关系），还是删掉 UI 范围输入、明说只支持按卷；两者都改公开契约，需产品拍板。
- **伏笔详情把"实际埋设章"回填成"计划埋设章"**：缺 `planned_chapter` 时凭空造出计划，生命周期出现同章两次。
  - 位置：`packages/writer-ui/src/client/project.ts:173`（`plannedChapter: p.plannedChapter ?? p.plantedChapter ?? ''`），渲染于 `StudioPages.tsx:85`
  - 风险：回溯补录的伏笔（只有 `planted_chapter`）显示"计划埋设：003"，生命周期同时列"计划埋设 003 / 实际埋设 003"；`docs/ui-redesign-2026-11-17.md:109` 明确要求缺锚显示"未设计划，不编造"。
  - 需要决定：直接去掉回填（缺锚即"未设计划"），还是要区分"无计划锚"与"计划即实际"的展示语义；属投影口径选择。
- **章节扫描接受写路径拒绝的文件名**：`chapters/序章.md`、`chapters/001-副本.md` 会进入章节清单与导出，却无法按 id 读取或更新。
  - 位置：`packages/writer-store/src/index.ts:596-628`（任意 `*.md` 入索引）与 `:157-161`（写入侧强制三位序号）、`:692-695`（id 只剥 `.md`）
  - 风险：`writer_read` 列表可见但 `get`/`save` 报"章节 id 必须为三位序号"；导出用 `Number(id)` 得 NaN（`packages/writer-export/src/index.ts:31-34`、`render.ts:68-69`）输出"第 NaN 章"，一致性检查还会把这些文件计入覆盖。
  - 需要决定：扫描时跳过并告警（与坏 frontmatter 同策略），还是放宽章节 id 契约；跳过意味着隐藏用户文件，必须明确口径。
- **写串行链按字面路径取键，别名路径并发不互斥**：同一物理项目经 junction/symlink 打开时，两会话仍可能都通过乐观锁并互相覆盖。
  - 位置：`packages/writer-store/src/index.ts:88-104`（只用 `resolve`，未 `realpath`）；默认根 `:188-193`；别名是受支持形态（`packages/writer-store/tests/initialization.test.ts:138-150`）
  - 风险：两会话先读同一 hash H，再经真实路径与 junction 两条不同链并发 `save`，校验都通过，后写者覆盖先写者且双方都收到成功——这是串行链本要消除的丢更新，只在别名路径下复现。
  - 需要决定：链键与 `projectRoot` 是否统一做 `realpath` 归一（初始化已 canonicalize，可复用）；若不做，应把"别名并发"写入已知限制并说明后果。
- **chapter-writing 技能仍说待办含"可直接提交的 JSON"**：引擎实际只产出散文建议加 `timeline_update(...)` 配方，没有 JSON 块。
  - 位置：`packages/writer-skills/assets/chapter-writing/SKILL.md:65` 对照 `packages/writer-engine/src/index.ts:817-833`
  - 风险：模型按技能去找不存在的 JSON，或改用 `writer_update` 手拼 timeline JSON，绕过服务端时间线校验与同章覆盖语义；属执行指引漂移，不损坏既有数据。
  - 需要决定：改技能文案指向 `timeline_update` 配方（改动最小），还是恢复在 pending 中输出可直接提交的 JSON；需连带确认 pending 稳定格式是否要保留兼容期。

## 待前置合入后处理（Deferred）

- 无

## 验证与说明

- **结论**：本轮未生成任何候选，因为该会话无法执行命令；`npm run typecheck`、`npm test`、`git diff`、`git status` 一次都未能启动，以下 B 项全部为静态读码结论。
- **环境阻塞（可复现）**：`pwsh` 在进程启动前即失败——`sandbox-local: windows-acl workspace grant failed: Win32Error: SetNamedSecurityInfoW failed (Win32 5): grantWrite(F:\workspace_2\writer-in-dsh)`。前台调用、后台 job、子代理三条路径均复现同一错误。
- **尝试的修复**：按 `diagnose-windows-sandbox-acl` 技能执行一次性权限修复脚本，被"`danger-full-access` 需要审批但当前无审批通道"拒绝；未执行任何提权，也未用其他方式改权限。
- **对产出的影响**：按审查准则，`gate_checks` 必须实际运行通过、补丁必须能相对基线导出并复核，因此 A 类为空；未留下半成品候选目录，也未编造任何测试或命令结果。
- **静态审查方法**：Lead 通读 engine/store/domain 核心/core/export/rag/guard/pending/timeline；另派三个只读子代理并行审 engine+store、tools+ui、domain+rag+export；所有 B 项由 Lead 回读代码复核，并已剔除既有候选与负向记忆覆盖项（空串/布尔章锚、附录 doctype、导出空作者、recompute mark 口径等）。
- **未覆盖风险**：真实 LLM/embedding 效果、Electron/干净 profile、epubcheck、并发竞态的实际复现均未执行；B 项第 7 条依赖时序推理，第 4 条依据安装版 `dsh-tools` 参数校验实现而非运行验证。
- **收尾状态**：业务工作区未做任何改动；`.ai-review/.acl-probe` 是本次权限探针文件，因当前文件工具无删除能力而保留，可安全删除；`git status` 无法执行，故工作区洁净度未经机器复核。

<!-- ai-review:audit-verification -->
## 插件复核
- 复核时间：2026-11-18T10:52:00.843Z
- 基线：`f822f384d33d686a890d9edfc3ddff5217633d7a`
- 审查目标：全仓库
- 新增候选：0
- AI 执行：成功
- 业务工作区：已尝试还原到基线（仅保留 .ai-review/）

### 候选校验
- 无新增候选。
<!-- /ai-review:audit-verification -->

> 收尾说明：门禁未由 Host 复算（audit 期门禁为 AI 报告；批准时 Host 仍会重新执行全部门禁）
