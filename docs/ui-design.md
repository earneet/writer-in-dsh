# writer-ui 视觉重构设计（v5.1）

> 配套文档：`docs/ui-capabilities-and-roadmap.md`（宿主能力清单 + 优化路线图——
> 增量 UI 改动先查该文档的令牌/基元/槽位可用面与规范速记）。
>
> **v5.1（轮次 22 五视角审查后修正）**：修两处失效 token、记录视觉层新债（双箭头冲突、
> Tag tone 语义、告警行着色覆盖、假进度等），缺陷清单与归宿统一见路线图 §7。

> 背景：v3 面板/卡片为内联硬编码样式的自包含实现（零字面 token、裸 div、无折叠动画），
> 真机对比后确认与 dsh 宿主原生工具 UI 差距明显。本设计对齐宿主原生观感，依据
> slot-catalog 与 ui-primitives 契约（证据见 implementation-plan §8 轮次 19/20）。
> v5 追加：用户对照 novel-writer 原版指出缺失——大纲 UI、人物展开详情、人物关系图、
> 面板内折叠交互（§查漏补缺）。

## 设计原则

1. **零字面颜色**：全部颜色/圆角/字体走宿主 token（`--dsw-alias-*`、`--dsw-radius-*`、
   `--dsw-font-family`、`--dsh-content-font-size-*`），亮暗主题（`body[data-ds-dark-theme]`）自动跟随。
2. **基元复用**：视觉基元一律取自 `@deepseek-ai/dsh-client-ui-primitives`（基线模块表 9 项之一，
   esbuild external + 运行期 require 供给）——DisclosureRow / Tag / Button / SegmentedTabs /
   StateDot / TextShimmer / 图标库。不再自绘徽章/按钮/页签。
3. **卡片与原生 ToolRow 同构**：DisclosureRow 信封（16px leading 图标 + running 微光动画 +
   collapsedContent 摘要 + 懒挂载展开体），开合状态用宿主注入的 `props.useDisclosure()`。
4. **面板自绘 chrome 对齐原生规格**：38px 头部 + `0.5px solid var(--dsw-alias-border-l3)` 细线
   （宿主不给 main 面板标题栏）；正文 `--dsh-content-font-size-secondary`(13px) 字号体系。

## 卡片（tool.call.toolview）

- 八张语义富卡片各一枚语义图标（write=编辑、review=审阅、stats=数据、foreshadow=分支、
  consistency=盾、search=放大镜、timeline=时钟、export=下载）；六张治理工具
  （writer_read/writer_update/recompute_derived/archive_point/pending_cleanup/maintenance_flush）
  复用通用 SummaryCard（M1b，无专属图标）。
- preparing/start：`running` 微光；start 阶段解析 argsRaw 给出意图摘要。
- result：折叠摘要 = 结论性短语 + Tag 结论色（severity/status→TagTone 映射）；展开 = 结构化
  详情（统计格/建议列表/告警行），解析失败回退原文 `<pre>`（token 着色）。
- isError：标题转 `--dsw-alias-state-error-primary`（v5.1 修正：原文写
  `--dsw-alias-label-error`，该 token 在宿主 ui-theme 中**无定义**——第一方个别 CSS
  引用它同样是悬空引用；红字真名是 `state-error-primary`，见 design-platform.css:250）。
- 结果文本统一经 `resultText()` 归一化（兼容 string 与 ContentBlock[] 两种 content 形态）。

## 面板（main keyed）

- 信息层级：书名 hero（进度条 + 目标差距）→ 四格统计 → 卷分布 → 最近章节 → 伏笔状态 →
  本会话写作/动态（叠加区）。章节页签按卷分组；伏笔/人物/待办列表化 + Tag 状态色。
- 加载态 TextShimmer；空态图标 + 引导文案；刷新为 Button(toolbar, sm) + IconRefreshOutline。
- 页签换 SegmentedTabs（等宽滑动指示、键盘可达）。

## 查漏补缺（v5，对齐 novel-writer 原版信息面）

- **大纲页签**（新）：扫描 novel/outline.md——frontmatter synopsis/volumes/chapters 出
  梗概卡（含「已写 N/M 章」进度 Tag），正文按 `## ` 切分小节，逐节 DisclosureRow 折叠
  （首节默认展开，长节内滚动）。
