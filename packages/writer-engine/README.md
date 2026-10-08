# dsh-writer-engine

dsh-writer 插件组合的一员：Provider：写作引擎——full/assist/rewrite 三模式、3+1 维审稿、维护 pass、一致性检查、断更恢复快照，发布 ctx.writerEngine。

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
