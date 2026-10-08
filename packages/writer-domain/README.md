# dsh-writer-domain

novel-writer 领域纯函数库：frontmatter 解析/序列化、content_hash、伏笔状态机、人物状态时间线、上下文组装、审稿/维护/一致性契约、RAG 分词与打分。无插件行、无副作用，**可独立引用**（`npm install dsh-writer-domain`）。

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
