# dsh-writer-store

> **任务来源**: 用户要求新工作目录提供一键初始化，并指导非空目录的正确使用。
> **任务内容**: 更新本包的默认项目目录说明，保持会话读写与初始化位置一致。
> **参考文档**:
> - `docs/project-initialization-design-2026-11-17.md` — 已确认的初始化设计与验收。
> - `docs/implementation-plan.md` — 包职责与迭代记录。
> **生成日期**: 2026-11-17

dsh-writer 插件组合的一员：Provider：Markdown SoT 存储——原子写 + content_hash 乐观锁 + 派生缓存，发布 ctx.writer。

## 安装

本组包面向 DeepSeek Harness（dsh）宿主，推荐经组合包安装（其余包由其拉入）：

```bash
dsh plugin --profile <name> add dsh-writer-bundle
dsh plugin --profile <name> add "@deepseek-ai/dsh-headless@0.2.2-rc.1"   # 或 dsh-web-app，app 入口必装
```

## 启动

在小说工作目录中打开 dsh 会话（创作与工作文件全部收在 `novel/`：`principles.md` / `outline.md` / `chapters/` 等）——省略 projectRoot 时默认使用调用会话工作目录的 `novel/` 子目录，可用配置显式覆盖。

空工作目录可在写作面板点击“一键初始化”，或通过宿主 `/writer-project-init` 人类命令建立基础结构；`/writer-project-status` 返回真实目录状态。初始化前后检查目录，只在空目录创建，不覆盖已有内容。中断时保留 `.initializing` 标记和已创建文件，检查处理后再使用空目录初始化。

## 数据布局与不变量

projectRoot 下两类分区（轮次 42 起）：

- **根下 = 人看的数据**：`project.md` / `principles.md` / `outline.md` / `events.md` / `ideas.md` / `pending.md` / `pending-archive.md`（待办归档：只增不删的不可重建史料，入 git）+ `chapters/` / `characters/` / `plots/` / `style/` / `worldbuilding/` 实体目录 + `exports/`（导出产物）。
- **`.writer/` = 机器可弃缓存**：**整目录可删且无损**——`derived/` 由维护 pass 重建，`recovery-snapshot.md` 由下次恢复快照再生成（随项目 `.gitignore` 忽略）。

旧布局的 `.writer/pending-archive.md` 会在项目首次访问时尝试迁移到根下（固定项目也在装载时尝试）；迁移失败告警并重试，不阻断正常稿件读取。归档写入仍强制完成迁移；迁移前 Web 面板保留旧路径兜底读取。

## 许可

MIT（见 [LICENSE](./LICENSE)）。
