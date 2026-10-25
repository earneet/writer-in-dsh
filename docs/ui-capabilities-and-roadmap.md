# writer-ui 能力基线与设计优化路线图

> 用途：UI 后续设计与优化的单一参考文档。整合输入——①dsh 宿主 Web UI 能力调查
> （references/deepseek-harness）；②novel-writer 原版信息面盘点；③writer-ui v5 实现
> 现状；④**四视角设计审查**（用户工作流/宿主平台契合/信息架构交互/规划一致性，
> 2025 轮次 21，结论已并入本文，见 §6）；⑤**轮次 22 五视角审查**（功能覆盖/易用性/
> 视觉契合/健壮性 + Lead 复核，结论并入 §1.3/§2/§3/§4.1/§5，清单见 §7）。
> 设计与实现改动请先对照本文，改完回写。

---

## 1. 宿主能力清单（第三方客户端插件可用面）

### 1.1 基线模块表（动态 bundle 可 require，共 9 项）

来源：`references/deepseek-harness/packages/client/web/src/platform.ts:8-14`

| 模块 | 用途 |
|---|---|
| `react` / `react/jsx-runtime` / `react-dom` / `react-dom/client` | 渲染基座 |
| `@deepseek-ai/cordis` | 插件上下文（ctx.slots / ctx.remote / ctx.sessions / ctx.sidebarRight…） |
| `@deepseek-ai/dsh-client-store` | 客户端会话存储（未用，备用） |
| `@deepseek-ai/dsh-client-ui-slots` | 槽位注册/注入（`ctx.slots.inject` 声明感知注入） |
| `@deepseek-ai/dsh-client-ui-primitives` | **共享视觉基元库（唯一共享点，见 1.2）** |
| `@deepseek-ai/dsh-client-ui-dockkit` | 停靠布局引擎（split/float/tab 拖拽；**非节点图库**；本仓库未安装，`import type` 需补 devDependency 钉 0.2.0-rc.2） |

规则：插件不得 import 另一插件包的组件；primitives 是唯一共享点；非基线宿主类型只能
`import type`。

### 1.2 primitives 基元库（`dsh-client-ui-primitives`）

- **布局/容器**：`DisclosureRow`（24px 折叠行：icon/title/running 微光/expandable/
  collapsedContent/懒挂载 children——原生工具行同款信封）、`Modal`、`HoverCard`、
  `MenuSurface`/`Menu`/`MenuGroup`、`SegmentedTabs`、`SegmentedControl`、`FoldToggle`。
- **原子**：`Button`、`Tag`、`Pill`、`StateDot`、`TextShimmer`、`Switch`/`Checkbox`/
  `Input`、`Tooltip`、`Toast`、`ShortcutKeys`、`PathLabel`。
- **内容渲染器**：`MarkdownText`（不可信 GFM+TeX；labels 最小构成
  `{code:{copyLabel,copiedLabel}, footnotes}`，fileMentions/pathImages 可选不传；
  **labels 必须引用稳定**否则丢弃渲染缓存）、`MarkdownDelegateProvider`（包裹后本地
  链接可点，openFile 回调支持 #L24 行号）、`CodeBlock`（shiki+复制）、`ReadBlock`/
  `DiffBlock`/`SearchBlock`/`TerminalBlock`/`WebBlock`、`JsonTree`。
- **图标库**：`IconXxx{Regular,Medium}` 全集，颜色随 currentColor。
- **工具**：`relativeTime`、`writeClipboard`、`use-copy-feedback`、`fileSizeText`。

### 1.3 主题令牌体系

来源：`client/ui-theme/src/styles/`。切换：`body[data-ds-dark-theme]`；第三方零字面颜色；
按主题分叉用 `:global(body[data-ds-dark-theme])`；`ctx.theme` 可注册 alias 覆盖。

常用令牌（✅ 已用 / ⬜ 可用）：

- 文字：✅ `label-{primary,secondary,tertiary}`、✅ `state-error-primary`（轮次 22 修正：
  ~~`label-error`~~ 在宿主 ui-theme **无定义**，红字真名是 `state-error-primary`，
  design-platform.css:250）；⬜ `label-link`、`label-caption`
- 背景：✅ `bg-layer-{2,3}`；⬜ `bg-layer-1`（轮次 22 修正：**`bg-layer-4` 不存在**，宿主
  只有 1/2/3；个别第一方 CSS 引用它属悬空引用，第三方不得跟抄）、`bg-mask-1`
- 边框：✅ `border-l2/l3`；⬜ `border-l1/l4`
- 状态：✅ `state-warn-label`；⬜ `state-{success,error,idle,business}-{primary,tertiary}`、`state-warn-primary`
- 品牌/交互：✅ `brand-primary`；⬜ `interactive-bg-{hover,active}`、`button-primary-*`、`button-tool-bar-*`
- 圆角：✅ `radius-{xs,sm,md}`；⬜ `radius-{lg,xl,panel}`
- 字体/字号：✅ `--dsw-font-family`、`--dsh-content-font-size-secondary`(13px)、`font-markdown-code-font-family`；⬜ markdown 字号阶梯
- ⬜ `--dsw-elevation-*`、`--dsw-focus-ring-*`、`static-*` 色阶

### 1.4 槽位（slots）速查

权威清单：`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`（90 个）。
注册语义：single=priority 竞争；list=必填 id + 可选 order/label；keyed=必填 key；chain=select。
跨包注册一律 `ctx.slots.inject(name, cb)`。

| 槽位/服务 | kind | 现状/要点 |
|---|---|---|
| `main`（keyed） | keyed | ✅ 写作面板体（key=writer-panel；**保留 key 'conversation' 不可碰**，slot-catalog.ts:1841） |
| `sidebar.panellist` | list | ✅ 面板入口（order=20） |
| `tool.call.toolview` | keyed | ✅ 14 张工具卡片全覆盖（8 语义富卡片 + 6 治理工具通用卡，M1b） |
| 右栏工作台 tab | 服务+keyed | ⬜ **两阶段注册**：① `ctx.sidebarRightTabs.register(definition)`（静态定义：id/kind/patterns/priority/title/guide/`keepMounted`/`multiple`）；② keyed seat `sidebar.right.pane.tab`（+可选 `.title`）注册 body/title，**key=definition.id，仅 key 无 label/order**（slot-catalog.ts:3262-3269）。范例：ui-sidebar-files/src/client/index.ts:81-96。需 inject `'sidebarRightTabs'`/`'sidebarRight'`。会话级持久（storage `dsh.sidebar-right.v1`）✅ |
| 右栏程序化打开 | 服务 | ⬜ `ctx.sidebarRight.openTab(kind,{paneId,replaceTab,revealIfOpened,params})` / `openResource(address,{params})`——「点击左栏摘要→右栏展开」联动的实现路径（ui-sidebar-right/src/client/contract/slots.ts:148-158） |
| 文件打开（面板侧） | 服务 | ⬜ 面板槽 props **无 openFile**；现实路径 = `ctx.sidebarRight.openResource('dsh-resource://file/session/<sessionId>/<path>', {params:{line}})`（第一方同款，ui-chat/src/client/apply.ts:246-258）；fallback text tab 已内建预览。sessionId：右栏 tab 槽是 standardProps，main 面板经 sessions 取活跃会话 |
| `conversation.session` / `session.header.actions` | — | ⬜ 会话头注入（进度微件） |
| `turnTail` | — | ⬜ 回合尾注（章后维护状态徽章席位） |
| locale | 服务 | ⬜ `ctx.locale.register(NS, dict)` 常规服务面，第三方 inject `'locale'` 即可（**不是「等宿主开放」**） |

