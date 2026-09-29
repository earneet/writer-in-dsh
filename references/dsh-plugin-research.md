# DeepSeek Harness (dsh) 插件机制研究

> 研究对象：`references/deepseek-harness` 子模块（dsh-v0.2.0-rc.2，提交 639ed015）。
> 用途：为本仓库后续制作 dsh 插件 / 技能提供参考。所有结论均注明源码路径，可信度以源码为准。

## 1. 核心理念：一切皆插件

dsh 是基于 [Cordis](https://github.com/cordiverse/cordis) 的 agent harness，核心架构是 **everything-is-a-plugin**（见 `README.md`）。宿主只提供加载器与注册表，所有能力（shell、LLM、工具、技能、UI……）都是插件挂载上来的。开发者文档入口：`docs/user/develop/`。

### 1.1 能力缝（Capability Seam）

dsh 中每个可替换能力由三类角色组成一个"能力缝"（`docs/glossary.md`、`docs/capability-seams.md`）：

- **Service Definition**（服务定义）：声明 `ctx.<name>` 服务的接口与事件。
- **Service Provider**（服务提供者）：实现该服务的插件，可替换。
- **Consumer**（消费者）：使用该服务的插件（如注册面向模型的工具）。

例：技能缝 = `dsh-skill`（定义，`ctx.skills`）+ `dsh-skill-filesystem`（本地提供者）+ `dsh-tool-skill`（消费者，注册 `skill` 工具）。同一缝可有多 provider 竞争：shell（bash-local / bash-sandbox / pwsh-*）、llm（deepseek / pi-ai）、web-search（deepseek / exa / perplexity）、storage（json / sqlite）、subagent（in-process / acp / claude-code / codex / dsh-sdk）。

## 2. 插件定义形式

来源：`docs/user/develop/basic/index.zh.md`、`packages/AGENTS.md`。

插件 = 一个**导出 `apply` 函数的 ESM TypeScript/JavaScript 模块**。框架加载时调用 `apply(ctx)`，通过 `ctx` 注册能力。三种形态：

### 2.1 函数形式（最常用）

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin'          // 必需：插件名
export const inject = ['tools']          // 可选：声明依赖的服务，就绪后才加载
export const Config = Schema.object({})  // 可选：配置 schema（见 §4）

export function apply(ctx: Context, config: Config) {
  ctx.tools.register(/* ... */)
}
```

### 2.2 对象形式

```ts
export default {
  name: 'my-plugin',
  inject: ['tools'],
  apply(ctx: Context) { /* ... */ },
}
```

### 2.3 类形式（Service 提供者）

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

export default class MyService extends Service {
  static inject = ['tools']
  constructor(ctx: Context) {
    super(ctx, 'myService')  // 向其他插件提供 ctx.myService
  }
}
```

### 2.4 生命周期与依赖

- `inject` 声明依赖的服务名列表，框架等所有服务就绪后才运行 `apply`；服务消失时依赖插件自动卸载、恢复后重载（`docs/user/develop/framework/index.md`）。
- 每个插件有独立 Fiber 作用域，状态机 `PENDING → LOADING → ACTIVE → (FAILED)` / `ACTIVE → UNLOADING → DISPOSED`。
- `ctx.plugin(child)` 挂子插件；`fiber.dispose()` 手动停止。
- 提供服务的类形态插件用 declaration merging 给 `ctx.<name>` 加类型：`declare module '@deepseek-ai/cordis' { interface Context { metrics: MetricsService } }`。

### 2.5 可注册的能力缝（capability seams）清单

来源：`docs/architecture.md`「新行为放哪里」表、`docs/cookbook/extension-cookbook.md` feature→mechanism 映射。

| 能力 | 机制 |
|---|---|
| 模型工具 | `ctx.tools.register(defineTool({...}))` |
| LLM 适配器 | `ctx.llm.registerAdapter(names, adapter)`（`LlmAdapter` 子类） |
| 任意服务 | 类形态插件 default-export `Service` 子类 |
| 人类命令 | `ctx.commands`（不经模型 turn） |
| 事件钩子 | `ctx.on(...)`：`agent/pre-step`、`agent/request`、`tools/pre-execute`（权限 gate，waterfall 返回 allow/deny/ask）、`tools/execute`、`tools/post-execute`、`tools/result`、`agent/turn-stopping` 等 |
| 系统提示词 | `ctx.systemPrompt.section()`（排序 + 作用域遮蔽） |
| 上下文注入 | `agent.inject()`（进入下一个请求） |
| Shell/终端/FS/沙箱 | `ctx.shell`、`ctx.terminals`、`ctx.fs`、`ctx.sandbox` provider |
| 子代理 | `ctx.subagents` provider 注册表 |
| MCP | 一个 server 一个插件：发现工具 → `ctx.tools.register()` |
| 后台任务/webhook | `ctx.jobs`、`ctx.webhookRuntime` |
| 会话投影（持久状态） | `ctx.sessionProjections.register({key, stateSchema, init, apply, wire})`，扩展 `SessionEventMap` |
| 动态扩展（agent 自写插件） | extensions 子系统 `ctx.dynamicCordisRunner`（`docs/subsystems/extensions.md`） |
| UI | Web Client 注册 `ConversationNodeDefinition` + keyed renderer |

事件分发四模式（`docs/user/develop/framework/events.md`）：`emit` 广播、`bail` 短路、`serial` 顺序 await、`waterfall` 管道（**必须调 `next()` 委托**）。

### 2.6 关键规则（来自 `packages/AGENTS.md` 与 postmortem 0001）

- **函数插件具名导出** `name` / `inject` / `Config` / `apply`，**不得有 default export**；服务包 default-export 服务类。混用两种形态会导致 Loader 丢弃函数插件的 namespace（`docs/postmortem/0001-acp-default-export-drops-inject.md`）。
- **注册即 effect**：所有贡献走 `ctx.effect()` / `ctx.on()`，注册表 `register()` 返回 disposer；插件卸载时自动清理（事件监听、工具、定时器），无需手动 removeListener。自定义资源用 `ctx.effect(() => cleanup)`。
- **可选服务用 `ctx.get(name)`**；`ctx.<name>` 仅用于已声明 inject 的服务（postmortem 0001）。
- 全 ESM（`"type": "module"`）；包名 `@deepseek-ai/dsh-<name>`；dsh 包放 `peerDependencies`/`devDependencies`。
- 瀑布流监听器必须调用 `next()` 委托；类型化事件用 declaration merging。

## 3. 工具（Tool）注册 DSL

来源：`docs/user/develop/basic/tool.zh.md`、`docs/cookbook/adding-a-tool.md`。

```ts
import { defineTool } from '@deepseek-ai/dsh-tools'

ctx.tools.register(defineTool({
  name: 'greet',
  description: 'Greet someone by name.',
  parameters: {
    name: { type: 'string', required: true, description: 'The name to greet' },
  },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute(args) {
    return `Hello, ${args.name}!`
  },
}))
```

`defineTool` 按 `parameters` 推导并校验 `args`；`execute` 返回 `output.schema` 声明的规范值，`output.render` 转为面向模型的内容。进阶（嵌套 schema、后台工作、策略钩子、PTC mode、UI 卡片）见 `docs/cookbook/adding-a-tool.md`。

## 4. 插件配置

来源：`docs/user/develop/basic/config.zh.md`。

导出 `Config` 接口 + 同名 Schemastery schema，默认值写在 schema 中：

```ts
import Schema from '@deepseek-ai/schemastery'

export interface Config { greeting: string; maxRetries: number }
export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  maxRetries: Schema.number().default(3),
})

export function apply(ctx: Context, config: Config) { /* config 已校验 */ }
```

- 配置在 `cordis.yml` 的插件行 `config:` 键传入，加载时经 schema 校验并填充默认值；非法配置**响亮失败**。
- **无硬编码可调参数**：部署可能变化的取值必须是 Config 字段（检验标准：不改代码能否在 cordis.yml 改这个值）。
- 配置变更触发插件 HMR 热替换（卸载旧实例 → 加载新实例，effect 自动清理）。
- `cordis.yml` 插件行支持 `!!js` 表达式（仅限 `config` 值和 `disabled`），如 base 里的 `disabled: !!js process.platform === 'win32'`（`packages/bundle/base/cordis.patch.yml`）；注意是 `!!js` 不是 `!js`。

## 5. 分发与安装：bundle + profile

来源：`docs/user/develop/basic/publish.zh.md`。

两个概念、两种 manifest（都在 `package.json` 的 `dsh` 键下）：

| 概念 | manifest | 说明 |
|---|---|---|
| **组合包 bundle** | `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` | 附带一个配置层的 npm 包，回答"贡献什么插件行" |
| **profile** | `"dsh": { "profile": { "bundles": [...] } }` | `$DSH_HOME/profiles/<name>` 下的目录，回答"按什么顺序组合哪些 bundle" |

组合包结构：

```
hello-plugin/
├── package.json       # name/version/type:module/main/files + dsh.bundle
├── cordis.patch.yml   # 插件行 patch（按包名引用入口）
└── index.js           # 插件模块
```

```json
{
  "name": "dsh-hello-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

```yaml
# cordis.patch.yml
- insert:
    - id: hello
      name: dsh-hello-plugin
```

安装/移除：`dsh plugin --profile demo add ./hello-plugin`（内部转发 pnpm）；`remove` 同时移依赖和层。加载层序（后者按行胜出，patch 替换整行 `config` 而非深合并）：

1. profile `bundles` 列表中各 bundle patch（按加入顺序）
2. profile 自己的 `cordis.patch.yml`
3. `$DSH_HOME/cordis.patch.yml`（机器级共享）
4. `--patch <path>` overlay（按 argv 顺序）

分发渠道（`publish.zh.md`「从 GitHub 安装」一节）：

- **npm 发布**：`pnpm publish` 时构建好 `lib/`，`dsh plugin add your-package` 装预构建代码（推荐，用户免授权）。
- **tarball**：`pnpm pack` → `dsh plugin add ./x.tgz`。
- **git 直装**：`dsh plugin add github:you/hello-plugin`——拉的是源码，作者必须提供自包含 `prepare` 脚本；pnpm ≥10 需用户在 profile 的 `pnpm-workspace.yaml` 加 `allowBuilds: <pkg>: true` 授权（= 允许该代码安装时在本机执行，建议锁定 commit）。
- 社区发现：给插件仓库打 GitHub topic [`dsh-plugin`](https://github.com/topics/dsh-plugin)（`README.md` L46）；无中心化市场，运行中可经 `plugin_manager` 工具装卸。

本地开发：`--patch overlay` 指向绝对路径的插件文件即可（见 §2 教程）。

## 6. 技能（Skill）子系统

来源：`docs/subsystems/skills.zh.md`、`packages/skill/`。

技能 = **纯 Markdown 指令文件**（非代码插件），是"可选指令"而非会话事件。面向模型的 `skill({ name })` 工具按需加载正文。

### 6.1 定义格式

- 名称 kebab-case：`^[a-z0-9]+(?:-[a-z0-9]+)*$`
- 两种形态：目录束 `<name>/SKILL.md`（可带资源文件）或扁平 `<name>.md`；不支持嵌套 `**/SKILL.md`
- YAML frontmatter 字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | kebab-case 标识 |
| `description` | 是 | 路由用短描述（模型目录里只显示 name+description，上限默认 500 字符） |
| `whenToUse` | 否 | 额外路由提示 |
| `disable-model-invocation` | 否 | 布尔；省略默认 true→模型可调用设 false 则模型目录不含 |
| `user-invocable` | 否 | 布尔；省略默认 true，用户命令目录可见 |

（调用控制是 `modelInvocable` / `userInvocable` 两个正交布尔，frontmatter 键为上述全小写形式。）

正文即 Markdown 指令；相对资源（脚本/图片/资料）通过 `resourceBase` 按需解析。实例参考：`packages/skill/skill-badge/assets/dsh-badge.md`（纯 Markdown + 同目录 PNG 资源）。

### 6.2 本地发现优先级（rank 小者胜）

| Rank | 来源 | 根目录 |
|---|---|---|
| 100 | project-dsh | `<projectRoot>/.dsh/skills` |
| 200 | project-agents | `<projectRoot>/.agents/skills` |
| 300 | custom | `Config.customSkillDirs` |
| 400 | user-dsh | `<dshHome>/skills` |
| 500 | user-agents | `<agentsHome>/skills` |
| 600 | bundled | `Config.bundledSkillDir` |

项目根 = 含 `.git` 的最近祖先。重名时近层直接胜出；单层内按 rank → 提供者顺序 → 本地顺序。Chokidar 监视变更，热生效。

### 6.3 编程接口

`ctx.skills.registerProvider()` 注册提供者；`ctx.skills.register()` 注册运行时技能（内存态，返回 disposer）；`list()/snapshot()/get()` 查询。也可以把技能作为资源打进 bundle（如 `dsh-skill-badge` 以 `BUNDLED_SKILL_RANK` 注册不可变 bundled 候选项并经 `resourceBase` 暴露资产目录）。

## 7. 已提供的插件与技能盘点

### 7.1 包布局

`packages/<group>/<pkg>/` 双层结构，`@deepseek-ai/dsh-*` 命名，约 60 组 240+ 包（分组清单见根 `AGENTS.md` Repository layout 一节）。主要分组：

- **核心**：core（agent/session）、boot、sdk、host、client、api、bundle（profile 组合）
- **执行/文件**：shell、fs、subprocess、terminal、ssh、ptc-runtime、sandbox
- **模型/外部**：llm、web（search/fetch）、mcp、lsp、context、compaction
- **编排**：subagent、workflow、jobs、todo、plan、goal、schedule、preset、guard
- **交互**：browser-use、computer-use、interaction、attachment、deliverables
- **会话/存储**：session、session-query、storage、workspace、spill、feedback、credentials、settings、identity
- **扩展机制**：extensions（运行时自我修改）、hooks（Claude Code/Codex 桥）、webhook
- **experimental**：voice-input、agent-team、speech-to-text 等原型
- **util / test-support / runtime-diagnostics**

工具类包统一 `tool-*` 前缀（约 25 个）。

### 7.2 内置工具清单（模型可调用）

来源：`docs/tool-catalog.md`（从源码生成的权威清单）。主要包括：bash/pwsh（含 persistent 版）、read/write/edit/read_image、glob/grep、str_replace_editor、terminal_*×6、web_search/web_fetch、skill、subagent/subagent_fork + send_message/interrupt_agent/list_agents、workflow、ralph、run_code(PTC)、todo_write、exit_plan_mode、present、ask_user_question、create/get/update_goal、schedule_*×4、job_kill/list/output、session_search 等×5、lsp、plugin_manager、MCP resources×3、stagehand_*×6、agent-team×9、cordis_inspect_*×2、load_workspace_dependencies。

### 7.3 随包技能（bundled skills）

| 技能 | 提供包 | 说明 |
|---|---|---|
| office-docx / office-pptx / office-xlsx | `packages/skill/skill-office` | Office 文档读写（即本会话技能目录里的三个 office 技能） |
| dsh-badge | `packages/skill/skill-badge` | "powered by dsh" 徽章（默认禁用，显式启用） |
| diagnose-windows-sandbox-acl | `packages/sandbox/sandbox-windows-acl` | Windows ACL 诊断（`src/acl-skill.ts`） |

本地提供者不合成内置系统技能；部署方经 bundled 根目录或专用提供者提供随包技能。仓库自身的 `.agents/skills/` 另有 16 个开发流程技能（dsh-doc、dsh-code-review、dsh-pre-push-checks 等），走 rank 200 的 project-agents 根。

### 7.4 可插拔扩展示例（做插件时可参考的实现样板）

- **MCP**：`packages/mcp/`（mcp-client、mcp-resources）——外部工具接入
- **浏览器**：`packages/browser-use/` + `experimental/browser-use-{chrome-devtools-mcp,playwright-mcp,runtime,stagehand-native}`
- **webhook**：`packages/webhook/`（webhook、webhook-github）——外部事件入口
- **LLM adapter**：`packages/llm/`（deepseek、pi-ai）+ `docs/user/develop/practice/llm-adapter.zh.md`
- **运行时自改**：`packages/extensions/`（tool-cordis 等）
- **CLI 桥**：`packages/hooks/`（hooks-claude-code、hooks-codex）
- **语音**：`experimental/voice-input-bundle`、`speech-to-text`

## 8. 制作插件的最小骨架（综合提炼）

**写代码插件**（工具/服务类扩展）：

```ts
// src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'writer-tool'
export const inject = ['tools']

export interface Config { greeting: string }
export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
})

