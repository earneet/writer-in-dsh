# writer-in-dsh

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
| `dsh-writer-ui` | 写作面板客户端插件：侧边栏面板 + 工具结果富卡片（/plugins 动态加载） |

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
