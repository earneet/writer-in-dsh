---
schema_version: 1
audit_id: 20261123-071322-repo
created_at: '2026-11-23T07:13:22Z'
base_revision: 733721e615c6e8f74dd62e18e3c7a6197e9b9efa
scope: .
trigger: manual
previous_audit: 20261118-103917-repo
candidates: []
items:
  - finding_id: f-f88c589c50
    kind: confirm
    title: 已放弃伏笔仍以 planted 投影，并可能要求执行非法的 resolve
    summary: '`foreshadow_update(abandon)` 只写 `status`，`abandoned_chapter` 从不落盘，终态伏笔在写作、RAG、审稿里仍按活跃处理。'
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-479b4097c7
    kind: confirm
    title: 改写全文回退会把围栏 JSON 当正文覆盖章稿
    summary: '`assertRewriteFullTextPlausible` 只拒绝以 `{` 开头的文本，围栏或带寒暄的错误 schema JSON 可直接落盘。'
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-40690acd1e
    kind: confirm
    title: 审稿 high 引文仅空白不同就被误降为 medium
    summary: 引文过滤用空白归一，`reviewWithEvidence` 却用逐字 `includes` 复核，两个口径互相矛盾。
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-48a9b055e5
    kind: confirm
    title: RAG 人物/伏笔/世界观长条目未切片，命中片段永远是开头
    summary: '`buildRagCorpus` 的契约写明「长条目切片」，实际只对章节切片。'
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-b856bd4f3d
    kind: confirm
    title: 平铺布局（scanRoot='.'）的文件监听传入空路径，必然退化手动刷新
    summary: 扫描把工作区根记为 `''`，`watchDirectories` 原样返回给监听层。
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-166e3c6feb
    kind: confirm
    title: 卷子目录章节被永久计入待维护，写作提示卡在维护
    summary: 扫描明确支持 `chapters/卷一/001.md`，但派生校验只认顶层三位文件。
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-a53edabfa2
    kind: confirm
    title: pending.md 带 BOM 时首个维护节无法归档
    summary: '`splitPendingSections` 只归一 CRLF，不剥 BOM，首行 `## ` 头因此落入 preamble。'
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-d63dde52de
    kind: confirm
    title: 纯数字与「第 N 夜」时间锚被静默忽略，倒序漏报
    summary: 文档承诺支持「第 N 日[N夜]」或纯数字形态，`parseDayAnchor` 只匹配 `第 N 日/天`。
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-0a725fac93
    kind: confirm
    title: 维护 partial 的校验原因行被当成可确认建议
    summary: 确认入口只过滤复数节名，单数原因行仍进入 `PendingPage` 的「准备确认请求」。
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-a4e56f7688
    kind: confirm
    title: 临时写失败不清理 tmp，可能被存档点提交
    summary: store 的四个写路径都把 `writeFile(tmp)` 放在 `try/rename` 之外，写失败即留下半截临时文件。
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-38a0093e52
    kind: confirm
    title: 人物反查关系只取 name 键，id 形式声明的边丢失
    summary: '`relationsByTarget` 同时索引 name 与解析出的 id，但消费端用 `??` 二选一。'
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-2039fb732d
    kind: confirm
    title: 空 frontmatter 块被当成正文（前轮已报，当前基线仍存在）
    summary: '`---\n---\n正文` 的闭合定界符在偏移 3，解析却从偏移 4 开始找。'
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-8c572d19ae
    kind: confirm
    title: writer_update 传 null 静默落盘为字符串 "null"（前轮已报，当前基线仍存在）
    summary: '`sanitizeFrontmatter` 对任何非标量都 `JSON.stringify`，null 变成四个字符的文本。'
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-50fb3a7383
    kind: confirm
    title: TXT 导出重写正文空行
    summary: '`renderTxt` 对整个输出执行 `\n{3,}`→`\n\n`，连章节内部空白一起压缩。'
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-2ddac2986a
    kind: confirm
    title: XML 清洗漏 U+FFFE/U+FFFF 与孤立代理项
    summary: '`stripIllegalXmlChars` 只剥离 C0 控制字符，非字符仍在。'
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-d4663366ca
    kind: confirm
    title: chapter-writing 技能仍教用 writer_update 改已有章节正文
    summary: 技能与工具守卫直接矛盾，模型按技能操作必失败。
    target_files: []
    depends_on: null
    status: pending
    candidate: null
  - finding_id: f-f0c5529cbc
    kind: confirm
    title: 一致性检查丢弃的引用不存在条目数未披露
    summary: 域层返回 `dropped`，引擎与工具从不读取，报告只报「发现 N 条矛盾」。
    target_files: []
    depends_on: null
    status: pending
    candidate: null
---

# 仓库审查报告

- 基线：733721e615c6e8f74dd62e18e3c7a6197e9b9efa
- 范围：全仓库（packages/ 12 包、根配置与 dev overlay、docs 契约；references/ 子模块与 example-project 内容文件只读）
- 执行时间：2026-11-23T07:13:22.210Z

## A 类：已生成候选

- 无

## B 类：需人工确认（未改代码）

- **已放弃伏笔仍以 planted 投影，并可能要求执行非法的 resolve**：`foreshadow_update(abandon)` 只写 `status`，`abandoned_chapter` 从不落盘，终态伏笔在写作、RAG、审稿里仍按活跃处理。
  - 位置：`packages/writer-tools/src/index.ts:227-228`；`packages/writer-domain/src/index.ts:425-429`、`:451-453`、`:499-523`；`packages/writer-ui/src/client/project.ts:68`
  - 风险：planted 章存在时，`projectForeshadow` 因缺 abandoned 锚把状态回退成 planted；若 `resolve_chapter` 到期，写作上下文会注入 🔴「必须回收」，但状态机已拒绝 abandoned→resolved，模型被推入必败循环。RAG/审稿仍会返回已放弃伏笔，工作台风险却显示 none。
  - 需要决定：是让域投影对所有 abandoned（含历史脏数据）直接按终态收束，还是在工具层要求/记录 `abandoned_chapter`；两端都做时需要定旧数据兼容口径。

