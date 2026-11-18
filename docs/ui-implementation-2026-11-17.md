# 写作工作台 UI 实施计划

> **任务来源**: 用户已确认 150 章目录修订后的工作台 UI，并授权开始实现；实机反馈写作面板仍被宿主任务列表及输入框覆盖。
> **任务内容**: 将已确认布局接入真实小说数据和宿主草稿，修复会话外壳集成，完成测试、浏览器验证及对抗审查。
> **参考文档**:
> - `docs/ui-redesign-2026-11-17.md` — 已确认设计，尤其 §4.1、§7、§12。
> - `docs/implementation-plan.md` — 包职责、环境限制与轮次 45 设计记录。
> - `references/novel-writer-analysis.md`、`references/dsh-plugin-research.md` — 领域与宿主边界。
> - `docs/ui-capabilities-and-roadmap.md`、`docs/ui-design.md` — 数据模型与主题约定。
> - `packages/writer-ui/src/client/` — 原有扫描、总线、面板与十四工具卡片。
> - `node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/types/client/contract/` — 实际安装版宿主草稿及槽 props 契约。
> **生成日期**: 2026-11-17

目标：完成七页写作工作台，功能导航与章节目录解耦，百章目录可直接定位，业务动作经当前会话草稿执行。

技术：现有 React、TypeScript、esbuild factory bundle；不新增运行依赖或宿主端点，宿主版本保持 0.2.2-rc.1。

## 全局约束与执行裁定

- 简体中文、UTF-8；新增代码四空格缩进，默认不写注释。
- Markdown 为权威来源；UI 不直接保存正文、变更伏笔状态或触发模型 turn。
- 保留全部十四工具卡片及既有正文、人物、伏笔、资料、归档信息。
- 用户已授权此设计实施，直接原生执行，不再增加方案批准轮次。复用当前工作区，保留已有 `.ai-review/` 与设计文档；不自动提交、推送或改动参考子模块。
- 按任务记录进度，先为业务行为写失败测试，再最小实现；纯视觉以浏览器验证，不写样式镜像测试。

## 重点复核输入

1. 150 章、无卷、超长单卷、有缺号的章节：目录最多八行，前后章按实际数组移动。
2. 两会话同时保留与迟到回执：扫描、缓存与动态按明确 sessionId 隔离。
3. 原有草稿带引用、命令草稿、输入锁定和会话已销毁：追加不覆盖，不错误导航。
4. planted 的埋设章已过而回收章未到：不得误报回收逾期；正文完整保留。
5. 超过原展示上限的待办/归档和资料：全部可访问，整章归档不伪装逐条忽略。

## 任务 1：数据隔离与领域投影

修改 `bus.ts`、`Cards.tsx`、`types.ts`、`graph.ts`、`project.ts`；新增/扩充 `tests/bus.test.ts` 与 `tests/project.test.ts`。

- [x] 写测试并确认失败：不同 sessionId 的扫描与相同 callId 不串台；planned/resolve 章锚分开；伏笔全文不截断。
- [x] 实现 `readBus(sessionId?)` / `publishScan(scan, sessionId?)` / `publishWatchState(watched, sessionId?)`，生产调用显式传会话；工具记录 options 加 `sessionId`，缺席不猜测其他会话。
- [x] 投影增加 `resolveChapter`、`content`，章行保留可定位的 `number`、`path`；既有快照/解析功能保持。
- [x] 运行 UI 数据单测；对照失败测试转绿。

## 任务 2：目录与宿主草稿

新增 `src/client/navigation.ts`、`actions.ts`、`tests/navigation.test.ts`、`tests/actions.test.ts`。

- [x] 目录失败测试覆盖 150 章、精确章号 128、缺号前后章、无分卷每 25 章分组、超长单卷、搜索空结果、每页八条及定位当前页。
- [x] 定义纯函数 `chapterGroups(chapters)`、`directoryPage(chapters, group, query, page)`；按实际章号正序，稳定路径作定位键。
- [x] 草稿失败测试覆盖 append 保留策略、blocked/preserved 不导航、命令草稿拒绝追加、销毁会话、缺少服务。
- [x] 实现 `appendRequest(sessionId, prompt, owner)`；成功追加后 persistDraft 再 openView(chat)，不调用 send/submit；失败返回明确状态供预览保留。
- [x] 运行上述单测并确认转绿。

