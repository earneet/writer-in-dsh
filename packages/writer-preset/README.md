# dsh-writer-preset

「写作模式」agent preset（预制模式）：安装后，DeepSeek Harness Web 客户端「新建会话」的
模式选择器中会出现「写作模式」，与内置的标准模式 / PTC 模式并列。选中该模式的会话按本包
声明组合插件；其他会话不受任何影响。

## 机制

本包是一个 bundle（`dsh.bundle.patch` → `cordis.patch.yml`），patch 只插入一条
`@deepseek-ai/dsh-agent-preset` 声明行。声明机制见宿主文档
`packages/preset/agent-preset/README.zh.md`；内置预设（standard/ptc/cordis/minimal）
来自 `dsh-web-app` bundle，本包按同一方言追加自定义预设。

## 组合内容

| 层 | 行 | 说明 |
|---|---|---|
| 人设 | `dsh-persona` | 长篇小说协作写作助手身份 + 开场加载 writer-onboarding 技能 |
| 基础 | `dsh-agent-instructions` / `tool-fs` / `tool-skill` / `tool-todo` / `tool-ask-user` / 平台 shell | 读稿件与 pending.md、加载写作技能、向作者提问 |
| 写作 | `dsh-writer-store→engine→skills→export→rag→guard→tools` | 全部 dsh-writer 插件，挂载序与 dsh-writer-bundle 一致 |

## 安装（需含 Web 应用的 profile）

```sh
# 在小说项目目录启动 dsh web（projectRoot 取会话工作目录）
dsh plugin add dsh-writer-preset        # 或本地路径 link: 安装
dsh web
# 新建会话 → 模式选择「写作模式」
```

要求：profile 已含 `dsh-web-app`（它提供 agent-preset-registry；headless 部署无模式选择器，
preset 不生效——headless 请用 dsh-writer-bundle 全局挂载）。

## 与 dsh-writer-bundle 的区别

- `dsh-writer-bundle`：profile 级全局挂载，**所有会话**都有写作工具（含 headless）。
- `dsh-writer-preset`：会话级按需挂载，只在**选了写作模式**的会话组合写作工具链，
  与代码/通用任务会话互不干扰。

## 已知限制

- 引擎默认路由 deepseek-official/deepseek-chat，可在 profile patch 或 Web 预设编辑器覆盖。
- preset 声明的 `name/description` 为中文原样展示（用户自建预设保留自身元数据，不随界面语言本地化）。
- 本包不携带 writer-bundle；两者同时安装时 preset 会话会在全局 writer 行之外再组合一组同 id 的
  writer 行（服务重复注册），未在此组合下验证——请按需二选一安装。

MIT License. 见 [仓库根](https://github.com/earneet/writer-in-dsh)。
