# 发布检查清单

> **任务来源**: 用户要求修复 2026-11-18 审查中的发布指引版本漂移，并确认补齐 Windows 与桌面验收。
> **任务内容**: 核对当前宿主、十二包依赖及预构建安装路径，加入可重复的浏览器冒烟与真实桌面验收。
> **参考文档**:
> - `docs/current-state-review-2026-11-18.md` — R10 及宿主升级边界。
> - `docs/writing-safety-decisions-2026-11-19.md` — 写作流程改进及浏览器与桌面验收范围。
> - `docs/implementation-plan.md` — 历轮发布与安装实测记录。
> - `package.json`、`packages/writer-preset/package.json` — 当前宿主依赖矩阵。
> - `references/dsh-plugin-research.md` — 插件分发机制。
> **生成日期**: 2026-11-19

> 适用于 `dsh-writer-*` 十二包（9 代码包 + bundle + preset + ui）的 npm 发布。依据 `references/dsh-plugin-research.md`（publish.zh.md 摘要）与
> `docs/implementation-plan.md` §8 轮次 6/10/11/17/18。当前版本 0.1.0；发布前逐项打勾。

## 1. 版本与依赖（每次发布）

- [ ] 十二包版本一致提升（包间互相依赖为精确版本 `0.1.0`，改版本须同步全部引用处）。流程：逐包 `npm version <v> -w <pkg>` 后 grep 复核旧版本字符串清零（防 bundle 拉到新旧混合依赖图）。
- [ ] 核对整套环境满足 `@deepseek-ai/dsh@0.2.2-rc.1` 的 **Node ≥24.9.0** 要求。单个 writer 包的 `engines.node >=20` 不代表包含宿主的套件支持 Node 20／22。
- [ ] `@deepseek-ai/dsh-*` 运行时依赖与宿主**严格同版本**（当前 `0.2.2-rc.1`）；独立版本包 `@deepseek-ai/cordis` 为 `4.1.0`，`@deepseek-ai/schemastery` 为 `3.19.0`。writer-preset 的 agent-preset／persona／tool-* 同样钉 `0.2.2-rc.1`，不把引用子模块的最新提交当成已安装版本。
- [ ] **升级宿主版本时**：独立安排版本迁移，统一所有直接宿主依赖及 lock，按目标宿主核对 cordis／schemastery；检查 `.cordis/`、工具决策、命令、preset 和客户端契约。特别核对 writer-guard 是否保留下游 block 决策新字段；重新执行干净安装和真实空会话、草稿、审批／问答验收，不沿用旧版“无适配点”结论。
- [ ] 全部包已去 `private: true`（仓库根 `writer-in-dsh` 保持 private 不发布）。
- [ ] **lib/ 预构建形态**（P6 起）：9 个代码包 main=`lib/index.js`、types=`lib/index.d.ts`、files=`["lib"]`（skills 加 `assets`）。构建 = 根 `npm run build`（逐包 `tsc -p tsconfig.build.json`，TS 5.7+ `rewriteRelativeImportExtensions` 把 `.ts` 相对导入重写为 `.js`，零新增构建依赖）。**发布前必须先 build**（`lib/` 在 .gitignore；每包已加 `prepublishOnly: npm run build` 兜底，新 clone 直接 publish 不会产出无 lib 坏包）。
- [ ] **构建先行是开发期新约定**：`npm test` / `npm run typecheck` 已串 build（工作区裸导入经 main 解析到 lib）；**overlay/profile 下改 domain/core 等被裸导入包的源码须先 `npm run build` 才生效**（overlay 入口指 src，但 src 内的包间裸导入走 lib）。
- [ ] **不支持 git 直装**：lib 不入库且无 prepare 脚本，`dsh plugin add github:...` 形态会拿到无 lib 的坏包——分发仅 registry / tarball / link 三路径（research.md publish 一节的 git 直装项对本仓不适用，留痕）。
- [ ] 包名非 scoped，npm 默认 public，无需设 `publishConfig.access`（留痕）。
- [x] `repository` 字段已补全（轮次 16：11 包 + 根均指向 https://github.com/earneet/writer-in-dsh，子包含 `directory`）；新包照抄同型字段。
- [ ] 运行时直接 import 的宿主包在 `dependencies` 且钉 `0.2.2-rc.1`（engine/rag→`@deepseek-ai/dsh-llm`、tools/guard→`dsh-tools`、skills→`dsh-skill`）：不依赖 pnpm auto-install-peers 默认行为（非契约，禁用即缺包崩）。
- [ ] `writer-bundle` / `writer-preset` 无 main/types 为**有意形态**（组合包无 JS 入口，cordis.patch.yml 按包名引用各包入口；与 research.md 官方示例的 main 差异在此留痕）。
- [ ] **writer-ui 双半形态**（轮次 18）：exports `.` → `lib/index.js`（宿主半，tsc）与 `./client` → `lib/client.js`（浏览器半，esbuild factory-form CJS，banner/intro/footer 与宿主 tsdown clientBundle 预设逐字对齐）；`dsh.client { platform: 'web' }` manifest；`files: ["lib"]` 覆盖双半产物；构建依赖 esbuild/@types/react 为 devDependencies（不进运行时依赖图）；宿主 slots 类型为本地最小契约（不依赖 ui-slots 包）。
- [ ] `writer-skills` 的 `files` 含 `assets`（技能资产随包分发）；`writer-bundle` / `writer-preset` 的 `files` 含 `cordis.patch.yml`。
- [ ] 根 `npm run typecheck` 零错、`npm test` 全绿；writer-ui 的 client tsc 已串入包构建，确认该构建门实际运行。
- [ ] **lockfile 卫生（轮次 38 修改后审查留痕）**：lock 重建曾致 semver 范围内传递依赖重解析（非 dev 漂移仅根 zod 4.4.3→4.6.7，本仓 12 包不 import zod；`@deepseek-ai/*` 钉版零漂移、npm ci 可复现、resolved 全指 registry.npmjs.org）——发布前如需收窄 zod，在根 devDependencies 显式钉 `4.4.3`。另：`@google/genai@2.21.0` 在 lock 中 `hasInstallScript: true` 但根 allowScripts 未列（旧 lock 同状旧账）——是否放行其安装脚本待发布时裁定，本仓未直接消费该包，默认维持不列。

