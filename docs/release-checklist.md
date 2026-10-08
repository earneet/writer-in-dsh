# 发布检查清单（P5 立项，P6 更新为 lib/ 预构建形态）

> 适用于 `dsh-writer-*` 十包的 npm 发布。依据 `references/dsh-plugin-research.md`（publish.zh.md 摘要）与
> `docs/implementation-plan.md` §8 轮次 6/10/11。当前版本 0.1.0；发布前逐项打勾。

## 1. 版本与依赖（每次发布）

- [ ] 十包版本一致提升（包间互相依赖为精确版本 `0.1.0`，改版本须同步全部引用处）。流程：逐包 `npm version <v> -w <pkg>` 后 grep 复核旧版本字符串清零（防 bundle 拉到新旧混合依赖图）。
- [ ] 核对十包 `engines.node` 与 dsh 宿主包（`@deepseek-ai/dsh@0.2.0-rc.2`）的 engines 要求一致（宿主当前未声明 engines，本仓 `>=20` 为保守约束——Node 版本要求实际由宿主运行时决定）。
- [ ] `@deepseek-ai/*` 运行时依赖与 dsh 宿主**严格同版本**（当前 `0.2.0-rc.2`；cordis `4.0.4`、schemastery `3.18.4`）——版本漂移会实例分裂致调度器崩（§8 轮次 2）。
- [ ] 全部包已去 `private: true`（仓库根 `writer-in-dsh` 保持 private 不发布）。
- [ ] **lib/ 预构建形态**（P6 起）：9 个代码包 main=`lib/index.js`、types=`lib/index.d.ts`、files=`["lib"]`（skills 加 `assets`）。构建 = 根 `npm run build`（逐包 `tsc -p tsconfig.build.json`，TS 5.7+ `rewriteRelativeImportExtensions` 把 `.ts` 相对导入重写为 `.js`，零新增构建依赖）。**发布前必须先 build**（`lib/` 在 .gitignore；每包已加 `prepublishOnly: npm run build` 兜底，新 clone 直接 publish 不会产出无 lib 坏包）。
- [ ] **构建先行是开发期新约定**：`npm test` / `npm run typecheck` 已串 build（工作区裸导入经 main 解析到 lib）；**overlay/profile 下改 domain/core 等被裸导入包的源码须先 `npm run build` 才生效**（overlay 入口指 src，但 src 内的包间裸导入走 lib）。
- [ ] **不支持 git 直装**：lib 不入库且无 prepare 脚本，`dsh plugin add github:...` 形态会拿到无 lib 的坏包——分发仅 registry / tarball / link 三路径（research.md publish 一节的 git 直装项对本仓不适用，留痕）。
- [ ] 包名非 scoped，npm 默认 public，无需设 `publishConfig.access`（留痕）。
- [ ] `repository` 字段待仓库公开上线后补（当前无 git remote，npm 页暂无源码链接——发布前如已有远端须补上）。
- [ ] 运行时直接 import 的宿主包在 `dependencies` 且钉 `0.2.0-rc.2`（engine/rag→`@deepseek-ai/dsh-llm`、tools/guard→`dsh-tools`、skills→`dsh-skill`）：不依赖 pnpm auto-install-peers 默认行为（非契约，禁用即缺包崩）。
- [ ] `writer-bundle` 无 main/types 为**有意形态**（组合包无 JS 入口，cordis.patch.yml 按包名引用各包入口；与 research.md 官方示例的 main 差异在此留痕）。
- [ ] `writer-skills` 的 `files` 含 `assets`（技能资产随包分发）；`writer-bundle` 的 `files` 含 `cordis.patch.yml`。
- [ ] 根 `npm run typecheck` 零错、`npm test` 全绿。

## 2. 打包预检

- [ ] 发布前根目录 `npm run build`，随后每包 `npm pack --dry-run` 核对产物内容（lib/、assets/、cordis.patch.yml 进包；src/ 与 tests/ 不在 files 白名单内不进包）。
- [ ] tarball 内 `package.json` 无 `private`、无 `"*"` 依赖。

## 3. 安装路径验证（发布后或发布前用 tarball 预演）

- [ ] **link 路径**（本地开发）：`dsh plugin --profile <p> add <包绝对路径>` 逐包按依赖序（domain → core → store → engine → skills → export → rag → guard → tools → bundle），再装 app bundle 并钉版本：`dsh plugin --profile <p> add @deepseek-ai/dsh-headless@0.2.0-rc.2`（或 `@deepseek-ai/dsh-web-app@0.2.0-rc.2`）。
- [ ] **npm 路径**（发布后真实形态；发布前用 `npm pack` tarball 等价预演）：`dsh plugin --profile <p> add ./dsh-writer-<x>-<ver>.tgz`。注意：**tarball 安装只对无包间依赖的包可独立完成**（如 writer-domain），含包间依赖（精确 `0.1.0`）的包须等全部包上 registry 后按包名安装（`dsh plugin add dsh-writer-bundle` 一步拉全图）。
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
