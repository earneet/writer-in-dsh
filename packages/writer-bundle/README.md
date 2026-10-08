# dsh-writer-bundle

一行安装全部 dsh-writer 插件组合。安装后从小说项目目录启动 dsh 即可用全套写作工具（writer_read / writer_update / write_chapter / review_chapter / foreshadow_update / timeline_update / consistency_check / recompute_derived / writer_stats / archive_point / export_book / writer_search）。

## 安装

本组包面向 DeepSeek Harness（dsh）宿主，推荐经组合包安装（其余包由其拉入）：

```bash
dsh plugin --profile <name> add dsh-writer-bundle
dsh plugin --profile <name> add "@deepseek-ai/dsh-headless@0.2.0-rc.2"   # 或 dsh-web-app，app 入口必装
```

## 启动

从小说项目目录（含 `principles.md` / `outline.md` / `chapters/` 等）启动 dsh——projectRoot 默认取当前工作目录。

## 许可

MIT（见 [LICENSE](./LICENSE)）。
