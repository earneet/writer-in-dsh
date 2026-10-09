# dsh-writer-ui

「写作面板」Web 客户端插件（dsh-writer 工具链的配套 UI）：

- **侧边栏「写作面板」**：全书概况（章节/字数/卷分布/伏笔状态/弧线覆盖/待维护章）+ 最近写作列表（含补丁跳过与丢句告警标记）+ 写作动态时间线。
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

配合 dsh-writer-preset（写作模式）或 dsh-writer-bundle 使用；面板数据从本会话工具结果文本派生，
在非写作会话显示空态指引。

## 已知限制（v1）

- 面板状态为进程内模块级存储（按会话隔离但跨刷新不持久；页面刷新后随工具再次调用重建）。
- 数据源是工具结果文本（卡片解析回写面板），不读全量会话事件、不新增宿主 remote 端点（第三方不可加）。
- 卡片/面板文案为中文硬编码（第三方包不走宿主 locale 字典）。
- 宿主 slots 服务的类型为本地最小契约（运行时同源实现）；样式内联自包含，不 import ui-primitives 值。
- 修改源码后须重建 `lib/client.js`（`npm run build`），registry 只服务构建产物。

MIT License. 见 [仓库根](https://github.com/earneet/writer-in-dsh)。