### 1.5 toolview props 契约（keyed 工具卡片）

- 公共：`useDisclosure()`（行内开合必须用它）、`callId`、`toolName`、`cwd?`、`home?`、
  `openFile(path,{line?})`（⬜ 卡片侧未用）、`loadImage`、`inspect?`。
- phase：`preparing`（无 args）、`start`（**argsRaw 在 block 顶层**）、`result`
  （`content: ContentBlock[]`；`call.argsRaw`；`isError`；`error?: {name,code,reason}`；
  **`block.callTime` 直接可读**（records.ts:171，call 出窗时 null——渲染需 null 分支））。

### 1.6 数据通道

- `remote.workspaceFiles.{list,read}`：✅ 已用（冷启动扫描）。
- **`remote.workspaceFiles.changes(sessionId, target, signal)`**：✅ 已接入（M1b 数据总线增量订阅，load.ts；api/workspace-files/src/changes.ts:79，第一方 files 侧栏 watch 同款）；按文件/目录粒度，目录须在 workspaceRoot 内；fs provider 不支持 watch 时报 `workspace-file/watch-unsupported`（面板已实现降级回轮询 + 断流退避重连）。
- `sessions`：活跃会话探测（✅ 已用）。

### 1.7 布局几何

- main 中央列不可调宽；**左栏 264-420px（默认 280）**；右栏默认 45% 帧、min 300 / max 70%；
  `ctx.layout` fullscreen 可用。面板 chrome：38px 自绘头部 + `0.5px border-l3` 细线。

---

## 2. novel-writer 原版信息面 → v5 覆盖矩阵

| 原版能力 | v5 状态 | 归宿 |
|---|---|---|
| 大纲树 | ◐ 小节折叠 | M2 大纲树视图（章号↔章节联动：M1a 实体索引） |
| 人物卡展开 | ✅ | — |
| 人物关系网络 | ◐ 静态环形图（轮次 22 降级：**静默丢边无提示**——对方无人物文件/名字不一致即整条丢弃；图例边数与列表 relationCount 口径矛盾；节点 fill 引用不存在的 bg-layer-4 实为透明） | M2 关系网络（自研 SVG+pointer 拖拽；**补名字归一 + 未匹配关系提示**） |
| 人物状态时间线 | ◐ 条目罗列（轮次 22 降级：宽容解析只取 chapter/state，domain timeline schema 其余字段丢弃；无倒序告警；数字型 chapter 被静默置空） | M2 时间线事件带（跨人物聚合）；字段收敛以 domain schema 为准（M1a） |
| **伏笔完整性红黄灰三色** | ✗ | **M1b 左栏伏笔页**（纯 frontmatter 计算：planted 章 vs 当前章数 → 滞留/停滞/未种植三色汇总 + 风险排序） |
| **伏笔 milestones 展示** | ✗ | **M1a Plot 实体字段级纳入（显式列 planted/resolved_chapter + milestones——resolved_chapter 轮次 22 补点名）；M2 展示**（「最后一次被触碰是哪章」） |
| 章节列表/进度 | ✅ | — |
| 待办 | ◐ 原文列表（轮次 22 加重：**截断取最旧 30 行、丢 `## [维护 pass]` 分节、重复 pass 不去重**——示例项目 117 行 7 次重复 pass，面板只显最旧一次前 30 条） | **M1b 前置小修**（分节折叠 + 最新 pass 优先/去重 + 截断提示）→ M2 pending 维护工作台（分章折叠 + 操作化）；归档区展示 → M1b |
| 灵感碎片（ideas，原文不可覆盖） | ✗ | M1a 扫描 + M2 设定库（「原文」Tag 区别于 AI 消化产物） |
| 世界观条目 | ◐ 仅计数 | M1a 扫描 + M2 设定库 |
| **创作准则（principles）** | ✗ 轮次 22 补列（原版独立实体 + 写作时全量注入的红线/基调；load.ts ROOT_MARKERS 认得 principles.md 却不读，面板零展示。**轮次 23 口径补全：域层链路完整**——store 已读（KIND_LAYOUT:30）、engine 三处注入永不截断（engine:115/265/558），仅 UI 零暴露，M1a 是纯 UI 补课不涉引擎/存储） | M1a 扫描 + M2 设定库（与风格示范同区折叠） |
| **重要事件时间线（key_events）** | ✗ 轮次 22 补列（原版独立表 + 写前预注入 + 一致性检查输入；人物时间线 ≠ 全书事件视角。**轮次 23 复核修正**：本仓库权威 SoT 是 novel/events.md 单文件实体（store KIND_LAYOUT:35），维护 pass 的 derived facts 聚合「事件索引」**当前不存在**） | M1a **扫描 events.md（权威 SoT）为主**，derived facts 聚合为增强项；M2 时间线事件带扩展 |
| **风格示范（style_reference）** | ✗ 轮次 22 补列（原版 tell/show 互补：principles=规则红线，style_reference=语感腔调 few-shot；文风资产是长篇核心） | M2 设定库 |
| 导出 | ✅ 卡片 | M2 导出中心（**只做工具触发 + 产物摘要；文件浏览引导用户用宿主文件树**，防与宿主重叠） |
| 变更影响分析提示 | ✗ | M4（引擎侧一致性检查结果总线化呈现，不建独立入口） |
| 章节正文阅读（写后确认） | ◐ 仅 200 字预览（轮次 22 纠错：原标 ✅ 与 §6 视角① A7「正文不可见」自相矛盾；实现仅 overview.ts preview() 截断预览） | **M2 章节正文书架**（openResource 全文） |
| **一致性检查明细展示** | ✗ 轮次 22 补列（工具输出已含 severity/dimension/refs/描述/证据——writer-tools/src/index.ts:237-238；parse.ts:140 只取批次数+矛盾数，明细全丢在 RawBody） | **M2/M3**（卡片补逐条矛盾结构化解析：严重度 Tag + 涉及章节 + 描述 + 证据），不必等 M4 总线 |
| **存档点/恢复快照（原版版本历史）** | ✗ 轮次 23 补列（原版 versions 表可回滚；本仓库等价物 archive_point git 存档点 + engine recoverySnapshot 断更快照，均 UI 零盘点） | M2 导出中心同区（存档点列表 + 一键恢复引导走对话）；recoverySnapshot 至少计数展示 |
| **伏笔 AI 双触发（写前 suggest + 保存后 detect）** | ◐ 轮次 23 补列（保存后检测由维护 pass foreshadowEvents 部分承接；写前建议无等价物——M2「下一章仪表」只盘既有伏笔不生成新建议） | M4（引擎侧能力，UI 只承接结果）或裁定「对话路径等价」留痕 |
| **写作统计图表（每日目标/按日字数）** | ◐ 轮次 23 补列（writer_stats 无按日字数，数据源缺口已留痕于 M4） | M4（同 sparkline 条目，防重复立案） |
| 审稿逐条裁定 | ✗ | **M2 审稿工作台**（quote/建议/改写方案渲染 + 逐条裁定；轮次 22 复核修正：引擎渲染**已输出**这三字段——writer-tools/src/index.ts:166-168 缩进行，丢失根因是 parse.ts:127 正则不匹配缩进续行，**UI 侧修解析即可，无需先改引擎**） |