- **改写全文回退会把围栏 JSON 当正文覆盖章稿**：`assertRewriteFullTextPlausible` 只拒绝以 `{` 开头的文本，围栏或带寒暄的错误 schema JSON 可直接落盘。
  - 位置：`packages/writer-engine/src/logic.ts:128-132`；`packages/writer-domain/src/index.ts:272-299`；`packages/writer-engine/src/index.ts:684-695`
  - 风险：模型返回围栏 JSON（缺 patches 数组）或「好的：\n{...}」时解析器回退 fulltext，守卫通过，整章被替换成 JSON/围栏文本；原稿只能靠存档点恢复。
  - 需要决定：全文路径拒绝任何围栏 JSON/前后缀 JSON 对象，还是只在解析层把错误 schema 标记为失败；需兼顾正文合法以代码块开头的极端情况。

- **审稿 high 引文仅空白不同就被误降为 medium**：引文过滤用空白归一，`reviewWithEvidence` 却用逐字 `includes` 复核，两个口径互相矛盾。
  - 位置：`packages/writer-engine/src/review.ts:113-124`（第 119 行）；`packages/writer-domain/src/index.ts:665-669`
  - 风险：模型把原文换行/空格归一后引用，`filterSuggestionsByQuotes` 已判定有效，但随后被标 `needsVerification` 并降为 medium；高危设定矛盾在面板上被弱化。
  - 需要决定：复用同一空白归一判断（或删掉已由过滤器完成的逐字复核）；「有待人工核对」与「已核验」的语义边界需要固定。

- **RAG 人物/伏笔/世界观长条目未切片，命中片段永远是开头**：`buildRagCorpus` 的契约写明「长条目切片」，实际只对章节切片。
  - 位置：`packages/writer-domain/src/rag.ts:54`、`:75-84`；`packages/writer-rag/src/index.ts:283`
  - 风险：长人物档案/世界观条目在中后段命中时，`snippetOf` 只截前 280 字，返回与查询无关的开头；external 档把整条长文塞进一次 embeddings 请求，可能触发端点长度上限并让整次混合检索失败。
  - 需要决定：人物/世界观按章节同款切片；伏笔条目则需先按 `projectForeshadow` 投影再切片（否则 spoiler 过滤会把每片替换成同一全文），切片 id 与排序权重需统一。

- **平铺布局（scanRoot='.'）的文件监听传入空路径，必然退化手动刷新**：扫描把工作区根记为 `''`，`watchDirectories` 原样返回给监听层。
  - 位置：`packages/writer-ui/src/client/load.ts:240-247`；`packages/writer-ui/src/client/useProject.ts:146`
  - 风险：宿主 `fs.resolve('')` 明确拒绝空路径（安装版 `dsh-fs-local/lib/index.js:183-185`），`changes` 立即结束，`useProject` 发布 `watched=false`；平铺项目的 `project.md/outline.md/pending.md` 编辑不再触发刷新。
  - 需要决定：监听路径改用 `'.'`（扫描路径仍保留 `''`），还是统一把工作区根表示为 `'.'`；会牵动 `watchDirectories` 去重与 UI 文案。

- **卷子目录章节被永久计入待维护，写作提示卡在维护**：扫描明确支持 `chapters/卷一/001.md`，但派生校验只认顶层三位文件。
  - 位置：`packages/writer-ui/src/client/load.ts:405-411`；`packages/writer-ui/src/client/project.ts:85-86`；`packages/writer-ui/src/client/Panel.tsx`（「仅支持面板阅读」提示）
  - 风险：卷内章节 `verified=false`，服务端又不支持该布局，`staleChapters` 永远清不掉；`nextStepOf` 持续给「处理 N 章待维护」而不是「写下一章」，与服务端 `writer_stats` 口径冲突。
  - 需要决定：把不可维护的卷内章节从 stale 中排除并单独披露，还是补齐 store 的卷子目录支持（后者是更大改动）。

- **pending.md 带 BOM 时首个维护节无法归档**：`splitPendingSections` 只归一 CRLF，不剥 BOM，首行 `## ` 头因此落入 preamble。
  - 位置：`packages/writer-domain/src/pending.ts:23-31`；`packages/writer-ui/src/client/load.ts:138-145`（明确会恢复 BOM）；`packages/writer-domain/src/index.ts:50`（实体解析已剥 BOM 的先例）
  - 风险：Windows 编辑器以「UTF-8 with BOM」保存后，`partitionPendingByChapter` 的 archived 为空，`pending_cleanup` 回「没有待办节」；store 的 append 还会继续保留 BOM，问题持久化。
  - 需要决定：在 `splitPendingSections` 入口统一剥 BOM，还是仅在读 pending.md 的 store/UI 层处理；首节归属语义不能变。

- **纯数字与「第 N 夜」时间锚被静默忽略，倒序漏报**：文档承诺支持「第 N 日[N夜]」或纯数字形态，`parseDayAnchor` 只匹配 `第 N 日/天`。
  - 位置：`packages/writer-domain/src/consistency.ts:123-126`、`:191-194`；`packages/writer-engine/src/index.ts:844-849`（`String(time)`）
  - 风险：frontmatter `time: 3` 或 `time: 第3夜` 被过滤，前后章倒序永远检测不到；一致性报告会给出「无时间线矛盾」的错误安心。
  - 需要决定：补纯数字与 `夜`（是否再补月/年需产品口径）；非法锚继续跳过，避免误报。

