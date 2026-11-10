# dsh-writer-ui

「写作面板」Web 客户端插件（dsh-writer 工具链的配套 UI）：

- **会话视图标签页「写作面板」（`conversation.view` 槽，与「对话」「轨迹」同级；八页签，v9 信息架构 + M1b 决策面）**：
  - **概况**：书名/流派卡（品牌色侧条 + 目标字数进度条 + 百分比）、**情境卡（当前项目状态下最有价值的下一步动作）**、**健康度徽章行（伏笔三色 + 待维护）**、图标统计格（**点击跳转对应页签**）、**卷分布分段占比条**、最近章节（章号 chip）、伏笔状态徽章、本会话写作动态；
  - **大纲（v8 树形）**：outline.md 梗概卡 + **卷→幕→章情节结构树**（小节标题分型；`##`~`######` 嵌套与平铺两种笔法同构）；**章叶联动实际章节**（已写显字数/状态点，未写灰标）；已写未入大纲的章节单独回填区；
  - **章节（v9 阅读面）**：按卷分组的已写章节，**展开读正文全文**（Markdown 渲染限高滚动）；**边界留痕**：第三方客户端插件对 workspaceFiles 只有读面，面板内直接编辑无落盘通道——修改走对话（writer_update/补丁改写），落盘后增量订阅自动刷新本页；
  - **伏笔**：**风险分桶（超期红 > 活跃黄 > 未种植灰 > 已收束，桶头计数）+ 逾期 Tag**，展开为**生命周期步进轨**（计划→种植→强化/半揭示/回调/红鲱鱼→回收，章号锚）+ 描述；
  - **人物**：characters 全量列表（首字头像，主角品牌色描边），**可折叠展开**（正文小节；结构化时间线步进轨；关系列表 + **「被指向」反向关系区**），并可切换**人物关系 SVG 环形图**（主角高亮、悬停看关系说明）；
  - **灵感（v8）**：ideas.md 碎片卡片（只读呈现；tags/消化状态机是参考项目 SQLite 概念，Markdown SoT 单文件分节不携带——差异留痕）；
  - **设定（v8）**：创作准则 principles.md（写作时全量注入的红线/基调）+ **世界观 worldbuilding/ 全文卡片**（v8 起全文读取，标题 frontmatter.title > 首标题 > id 三级回退）+ 重要事件 events.md + 风格示范 style/；
  - **待办**：pending.md 分节待办行（复选框行标，**跨维护 pass 归一化去重、倒序最新在前**）+ **已归档区（pending-archive.md，默认折叠）**。
  - 冷启动即拉取：面板打开时经宿主 `workspaceFiles` remote（list/read）扫描当前会话工作区的小说项目（`novel/` 子目录或工作区根直铺布局均可识别，大纲阶段无章节亦可，支持一层卷子目录 `chapters/卷/NNN.md`），浏览器侧用 `dsh-writer-domain` 纯函数聚合——无需先运行任何写作工具；手动「刷新」+ 会话切换自动重扫。
  - **增量订阅（M1b）**：`workspaceFiles.changes` 目录流（`watchProject`）驱动去抖重扫——工具落盘 → 文件变更 → 面板自动更新；宿主不支持该流时降级手动刷新，断流退避重连。
