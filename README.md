# writer-in-dsh

> **任务来源**: 用户要求空工作目录提供一键初始化，非空目录提供正确使用指引。
> **任务内容**: 说明新作品起步、项目目录解析及已有文件保护。
> **参考文档**:
> - `docs/project-initialization-design-2026-11-17.md` — 初始化方案与验证。
> - `docs/implementation-plan.md` — 架构约定和实施记录。
> **生成日期**: 2026-11-17

以 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）插件形式复刻
[novel-writer](https://github.com/earneet/novel-writer)（AI 长篇小说写作工具）的领域层：
写作引擎、伏笔状态机、人物时间线、一致性检查、防剧透混合检索与成书导出。
小说正文与工作信息以 **Markdown 为权威来源（SoT）**，索引/摘要/状态全部为可重建派生物。

## 包结构（12 包）

| 包 | 角色 |
|---|---|
| `dsh-writer-domain` | 纯函数域库（frontmatter/hash/伏笔状态机/时间线/检索打分），无插件行 |
| `dsh-writer-core` | Service Definition：`ctx.writer` 抽象基类 + typed events |
| `dsh-writer-store` | Provider：Markdown SoT 存储 + 派生索引（乐观锁/原子写/串行化链） |
| `dsh-writer-engine` | Provider：写作引擎（full/assist/rewrite 三模式、3+1 维审稿、维护 pass、一致性检查、恢复快照） |
| `dsh-writer-tools` | Consumer：14 个面向模型的工具（writer_read / write_chapter / foreshadow_update / timeline_update / consistency_check / writer_search / export_book …） |
| `dsh-writer-skills` | 五个 bundled 技能（起步引导/章节写作/伏笔指南/审稿指南/参照学习） |
| `dsh-writer-export` | TXT / HTML（打印 PDF）/ ePub 导出 |
| `dsh-writer-rag` | 混合检索（CJK bigram TF-IDF + 可选语义档 + RRF，防剧透过滤） |
| `dsh-writer-guard` | 工具业务错误预算（超预算注入纠偏提示，不熔断） |
| `dsh-writer-bundle` | 组合包：profile 级全局挂载全部插件（含 headless） |
| `dsh-writer-preset` | 「写作模式」agent preset：Web 新建会话的模式选择器并列预制，会话级挂载写作工具链 |
| `dsh-writer-ui` | 写作面板客户端插件：会话视图「写作面板」标签页 + 工具结果富卡片（/plugins 动态加载；入口轮次 37 起由侧边栏迁至标签页） |

## 快速开始

```sh
# Web 形态（推荐，含「写作模式」与写作面板 UI）
dsh plugin add dsh-writer-preset        # 需 profile 已含 dsh-web-app
dsh web
# 新建会话 → 模式选择「写作模式」，会话目录指向你的小说项目根

# headless 形态（无 UI，全局挂载）
dsh plugin add dsh-writer-bundle
dsh headless "写第二章"
```

**项目布局**：创作与工作文件全部收进 `<项目根>/novel/` 子目录——`novel/project.md`（项目元数据）、
`principles.md`（创作准则）、`outline.md`、`chapters/{NNN}.md`、`characters/`、`plots/`、
`pending.md`（人工待办）、`exports/`（导出产物）、`.writer/`（派生缓存）。
`example-project/` 是完整示例（novel/ 布局）。

**新作品起步**。在宿主中打开空工作目录并创建「写作模式」会话。目录也可以仅含 Git 元数据、空 `novel/`，或两者。在首轮输入框旁点击「一键初始化」，插件会在 `novel/` 中建立基础模板，无需调用模型。随后可点「和助手确定故事方向」，把起步要求追加到草稿里，核对后自行发送。发送首轮后也可从写作面板进入工作台。

如果初始化中断，在原会话点击「重试初始化」补齐缺失项，已有文件会保留。使用默认项目目录时，写作工具会检查项目状态，未就绪时提示先完成初始化。其他未识别的非空目录会显示使用指引。

省略 `writer-store.projectRoot` 时，写作服务使用**发起操作的会话工作目录**下的 `novel/`，与面板保持一致。显式绝对路径仍可用于固定项目或旧式平铺布局。固定路径与当前会话不一致时，面板展示实际路径和修正办法。旧 profile 中的示例目录覆盖需手动移除。如果桌面端刷新后仍采用旧配置，请退出并重新打开宿主。

## 文档

- [docs/implementation-plan.md](docs/implementation-plan.md) — 落地规划与 §8 全部迭代记录（含已知限制与环境坑）
- [docs/release-checklist.md](docs/release-checklist.md) — npm 发布清单
- 各包 README 有该包的机制、安装与限制说明

## 开发

```sh
git submodule update --init   # 拉取两个只读参考子模块
npm install && npm test       # 测试自动串 build
npm run typecheck
```

本仓库用 npm workspaces；dsh `plugin add` 内部转发 pnpm（本机须 pnpm 10）。详见 [AGENTS.md](AGENTS.md)。

MIT License.
