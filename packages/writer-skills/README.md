# dsh-writer-skills

dsh-writer 插件组合的一员：bundled skills：创作起步 / 章节写作 / 伏笔指南等技能资产与注册插件。

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
