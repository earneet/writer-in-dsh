# 发布检查清单（P5：轮次 6 限制③清偿）

> 适用于 `dsh-writer-*` 十包的 npm 发布。依据 `references/dsh-plugin-research.md`（publish.zh.md 摘要）与
> `docs/implementation-plan.md` §8 轮次 6/10。当前版本 0.1.0；发布前逐项打勾。

## 1. 版本与依赖（每次发布）

- [ ] 十包版本一致提升（workspace 互相依赖为精确版本 `0.1.0`，改版本须同步全部引用处）。
- [ ] `@deepseek-ai/*` 运行时依赖与 dsh 宿主**严格同版本**（当前 `0.2.0-rc.2`；cordis `4.0.4`、schemastery `3.18.4`）——版本漂移会实例分裂致调度器崩（§8 轮次 2）。
- [ ] 全部包已去 `private: true`（仓库根 `writer-in-dsh` 保持 private 不发布）。
- [ ] 每包 `engines.node >= 20` 与 `files` 已声明（当前形态：main 指向 `src/index.ts`，由宿主 tsx 加载 TS 源码——**发布 TS 源是显式选择**，宿主 ≥0.2.0 自带 tsx；若未来要求预构建，加 `tsc` 产出 `lib/` 并把 main/types/files 切到 `lib`）。
- [ ] `writer-skills` 的 `files` 含 `assets`（技能资产随包分发）；`writer-bundle` 的 `files` 含 `cordis.patch.yml`。
- [ ] 根 `npm run typecheck` 零错、`npm test` 全绿。

## 2. 打包预检

- [ ] 每包 `npm pack --dry-run` 核对产物内容（src/、assets/、cordis.patch.yml 进包；tests/ 不在 files 白名单内不进包）。
- [ ] tarball 内 `package.json` 无 `private`、无 `"*"` 依赖。

## 3. 安装路径验证（发布后或发布前用 tarball 预演）

- [ ] **link 路径**（本地开发）：`dsh plugin --profile <p> add <包绝对路径>` 逐包按依赖序（domain → core → store → engine → skills → export → rag → guard → tools → bundle），再装 app bundle 并钉版本：`dsh plugin --profile <p> add @deepseek-ai/dsh-headless@0.2.0-rc.2`（或 `@deepseek-ai/dsh-web-app@0.2.0-rc.2`）。
- [ ] **npm 路径**（发布后真实形态；发布前用 `npm pack` tarball 等价预演）：`dsh plugin --profile <p> add ./dsh-writer-<x>-<ver>.tgz`。注意：**tarball 安装只对无 workspace 依赖的包可独立完成**（如 writer-domain），含 workspace 依赖的包须等全部包上 registry 后按包名安装（`dsh plugin add dsh-writer-bundle` 一步拉全图）。
- [ ] 安装后 `dsh --profile <p> --dump-config` 核对组合树（`# == dsh-writer-bundle` 分节含 store→engine→skills→export→rag→guard→tools 行序）。
- [ ] 从小说项目目录启动 headless 跑一次 `writer_stats`（projectRoot 默认 `process.cwd()`）。

## 4. 已知环境坑（装机差异，发布说明可引用）

- pnpm ≥12 在 Windows 盘符根锁目录 EPERM 完全不可用，宿主须配 pnpm 10（§8 轮次 6）。
- 新建 profile 只含 base + 功能 bundle 无 app 入口会**无限空转**，必须另装 app bundle（§8 轮次 6）。
- npm 源上 app 包默认解析到不兼容旧版 0.0.1-rc.1，必须钉 `@0.2.0-rc.2`。
- `dsh plugin add` 内部转发 pnpm；宿主 install-scripts 审批由宿主 profile 管，本仓包无安装脚本。

## 5. 发布动作

- [ ] 按依赖序发布：domain → core → store → engine / skills / export / rag / guard → tools → bundle（`npm publish` 或 `pnpm publish`；本仓日常用 npm workspaces）。
- [ ] 发布后在新环境按包名 `dsh plugin --profile demo add dsh-writer-bundle` 复验 registry 安装路径（本机已完成 tarball 等价预演，见 §8 轮次 10）。