- **维护 partial 的校验原因行被当成可确认建议**：确认入口只过滤复数节名，单数原因行仍进入 `PendingPage` 的「准备确认请求」。
  - 位置：`packages/writer-ui/src/client/actions.ts:44-55`（第 47 行）；`packages/writer-ui/src/client/overview.ts:155-183`；`packages/writer-engine/src/index.ts:864-867`；`packages/writer-ui/src/client/project.ts:262`
  - 风险：`fact「X」引用不存在的实体…`、`foreshadowEvent 引用不存在的伏笔…` 等校验错误会生成确认草稿，模型被要求据错误信息改权威记录；`pendingLineTotal` 同时虚高。
  - 需要决定：按单数原因前缀过滤，还是整段跳过 `⚠ 部分抽取` 直到下一个节；诊断行是否计入「建议」总数。

- **临时写失败不清理 tmp，可能被存档点提交**：store 的四个写路径都把 `writeFile(tmp)` 放在 `try/rename` 之外，写失败即留下半截临时文件。
  - 位置：`packages/writer-store/src/index.ts:313-320`、`:479-487`、`:507-515`、`:573-581`；`packages/writer-tools/src/index.ts:389-390`；`packages/writer-store/src/project.ts:122`
  - 风险：ENOSPC/EACCES/杀软占用时抛原始 Node 错误，`<target>.<pid><n>.tmp` 留在项目根或章节目录；`archive_point` 的 `git add -A -- .` 会把它提交进小说历史。
  - 需要决定：把 `writeFile` 纳入同一 `try` 并在失败时 `rm(tmp)`，同时把 tmp 模式加入 `.gitignore` 作纵深防御；错误文案沿用现有「落盘失败」前缀。

- **人物反查关系只取 name 键，id 形式声明的边丢失**：`relationsByTarget` 同时索引 name 与解析出的 id，但消费端用 `??` 二选一。
  - 位置：`packages/writer-ui/src/client/project.ts:210-212`；`packages/writer-ui/src/client/graph.ts:284-302`
  - 风险：A（name=艾琳，id=elin）同时被 B 以 `艾琳`、C 以 `elin` 声明关系时，只取 `get('艾琳')`，C 的边从「他人指向的关系」和关系图消失，网络图不完整。
  - 需要决定：合并两个键的列表并按 owner/name/desc 去重，还是在索引时收敛为单一规范键；同名多档案的去重口径需一并确定。

- **空 frontmatter 块被当成正文（前轮已报，当前基线仍存在）**：`---\n---\n正文` 的闭合定界符在偏移 3，解析却从偏移 4 开始找。
  - 位置：`packages/writer-domain/src/index.ts:53`；对照 `:55-58` 的 EOF 闭合分支
  - 风险：`content` 变成 `---\n---\n正文`，污染 hash、预览、导出与检索切片；仓库夹具 `characters/b.md`、RAG 夹具都使用该形态但只断言字段，未断言正文。
  - 需要决定：把搜索起点改为 3（对非空块与 EOF 形态均安全），还是显式拒绝空 frontmatter 块；后者会拒绝合法 YAML 空文档。

- **writer_update 传 null 静默落盘为字符串 "null"（前轮已报，当前基线仍存在）**：`sanitizeFrontmatter` 对任何非标量都 `JSON.stringify`，null 变成四个字符的文本。
  - 位置：`packages/writer-tools/src/index.ts:634-639`；`packages/writer-tools/src/index.ts:82`（schema 允许任意值）；`packages/writer-domain/src/maintenance.ts:164-166`
  - 风险：`milestones: null` 之后 `foreshadow_update(milestone)` 必抛「必须是 JSON 数组」；`status: null` 变成未知状态，伏笔从活跃判断中静默消失；保存回执仍报成功。
  - 需要决定：null 是响亮拒绝，还是定义为「删除该键」；后者要新增删键语义，属公开契约变更。

- **TXT 导出重写正文空行**：`renderTxt` 对整个输出执行 `\n{3,}`→`\n\n`，连章节内部空白一起压缩。
  - 位置：`packages/writer-export/src/render.ts:99-115`（第 114 行）
  - 风险：正文两处空行、围栏代码块内空行会被改写，与同函数「原文 Markdown 原样保留」的注释承诺不一致；只有 TXT 路径如此，HTML/EPUB 的分段语义不同。
  - 需要决定：只在拼接分节边界时归一空行，还是保留章节正文原样；需补一个正文含三连换行的字节级用例。

- **XML 清洗漏 U+FFFE/U+FFFF 与孤立代理项**：`stripIllegalXmlChars` 只剥离 C0 控制字符，非字符仍在。
  - 位置：`packages/writer-export/src/render.ts:52-60`；测试 `packages/writer-export/tests/export.test.ts:136-144`
  - 风险：从工具粘贴的 U+FFFF 或模型输出的孤立代理项进入 XHTML/OPF/NCX，XML 1.0 文档不合法，epubcheck 报错、严格阅读器拒载整本；现测试只覆盖 C0。
  - 需要决定：把 FFFE/FFFF 与代理区并入侵蚀谓词（替换 U+FFFD），还是依赖上游导入清洗；后者无法覆盖模型正文。

- **chapter-writing 技能仍教用 writer_update 改已有章节正文**：技能与工具守卫直接矛盾，模型按技能操作必失败。
  - 位置：`packages/writer-skills/assets/chapter-writing/SKILL.md:77`；`packages/writer-tools/src/index.ts:93-97`；工具描述 `:76`
  - 风险：模型按「改错别字走 writer_update」读取后必被拒（已有章稿正文只能由作者登记 rewrite），随后可能改用 assist 追加，破坏正文结构；也可能反复重试死循环。
  - 需要决定：只改技能与工具描述（明确正文修改必须由作者登记选区/整章改稿），还是提供安全的小改工具（公开 API 扩展，需单独评审）。