不抄（裁定）：SQLite 实体树/FTS/手动排序 UI（Markdown SoT，文件名序即章序）；手动伏笔
标记按钮（第二编辑入口违反对话式信任链；**等价操作力经 M2 pending 工作台的对话路径
提供**——「一键让 AI 执行 foreshadow_update」，轮次 22 留痕防重复争议）；按日字数统计表
（M4 sparkline 够用，但需先落数据源——见 M4 备注）；章节三态编辑器（状态来自
frontmatter，对话流审稿已覆盖）；**关系图拖拽编辑**（轮次 23 留痕：编辑等价力经对话
writer_update(relation)，与手动伏笔标记同裁定）；**反向分析独立入口**（轮次 23 留痕：
reverse-reference 技能触发即对话路径，UI 无需新面）；**LLM Context 调试面板**（轮次 23
留痕：dsh 宿主自带调试面，无对应缝也不需要）；**项目设置/压缩策略 UI**（轮次 23 留痕：
各包 Config schema 承接，用户改 profile 配置即等价）。

---

## 3. writer-ui v5 现状摘要

- 面板六页签（概况/大纲/章节/伏笔/人物/待办）：SegmentedTabs + Tag 状态色 + 折叠行 +
  关系图 SVG + TextShimmer/图标空态。六页签是**过渡形态**（M2 后左栏收敛，见 §4.0）。
- 8 张工具卡片：原生 ToolRow 同构。
- 数据：冷启动全量扫描 novel/；会话内动态经卡片回写模块级存储。
- 视觉：零字面颜色，全 token；产物 ~77KB。
- 验证：client tsc / 根 tsc / build 零错，216/216 测试，harness 3/3。
- 审查定位结论：**「事后观察窗」而非「决策支持面」**——三个最高频决策点（读新写正文/
  裁定审稿建议/确认维护待办）信息缺失或不可操作（§6 视角① A7/A9/A11）。
- 轮次 22 五视角审查追加定性（§7）：**正确性层有实锤缺陷**（两处失效 token、订阅写进
  cleanup、渲染期副作用、会话单桶串台、扫描竞态、pending 截断方向反了）；矩阵两处 ✅
  成色注水（关系网络/人物时间线）；四行原版信息面漏列（principles/key_events/
  style_reference/一致性检查明细）。

---

## 4. 长期规划（目标形态 → 里程碑，2025 轮次 21 审查后修订版）

> 取向：不做零散快赢；按目标形态规划。里程碑按**用户决策频率**排序（审查裁定：高频
> 写作决策面 > 低频重交互）。

### 4.0 北极星：「写作驾驶舱」双屏形态

```
左栏（280-420px，摘要仪表）              右栏宽画布（45% 帧，sidebar.right.pane.tab）
┌──────────────────────┐   ┌────────────────────────────────┐
│ 写作面板（摘要仪表）    │   │ 写作工作台（深度视图，按需打开）    │
│ · 进度/统计 hero       │   │ ① 章节正文书架（写后读稿确认）     │
│ · 健康度徽章行         │⟶  │ ② 审稿工作台（quote/建议/裁定）    │
│ · 下一步情境卡         │   │ ③ pending 维护工作台             │
│ · 待办/告警摘要        │   │ ④ 写前「下一章仪表」              │
│ （实体浏览页签→降位）  │   │ ⑤ 大纲树 ⑥ 时间线带 ⑦ 关系网络     │
└──────────────────────┘   │ ⑧ 设定库 ⑨ 导出中心              │
                           └────────────────────────────────┘
```

- **左栏 = 状态 + 入口**：进度、健康度（伏笔滞留/待维护/时间线倒序）、情境引导；
  实体浏览页签随右栏视图就绪**逐个降位**为「摘要行 + 跳转」（收敛时序：概况/待办常驻，
  其余按右栏对应视图完成度迁移）。
- **右栏 = 高频决策面优先**：①-④ 是每天走的路径（写后读稿、裁定建议、确认维护、写前
  盘点），⑤-⑨ 为支撑视图。
- 联动机制（已验证）：左栏点击 → `ctx.sidebarRight.openTab/openResource`。
- 工具卡片（对话流内）保持原生同构信封——属于对话，不属于驾驶舱。
- 四层架构：实体模型层 → 数据总线层 → 渲染层（MarkdownText + MarkdownDelegateProvider）→
  交互层（openResource 全联动 + 交叉导航 + locale）。

### 4.1 里程碑

#### M1a 实体模型接口冻结 + 纯函数构建器（设计先行，面板零改动）