- **工具结果富卡片**（v4 与宿主原生 ToolRow 同构，14 工具全覆盖）：`write_chapter`（保存回执 + 补丁协议 + 丢句告警 Tag）、`review_chapter`（建议列表 severity 分级 Tag）、`writer_stats`（统计格 + 卷/伏笔 Tag）、`foreshadow_update` / `consistency_check` / `writer_search` / `timeline_update` / `export_book`（结论摘要行）；治理类六工具（`writer_read` / `writer_update` / `recompute_derived` / `archive_point` / `pending_cleanup` / `maintenance_flush`）落通用摘要卡并回写「写作动态」。全部为 DisclosureRow 折叠信封（语义图标 + running 微光 + 懒挂载详情），解析失败回退原文。
- **视觉体系（v7/v8）**：零字面颜色——全部走宿主 `--dsw-*` / `--dsh-*` token（亮暗主题自动跟随；v7 修复了 label-tertiary/bg-layer-3/border-l3/l4/state-warn-label 等在 0.2.2 宿主主题不存在的失效引用，收敛到现行 13 token）；基元（Tag/Button/SegmentedTabs/Tooltip/TextShimmer/图标库）取自基线模块 `@deepseek-ai/dsh-client-ui-primitives`；面板 38px 自绘头部对齐原生面板 chrome 规格。设计决策见 `docs/ui-design.md`。

## 机制

第三方动态客户端插件：package.json 声明 `dsh.client { platform: 'web' }`，`exports["./client"]`
指向构建产物 `lib/client.js`（factory-form CJS：`window.__ModuleLoader__.load({ id, factory })`，
与宿主 tsdown clientBundle 预设逐字对齐）。宿主把它经 `/plugins/<pkg>/client.js` 运行期服务给
浏览器；基线模块（react/cordis/ui-slots 等）经注入的 require 从模块表取。扩展位全部走
`ctx.slots.inject`（声明感知注入）：`conversation.view`（会话视图标签页面板体，session
作用域，sessionId 经槽标准 props 直达；`order: 20` 排在 chat/trajectory 之后）、
`tool.call.toolview`（keyed 工具卡片，任意工具名可注册）。

入口位置（与旧版侧边栏形态的区别）：`conversation.view` 是**会话作用域**——标签随已打开的
会话出现，每个会话独立记忆所选视图；未打开会话时没有该入口。当前版本为纯会话视图形态，
不再注册 `main` + `sidebar.panellist`（旧版全局面板入口已移除）。

## 安装

```sh
# profile 全局层挂载（不要加进 agent preset 的会话级行——同包多 source 组合会失败）
dsh plugin add dsh-writer-ui
```

配合 dsh-writer-preset（写作模式）或 dsh-writer-bundle 使用。面板冷启动数据经宿主现成 remote
（`workspaceFiles`/`sessions`，与第一方文件侧栏同范式）读取，不新增宿主端点；本会话工具运行动态
由富卡片回写叠加在概况页。

## 已知限制（v5 + M1b）

- 面板概况的「本会话写作/动态」为进程内模块级存储（跨刷新不持久，随工具再次调用重建）；冷启动总览不受影响。
- watch 不可用时扫描退化为打开面板/切换会话/手动刷新时全量重拉（`watchProject` 对 `workspaceFiles.changes` 不支持/结束的场景自动降级并提示）。
- **一层卷子目录布局（`chapters/卷/NNN.md`）当前仅客户端扫描支持**：服务端 writer-store 的 `writer_read`/引擎/RAG/导出仍只识别扁平 `chapters/NNN.md`——按卷子目录组织的章节在面板可见但服务端工具不可见，正式写作项目请沿用扁平布局（服务端支持为后续 backlog）。
- 卡片/面板文案为中文硬编码（第三方包不走宿主 locale 字典）。
- 宿主 slots/remote 服务的类型为本地最小契约（运行时同源实现）；视觉基元依赖浏览器模块表供给的 `dsh-client-ui-primitives`（基线 9 模块之一，宿主 ≥0.2.0-rc.2 均携带）。
- `scripts/client-harness.mjs` 对 primitives 打桩（其 lib 为 ESM+CSS imports，Node 侧无法 require）；真实观感验证走 `scripts/browser-test.mjs`。
- 修改源码后须重建 `lib/client.js`（`npm run build`），registry 只服务构建产物；自测工具见 `scripts/`（Node harness + Playwright 浏览器测试）。

MIT License. 见 [仓库根](https://github.com/earneet/writer-in-dsh)。
