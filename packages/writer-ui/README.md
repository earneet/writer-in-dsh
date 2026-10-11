# dsh-writer-ui

「写作面板」Web 客户端插件（dsh-writer 工具链的配套 UI）：

- **侧边栏「写作面板」（五页签）**：
  - **概况**：书名/流派卡（目标字数进度条）、章节/人物/伏笔/世界观统计格、卷分布、最近章节、伏笔状态徽章、本会话写作动态；
  - **章节**：全量章节列表（编号/标题/卷/线/状态徽章/字数，倒序）；
  - **伏笔**：plots 全量列表（hint/状态徽章/计划章）；
  - **人物**：characters 全量列表（名字/角色/弧线/时间线条数/关系数）;
  - **待办**：pending.md 待办行。
  - 冷启动即拉取：面板打开时经宿主 `workspaceFiles` remote（list/read）扫描当前会话工作区的小说项目（`novel/` 子目录或工作区根直铺布局均可识别，大纲阶段无章节亦可），浏览器侧用 `dsh-writer-domain` 纯函数聚合——无需先运行任何写作工具；手动「刷新」+ 会话切换自动重扫。
- **工具结果富卡片**：`write_chapter`（保存回执 + 补丁协议 + 丢句告警高亮）、`review_chapter`（建议列表按 severity 着色）、`writer_stats`（统计表）、`foreshadow_update` / `consistency_check`（摘要卡）。解析失败回退原文显示。

## 机制

第三方动态客户端插件：package.json 声明 `dsh.client { platform: 'web' }`，`exports["./client"]`
指向构建产物 `lib/client.js`（factory-form CJS：`window.__ModuleLoader__.load({ id, factory })`，
与宿主 tsdown clientBundle 预设逐字对齐）。宿主把它经 `/plugins/<pkg>/client.js` 运行期服务给
浏览器；基线模块（react/cordis/ui-slots 等）经注入的 require 从模块表取。扩展位全部走
`ctx.slots.inject`（声明感知注入）：`main`（keyed 面板体）、`sidebar.panellist`（面板入口）、
`tool.call.toolview`（keyed 工具卡片，任意工具名可注册）。

## 安装

```sh
# profile 全局层挂载（不要加进 agent preset 的会话级行——同包多 source 组合会失败）
dsh plugin add dsh-writer-ui
```

配合 dsh-writer-preset（写作模式）或 dsh-writer-bundle 使用。面板冷启动数据经宿主现成 remote
（`workspaceFiles`/`sessions`，与第一方文件侧栏同范式）读取，不新增宿主端点；本会话工具运行动态
由富卡片回写叠加在概况页。

## 已知限制（v3）

- 面板概况的「本会话写作/动态」为进程内模块级存储（跨刷新不持久，随工具再次调用重建）；冷启动总览不受影响。
- 扫描为打开面板/切换会话/手动刷新时全量重拉（无文件 watch 增量；`workspaceFiles.changes` 流是后续优化点）。
- 卡片/面板文案为中文硬编码（第三方包不走宿主 locale 字典）。
- 宿主 slots/remote 服务的类型为本地最小契约（运行时同源实现）；样式内联自包含，不 import ui-primitives 值。
- 修改源码后须重建 `lib/client.js`（`npm run build`），registry 只服务构建产物；自测工具见 `scripts/`（Node harness + Playwright 浏览器测试）。

MIT License. 见 [仓库根](https://github.com/earneet/writer-in-dsh)。
