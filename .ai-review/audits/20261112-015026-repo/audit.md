---
schema_version: 1
audit_id: 20261112-015026-repo
created_at: '2026-11-12T01:50:26Z'
base_revision: 53916889d7abb032f867e2b36b12510889e58eb1
scope: .
trigger: manual
previous_audit: null
candidates: []
items:
  - finding_id: f-b7bc3c4d58
    kind: confirm
    title: serializeEntity 对不可往返的 frontmatter 键静默损毁
    summary: 坏键三种行为不一致，需要人工定校验落点
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-84d8166dff
    kind: confirm
    title: chunkChapterText 按 UTF-16 步进切片可产孤立代理项外送 embeddings 端点
    summary: 修复简单但改变切片计量语义
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-ad0c41d20c
    kind: confirm
    title: recompute mark 语义与工具描述直接矛盾
    summary: 文案说「仅删除过期派生」，行为是连新鲜派生一起删
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-da99ad7afa
    kind: confirm
    title: engine 维护 pass inflight 去重是实例级 Map
    summary: preset 双会话同 projectRoot 同章双跑
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-c24b9d07b1
    kind: confirm
    title: writer_stats 待维护章列表无界
    summary: 长书批量改稿后单行回挂数 KB
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-6ab0a8a1dc
    kind: confirm
    title: buildZip 以 number[] 中转全部字节
    summary: 大书导出内存/CPU 放大近一个量级（Lean 档）
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-47606b0a8d
    kind: confirm
    title: writer-export 冗余导入与导出面
    summary: 库公共面取舍
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-ddffda0338
    kind: confirm
    title: writer-domain 域库导出面盘点
    summary: 零引用导出与仅内部使用导出
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-022587fe55
    kind: confirm
    title: UI 人物关系图同名人物节点同坐标叠印
    summary: 复制档案忘改名时图上只见一个点
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-25d64c9408
    kind: confirm
    title: UI bus.lastReview 零消费写死字段（连带 RecordParsers.review 接线）
    summary: M1b 对称预留未接线
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-c0118bc7b4
    kind: confirm
    title: writer-ui 诊断脚本硬编码本机 chrome 路径 + 仓外 scratch 依赖
    summary: 克隆仓即不可跑，README 却宣称为自测工具
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-8be9c7369a
    kind: confirm
    title: M1a 冻结面未消费成员盘点（防遗忘，非行动项）
    summary: 占位已挂账
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-b228c6bb7b
    kind: confirm
    title: zip DOS 时间戳全 0 与 TXT 导出无 BOM（存疑裁量）
    summary: 主流工具容忍，未见破坏面
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-df383d4c45
    kind: deferred
    title: WriterService.root 旧 API 删除
    summary: fix-plan P0-3 第二步的剩余面（`root` 在同一条裁定中列入删除面）
    target_files: []
    depends_on: f-5ac2888e63
    status: pending
    candidate: null
---

# 仓库审查报告

- 基线：53916889d7abb032f867e2b36b12510889e58eb1
- 范围：全仓库（packages/ 12 包 + 根配置/CI；references/ 子模块与 example-project 内容文件按约定只读不审）
- 执行时间：2026-11-12T10:45:00+08:00

## A 类：已生成候选


## B 类：需人工确认（未改代码）

- **serializeEntity 对不可往返的 frontmatter 键静默损毁**：坏键三种行为不一致，需要人工定校验落点
  - 位置：packages/writer-domain/src/index.ts:63-71（parse）vs 99-104（serialize 键不校验）；入口 packages/writer-tools/src/index.ts sanitizeFrontmatter（只收敛值不校验键）
  - 风险：模型传 `{"a:b":1}` 落盘回读键被改写为 "a"（类型漂移）、`{"#x":1}` 整键静默丢失，writer_read 展示错键且无告警；含换行键则响亮失败——三种行为不一致
  - 需要决定：在 serializeEntity 单点对含冒号/换行/注释前缀键响亮拒绝（错误文案与 guard 模式表同步），还是工具层键白名单；键字符集口径由人拍板
- **chunkChapterText 按 UTF-16 步进切片可产孤立代理项外送 embeddings 端点**：修复简单但改变切片计量语义
  - 位置：packages/writer-domain/src/rag.ts:47（text.slice）；外送 packages/writer-rag/src/index.ts:283（embed 整块入 JSON body）
  - 风险：astral 字符富集章节的切片边界落在代理对中间 → external 档 JSON 含 `\uD8XX` 转义，兼容端点 400 或静默替换污染向量；关键词腿仅损失边界 1 个 bigram
  - 需要决定：切片游进改码点口径会同时改变切片数与「chunkChars 字符数」计量语义（UTF-16 → 码点），属口径决策
- **recompute mark 语义与工具描述直接矛盾**：文案说「仅删除过期派生」，行为是连新鲜派生一起删
  - 位置：packages/writer-engine/src/index.ts:426-437；对照 packages/writer-tools/src/index.ts:251 与 writer-core/src/index.ts:195-196 的描述
  - 风险：用户按描述对区间 mark，以为只动过期章——新鲜章派生也被删，后续每章多花 2 次 LLM 调用重建
  - 需要决定：改文案对齐行为（行为已被 p3-integration.test.ts:296-300 锁定），还是改行为让 mark 跳过 fresh（需同步既有断言）；不能由 AI 单方面裁定语义