## 任务 3：工作台布局与七页

替换 `Panel.tsx`；扫描生命周期提取至 `useProject.ts`；新增局部 `studio-style.ts` 与 `ChapterDirectory.tsx`，按职责拆分页体 `StudioPages.tsx`。

- [x] 左栏只保留稿件/大纲/人物/伏笔/资料/待确认/概况，样式映射宿主 token，容器断点适配。
- [x] 目录使用任务 2 纯函数，浮层最多八行，卷/分组选择、标题查找、Enter/关闭焦点恢复齐备。
- [x] 稿件独立全文阅读、上一章/下一章、完整大纲与关联资料；返回保留选章和阅读位置，按会话隔离。
- [x] 人物列表/全文/关系/时间线及章号跳转；大纲计划/正文对照；伏笔本章待埋/待收/逾期/收束及完整生命周期。
- [x] 资料分组全文与本地筛选；待确认逐节原文及完整归档可达；概况真实统计、风险、动态及项目操作。
- [x] 请求预览提供编辑、复制、追加到宿主草稿；各操作携带具体实体、章号和建议原文。
- [x] 错误/加载/空态、监听降级、部分读取失败明确呈现；扫描取消和代次判据防迟到污染。

## 任务 4：接线、浏览器与全仓验证

修改 `index.tsx` 转发宿主 props 并安装动作服务；补浏览器验证脚本；更新 UI README、设计及实施记录。

- [x] 确认十四工具卡片仍注册；正确透传 sessionId 和输入动作；审稿证据保留，增加继续处理请求入口。
- [x] `npm run typecheck` 与 `npm test` 全过，客户端 `tsc -p packages/writer-ui/tsconfig.client.json` 全过。
- [x] 真实构建产物浏览器加载，检查 150 章目录与缺号、七页交叉导航、草稿追加、待办/归档全量访问、亮暗主题及四宽度无溢出。
- [x] 独立对抗审查→逐条复核→修复→重测，直到收敛；文档记录真实证据与限制。

## 执行记录

- 预检：当前分支 main，已有用户审查材料及本聊天的未提交设计文件。遵循上级复用当前 checkout 指令，不创建工作树或自动提交，改动范围限 writer-ui 与对应文档。
- 基线：全仓 315/315 通过。

## 实施结果与审查

- 任务 1～4 已完成，当前源码与预构建产物为七页写作工作台。客户端单独 tsc 已串入 writer-ui build，根 typecheck/test 会自动覆盖客户端类型检查。
- 新行为先红后绿：跨会话扫描与同 callId 回执、无来源回执匿名隔离、伏笔 resolve 锚与正文、目录八行/150 章/缺号/无卷、草稿 append/命令/锁定/绑定失效/追加后导航异常、归档完成项/重复项/说明段落。
- 独立对抗审查首轮 3 项 P2，逐条复核并修复：人物筛选后关系跳转、Dialog 初始/恢复焦点、归档有损投影。前两项与归档展示均在实际构建产物浏览器检查中复现失败后修正通过；归档数据链另有自动测试锁定。收敛复审无新实质问题。
- 草稿服务的绑定读取异常返回可复制状态；追加成功后保存或导航异常仍返回 applied，避免提示重试造成重复追加。
- 保留原有无关审查材料；未创建提交、推送、发布或修改宿主 profile。

## 最终验证与适用边界