- **一致性检查丢弃的引用不存在条目数未披露**：域层返回 `dropped`，引擎与工具从不读取，报告只报「发现 N 条矛盾」。
  - 位置：`packages/writer-engine/src/index.ts:423-437`；`packages/writer-domain/src/consistency.ts:100-120`
  - 风险：模型引用了不存在的 `chapter/003#段落`、`event/007` 等，条目被静默丢弃；用户以为本批已完整覆盖，与仓库「覆盖范围如实披露」的既有口径冲突。
  - 需要决定：在 coverage 后缀补「N 条因引用不存在被丢弃」，还是把 dropped 计数放进报告结构；只披露不改变丢弃策略。

## 待前置合入后处理（Deferred）

- 无

## 验证与说明

- **结论**：本轮未生成候选，也没有执行任何 `gate_checks`；所有 B 项均为静态读码结论。
- **环境阻塞**：`pwsh` 在进程启动前即失败——`sandbox-local: windows-acl workspace grant failed: Win32Error: SetNamedSecurityInfoW failed (Win32 5): grantWrite(F:\workspace_2\writer-in-dsh)`；从仓库根、从 `packages/`、子代理三条路径均复现。
- **尝试的修复**：按 `diagnose-windows-sandbox-acl` 技能请求一次性权限修复，被「`danger-full-access` 需要审批但当前无审批通道」拒绝；未执行提权，也未用其他方式改权限。
- **静态审查方法**：Lead 通读 domain/core/store/engine/tools/export/rag/guard/pending/timeline 与 writer-ui 客户端；另派四个只读子代理并行审计 export+rag+domain、tools+guard+skills、store+domain IO、writer-ui，所有 B 项由 Lead 回读代码与行号复核，并剔除既有候选与负向记忆覆盖项。
- **未覆盖风险**：真实 LLM、embeddings、Electron/干净 profile、浏览器与 epubcheck 均未运行；平铺监听结论依据安装版 `dsh-fs-local`/`dsh-api-workspace-files` 源码而非运行时复现；并发与磁盘写失败均为时序/故障注入推演。
- **收尾状态**：业务文件未做任何修改，只新增本报告；因 `git status` 不可执行，工作区洁净度未经机器复核，`.ai-review/` 之外不应有本轮改动。

## 修复方案数据