- `types.ts`：Chapter/Character/Plot（**含 milestones 字段级 + planted/resolved_chapter**，
  轮次 22 补点名）/Relation/TimelineEvent（**字段宽容表以 domain timeline.ts 权威 schema
  收敛**，数字型 chapter coerce 为字符串）/WorldEntry/Idea/OutlineNode/**Principle/
  StyleRef/KeyEvent（轮次 22 新增三实体——principles.md 扫描 + derived 事实索引 + 风格
  示范）** + 双向索引（人物↔关系反查、章节↔大纲章号、伏笔↔种植/回收章）+ 分页参数位
  （`store.getEntities(kind,{cursor})`，兑现 §4.2 性能行）。
- `buildEntityGraph(scannedFiles)` 纯函数 + 单测（人物反查关系、大纲章号↔章节、
  JSON 字符串 timeline 双形态回归）。**轮次 22 补**：章号排序宽容 coerce（字符串
  `"001"`/中文数字/缺失——现状只认数字型 frontmatter.number，其余归 0 退化文件名序）；
  `localeCompare(x, {numeric:true})`；**轮次 23 补**：数字型 planned_chapter 同族 coerce
  （现状静默置空，「计划」Tag 无告警消失）；**目录子目录裁定**（现状 mdFiles 只取顶层
  file，chapters/卷一/001.md 布局静默漏计——支持一层卷子目录或留痕不支持）。
- **扫描缺口列全（轮次 23 补强）**：UI 冷扫描实缺**四实体**——principles.md/events.md/
  ideas.md（单文件实体，store KIND_LAYOUT:30/35/36）+ style/ 目录（store:37）；对照
  load.ts:101-157 现只扫七类。events.md 为事件权威 SoT（见 §2 key_events 行）。
- **解析器健壮性收敛（轮次 22）**：parse.ts 三处盲区——`(\d{3})` 三位章号（≥1000 章
  失配）、审稿/一致性检查**缩进续行不捕获**（quote/建议/改写方案/证据字段整段丢，此即
  A9 的直接根因）、数字开头卷名失配静默丢；timeline 坏 JSON 与 writer_stats 非法
  timeline 双侧口径不一致（面板静默 0 vs 服务端告警）。
- **hash spike**：验证 dsh-writer-domain 纯函数可打进 client bundle（体积/依赖形态）；
  不可行则降级为 client 独立 content hash + 口径文档化（两端各自对同内容算 hash 自然
  一致，无需互读锚点）。
- **验收（机制化）**：接口 PR 评审；新增实体构建单测全绿；面板行为零变化
  （现有 216 测试不动的证明）。

> **轮次 25 已实施**（详见 implementation-plan §8 轮次 25）：`types.ts`（冻结实体接口 +
> 双向索引 + `PageParams`/`paginate` 分页参数位）与 `graph.ts`（`buildEntityGraph` 纯函数，
> coerce：章号 "002"/中文数字/缺失回退数字文件名、planned_chapter 与 timeline chapter
> 数字→三位序号补零）落地；扫描补全四实体（principles/events/ideas/style/ +
> worldbuilding 名单）+ chapters 一层卷子目录（裁定：支持一层，不深递归）；解析器三盲区
> 收敛（`\d{3,}` 千章、审稿/一致性缩进续行、数字开头卷名）；**hash spike 裁定**：domain
> 纯函数可打进 client bundle（graph+domain 全量 14KB，node:crypto 桩重定向已有），
> contentHash 依赖 node:crypto **不可用** → M1b 增量缓存走 client 独立 hash
> （WebCrypto sha256 + 同口径 canonical 行），两端各自对同内容算 hash 自然一致；
> spike 体积结论来自自建 bundle（graph+domain 全量 14KB）——**M1b 接线 graph.ts 进浏览器
> 入口后复测真实 client.js 体积增量**（轮次 26 已兑现：87.1→~117KB）；types.ts 的
> `SectionEntry` 暂反向引用 overview.ts，M1b 换源时迁入 types.ts 并让 overview 反向引用
> （依赖方向留痕）——**轮次 26 已兑现**（视图模型类型全部迁入 types.ts，overview 仅
> type 再导出兼容）。
> 面板零改动验证：现有 218 测试全绿不动 + 净增 17 例（235/235）、client-harness 3/3。

#### M1b 数据总线 + 面板换源 + 增量订阅 + 左栏决策面增强

- 模块级 store（扫描结果 + 工具动态合并、版本化快照、subscribe），替换 state.ts 与
  2s 会话轮询；**接入 `workspaceFiles.changes` 订阅**（现已可用，目录粒度 watch，
  `watch-unsupported` 时降级回手动刷新）。
- **约束（硬性）**：总线禁止成为第二真源——任何状态必须可从 novel/ 全量重建（内存快照
  = 派生物，与 Markdown SoT 一致）。
- harness 行为基线先行：六页签关键内容断言集（清偿「面板 UI 零覆盖」）→ 面板换源
  （overview 形状从实体图投影，保留旧渲染分支一行切换）→ 删旧 state.ts。
- **左栏决策面增强**（数据已到位，不等右栏）：伏笔页三色汇总 + 风险排序（红=planted
  未回收超期/黄=milestone 停滞/灰=planned 未种植）；**伏笔列表排序键改 planned_chapter
  与当前章差值 + 逾期 Tag（轮次 22 补——现状 status 字母序与写前盘点无关，planned_chapter
  已解析却不参与排序）**；章后维护状态徽章（changes 订阅 + staleChapters 数据）；概况
  「下一步」情境卡（无大纲→规划大纲；有大纲无章→写第一章）；待办归档折叠区；折叠智能
  默认（伏笔页非 resolved 前 3 条、人物页主角、章节页最新一章展开）；页签风险角标。
- **待办页前置小修（轮次 22，P1）**：现状 `slice(0,30)` 取最旧 30 行 + 丢 `##
  [维护 pass]` 分节 + 重复 pass 不去重——改分节折叠、最新 pass 优先/建议去重、截断显示
  「还有 N 条」；`[x] 已完成` 行过滤或划线区分。**轮次 23 补**：分节设计须同时纳入
  `.writer/pending-archive.md` 归档区折叠展示（pending_cleanup 移档后条目现状彻底消失、
  无追溯入口）；M2 pending 工作台操作语义留痕（升格=原版 confirm 等价、作废=reject 等价）。
- **卡片覆盖与回写补全（轮次 23）**：writer-tools 注册 14 工具、writer-ui 仅 8 卡片——
  writer_read/writer_update/recompute_derived/archive_point/pending_cleanup/maintenance_flush
  落通用卡片且不回写面板动态，治理动作在「写作动态」零痕迹；总线层补通用回写路径（或
  六工具轻量卡）。export_book 的 ask 审批等待期与真执行不可区分（均 running）——卡片补
  审批语义态。SummaryCard 错误不回写 vs WriteChapterCard 回写，失败处理统一。review/
  consistency/writer_search 卡补参数摘要（现成 argsHint，多张同名卡可区分）。
- **实体变更达页签（轮次 23）**：现状实体页签只来自冷扫描，timeline_update/
  foreshadow_update 成功后页签仍旧值，「面板见问题→对话操作→回面板验证」环路断裂——
  changes 订阅天然覆盖（工具落盘即触发文件变更流），换源时验收断言此环路。
- **根探测收紧（轮次 23）**：ROOT_MARKERS 补 ideas.md（自底向上纯灵感起步项目现状直接
  报「未找到项目」）；候选 `'.'`/`''` 泛化标记（chapters 等）易误判普通工作区——≥2 标记
  命中或 project.md/outline.md 加权。
- **正确性修复包（轮次 22，随换源一并）**：①卡片记录移入 useEffect + callId 幂等去重
  （现状渲染期副作用，重渲染重复 unshift 挤掉上限内真实历史）；②扫描 `.then` 路径补
  aborted 检查（会话切换竞态）；③会话状态桶语义明确（现状恒写 `_anonymous` 单桶，与
  state.ts「跨会话不共享」声明不符——toolview props 无 sessionId，换识别键或改声明）；
  ④部分失败语义（单文件 read 失败不再整面板报错，收集失败清单呈现「N 个文件读取失败」；
  目录 listDir 失败与「没有章节」空态区分）；⑤readText 分页保险丝（页数/字节上限防
  OOM）；⑥有限并发批量读（4-8 路）+ 扫描进度指示；⑦activeSessionId 无 mainView 持有者
  返回 null（不取任意第一会话）；⑧readText/scanNovel 各循环头 `signal.aborted` 早退
  （轮次 23 补——取消语义不能全外包给宿主 read 传播）。
- **验收（机制化）**：harness 断言六页签关键内容（换源前后各跑一次，快照一致）；changes
  订阅单测（mock 流）；三色/角标渲染断言；**「工具渲染格式 ↔ parse.ts」契约测试**（镜像
  guard 措辞契约做法，锁 writer-tools 成功回执文案漂移——轮次 22 补：全部 ✅ 卡片都建立
  在逐字对齐的正则上却无联动测试）；abort 后 resolve、多会话隔离、失败分支补测。

> **轮次 26 已实施**（详见 implementation-plan §8 轮次 26）：bus.ts 数据总线（版本化快照
> + subscribe + 会话桶 + callId 幂等，替换并删除 state.ts）；换源 projectOverview
> （buildOverview 改为实体图投影；**「保留旧渲染分支」未保留**——旧聚集体直接删除，
> 等价由既有 overview 测试 + project 换源等价抽查锁定）；load.ts 强化（readText 保险丝/
> 4 路并发读/单文件失败清单/进度/staleChapters（client hash 与 domain 同口径，hash.test
> 锁定）/归档扫描）；changes 订阅 + watch 降级（断流退避重连 ≤3 次，重试耗尽降级手动）
> + sessions.list.subscribe 替换 2s 轮询（**observable 缺席时回退轮询**，非纯替换）；
> 左栏决策面全项（情境卡/健康度徽章/伏笔三色+风险排序+逾期 Tag/维护徽章/归档折叠/智能
> 默认/页签角标；三色口径：红=planned_chapter 超期未回收、黄=停滞（距 planted/最后
> milestone 超 3 章）或无锚活跃、灰=未种植，新鲜 planted 不计档）；六治理工具通用卡片
> （14 工具全覆盖）+ export_book 审批语义态（**宿主 toolview props 无审批信号（实证
> ui-tool/contract/slots.ts）——降级为文案标注「审批/执行中」，留痕**）；正确性修复包
> ①-⑧ 全清。验收：258/258 测试（契约测试直调 writer-tools execute；watch/mapPool/保险丝/
> **函数级环路接线测试**「工具落盘→变更帧→重扫→总线新值」）、harness 4/4（**六页签
> 断言为数据级**——Panel 渲染仍只验不抛错，UI 级断言与「闪断→恰 N 次重连→降级」
> 编排用例留 M2 browser-test）、产物零字面色（~117KB）。真人冒烟反馈修正：大纲/人物正文小节改走 MarkdownText（M3 该子项提前落地，labels 模块级常量）。
> 总线口径留痕：快照=「novel/ 全量扫描 + 本客户端工具结果」的内存派生物（live 动态
> 不可从 novel/ 重建——工具回执也是派生物，刷新即丢由冷扫描兜底），非第二真源约束
> 按此口径执行。

#### M2 右栏宽画布工作台（形态落地，高频决策面优先）

- 注册（两阶段）：`ctx.sidebarRightTabs.register(definition)` × N（id 加 `writer-` 前缀，
  kind 自有不与原生 files 冲突；`keepMounted` 保活、`multiple` 多实例按需）+ keyed seat
  body/title；inject 数组补 `'sidebarRightTabs'`/`'sidebarRight'`。
- 视图（优先序 = 决策频率）：
  1. **章节正文书架**：章节列表 + 全文阅读（MarkdownText 渲染；openResource 联动打开
     源文件含行号）——补「写完→读→裁定」主路径（审查视角① A7）。
  2. **审稿工作台**：ReviewCard 先行补 quote/建议/改写方案渲染（severity Tag + quote
     引用块 + 建议正文；**轮次 22 复核修正：引擎渲染已输出三字段**——writer-tools/
     src/index.ts:166-168 缩进行，修 parse.ts:127 续行捕获即可，无需引擎侧先行）；右栏
     逐条裁定（接受→生成 rewrite 指令注入对话、忽略→标记；裁定结果作为对话输入，不直接
     改文件——保持 SoT 信任链）（A9/A10）；**一致性检查卡片同型补逐条明细**（refs +
     描述 + 证据，工具输出已含）。
  3. **pending 维护工作台**：分章折叠 + 行级操作（一键让 AI 执行 timeline_update/
     foreshadow_update、作废归档 pending_cleanup），承接 chapter-writing 章后维护闭环（A11）。
  4. **写前「下一章仪表」**：本章必设/逾期伏笔 + 出场人物 + 上章状态（A13）。
  5. 大纲树（卷分组 + 章节状态色 + 未写条目虚位 + 章号点击↔书架）。
  6. 时间线事件带（跨人物按章聚合 + 倒序告警高亮）。
  7. 关系网络（**自研 SVG + pointer 拖拽**——dockkit 是停靠引擎非图库，可复用其
     useGesture/capturePointer；>12 节点降级邻接表；需补 dockkit devDependency 钉版本；
     **轮次 22 补：名字归一 + 未匹配关系页脚提示**——现状静默丢边且与列表计数矛盾）。
  8. 设定库（世界观条目 + 灵感碎片「原文」Tag）。
  9. 导出中心（工具触发 + 产物摘要；文件浏览引导宿主文件树）。
- 左栏收敛：概况（健康度徽章 + 情境卡）+ 待办常驻；实体页签按右栏就绪度逐个降位为
  摘要行 + openTab 跳转。
- **验收（机制化）**：browser-test 断言——原生右栏 tab 与 writer- 前缀 tab 共存、boot 图
  无 slot 报错、左栏点击后右栏出现对应 tab（**不用 dump-config**——它看不到 client 侧
  slot 注册，轮次 17 已留痕此教训）；tab 关闭重开会话持久（storage 快照）。

#### M3 渲染与交互统一（品质收口）

- MarkdownText 全面接管正文渲染（labels 模块级常量；M4 locale 开放后统一收编——
  **过渡期 labels 为自给常量，留痕**）；本地链接经 `MarkdownDelegateProvider` +
  openResource。
- openResource 全联动（实体卡/路径/时间线章号/导出产物路径）。
- 卡片细节：`block.callTime` 耗时（null 分支）、relativeTime 动态时间、StateDot 状态点。
- hover/focus/键盘焦点环全量（`interactive-bg-hover`、`--dsw-focus-ring-*`）。
- 美学收口：字号收敛 15/13/12/11 四级（去 uppercase/letterSpacing 中文场景）；两套
  statCell 规格统一；statusTone/severityTone 合并 `tones.ts`；章节页改正序 + 定位最新。
- **验收（机制化）**：browser-test 增加 Tab/Enter/Esc 键盘遍历模式（可完成主要导航）；
  **静态扫描脚本**对 lib/client.js grep 字面色（`#[0-9a-fA-F]{3,8}\b|rgb(`，排除 SVG
  title 文本）——「无字面色」是代码属性不用截图测；harness 快照回归。

#### M4 生态与智能（条件触发项）

- locale 化：`ctx.locale.register(NS, dict)` 常规服务面（**普通工作量，非「等宿主」**；
  **修订轮次 18 v1 裁定**「第三方不走宿主 locale 字典」——触发条件：M3 labels 收编时
  一并迁移）。
- 会话头进度微件（`session.header.actions`）——价值低于 M1b 维护徽章，保持后置。
- 字数曲线 sparkline（数据源 `.writer/derived/` 维护产物；**轮次 22 补数据源缺口**：
  derived 现只有摘要/事实/伏笔状态，无按日字数——需先在维护 pass 或 archive_point 落
  按日字数行，否则降级为累计进度曲线）。
- 大纲变更影响提示（引擎侧一致性检查结果总线化呈现）。

### 4.2 关键决策与风险（审查校准版）

| 决策点 | 裁定 | 风险与对策（证据校准） |
|---|---|---|
| 右栏 tab 注册 | 两阶段：`sidebarRightTabs.register` 定义 + keyed seat（key=definition.id，仅 key） | keyDomain 当前空置、replaceRisk 'none'（slot-catalog.ts:3289）；**真正会 throw 的是 kind 同 band 重复注册**（tab-registry.ts:258-262）→ kind 唯一 + writer- 前缀 id |
| 正文渲染器 | MarkdownText + MarkdownDelegateProvider | labels 引用不稳丢弃渲染缓存 → 模块级常量 |
| 关系图布局 | **自研 SVG + pointer**（dockkit 无图原语） | 复杂度失控 → >12 节点降级邻接表；可借 dockkit useGesture |
| openFile 联动 | inject `sidebarRight` → `openResource('dsh-resource://file/...')` | 面板槽无 openFile props（已证）；main 面板 sessionId 经 sessions 取 |
| 数据总线 | 进程内 store + changes 订阅，**禁止第二真源** | 刷新即失 → 冷启动扫描兜底；watch-unsupported → 降级手动刷新 |
| 增量缓存 | hash spike 先行（M1a） | domain 打包不可行 → client 独立 hash + 口径文档化 |
| 审稿裁定交互 | 裁定结果注入对话，不直接改文件 | 第二编辑入口违反 SoT 信任链（审查裁定） |
| 性能边界 | 百章/百实体设计，分页参数位进 M1a 接口 | 超大书卡顿 → cursor 分页 |
| 测试机制 | 行为基线（harness 断言）/键盘遍历（browser-test 模式）/字面色（静态扫描脚本） | 「验收不可判定」是审查 P1 主病——每个里程碑验收必须绑定机制 |

---

## 5. 设计规范速记（增量改动必须遵守）

1. 零字面颜色：一律 token（§1.3）；SVG 属性同 `var(--dsw-*)`；CI 化静态扫描（M3 起）。
2. 基元优先：能用 primitives 就不自绘；折叠 = DisclosureRow 信封（工具卡片用宿主
   useDisclosure，面板行用 CollapsibleRow 本地态）。
3. 状态色映射统一走共享 `tones.ts`（M3 合并前两处暂存需同步改）。
4. 键盘可达：交互控件用基元；自绘控件必须可 Tab + Enter。
5. 空态三要素：图标 + 说明 + 下一步引导；有数据场景复用为「情境卡」（M1b）。
6. 文件改动后 `npm run build` 重建产物；验证四线：client tsc → `npm test` →
   `node scripts/client-harness.mjs` → `node scripts/browser-test.mjs <url>`。

### 已知技术债（随里程碑清偿）

- statusTone/severityTone 双份 → M3 tones.ts（**轮次 22 补证据：面板/卡片 statCell 双
  规格 17px vs 16px、radius-md vs sm，17px 超四级**）。
- 2s 会话轮询 → M1b（总线 + sessions observable）。
- 关系图 280px 下限不可读 → M2 右栏宽画布 + >8 节点降级提示（**过渡期临时缓解：列表
  行数上限 + 「还有 N」提示可先行**——轮次 22）。
- 概况「写作动态」刷新即失 → M1b 总线。
- 面板 UI 零测试覆盖 → M1b harness 行为基线。
- **Tag tone 语义偏差**（unknown 兜底 outline 应为 quiet；solid 一组一枚约定被主角 role
  多枚违反）→ M3 tones.ts 一并。
- **aria-labelledby**：~~缺失~~ 轮次 24 已接线（Panel.tsx tabpanel）；M3 键盘/读屏遍历
  验收时回归确认。

---

## 6. 设计审查记录（轮次 21，四视角并行）

| 视角 | 核心结论 | 主要产出 |
|---|---|---|
| ① 用户工作流 | 定位正确但当前是「事后观察窗」非「决策支持面」；三个高频决策点断档 | A7 正文不可见/A9 审稿丢字段/A11 pending 不可用（均高）；M2 优先级重排为决策面优先；新增正文书架/审稿工作台/pending 工作台/下一章仪表四个规划外项；A1 preset 文案过期（已修） |
| ② 宿主契合 | M1/M3/M4 前提比规划更宽松；M2 两处设计依据需修正 | 右栏两阶段注册形态、openResource 联动路径、changes 流现已可用（M4→M1b）、dockkit 非图库、callTime 直接读、locale 常规面、MarkdownText labels 最小构成 |
| ③ 信息架构 | 六页签是过渡形态；原版取舍清单明确 | 伏笔三色汇总（高）；「设定」页签补世界观/灵感去处；B2 联动硬依赖（由②解）；折叠智能默认/页签角标/情境卡渐进披露；美学四级字号/容器分层/图降级 |
| ④ 规划一致性 | 方向无冲突；问题集中验收可测性/裁定留痕/M1 步幅 | P1/P2 验收机制化（本文 §4.1 各里程碑已绑定）；P7 locale 修订留痕（§M4）；P11 M1 拆 a/b；P9 矩阵归宿补全（§2）；P3 悬空引用清除 |

处置：全部结论已并入 §1/§2/§4/§5；preset 过期文案已修（cordis.patch.yml:35）。

---

## 7. 轮次 22 审查记录（五视角并行：功能覆盖/易用性/视觉契合/健壮性 + Lead 逐项复核）

> 四路子代理审查 + Lead 对每项 P1/P2 独立复核（读源码/宿主 token 定义/工具渲染格式），
> 结论并入 §1.3/§2/§3/§4.1/§5 与本节。子代理个别结论经复核修正后不采纳原文方向（见
> 裁定栏）。

### 7.1 采纳与归宿汇总

| # | 严重度 | 结论（复核后） | 归宿 |
|---|---|---|---|
| 1 | P1 | `--dsw-alias-label-error` 宿主无定义（Cards.tsx:160），红字失效 | 小修清单 |
| 2 | P1 | `--dsw-alias-bg-layer-4` 宿主无定义（Panel.tsx:225），关系图节点透明 | 小修清单 |
| 3 | P1 | usePanelState 订阅写进 cleanup，listener 机制死代码（Panel.tsx:83） | 小修清单 |
| 4 | P1 | 渲染期副作用 + 无去重，动态时间线重复行挤掉真实历史（Cards.tsx onceRecorded） | M1b（**轮次 24 审查提示：修复时勿漏 SummaryCard 错误回写分支**） |
| 5 | P1 | 会话状态恒写 `_anonymous` 单桶，与 state.ts 声明不符，跨会话串台 | M1b |
| 6 | P1 | pending 截断取最旧 30 行 + 丢分节 + 重复 pass 不去重（示例项目 117 行 7 pass 实证） | M1b 前置小修 |
| 7 | P1 | 扫描 then 路径无 aborted 检查（会话切换竞态） | M1b |
| 8 | P2 | 刷新失败清空全部已获数据（catch 置 overview:null） | M1b |
| 9 | P2 | 单文件失败整面板报错 vs 目录失败静默空态，矛盾且不如实 | M1b |
| 10 | P2 | readText 无保险丝（协议异常 OOM） | M1b |
| 11 | P2 | 串行逐文件全量读 + 无进度（百章秒级放大）；charCount 每章两遍 | M1a/M1b |
| 12 | P2 | activeSessionId 无 mainView 取任意第一会话（键序不稳定） | M1b |
| 13 | P2 | 章号排序只认数字型 number（字符串/中文数字/缺失归 0） | M1a |
| 14 | P2 | dev 兜底路径 example-project/novel 硬编码进生产扫描 | 小修清单 |
| 15 | P2 | 关系图/长列表无节点/行数上限（过渡期裸奔） | 临时缓解 + M2 |
| 16 | P2 | 双箭头冲突（自绘 ▾/▸ vs DisclosureRow 内建 chevron） | 小修清单 |
| 17 | P2 | tabpanel 缺 aria-labelledby | M3 |
| 18 | P2 | Tag tone 语义（unknown→quiet；solid 单枚） | M3 tones.ts |
| 19 | P2 | 伏笔排序 status 字母序、无逾期标记 | M1b |
| 20 | P2 | 矩阵两处 ✅ 注水（关系网络静默丢边/计数矛盾；时间线字段丢弃/无倒序告警） | 已改 §2 |
| 21 | P2 | 四行漏列（principles/key_events/style_reference/一致性检查明细） | 已改 §2 |
| 22 | P2 | parse.ts 与工具渲染无契约测试 | M1b 验收机制 |
| 23 | P3 | write_chapter start 摘要键名错（chapter_id vs 实际 chapter），章号静默丢失 | 小修清单 |
| 24 | P3 | foreshadow milestone 分支卡片只显旧状态、丢事件信息 | 小修清单 |
| 25 | P3 | 伏笔/人物空态缺引导句（违反本文 §5 第 5 条「空态三要素」） | 小修清单 |
| 26 | P3 | timeline 数字型 chapter 丢弃；坏 JSON 双侧口径不一致 | M1a |
| 27 | P3 | 解析器盲区（\d{3} 千章/缩进续行/数字开头卷名） | M1a；pending [x] 过滤与截断提示部分 → M1b 待办前置小修 |
| 28 | P3 | 告警行 rowAside 覆盖告警色（丢句计数不着色） | 小修清单 |
| 29 | P3 | ProgressBar brand-primary 挪用 + 0 进度假 1.5% | 小修清单 |
| 30 | P3 | 人物 list/graph 模式随页签切换丢失 | 小修清单 |
| 31 | P3 | DisclosureRow memo 被 inline 闭包击穿；章节倒序渲染每遍 reverse | M1b/M3 |
| 32 | P3 | M4 sparkline 缺按日字数数据源 | M4 前置说明（已改） |
| 33 | ✅ | XSS 正面确认：全走 React 文本节点，注入不可达；M3 启用 MarkdownText 时重评 | 留痕 |

**复核修正（子代理结论不采纳/改向）**：①功能覆盖 #9「M2 审稿需先改引擎侧」——实证
writer-tools 渲染已含 quote/建议/改写方案（:166-168），丢失在 parse.ts 续行正则，UI 侧
修即可；②功能覆盖 #1 建议改 ✗——应为 ◐（尚有 200 字预览）；③视觉 #1/#2 的 token 缺失
经宿主全量定义 grep 实锤（个别第一方 CSS 引用同为悬空引用，不构成「存在」证据）。

**过程留痕**：一个子代理在审查期间越权直接修改了本文件矩阵单元格（章节正文阅读
✅→✗）——方向与裁定一致但流程越界，已按裁定值 ◐ 重写；源码未被子代理改动（git
核对）。

### 7.2 独立小修清单（M1a/M1b 前可先行，均低风险一行至数行级）

> **轮次 24 已全部实施**（详见 implementation-plan §8 轮次 24；验证：typecheck/build 零错、
> 218/218 测试、harness 3/3、产物零字面色）。

- [x] token 两处（state-error-primary / 关系图节点 bg-layer-3——比文档原方案 bg-layer-2
      再上一档，因图容器底即 bg-layer-2，同色不可见）
- [x] 订阅 cleanup 修正（挂载期订阅、卸载退订）
- [x] dev 兜底路径删除（rootCandidates 移除 example-project 两项）
- [x] argsHint 键名补 `chapter`
- [x] foreshadow milestone 回执行解析（**引擎侧同改**：writer-tools milestone 回执补
      `milestone <type> @ chapter/<N>`，否则 UI 无从解析——原「纯 UI 侧」预估修正）
- [x] 伏笔/人物/待办空态补引导句
- [x] 删自绘 ▾/▸ 箭头（模块级稳定语义图标 + useCallback toggle，顺带不再击穿 memo）
- [x] 告警行 aside 着色
- [x] ProgressBar 0 值隐藏填充
- [x] 人物页 mode 提升到面板层

> 计数口径：§7.1 表中归宿=小修清单为 11 行（token 两行合并为一条表述）；轮次 23 追加
> 见 §8.3。

---

## 8. 轮次 23 审查记录（第二轮对抗，目标收敛）

> 四路子代理二轮（文档一致性 / 易用性深挖 / 功能覆盖穷举 / 健壮性+视觉复合）+ Lead
> 逐项复核。**文档一致性子代理对轮次 22 修订本身的 14 处代码证据引用、33 项归宿交叉、
> 数字口径全部核验通过**（含 216/216 测试数实测吻合）；仅 4 项 P3 文档瑕疵，已当场修复。

### 8.1 文档自身瑕疵（4×P3，已修）

§7.1 #25 悬空锚点「§5.5」→「§5 第 5 条」；#27 归宿拆分（pending [x] 部分 → M1b）；
小修清单 11 行/10 条计数口径注明（§7.2）；ui-design.md aria-labelledby 指针改指
「§7 #17（M3）」。

### 8.2 新立案（采纳 22 项，#34-#55：10×P2 + 12×P3）

| # | 严重度 | 结论 | 归宿 |
|---|---|---|---|
| 34 | P2 | 存档点/恢复快照 UI 零盘点（原版 versions 表等价物 archive_point + recoverySnapshot） | §2 已补行 → M2 |
| 35 | P2 | 伏笔写前 suggest 无等价物（保存后 detect 由维护 pass 部分承接） | §2 已补行 → M4 留痕 |
| 36 | P2 | key_events 归宿措辞失实（权威 SoT 是 events.md，derived 聚合不存在） | §2 已修正 |
| 37 | P2 | principles 行补口径（域层链路完整，仅 UI 零暴露） | §2 已补 |
| 38 | P2 | UI 扫描缺口实为四实体全缺（principles/events/ideas/style） | M1a（已补） |
| 39 | P2 | 14 工具 vs 8 卡片，治理动作零回写面板动态 | M1b（已补） |
| 40 | P2 | ROOT_MARKERS 缺 ideas.md（纯灵感起步项目不识别） | 小修（M1b 根探测一并） |
| 41 | P2 | 实体变更不达实体页签（操作后回面板验证环路断裂） | M1b（changes 订阅覆盖，已补） |
| 42 | P2 | setBrowserContext 单例无卸载语义（热重载窗口期持死引用） | 小修 |
| 43 | P2 | pending 修复设计漏归档区（pending-archive.md 追溯断档） | M1b 待办小修（已补） |
| 44 | P3 | export_book ask 审批期与执行不可区分 | M1b 卡片补全（已补） |
| 45 | P3 | SummaryCard 错误不回写（与 WriteChapterCard 不一致） | 小修 |
| 46 | P3 | review/consistency/search 卡无参数摘要 | 小修 |
| 47 | P3 | 目录不递归子目录（卷子目录布局静默漏计） | M1a 裁定（已补） |
| 48 | P3 | 数字型 planned_chapter 静默置空 | M1a coerce（已补） |
| 49 | P3 | 循环无 signal.aborted 自检（取消语义外包宿主） | M1b ⑧（已补） |
| 50 | P3 | Tooltip 包 disabled 刷新按钮失效（disabled 不派发 hover） | 小修 |
| 51 | P3 | writer-ui 缺 dsh-writer-domain devDependency 声明（构建可复现性） | 小修 |
| 52 | P3 | crypto-stub 路径手工剥盘符（空格/中文 percent-encoding 不还原） | 小修 |
| 53 | P3 | 根探测泛化标记误判面（'.' 候选配 chapters 即命中） | M1b 根探测收紧（已补） |
| 54 | P3 | 暗色关系图边线 tertiary×0.5 近不可见（悬停说明挂其上） | 小修（去 opacity/换 border token） |
| 55 | P3 | 写作统计图表行防重复立案 | §2 已补行指向 M4 |

### 8.3 轮次 23 追加小修（并入 §7.2 执行）

> **轮次 24 已全部实施**（同 §7.2 验证口径；带 * 者超出原小修范围顺带落地，见轮次 24 记录）。

- [x] ROOT_MARKERS 补 ideas.md（顺带补 events.md 单文件实体）
- [x] setBrowserContext 包进 effect + cleanup 置 null
- [x] SummaryCard 错误回写统一
- [x] 三卡补 argsHint 参数摘要（TOOL_ARG_KEYS 表，覆盖六工具键名）
- [x] Tooltip disabled 分支（加载期不包 Tooltip，按钮文案自明）
- [x] writer-ui 补 dsh-writer-domain devDependency（钉 0.1.0）
- [x] build-client.mjs 换 fileURLToPath
- [x] 关系图边线对比度（border-l2 去 opacity）
- [x] *M1b 前置小修：pending 页分节重构（extractPendingSections：倒序/跨 pass 去重保留
      最新/[x] 过滤/空节剔除 + 面板分节折叠 + 截断「还有 N」提示）
- [x] *M1b 正确性修复包提前项：then/catch 双路径 aborted 检查；刷新失败保留旧数据 +
      顶部错误提示条；readText 每页 aborted 自检；根探测收紧（'.'/'' 需强标记或 ≥2 弱标记）
- [x] *M1a coerce 提前项：数字型 planned_chapter / timeline chapter 宽容转字符串
- [x] *M3 提前项：tabpanel aria-labelledby 接线

### 8.4 复核关闭的悬念（正面确认）

Tag tone="info" 存在（Tag.tsx:21 八值枚举）；Tooltip 包 Button 合规（forwardRef 转发）；
Button icon+children 同用为宿主明示用法；react/jsx-runtime 在 externals；border-l4
token 双主题定义存在；scrollbarGutter 已用 stable。功能覆盖侧：矩阵其余在册项对照
read 白名单 14 entity + 写作白名单 9 entity 穷举后**无其他漏列**（project 已由概况页承接）。

**收敛判定**：本轮无 P1；P2 均已归宿并入规划；文档自身核验大面积通过。按「一轮审查
无新问题再收口」标准，本轮为收敛轮（新发现均为 P2/P3 且已全部归宿），下一轮实施
小修清单后回归验证即可。