- `npm run typecheck`：通过，含全部包构建和客户端 tsc。
- `npm test`：324/324 通过（基线 315 项，新增 9 项），完整结果记录在全仓日志。
- `node packages/writer-ui/scripts/client-harness.mjs`：四项 PASS（SSR、冷启动扫描、投影、根目录布局）。
- `node packages/writer-ui/scripts/studio-browser-check.mjs`：使用安装版 dsh-web-frontend 的真实 React、基元、主题以及实际 writer-ui/lib/client.js；工作区和草稿 API 使用受控桩。150 个编号中缺 127（实际 149 章），可跨卷精确定位 128，前后章跳过缺号；搜索不改变目录高度；20 条待确认、完整归档、两会话扫描/草稿隔离、命令草稿阻断均通过；七页×1280/960/720/390px 共 28 组合无整页溢出；亮暗主题实际变色；未捕获页面 JavaScript 异常。
- 浏览器的“保留引用”证明插件使用 append 且不改夹具已有引用，宿主真实语义由安装版 API/实现静态核验；不把它当成完整真实草稿引擎端到端测试。真实桌面 profile、真人导出审批、真实模型生成与外部检索效果未在本轮执行。
- 日志与浏览器截图位于 `.tmp/ui-implementation/`；聊天持久截图位于 `C:/Users/Administrator/.codex/visualizations/2026/11/17/01a1e85b-eaa3-7600-9d28-f778abd51a74/writer-studio-implemented-light.png` 和同目录 dark 图。
- 继续保留已有边界：服务端只识别扁平 chapters/三位章号.md；嵌套路径章节按钮仅支持阅读，不伪造可执行写作；世界观读取上限明确披露并可交给助手检索。

## 宿主底部控件覆盖修复（用户实机反馈）

任务来源：用户在真实“写作面板”中确认工作台显示正确，但宿主任务列表、输入框仍常驻并覆盖面板。

参考：实际安装版 `node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js` 的 ConversationContent / DefaultConversationViews，以及 `references/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css`、`references/deepseek-harness/packages/client/ui-renderer/src/client/scoped-slots.tsx`。已确认 conversation.view 只替换视图区；composerSeat 是常驻兄弟节点，宿主公开 data-conversation-composer-overlay 布局标记和 data-slot 地址锚可用于局部适配。

执行顺序：

- [x] 在浏览器夹具中补实际宿主 ConversationContent / DefaultConversationViews 外壳，先复现任务及输入框未隐藏。
- [x] 工作台接入宿主独立滚动标记，仅在该视图存在的会话滚动区隐藏直属 composerSeat；不卸载输入框、不更改宿主源码。
- [x] 验证写作面板隐藏底部控件、切回对话恢复、原输入节点和草稿保留、不影响其他宿主区域，且工作台获得完整高度。
- [x] typecheck、全仓测试、原浏览器回归和修复专项通过后，复核并追加实施记录。

实现仅涉及工作台根节点的 `data-conversation-composer-overlay` 属性与一条局部样式。选择器通过实际宿主 `data-conversation-scroll`、`data-slot`、`data-composer-seat` 标记定位同一滚动区的底部区域，不依赖哈希类名，不全局修改 body，也不卸载输入节点。切回对话或工作台因异常被替换时，条件自然失效。常规审批/问答仍须回到宿主对话页处理。

专项验证：`node packages/writer-ui/scripts/studio-browser-check.mjs --shell`。夹具从安装版产物的副本导出真实 ConversationContent、DefaultConversationViews 和 CSS；实际组件逻辑保持原样，slot 地址包装按真实 renderer 核对。修复前目标断言失败，修复后 1280/390px 的隐藏、满高、切回恢复同一输入节点、草稿保留、请求追加后返回对话均通过；其他区域的底部节点不受影响，页面异常列表为空。日志为 `.tmp/ui-implementation/shell-red.log`、`shell-green.log`，截图为 `.tmp/ui-implementation/browser/studio-shell.png`。原浏览器 28 组合回归、Node harness 四项、typecheck 和全仓 324 项测试均通过。

独立对抗审查核对宿主正常 DOM、slot 包装、加载/空态/异常态及选择器作用域，逐条复核后无新问题。夹具中的任务内容、textarea 与服务仍为受控桩，尚未证明真实 Lexical 编辑器、审批/问答 chain、Electron profile 的端到端行为，不能据此宣称已完成用户桌面实机验收。