export function apply(ctx: Context, config: Config) {
  ctx.tools.register(defineTool({
    name: 'writer_greet',
    description: 'Greet a writer.',
    parameters: { name: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(args) { return `${config.greeting}, ${args.name}!` },
  }))
}
```

本地调试（绝对路径 overlay）：

```yaml
# cordis.yml
- insert:
    - id: writer-tool
      name: '/abs/path/to/src/index.ts'
```

```sh
dsh web --patch ./cordis.yml
```

发布：加 `package.json`（`dsh.bundle` + `cordis.patch.yml` 按包名引用）→ npm publish 或 pack tarball → `dsh plugin --profile <name> add <pkg>`。**真实完整范本**：`packages/todo/tool-todo/src/index.ts`（212 行）——具名导出 `name`/`inject = ['tools', 'sessionProjections']`、Schemastery `Config`、会话投影 + `defineTool` + UI 卡片声明，其 `package.json` 展示 peer/dev 依赖布局，是写工具插件的最佳模仿对象。

**写技能**（纯指令，零代码）：项目里建 `.dsh/skills/my-skill/SKILL.md`（或 `.agents/skills/`），frontmatter 写 name/description(/whenToUse)，正文写操作指令，同目录可放资源。即刻被模型经 `skill` 工具发现（rank 最高）。

选择建议：**能用技能（Markdown 指令）解决的不写代码插件**；需要新工具/服务/事件/UI 时才写插件；可替换能力按能力缝三角色拆包。

## 9. 权威文档索引（制作插件时按需查阅）

| 主题 | 路径（相对 references/deepseek-harness/） |
|---|---|
| 第一个插件 / 工具 / 配置 / 发布 | `docs/user/develop/basic/{index,tool,config,publish}.zh.md` |
| 框架（生命周期/服务/事件） | `docs/user/develop/framework/` |
| Cordis 教程（7 篇） | `docs/cordis-tutorial/` |
| 扩展 cookbook | `docs/cookbook/extension-cookbook.md`、`docs/cookbook/adding-a-tool.md` |
| 架构图 | `docs/architecture.md` |
| 技能子系统 | `docs/subsystems/skills.zh.md` |
| 工具目录（生成） | `docs/tool-catalog.md` |
| 配置目录（生成） | `docs/config-catalog.md` |
| 能力缝 | `docs/capability-seams.md`、`docs/glossary.md` |
| 包布局与规范 | 根 `AGENTS.md`、`packages/AGENTS.md`、`packages/README.md` |
