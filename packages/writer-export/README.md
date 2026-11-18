# dsh-writer-export

> **任务来源**: 用户要求新工作目录提供一键初始化，并指导非空目录的正确使用。
> **任务内容**: 更新本包的默认项目目录说明，保持会话读写与初始化位置一致。
> **参考文档**:
> - `docs/project-initialization-design-2026-11-17.md` — 已确认的初始化设计与验收。
> - `docs/implementation-plan.md` — 包职责与迭代记录。
> **生成日期**: 2026-11-17

dsh-writer 插件组合的一员：Consumer：TXT / HTML / ePub 导出，发布 ctx.writerExport。

## 安装

本组包面向 DeepSeek Harness（dsh）宿主，推荐经组合包安装（其余包由其拉入）：

```bash
dsh plugin --profile <name> add dsh-writer-bundle
dsh plugin --profile <name> add "@deepseek-ai/dsh-headless@0.2.2-rc.1"   # 或 dsh-web-app，app 入口必装
```

## 启动

在小说工作目录中打开 dsh 会话（创作与工作文件全部收在 `novel/`：`principles.md` / `outline.md` / `chapters/` 等）——省略 projectRoot 时默认使用调用会话工作目录的 `novel/` 子目录，可用配置显式覆盖。

## 许可

MIT（见 [LICENSE](./LICENSE)）。