- **engine 维护 pass inflight 去重是实例级 Map**：preset 双会话同 projectRoot 同章双跑
  - 位置：packages/writer-engine/src/index.ts:71-72（实例字段）vs writer-store/src/index.ts:60（轮次 38 已提 module 级的同场景先例）
  - 风险：两会话并发触发同章 pass → 双份摘要+抽取调用（成本翻倍）；派生后写者胜（无损坏）、pending 双节均落盘——无数据丢失，纯成本面
  - 需要决定：仿 WRITE_CHAINS 提 module 级（键=projectRoot 归一化+chapterId）是行为改动，请裁定是否值得
- **writer_stats 待维护章列表无界**：长书批量改稿后单行回挂数 KB
  - 位置：packages/writer-tools/src/index.ts:327
  - 风险：500 章派生过期 → 「待维护 pass：001、002、…、500」≈3KB 进模型上下文；轮次 34 已为 computeSpineWarnings 做过 >20 有界摘要同型修复
  - 需要决定：同范式加界（stale>20 时前 20 + 总数）即可，价值低未单列候选，可与任一 tools 改动顺带
- **buildZip 以 number[] 中转全部字节**：大书导出内存/CPU 放大近一个量级（Lean 档）
  - 位置：packages/writer-export/src/zip.ts:93-108（centrals.map(c => [...c]) 与 locals 展开）
  - 风险：5MB 小说 epub 峰值额外 ~40-80MB 与两轮全量拷贝；正确性无虞（往返测试锁定）
  - 需要决定：parts 直持 Uint8Array 的纯内部优化（零接口变化），按 Lean 优先级裁量
- **writer-export 冗余导入与导出面**：库公共面取舍
  - 位置：packages/writer-export/src/index.ts:15（escapeXmlText 死导入）、src/render.ts:63/118（escapeXmlText/HTML_PRINT_CSS 可去 export，全仓零外部引用）
  - 风险：无运行时影响；发布包的公共 API 面含从未对外的符号
  - 需要决定：删除/降级是否与「render 系工具函数属包 API」的定位冲突
- **writer-domain 域库导出面盘点**：零引用导出与仅内部使用导出
  - 位置：consistency.ts:9-10（CONSISTENCY_DIMENSIONS/ConsistencyDimension 零引用）；index.ts:128/531/659/661（FORESHADOW_TRANSITIONS/ReviewDimension/CONTINUATION_REPEAT_MIN_SENTENCES/MIN_EFFECTIVE_CONTINUATION_CHARS 仅内部使用）
  - 风险：无运行时影响；domain 定位「可独立引用的纯函数域库」，导出面广度是设计选择——一致性检查的维度表从未被任何校验/提示词/测试消费
  - 需要决定：整删零引用项 + 降级内部项，还是保留为域库公共词汇表
- **UI 人物关系图同名人物节点同坐标叠印**：复制档案忘改名时图上只见一个点
  - 位置：packages/writer-ui/src/client/Panel.tsx:377-391（nodes 不去重而 pos 按 name 单键）
  - 风险：两个 fm.name 同值的 character 且各有关系 → 双节点叠印 + 双标签重叠，「共 2 人」但图上一点；RelationGraph 布局是组件内私有函数，需抽纯函数才好单测
  - 需要决定：nodes 按 name 去重取首者，还是布局键改 id（同名不同档应各自有节点）；涉及图语义选择
- **UI bus.lastReview 零消费写死字段（连带 RecordParsers.review 接线）**：M1b 对称预留未接线
  - 位置：packages/writer-ui/src/client/bus.ts:34/171-174、Cards.tsx 的 parsersOf('review') 链
  - 风险：无运行时影响（review_chapter 落卡走 plain 案已可用）；删除需动 3 处 + 测试
  - 需要决定：M2 若无 lastReview 消费计划可整链删除；若有计划应补接线而非保留死字段
- **writer-ui 诊断脚本硬编码本机 chrome 路径 + 仓外 scratch 依赖**：克隆仓即不可跑，README 却宣称为自测工具
  - 位置：packages/writer-ui/scripts/browser-test.mjs:8/24、scripts/outline-probe.mjs:8/14、README.md:51-52
  - 风险：任何非原开发机执行即抛错；工具可信度受损
  - 需要决定：executablePath 改 env（如 WRITER_UI_CHROME）/argv 可选覆盖，缺省让 playwright 自解析；或 README 补已知限制
- **M1a 冻结面未消费成员盘点（防遗忘，非行动项）**：占位已挂账
  - 位置：graph.ts:302-332（outlineByChapterNumber/plotsByChapter）、types.ts:166-179/324-335（paginate/Page）、parse.ts:199-227（parseConsistencyIssues）、project.ts:200（CharacterRow.arc）
  - 风险：全部有明文留痕（implementation-plan 轮次 25 / roadmap §4.1），M1a 冻结期内不可删
  - 需要决定：M2 落地时统一复核裁撤，避免占位永续