```json
[
  {
    "finding_id": "foreshadow-abandon-unanchored",
    "kind": "confirm",
    "title": "已放弃伏笔仍以 planted 投影并可能要求非法 resolve",
    "summary": "foreshadow_update(abandon) 从不写 abandoned_chapter，终态伏笔在写作/RAG/审稿中仍按活跃处理，到期时甚至注入不可能完成的回收红线。",
    "target_files": [
      "packages/writer-tools/src/index.ts",
      "packages/writer-domain/src/index.ts",
      "packages/writer-ui/src/client/project.ts"
    ],
    "depends_on": null,
    "status": "pending",
    "candidate": null,
    "repair_plan": {
      "evidence": "packages/writer-tools/src/index.ts:227-228 只写 status；packages/writer-domain/src/index.ts:425-429 仅从 abandoned_chapter 判终态，:451-453 在缺锚时把状态写回 planted；:499-523 会据 resolve_chapter 注入 🔴 回收；UI packages/writer-ui/src/client/project.ts:68 却把 abandoned 视为 none。",
      "steps": [
        "方案 A（推荐）：在 projectForeshadow 中把 status=abandoned 视为已收束，即使 abandoned_chapter 缺失也不返回可执行 resolve，并在 text 中标注「已放弃（未记章）」；保留原章锚供人工修正。",
        "方案 B：扩展 foreshadow_update(abandon) 接受/要求 chapter 并写入 abandoned_chapter；同时保留方案 A 的域层兜底以兼容历史数据。",
        "为 abandon 成功路径补工具测试（当前 tests/tools.test.ts:121-149 只测非法迁移），并补写作上下文/审稿/RAG 三入口断言。"
      ],
      "acceptance": [
        "planted 伏笔 abandon 后，assembleWritingContext 不再出现该伏笔的 🔴/🟡 指令，review 与带 chapter_limit 的 RAG 不再把它当活跃档案返回。",
        "对只有 status=abandoned、无 abandoned_chapter 的历史数据同样不产生非法 resolve 指令。",
        "UI 风险档与服务端投影一致（abandoned 均视为已收束）。"
      ]
    }
  },
  {
    "finding_id": "rewrite-fulltext-json-fence",
    "kind": "confirm",
    "title": "改写全文回退会把围栏 JSON 当正文覆盖章稿",
    "summary": "全文守卫只拒绝以 { 开头的文本；围栏或带寒暄的错误 schema JSON 会被判为全文并整章落盘。",
    "target_files": [
      "packages/writer-engine/src/logic.ts",
      "packages/writer-engine/src/index.ts",
      "packages/writer-domain/src/index.ts"
    ],
    "depends_on": null,
    "status": "pending",
    "candidate": null,
    "repair_plan": {
      "evidence": "packages/writer-domain/src/index.ts:272-299 在栅栏内 JSON 缺 patches 时返回 asFulltext(raw.trim())；packages/writer-engine/src/logic.ts:128-132 只检查 trimStart().startsWith('{')；packages/writer-engine/src/index.ts:684-695 直接保存该文本。",
      "steps": [
        "在 parseRewriteModelOutput 中区分「栅栏内是 JSON 但 schema 不符」与「真正的全文」，前者返回显式失败而非 fulltext。",
        "或在 assertRewriteFullTextPlausible 中拒绝围栏代码块与前后缀 JSON 对象；需定义正文以代码块开头时的例外。",
        "补一个模型返回围栏 JSON {\"find\":\"…\",\"replace\":\"…\"} 的用例，断言抛错且章稿 hash 不变。"
      ],
      "acceptance": [
        "错误 schema 的栅栏 JSON、带寒暄的 JSON、单条 find/replace 对象均不会落盘为章稿。",
        "真正的全文改写仍可保存，丢句守卫照常告警。",
        "失败回执给出可行动原因，原章稿字节与 hash 不变。"
      ]
    }
  },
  {
    "finding_id": "review-quote-whitespace",
    "kind": "confirm",
    "title": "审稿 high 引文仅空白不同就被误降为 medium",
    "summary": "引文过滤使用空白归一，后续证据复核却使用逐字 includes，导致已通过过滤的高危建议被降级并标记待核对。",
    "target_files": [
      "packages/writer-engine/src/review.ts",
      "packages/writer-domain/src/index.ts"
    ],
    "depends_on": null,
    "status": "pending",
    "candidate": null,
    "repair_plan": {
      "evidence": "packages/writer-domain/src/index.ts:665-669 用 stripWhitespace 接受引文；packages/writer-engine/src/review.ts:119 用 chapter.content.includes(suggestion.quote) 再次判断，换行/空格归一后的引文在此失败。",
      "steps": [
        "让两处共用同一空白归一的包含判断（可在 domain 导出 containsNormalized，或在 review 层复用 filterSuggestionsByQuotes 的结果）。",
        "去掉重复的逐字 contains：quote 已由过滤器验证；仅保留「无 quote 的 high 建议需核对」分支。",
        "补测试：引文为换行/空格归一形态时 high 不降级、needsVerification 不为 true。"
      ],
      "acceptance": [
        "quote 通过空白归一校验的 high 建议保持 high 且不标待核对。",
        "真正不存在的 quote 仍被过滤或降级。",
        "既有 evidence 校验用例（context-regressions.test.ts:119-139）保持通过。"
      ]
    }
  },
  {
    "finding_id": "rag-entry-slicing",
    "kind": "confirm",
    "title": "RAG 人物/伏笔/世界观长条目未切片，命中片段永远是开头",
    "summary": "buildRagCorpus 的注释承诺长条目切片，实际只切章节，导致中后段命中的 snippet 与查询无关，external 档还会整条长文送 embeddings。",
    "target_files": [
      "packages/writer-domain/src/rag.ts",
      "packages/writer-rag/src/index.ts"
    ],
    "depends_on": null,
    "status": "pending",
    "candidate": null,
    "repair_plan": {
      "evidence": "packages/writer-domain/src/rag.ts:54 写明「长条目切片」，:75-84 对 character/plot/worldbuilding 直接 push 全文；:241-244 的 snippetOf 只截前 280 字；packages/writer-rag/src/index.ts:283 对候选全文调用 embed。",
      "steps": [
        "人物与世界观条目复用 chunkChapterText 切片，id 追加 #序号，保证 snippet 能覆盖命中位置。",
        "伏笔条目先按 projectForeshadow 投影再切片，或让 filterChunksBySpoiler 对每个切片重新投影，避免整条投影覆盖所有片段。",
        "为长条目中后段命中和 external 单请求长度补测试；若同时修 chunkChapterText 的 UTF-16 切片，需同步口径。"
      ],
      "acceptance": [
        "查询命中长人物/世界观条目第 1000 字后，返回 snippet 包含命中段而非固定开头。",
        "external 档按片嵌入，单请求长度有界；防剧透过滤对伏笔切片仍生效。",
        "既有 RAG 关键词/RRF/摘要块测试不回归。"
      ]
    }
  },
  {
    "finding_id": "ui-flat-watch-empty-path",
    "kind": "confirm",
    "title": "平铺布局文件监听传入空路径，面板永远退化为手动刷新",
    "summary": "scanRoot='.' 时扫描把根记为 ''，watchDirectories 原样交给宿主 changes；宿主拒绝空路径，监听立即结束。",
    "target_files": [
      "packages/writer-ui/src/client/load.ts",
      "packages/writer-ui/src/client/useProject.ts"
    ],
    "depends_on": null,
    "status": "pending",
    "candidate": null,
    "repair_plan": {
      "evidence": "packages/writer-ui/src/client/load.ts:240-247 把 candidate='.' 归一为 root='' 并放进 watchDirectories；useProject.ts:146 直接调用 watchProject；node_modules/@deepseek-ai/dsh-fs-local/lib/index.js:183-185 对空路径抛 FS_NOT_FOUND，dsh-api-workspace-files/lib/index.js:56-62 在生成器内直接抛出。",
      "steps": [
        "为监听单独保留显示/协议路径：平铺根传 '.'，扫描内部仍用 '' 拼相对路径。",
        "在 watchProject 入口对空路径做归一（''→'.'）并补单测；同时检查 watchDirectories 去重与排序。",
        "补平铺布局（project.md 在根、无 novel/）的监听用例，编辑根文件后断言触发 invalidate。"
      ],
      "acceptance": [
        "平铺项目的 project.md/outline.md/pending.md 变更无需手动刷新即可更新面板。",
        "novel/ 子目录布局监听行为不变。",
        "空路径不再发往 workspaceFiles.changes。"
      ]
    }
  },
  {
    "finding_id": "ui-subdir-stale",
    "kind": "confirm",
    "title": "卷子目录章节被永久计入待维护，写作提示卡在维护",
    "summary": "扫描支持一层卷子目录，但派生新鲜度只认顶层三位文件，卷内章节永远 stale 且服务端无法维护。",
    "target_files": [
      "packages/writer-ui/src/client/load.ts",
      "packages/writer-ui/src/client/project.ts"
    ],
    "depends_on": null,
    "status": "pending",
    "candidate": null,
    "repair_plan": {
      "evidence": "packages/writer-ui/src/client/load.ts:405-411 对 subdir!==undefined 令 verified=false，无派生时直接返回 id；packages/writer-ui/src/client/project.ts:85-86 的 nextStepOf 优先给 maintain；Panel 明示卷内章节仅面板阅读。",
      "steps": [
        "在 staleChapters 计算中排除 subdir 章节，另设 unsupported/readonly 清单并在 UI 提示。",
        "若产品决定支持卷子目录完善，则改 store 扫描/写路径与派生键（大改动，单独立项）。",
        "补测试：卷内章节存在且无派生时 staleChapters 不含它，nextStep 仍给写下一章。"
      ],
      "acceptance": [
        "卷内章节不再让工作台停在「处理 N 章待维护」。",
        "writer_stats 与服务端一致；面板仍明确告知该布局只读。",
        "顶层章节的 stale 判定与既有用例不变。"
      ]
    }
  },
  {
    "finding_id": "pending-bom-section",
    "kind": "confirm",
    "title": "pending.md 带 BOM 时首个维护节无法归档",
    "summary": "splitPendingSections 不剥 BOM，首行 ## 头落入 preamble，pending_cleanup 对该章返回无待办节。",
    "target_files": [
      "packages/writer-domain/src/pending.ts",
      "packages/writer-ui/src/client/load.ts"
    ],
    "depends_on": null,
    "status": "pending",
    "candidate": null,
    "repair_plan": {
      "evidence": "packages/writer-domain/src/pending.ts:23-31 只归一 CRLF；带 U+FEFF 的首行不匹配 /^## /，成为 preamble；load.ts:138-145 明确会补回 BOM，说明该输入被支持；index.ts:50 的实体解析已剥 BOM。",
      "steps": [
        "在 splitPendingSections 入口剥离开头 U+FEFF（仅文件首字符），再按现有逻辑切节。",
        "补 BOM pending.md 用例：首个维护节可被 partitionPendingByChapter 归档，preamble 其他内容保留。",
        "若选择在 store/UI 读取层剥离，需保证 append 写回不重新引入 BOM 或至少不影响解析。"
      ],
      "acceptance": [
        "BOM 文件的 chapter/001 首节 archived 非空，pending_cleanup 不再误报无待办。",
        "无 BOM 文件的既有分区/归档行为字节级不变。",
        "preamble（真正的非节内容）仍原样保留。"
      ]
    }
  },
  {
    "finding_id": "consistency-numeric-day-anchor",
    "kind": "confirm",
    "title": "纯数字与「第 N 夜」时间锚被静默忽略，倒序漏报",
    "summary": "parseDayAnchor 只匹配 第 N 日/天，文档承诺的纯数字与夜形态被过滤，一致性检查错过倒序。",
    "target_files": [
      "packages/writer-domain/src/consistency.ts",
      "packages/writer-engine/src/index.ts"
    ],
    "depends_on": null,
    "status": "pending",
    "candidate": null,
    "repair_plan": {
      "evidence": "packages/writer-domain/src/consistency.ts:123-126 注释承诺「第 N 日[N夜]」或纯数字；:191-194 仅有 /第\\s*(\\d+)\\s*[日天]/；engine:844-849 用 String(frontmatter.time) 传入，纯数字会变成 '3' 被过滤。",
      "steps": [
        "扩展 parseDayAnchor：接受 /^\\s*(\\d+)\\s*$/ 与 第 N [日天夜]；不匹配仍返回 undefined。",
        "补 domain 用例：time=3、第3夜 与相邻锚构成倒序时被检出；'三日后' 仍跳过。",
        "确认 engine 的 time 取值对数字/字符串两种 frontmatter 均生效。"
      ],
      "acceptance": [
        "time: 3 与 time: 第3夜 进入倒序比较。",
        "非规范自由文本时间仍不强行比较。",
        "现有 parseDayAnchor 测试（consistency.test.ts:70-81）保持通过。"
      ]
    }
  },
  {
    "finding_id": "ui-partial-diagnostics",
    "kind": "confirm",
    "title": "维护 partial 的校验原因行被当成可确认建议",
    "summary": "单数 fact/foreshadowEvent/characterState 原因行绕过确认过滤，PendingPage 会为校验错误生成确认草稿并计入建议数。",
    "target_files": [
      "packages/writer-ui/src/client/actions.ts",
      "packages/writer-ui/src/client/overview.ts",
      "packages/writer-ui/src/client/project.ts"
    ],
    "depends_on": null,
    "status": "pending",
    "candidate": null,
    "repair_plan": {
      "evidence": "packages/writer-engine/src/index.ts:864-867 把失败原因写成缩进列表；overview.ts:176-183 剥掉 - 前缀后全部当 lines；actions.ts:47 只过滤 facts/foreshadowEvents/characterStates 复数与「缺少…节」；project.ts:262 用这些 lines 计 pendingLineTotal。",
      "steps": [
        "过滤单数原因前缀（fact「…」/foreshadowEvent/characterState）及引用不存在/形状非法等诊断行，或整段跳过 partial 块。",
        "把诊断行与可确认建议分行建模，pendingLineTotal 只统计建议。",
        "补 partial 节用例：无「准备确认请求」按钮、计数不把诊断算作建议。"
      ],
      "acceptance": [
        "partial 原因行不再生成确认草稿。",
        "待确认计数与可操作建议一致。",
        "真正的维护建议与 recompute 作废提示仍可确认/归档。"
      ]
    }
  },
  {
    "finding_id": "store-tmp-cleanup",
    "kind": "confirm",
    "title": "临时写失败不清理 tmp，可能被存档点提交",
    "summary": "store 四个写路径的 writeFile 位于 try/rename 之外，写失败会留下未清理的 .tmp，并可能被 archive_point 提交。",
    "target_files": [
      "packages/writer-store/src/index.ts",
      "packages/writer-tools/src/index.ts",
      "packages/writer-store/src/project.ts"
    ],
    "depends_on": null,
    "status": "pending",
    "candidate": null,
    "repair_plan": {
      "evidence": "packages/writer-store/src/index.ts:313-320（save）、:479-487（appendPending）、:507-515（archivePending）、:573-581（appendFileAtomic）均在 try 外 writeFile；project.ts:122 的 .gitignore 仅忽略 .writer/ 与 exports/；tools/index.ts:389-390 的 git add -A 不排除 .tmp。",
      "steps": [
        "把 writeFile 与 rename 一起包进 try，catch 中 rm(tmp,{force:true}) 后抛既有「落盘失败/追加失败」文案。",
        "在 .gitignore 模板增加通用 .tmp 模式作纵深防御；存档点路径排除可另行评估。",
        "补故障注入用例（writeFile 抛 ENOSPC）：目录内无 *.tmp，错误信息带目标路径。"
      ],
      "acceptance": [
        "任何写失败后不留临时文件。",
        "原有写入/归档/追加成功路径字节不变。",
        "archive_point 不会把本次失败的临时文件纳入提交。"
      ]
    }
  },
  {
    "finding_id": "ui-reverse-relations-keys",
    "kind": "confirm",
    "title": "人物反查关系只取 name 键，id 形式声明的边丢失",
    "summary": "relationsByTarget 同时有 name 与 id 两个键，消费端用 ?? 二选一，导致 id 形式的关系边不显示。",
    "target_files": [
      "packages/writer-ui/src/client/project.ts",
      "packages/writer-ui/src/client/graph.ts"
    ],
    "depends_on": null,
    "status": "pending",
    "candidate": null,
    "repair_plan": {
      "evidence": "packages/writer-ui/src/client/graph.ts:284-302 对每条边同时 addTarget(edge.name) 与 addTarget(解析出的 id)；project.ts:210-212 使用 get(c.name) ?? get(c.id)，name 命中时不再读 id 列表。",
      "steps": [
        "合并两个键的边列表，按 owner+name+desc 去重后生成 reverseRelations。",
        "或改为单一规范目标键（姓名解析优先，无法解析时用原名），同步索引构建。",
        "补用例：B 用 name、C 用 id 声明同一目标，两条边都出现且不重复。"
      ],
      "acceptance": [
        "人物页「他人指向的关系」与关系图包含两种声明形式的全部边。",
        "自己声明自己的边仍不重复计。",
        "既有 name 形式用例（project.test.ts:227-238）不回归。"
      ]
    }
  },
  {
    "finding_id": "f-b72eb0b768",
    "kind": "confirm",
    "title": "空 frontmatter 块被当成正文（前轮已报，当前基线仍存在）",
    "summary": "---\\n---\\n正文 的闭合定界符在偏移 3，解析从偏移 4 搜索，空块永远不会被识别。",
    "target_files": [
      "packages/writer-domain/src/index.ts"
    ],
    "depends_on": null,
    "status": "pending",
    "candidate": null,
    "repair_plan": {
      "evidence": "packages/writer-domain/src/index.ts:53 使用 indexOf('\\n---\\n',4)；空块的闭合序列从索引 3 开始。仓库夹具 characters/b.md 与 RAG 夹具使用该形态但只断言字段（tools.test.ts:327 等）。",
      "steps": [
        "把搜索起点改为 3，并保留 EOF 闭合分支。",
        "补测试：---\\n---\\nB 的 frontmatter 为空、content 恰为 'B'；非空块、EOF 闭合、无 frontmatter 三种形态不变。",
        "确认 hash、导出与检索切片随之恢复正确（无需改存储）。"
      ],
      "acceptance": [
        "空 frontmatter 块的 content 不含两条 ---。",
        "非空 frontmatter 的解析结果字节级不变。",
        "EOF 无尾换行的闭合形态仍被识别。"
      ]
    }
  },
  {
    "finding_id": "f-cba698b9f3",
    "kind": "confirm",
    "title": "writer_update 传 null 静默落盘为字符串 \"null\"（前轮已报，当前基线仍存在）",
    "summary": "sanitizeFrontmatter 对 null 执行 JSON.stringify，清空意图变成文本 \"null\"，工具仍回成功。",
    "target_files": [
      "packages/writer-tools/src/index.ts"
    ],
    "depends_on": null,
    "status": "pending",
    "candidate": null,
    "repair_plan": {
      "evidence": "packages/writer-tools/src/index.ts:634-639 对非 string/number/boolean 一律 JSON.stringify；schema:82 允许任意 additionalProperties；domain maintenance.ts:164-166 随后把 'null' 当非法 JSON 数组。",
      "steps": [
        "方案 A：sanitizeFrontmatter 对 null 显式抛错，文案说明「删除键尚未支持」。",
        "方案 B：定义 null=删除该 frontmatter 键，并在 store save 合并语义中实现与测试；属公开契约变更。",
        "补 writer_update null 用例（milestones/status），断言不落 \"null\"。"
      ],
      "acceptance": [
        "null 不再以字符串 \"null\" 落盘。",
        "选择拒绝时回执给出可行动说明；选择删除时 read 后键确实消失。",
        "数组/对象 JSON 序列化的既有行为不变。"
      ]
    }
  },
  {
    "finding_id": "export-txt-blank-line-collapse",
    "kind": "confirm",
    "title": "TXT 导出重写正文空行",
    "summary": "renderTxt 对整个输出执行 \\n{3,}→\\n\\n，章节内部空行与围栏代码块被压缩，违反原文保留承诺。",
    "target_files": [
      "packages/writer-export/src/render.ts"
    ],
    "depends_on": null,
    "status": "pending",
    "candidate": null,
    "repair_plan": {
      "evidence": "packages/writer-export/src/render.ts:99 注释称 Markdown 原样保留，:114 的全局 replace 会改写 chapter.content 中的三连换行；测试 export.test.ts:111-117 未覆盖内部空行。",
      "steps": [
        "只在拼接卷/章/附录边界时归一空行，不对 chapter.content 做全局替换。",
        "补字节级用例：正文含 '一\\n\\n\\n二' 与围栏代码块空行时原样保留。",
        "确认原有分节间距与末尾单换行不变。"
      ],
      "acceptance": [
        "章节正文中的连续空行与围栏代码块在 TXT 中逐字保留。",
        "卷/章标题之间仍只有一个空行分隔。",
        "导出末尾仍恰好一个换行。"
      ]
    }
  },
  {
    "finding_id": "export-xml-noncharacter",
    "kind": "confirm",
    "title": "XML 清洗漏 U+FFFE/U+FFFF 与孤立代理项",
    "summary": "stripIllegalXmlChars 只剥离 C0 控制字符，非字符与孤立代理项仍进入 XHTML/OPF/NCX。",
    "target_files": [
      "packages/writer-export/src/render.ts"
    ],
    "depends_on": null,
    "status": "pending",
    "candidate": null,
    "repair_plan": {
      "evidence": "packages/writer-export/src/render.ts:52-60 的谓词只覆盖 <=0x08、0x0b、0x0c、0x0e-0x1f；测试 export.test.ts:136-144 也只断言 C0。",
      "steps": [
        "把 code===0xFFFE || code===0xFFFF 与代理区（0xD800-0xDFFF）加入非法判断，替换 U+FFFD。",
        "补用例：正文/标题含 U+FFFF 与孤立代理项，断言 XHTML/OPF/NCX 不含这些码点。",
        "保留合法 \\t \\n \\r 与大于 BMP 的普通字符。"
      ],
      "acceptance": [
        "含 U+FFFF 或孤立代理项的导出 XHTML 仍为合法 XML。",
        "既有控制字符剥离用例不回归。",
        "逐字符替换不改变文本长度（除代理项外）。"
      ]
    }
  },
  {
    "finding_id": "skill-chapter-update-dead-end",
    "kind": "confirm",
    "title": "chapter-writing 技能仍教用 writer_update 改已有章节正文",
    "summary": "技能说改错别字走 writer_update，但工具对已有章稿正文一律拒绝，模型按技能操作必失败。",
    "target_files": [
      "packages/writer-skills/assets/chapter-writing/SKILL.md",
      "packages/writer-tools/src/index.ts"
    ],
    "depends_on": null,
    "status": "pending",
    "candidate": null,
    "repair_plan": {
      "evidence": "SKILL.md:77 明确写「手工微调章节（改错别字等）仍走 writer_update」；packages/writer-tools/src/index.ts:93-97 对已有章稿正文直接抛错；工具描述 :76 仍写「创建或修改」。",
      "steps": [
        "改技能为：已有章稿正文只能由作者在工作台登记选区/整章改稿后调用 write_chapter(rewrite)；writer_update 仅用于 frontmatter/新建章。",
        "同步工具描述，明确拒绝条件与替代路径。",
        "若产品希望支持安全小改，另立 API 设计（需破坏「仅作者发起」的安全边界）。"
      ],
      "acceptance": [
        "技能与工具描述不再引导 writer_update 修改已有正文。",
        "模型按技能走作者登记 rewrite 路径，不再撞「已有章稿正文请通过作者发起」错误。",
        "新建章节与 frontmatter 更新路径不受影响。"
      ]
    }
  },
  {
    "finding_id": "consistency-dropped-undisclosed",
    "kind": "confirm",
    "title": "一致性检查丢弃的引用不存在条目数未披露",
    "summary": "域层返回 dropped，引擎与工具从不读取，用户只看到「发现 N 条矛盾」，不知道有模型条目被静默丢弃。",
    "target_files": [
      "packages/writer-engine/src/index.ts",
      "packages/writer-domain/src/consistency.ts"
    ],
    "depends_on": null,
    "status": "pending",
    "candidate": null,
    "repair_plan": {
      "evidence": "packages/writer-domain/src/consistency.ts:100-120 统计 dropped 并返回；packages/writer-engine/src/index.ts:423-437 只读 issues/summary；报告无任何 dropped 字段。",
      "steps": [
        "在引擎 coverageParts 或 summary 后缀追加「N 条因引用不存在被丢弃」；需要时把 dropped 汇总进 ConsistencyReport 结构。",
        "保留现有丢弃策略（引用全不存在才丢），只补披露。",
        "补测试：一批含 1 条被丢弃时报告出现计数；0 条时无噪音。"
      ],
      "acceptance": [
        "一致性检查回执如实显示被丢弃条目数。",
        "合法批次的措辞与计数不变。",
        "丢弃策略本身不改，避免幻觉条目进入报告。"
      ]
    }
  }
]
```

<!-- ai-review:audit-verification -->
## 插件复核
- 复核时间：2026-11-23T07:39:54.251Z
- 基线：`733721e615c6e8f74dd62e18e3c7a6197e9b9efa`
- 审查目标：全仓库
- 新增候选：0
- AI 执行：成功
- 业务工作区：已尝试还原到基线（仅保留 .ai-review/）

### 候选校验
- 无新增候选。

### 复核提示
- 修复方案数据无效：items[0].repair_plan 必须是非空字符串
<!-- /ai-review:audit-verification -->

> 收尾说明：门禁未由 Host 复算（audit 期门禁为 AI 报告；批准时 Host 仍会重新执行全部门禁）
