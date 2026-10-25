# dsh-writer-bundle

一行安装全部 dsh-writer 插件组合。安装后从含 `novel/` 子目录的项目目录启动 dsh 即可用全套 14 个写作工具（writer_read / writer_update / write_chapter / review_chapter / foreshadow_update / timeline_update / consistency_check / recompute_derived / writer_stats / archive_point / pending_cleanup / maintenance_flush / export_book / writer_search）。

## 安装

本组包面向 DeepSeek Harness（dsh）宿主，推荐经组合包安装（其余包由其拉入）：

```bash
dsh plugin --profile <name> add dsh-writer-bundle
dsh plugin --profile <name> add "@deepseek-ai/dsh-headless@0.2.0-rc.2"   # 或 dsh-web-app，app 入口必装
```

## 启动

从含 `novel/` 子目录的项目目录启动 dsh（创作与工作文件全部收在 `novel/`：`principles.md` / `outline.md` / `chapters/` 等）——projectRoot 默认取启动目录的 `novel/` 子目录，可用配置显式覆盖。

## 许可

MIT（见 [LICENSE](./LICENSE)）。