- **人物展开详情**：人物正文（背景/性格/关系/弧线/写作注意等 `## ` 小节）+ frontmatter
  timeline（**JSON 字符串或数组两种形态宽容解析**，示例项目实际为 JSON 字符串——v3 的
  `Array.isArray` 判断对它恒 false，时间线计数一直是 0）+ 关系（frontmatter relations
  与正文「## 关系」小节列表项 `- **名字**：描述` 解析合并、按名字去重）。
- **人物关系图**：人物页签列表/关系图双模式切换；SVG 环形布局——节点=有关系的人物
  （主角 role 高亮 brand 描边），边=名字能对上号的关系（悬停 title 看说明）；颜色全 token。
  **v5.1 修正**：节点 fill 原写 `--dsw-alias-bg-layer-4`，该 token 宿主**无定义**
  （只有 bg-layer-{1,2,3}），fill 失效为透明空心圆——已改 `bg-layer-3`（图容器底即
  bg-layer-2 同色不可见，比原定再上一档，轮次 24 实施）；静默丢边
  （对方无人物文件/名字不一致）需页脚补「另有 N 条未匹配」提示（归宿 M2，与列表
  relationCount 口径矛盾一并修）。
- **面板内折叠**：章节行（展开看正文预览，预览去记号、CJK 间不留空格、截 200 字）、
  伏笔行（展开看描述预览）、人物行（展开看详情）、大纲小节行，统一 CollapsibleRow
  （本地开合 + DisclosureRow 信封；宿主 useDisclosure 席位仅工具卡片拥有）。
  **v5.1 修正**：CollapsibleRow 的自绘 `▾/▸` 文本箭头与 DisclosureRow 内建 chevron
  冲突（闭合悬停双箭头、展开态自绘箭头消失）——轮次 24 已删自绘箭头，改模块级稳定
  语义图标（宿主 icon prop 必填；previewChevron 悬停展开指示随 expandable 默认呈现）。
  `aria-labelledby` 已随轮次 24 接线（M3 键盘遍历验收回归）。

## 已知取舍

- 卡片文案仍为中文硬编码（第三方包不接宿主 locale 字典，沿袭 v1 裁定）。
- `scripts/client-harness.mjs` 对 primitives 打桩（其 lib 为 ESM+CSS imports，Node 侧无法直接
  require）；真实观感验证走 `scripts/browser-test.mjs`。
- 结果文本的 ContentBlock[] 归一化只处理 text 块，其余块形态 JSON 序列化（与宿主 resultText 同策略）。
- 关系图为静态环形布局（不做力导向/拖拽）；关系说明经 SVG `<title>` 悬停展示。
- 正文小节详情内滚动限高（人物节 200px / 大纲节 360px），长正文不整页铺开。

## v5.1 审查裁定补记（轮次 22）

除上述两处 token 与折叠/关系图修正外，视觉与交互层确认的新债（证据与归宿详路线图 §7）：

- **Tag tone 语义**：statusTone 把 unknown 兜底为 `outline`（read-only 外观），未知状态
  无视觉区分——应改宿主更弱档 `quiet`；`solid` 在宿主注释中约定「一组一枚」，主角 role
  多枚 solid 违反用法——主角高亮改用其他 tone 或保证单枚。
- **告警行着色覆盖**：本会话写作行整行 state-warn-label，但右侧 rowAside 自带 tertiary
  色——「⚠丢句 N」计数恰不着告警色；aside 在告警行应继承或单独上色。
- **假进度**：进度 0 时 `Math.max(progress*100, 1.5)%` 显示 1.5% 假进度条；0 时应隐藏
  填充。填充色用 brand-primary 属品牌色挪用，可考虑 state-success-primary。
- **statCell 双规格**：面板 17px/radius-md vs 卡片 16px/radius-sm，且 17px 超出 M3 的
  15/13/12/11 四级——统一并入 M3 美学收口（补齐差异证据）。
- **模式切换状态丢失**：人物页 list/graph 模式是组件内 state，切页签即丢——mode 应提升
  到面板层或模块级。
- **XSS 正面确认**：正文/frontmatter/关系名/SVG title 全走 React 文本子节点（自动转义），
  无 dangerouslySetInnerHTML；M3 启用 MarkdownText 时需重新评估不可信渲染配置。