## 2. 打包预检

- [ ] 发布前根目录 `npm run build`，随后每包 `npm pack --dry-run` 核对产物内容（lib/、assets/、cordis.patch.yml 进包；src/ 与 tests/ 不在 files 白名单内不进包；**无 spike/临时产物混入 lib/**——writer-ui 的 hash-spike 已改内存构建不落盘，此处核对兜底）。
- [ ] tarball 内 `package.json` 无 `private`、无 `"*"` 依赖。

## 3. 安装路径验证（发布后或发布前用 tarball 预演）

- [ ] **link 路径**（本地开发）：`dsh plugin --profile <p> add <包绝对路径>` 逐包按依赖序（domain → core → store → engine → skills → export → rag → guard → tools → ui → bundle / preset），再装 app bundle 并钉版本：`dsh plugin --profile <p> add @deepseek-ai/dsh-headless@0.2.2-rc.1`（或 `@deepseek-ai/dsh-web-app@0.2.2-rc.1`；**preset/ui 的验证须用 web-app**——preset 依赖 agent-preset-registry，headless 无模式选择器与客户端半加载）。
- [ ] **npm 路径**（发布后真实形态；发布前用 `npm pack` tarball 等价预演）：`dsh plugin --profile <p> add ./dsh-writer-<x>-<ver>.tgz`。注意：**tarball 安装只对无包间依赖的包可独立完成**（如 writer-domain），含包间依赖（精确 `0.1.0`）的包须等全部包上 registry 后按包名安装（`dsh plugin add dsh-writer-bundle` 一步拉全图）。
- [ ] 安装后 `dsh --profile <p> --dump-config` 核对组合树（`# == dsh-writer-bundle` 分节含 store→engine→skills→export→rag→guard→tools 行序；preset 形态含 writer-ui 全局行 + preset-writer 声明行）。
- [ ] preset 形态追加验证（轮次 17 教训）：web 启动后 **必须**核对 `agentPresets/list`（token 换 cookie 后 POST `/api/agentPresets/list`）——写作模式在 roster 且**无 `broken` 标记**（dump-config 组合树不充分，服务提供方须在 isolate 域）；ui 形态核对 boot 图发现 `dsh-writer-ui` + `/plugins/??dsh-writer-ui/client.js&rev=…` 返回 200。
- [ ] 从含 `novel/` 的小说工作目录启动 headless 跑一次 `writer_stats`；缺省 projectRoot 跟随发起会话的 `header.cwd/novel`，不是宿主进程启动目录。显式绝对路径配置仍优先。

### Windows 写作流程复验

- [ ] 干净 checkout 中执行 `npm ci --no-audit --no-fund` 和 `npm run smoke:windows`。核对首轮前建书实际落盘、改稿要求追加到宿主草稿并保留原稿、待办刷新及改稿后旧建议停止供确认。记录 CI run 链接或执行日志。脚本自动查找 Edge 或 Chrome，必要时用 `WRITER_BROWSER_EXECUTABLE` 指定浏览器。夹具使用随依赖安装的宿主前端产物、真实命令与临时项目，模型输出和真人审批由下面的桌面场景验证。
- [ ] 使用隔离的 Windows 测试账号或虚拟机，以新的 Electron profile 安装本次候选包。发布前可按本节 link 顺序装候选包，发布后另用全新 profile 走 registry 路径。记录应用版本、包版本、安装来源和测试作品目录。在桌面宿主内通过 `plugin_manager list_plugins` 核对写作预设及客户端插件已激活。验收时使用独立的测试模型配置及空工作目录。
- [ ] 新建「写作模式」会话，在发送首轮之前点击初始化，验证 `novel/project.md` 写入所选目录、已有输入草稿保留，首轮后能打开工作台。保存并改写一个示例章，核对选区外原样、旧稿待办状态及审稿依据。
- [ ] 对同一测试章从工作台发起 `export_book`。验收者先拒绝一次，确认目录无新增产物，再发起并批准一次，检查回执与实际文件路径，打开 EPUB 或 HTML 核对书名和章范围。记录拒绝和批准结果及产物路径。浏览器夹具的通过记录和这项验收记录分别归档。
- [ ] 对同一测试章发起整章改稿，验收者先拒绝并核对稿件哈希，再重新在工作台发起并批准，确认回执和磁盘写入一致。另做一次局部改稿，核对选区前后正文逐字一致。

## 4. 已知环境坑（装机差异，发布说明可引用）

- pnpm ≥12 在 Windows 盘符根锁目录 EPERM 完全不可用，宿主须配 pnpm 10（§8 轮次 6）。
- 新建 profile 只含 base + 功能 bundle 无 app 入口会**无限空转**，必须另装 app bundle（§8 轮次 6）。
- 安装 app 包时明确钉 `@0.2.2-rc.1`，避免无版本参数解析到其他版本。
- `dsh plugin add` 内部转发 pnpm；宿主 install-scripts 审批由宿主 profile 管，本仓包无安装脚本。

## 5. 发布动作

- [ ] 按依赖序发布：domain → core → store → engine / skills / export / rag / guard → tools → ui → bundle / preset（`npm publish` 或 `pnpm publish`；本仓日常用 npm workspaces）。
- [ ] 发布后在新环境按包名 `dsh plugin --profile demo add dsh-writer-bundle` 复验 registry 安装路径（本机已完成 tarball 等价预演，见 §8 轮次 10；preset 形态另按 §3 的 roster/路由两项复验）。