- **zip DOS 时间戳全 0 与 TXT 导出无 BOM（存疑裁量）**：主流工具容忍，未见破坏面
  - 位置：packages/writer-export/src/zip.ts:60-61/77-78（时间 0=无效日期 1980-00-00）、render.ts renderTxt（UTF-8 无 BOM + LF）
  - 风险：主流解压器/epubcheck/阅读器均容忍时间 0；旧版 Windows 记事本对无 BOM UTF-8 中文可能乱码（现代版本正常）
  - 需要决定：如求绝对稳妥可写 0x0021（1980-01-01）/TXT 加 BOM 选项，属产品裁量非缺陷

## 待前置合入后处理（Deferred）

- **WriterService.root 旧 API 删除**：fix-plan P0-3 第二步的剩余面（`root` 在同一条裁定中列入删除面）
  - 依赖：替代路径解析 API 的设计——root 当前有活跃生产消费者（writer-tools archive_point、writer-engine recoverySnapshot、writer-export 输出路径），直接删除会破坏三包；需先设计业务语义的路径方法（如 resolveExportPath/archiveAbsPath）并迁移消费者后，root 才可删。候选 20261112-writer-core-derived-api-removal 已完成第二步中零消费者的 Derived 四方法，root 部分留此待办。

## 验证与说明

- 审查方法：Lead 通读全部核心源码（domain 8 文件、core、store、engine、tools、export、rag、skills、bundle/preset 接线、根配置与 CI）+ 四路子代理并行只读深审（domain+core / store+engine / tools+skills+guard+export / writer-ui），全部发现由 Lead 读码复核后在 A/B 间分流。
- 基线验证：`npm run typecheck` 退出码 0；`npm test` 基线 286/286（执行时 HEAD=b153253，轮次 39 在审查开始后由外部合入，其触碰面 AGENTS/docs/bundle/preset 与全部候选文件零交集——所有补丁按 pathspec 相对 base_revision 53916889 导出，并已在 53916889 独立 worktree 上逐一 `git apply --check` 通过，12/12 全绿）。
- 每个候选的 gate_checks（`npm run typecheck` + `npm test`）均在修改态实际执行并通过（各候选 review.md 的验证证据节有逐项记录，测试数 286-289 视候选净增用例而定）。
- 未覆盖风险：epubcheck 未在本地执行（两个 export 候选的规范符合性依据 EPUB 2.0 规范与同书一致性判定，已在各 review.md 需人工判断项披露）；浏览器半真实渲染与 desktop profile 形态未实测（纯函数测试面 + 契约测试锁定）；external embeddings 档维持 stub 测试口径（待有 key 环境，与既有留痕一致）。
- 收尾状态：业务工作区已还原至 HEAD（仅 `.ai-review/` 新增）；未执行任何 git commit/push；基线校验 worktree 与临时日志已清理。

<!-- ai-review:audit-verification -->
## 插件复核
- 复核时间：2026-11-12T06:03:22.092Z
- 基线：`53916889d7abb032f867e2b36b12510889e58eb1`
- 审查目标：全仓库
- 新增候选：12
- AI 执行：成功
- 业务工作区：已尝试还原到基线（仅保留 .ai-review/）

### 候选校验
- `2026-11/20261112-writer-core-derived-api-removal`：存在问题：current_revision 对应的版本缺失
- `2026-11/20261112-writer-domain-anchor-dirty-guard`：存在问题：current_revision 对应的版本缺失
- `2026-11/20261112-writer-domain-dead-merge-export`：存在问题：current_revision 对应的版本缺失
- `2026-11/20261112-writer-domain-foreshadow-dirty-entry`：存在问题：current_revision 对应的版本缺失
- `2026-11/20261112-writer-domain-optional-codepoint-truncate`：存在问题：current_revision 对应的版本缺失
- `2026-11/20261112-writer-engine-pending-rollback`：存在问题：current_revision 对应的版本缺失
- `2026-11/20261112-writer-engine-retry-keep-entries`：存在问题：current_revision 对应的版本缺失
- `2026-11/20261112-writer-export-appendix-doctype`：存在问题：current_revision 对应的版本缺失
- `2026-11/20261112-writer-export-conditional-creator`：存在问题：current_revision 对应的版本缺失
- `2026-11/20261112-writer-store-pending-io-loud`：存在问题：current_revision 对应的版本缺失
- `2026-11/20261112-writer-tools-archive-empty-repo-unstage`：存在问题：current_revision 对应的版本缺失
- `2026-11/20261112-writer-ui-worldbuilding-total-count`：存在问题：current_revision 对应的版本缺失
<!-- /ai-review:audit-verification -->
-（12 个候选未通过收尾校验，未纳入共享提交；详见插件复核块。）

> 收尾说明：门禁未由 Host 复算（audit 期门禁为 AI 报告；批准时 Host 仍会重新执行全部门禁）
