# dsh-writer-store

dsh-writer 插件组合的一员：Provider：Markdown SoT 存储——原子写 + content_hash 乐观锁 + 派生缓存，发布 ctx.writer。

## 安装

本组包面向 DeepSeek Harness（dsh）宿主，推荐经组合包安装（其余包由其拉入）：

```bash
dsh plugin --profile <name> add dsh-writer-bundle
dsh plugin --profile <name> add "@deepseek-ai/dsh-headless@0.2.2-rc.1"   # 或 dsh-web-app，app 入口必装
```

## 启动

从含 `novel/` 子目录的项目目录启动 dsh（创作与工作文件全部收在 `novel/`：`principles.md` / `outline.md` / `chapters/` 等）——projectRoot 默认取启动目录的 `novel/` 子目录，可用配置显式覆盖。

## 数据布局与不变量

projectRoot 下两类分区（轮次 42 起）：

- **根下 = 人看的数据**：`project.md` / `principles.md` / `outline.md` / `events.md` / `ideas.md` / `pending.md` / `pending-archive.md`（待办归档：只增不删的不可重建史料，入 git）+ `chapters/` / `characters/` / `plots/` / `style/` / `worldbuilding/` 实体目录 + `exports/`（导出产物）。
- **`.writer/` = 机器可弃缓存**：**整目录可删且无损**——`derived/` 由维护 pass 重建，`recovery-snapshot.md` 由下次恢复快照再生成（随项目 `.gitignore` 忽略）。

旧布局的 `.writer/pending-archive.md` 会在下次归档写入（`pending_cleanup` 工具等）时自动幂等迁移到根下；迁移前 Web 写作面板对旧路径保留兜底读取。

## 许可

MIT（见 [LICENSE](./LICENSE)）。
