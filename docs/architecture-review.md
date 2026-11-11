# 架构评审报告（writer-in-dsh）

> 评审对象：HEAD `425f743`（工作树除 `package-lock.json` 外无改动）
> 评审方式：四维度并行子代理评审 + 主评审员横切复核；**只审不改**，结论落盘仅本文件。
> 评审日期：2026-11-11

---

## 0. 评审基线（可复现）

| 项 | 结果 |
|---|---|
| `npm run typecheck` | ✅ 通过（12 包 build + `tsc --noEmit` 零错） |
| `npm test`（单次） | ⚠️ **280 / 280 通过，但这是 flaky 结果**——见下方"基线修正" |
| 规模 | 12 包 / 29 个源文件 / 约 6.9k 行 src + 约 3.2k 行 test |
| 依赖安装 | ⚠️ **HEAD 版 lock** 下 `npm ci` 失败；**工作区未提交 lock** 下 `npm ci --dry-run` 通过（见 P1-3） |

> **基线修正（重要）**：本报告初稿据一次运行记为"280/280 全绿"。经复核子代理提示后实测，
> **该套件存在稳定可复现的 flake**：单跑 `rag-service.test.ts` **12 次失败 5 次**，
> 全量套件 **5 次失败 1 次**。故"280/280"是**运气好的一次**，不是稳定状态。
> 详见 **P0-4**。同时 `AGENTS.md` 自述"273/273"，与实测 280 亦已不同步。

---

## 1. 总评：**架构健康度良好，但存在 4 个必须先修的 P0**

**一句话结论**：这个项目的**架构骨架是优秀的**——三分法是真的、依赖图是干净的、单一事实来源守住了、错误处理普遍响亮。它不是"看起来分层"的玩具，而是经得起逐行翻的实现。但它有三个系统性问题：**(a) 抽象边界被存储机制穿透**，**(b) 并发正确性只在"单实例单进程"假设下成立**（而产品实际会开多个会话共用同一个 `novel/` 目录），**(c) 质量基础设施缺位**——测试有 flake、没有 CI、锁文件未提交，导致"全绿"这一判断本身不可靠。

> 其中 **(c) 是本报告最重要的发现**：如果一份架构评审建立在"测试全绿"之上，而那个"全绿"其实是 1/5 概率的侥幸，那么**所有基于它的结论都要打折扣**。P0-4 不修，其余一切改进都缺少可验证的基准。

| 维度 | 结论 | 一句话判定 |
|---|---|---|
| 一、包切分与能力缝 | **基本达标** | 无环无越层，domain/core 纯净；但 `WriterService` 泄漏了 8 个存储内部机制，磁盘布局成了跨包 ABI |
| 二、存储与数据一致性 | **基本达标** | SoT 边界守住、派生 100% 可重建；但跨会话并发**静默丢数据**，且 TOCTOU 守卫被自身补跑绕过 |
| 三、插件与配置形态 | **基本达标** | 形态/effect/ctx.get 全部合规；但 rag 语义档静默降级、preset 依赖不自包含 |
| 四、测试与可维护性 | **不达标** | 测试密度与风格优秀，但**存在可稳定复现的 flake**（12 次跑 5 失败）、零 CI、锁文件不可复现、文档滞后 |

### 问题分级统计

| 级别 | 数量 | 说明 |
|---|---|---|
| **P0** | 4 | 架构性硬伤 / 正确性缺陷，**必须修** |
| **P1** | 5 | 明显设计债，应排期 |
| **P2** | 12 | 打磨项，可择机 |

---

## 2. P0 问题（必须修）

### P0-1　跨会话并发写 `pending.md` 静默丢数据

- **维度**：存储与数据一致性
- **证据**：
  - `packages/writer-store/src/index.ts:101-108,113` —— 串行化链是 **每个 Service 实例私有**的 `saveChains` Map
  - `packages/writer-store/src/index.ts:255,330` —— 原子写的临时文件用**固定名** `pending.md.tmp`
  - `packages/writer-preset/cordis.patch.yml:74-78` —— preset 每个会话**独立挂载一组 store**，`projectRoot` 默认同为 `<cwd>/novel`
  - `docs/implementation-plan.md` 轮次 2④ 的"单用户可接受"假设，实际覆盖不到"单用户开两个会话"
- **实测（本次评审亲自复现，非推测）**：两个独立 `WriterStoreService` 实例各 `appendPending` 20 次、共提交 40 次 → **落盘只有 20 节，失败 0 次，无任何报错**。
  ```
  [PROBE2] 提交写入=40  落盘节数=20  失败=0
  ```
- **影响**：维护 pass / recompute / pending_cleanup 写出的待办**静默消失**。用户以为待办已登记，实际上被另一个会话按旧快照整体重写掉了。这是数据丢失级缺陷，且**没有任何用户可感知信号**。
- **修复建议**：
  1. **单一写者**：所有写入经共享服务（`ctx.get('writer')` 聚合到 module 级 Map 按 `projectRoot` 取键，跨 isolate realm 亦有效），而非每实例私链；
  2. **唯一 tmp 名**：`saveDerived` 已有先例（`index.ts:207`），`pending.md` 与归档的固定 `.tmp` 应同款化；
  3. 残余跨进程场景（两个 dsh 进程）用锁文件或"compare-and-swap 重试"兜底。
- **工作量**：**S**

### P0-2　`maintenancePass` 的 TOCTOU 守卫被自身补跑绕过，旧版本建议混入人工确认环

- **维度**：存储与数据一致性
- **证据**：
  - `packages/writer-engine/src/index.ts:245` —— `changedDuringRun` 判定
  - `packages/writer-engine/src/index.ts:254-256` —— 判定后才 `appendPending`
  - `packages/writer-engine/src/index.ts:163-171` —— 前置的"补跑"会**再跑一次**；补跑期间的改写不会被第二次判定正确覆盖
  - `packages/writer-engine/tests/p3-integration.test.ts:306-339` —— 该测试**只断言 `sourceHash` 最新**，从未检查 `pending.md` 是否含旧版本（守卫事实上未被锁定）
- **实测（本次评审亲自复现）**：
  ```
  [PROBE] pending 节数=2  旧摘要出现=1  新摘要出现=1
  [PROBE] pending.md 摘要行： - 摘要：旧摘要。 | - 摘要：新摘要。
  ```
- **影响**：同一章在 `pending.md` 里留下**两条互相矛盾**的待人工确认记录（一条基于已被取代的旧稿）。维护 pass 的整个设计前提就是"产出待人确认"，而这里正是把**已作废的建议**送进确认环——用户可能据此修改伏笔/人物状态。会放大 P0-1。
- **修复建议**：把重读判据**挪到落盘瞬间**（L254 之前再 `get` 一次并比对 hash）；补一条断言 `pending.md` 只含 1 节且不含旧摘要的测试。
- **工作量**：**S**

### P0-3　`WriterService` 泄漏存储内部机制，磁盘布局成为跨包 ABI

- **维度**：包切分与能力缝
- **证据**：
  - `packages/writer-core/src/index.ts:72,79-103` —— 抽象基类暴露 `root`、`readDerived/writeDerived/deleteDerived/listDerived`、`appendPending/archivePending/appendPendingArchive` **共 8 个成员**，全部是"Markdown-on-disk Provider"的实现细节
  - `packages/writer-engine/src/index.ts:166,179,253,305,420,427,453,614`；`packages/writer-rag/src/index.ts:186`；`packages/writer-tools/src/index.ts:295` —— **10 处** `readDerived('maintenance', id)` 字面量
- **对照官方范式**：dsh `dsh-fs` 的 `FsTargetKey`/`FsVersion` 是 `Branded<>` 不透明 id，并明写 *"Consumers MUST NOT parse it or assume it is a local absolute path"*。本项目的消费者却必须知道"kind 叫 `maintenance`""派生按章 id 存""值是 `MaintenanceDerived`"。
- **影响**：磁盘布局成了三个消费者共享的隐式契约。换 Provider（换存储介质/换布局）要同时改 3 个包——这正是"依赖倒置"要做的事没做到位。`root: string` 更把"本地绝对路径"焊进契约，未来任何远程/workspace 形态都失效。
- **修复建议**：按业务语义上提——`readMaintenance(chapterId)` / `writeProjectFile(rel, bytes)` / `statProjectFile(rel)`；`'maintenance'` 字面量只允许在 store 出现一次。**性价比最高的一步**：先把 `readDerived('maintenance', …)` 收成 `readMaintenance`，10 处字面量一次性归零。
- **工作量**：**M**（README 所述 `listDerived` 无生产消费者，可顺手删除）

---

## 2.1　P0-4　测试套件 flaky：`rag-service.test.ts` 稳定复现失败

- **维度**：测试与可维护性
- **证据**：
  - `packages/writer-rag/tests/rag-service.test.ts:152` —— 失败断言
    `await assert.rejects(badRag.search('港城'), /缺少 data\[0\]\.embedding/)`
  - `packages/writer-rag/tests/rag-service.test.ts:73-74` —— fixture：001 章含 `绿焰`，002 章正文 `南方港城的贸易风波`
  - `packages/writer-rag/tests/rag-service.test.ts:114` —— 同一测试**前面**把 002 章改写为 `第二章改写：港城风波加剧，绿焰再现。`
    → 002 块文本同时含 `绿焰` 与 `港城`
  - `packages/writer-rag/tests/rag-service.test.ts:127-129` —— 错误 stub 按 `input.includes('绿焰')` 返回 **500**，否则返回缺 embedding
  - `packages/writer-rag/src/index.ts:248-249` —— `rankByEmbeddings` 用 `Promise.all` **并发**送出 `[query, ...候选文本]`；任一个 reject 即让整个 `Promise.all` reject，而**谁先 reject 取决于网络时序**
- **实测**：
  - 单跑该文件 **12 次失败 5 次**；全量套件 **5 次失败 1 次**
  - 失败信息恒为：`The input did not match /缺少 data\[0\]\.embedding/. Input: 'Error: writer-rag：embeddings 端点返回 500'`
  - 已排除"报文串包"：独立探针 500 轮 × 20 并发请求，body 归一化 0 次异常
- **根因**：查询 `港城` 并发打分时，候选块 `002`（含 `绿焰`）被送去 embedding → 返回 500 并**抢先 reject**；`港城` 查询向量本身走的是"缺 embedding"分支。哪个错误先到就抛哪个，于是断言在两种合法错误间随机摆动。
- **影响**：①**"测试全绿"这一核心质量声明不可信**，任何基于单次运行的判断都可能是侥幸；②它会训练出"失败了重跑一次"的危险习惯——而重跑正是掩盖真 bug 的开始；③一旦接入 CI 就是随机红灯，团队很快会学会忽略 CI。
- **修复建议**：断言两种合法错误（`/端点返回 500|缺少 data\[0\]\.embedding/`）以消除时序依赖；若要精确锁定"缺 embedding"分支，则给 `badRag` 用**独立 fixture**（不含与查询共享词的章节），或在 stub 中按 `input` 精确匹配而非 `includes`。同时建议给 `rankByEmbeddings` 加 `Promise.allSettled` 式的确定性错误优先序（先报查询向量的错，再报候选的错），让排障路径稳定。
- **工作量**：**S**

---

## 3. P1 问题（应排期）

### P1-1　RAG 语义档在多处静默降级

- **证据**：`packages/writer-rag/src/index.ts:98-100,229,234-238,255`
- **问题**：`semanticCandidates` 的 schema 下限 `.min(3)` 与"0 = 关闭"语义矛盾（`:51`）；`llm` 档打分解析失败时 `return []` 后**无声退化为纯关键词**，`search()` 结果不带任何标记。
- **影响**：用户以为开了语义检索，实际一直是关键词——**这正是项目自己立下的"配置错误响亮失败"要禁止的静默兜底**。
- **修复**：`search()` 结果加 `degraded` 标志，工具回执与 RAG 分节**可见披露**；`semanticCandidates: 0` 显式表示关闭。
- **工作量**：S

### P1-2　`writer-preset` 依赖不自包含

- **证据**：`packages/writer-preset/package.json`（dependencies 段）、`packages/writer-preset/cordis.patch.yml:14-15,17-59`
- **问题**：patch 引用了 `@deepseek-ai/dsh-persona`、`dsh-agent-instructions`、`dsh-tool-{bash,pwsh,fs,skill,todo,ask-user}`，这些**全部未声明为依赖**（而同文件里的 `dsh-writer-ui` 却声明了，口径不一致）。
- **影响**：装到不含 `dsh-web-app` 的 profile 时，错误推迟到 Loader 解析那一刻才暴露，且报错不指向"缺依赖"。
- **修复**：补齐 `dependencies` 并钉 `0.2.2-rc.1`，或 README 显式写明"要求 profile 含 dsh-web-app"及其失败表现。
- **工作量**：S

### P1-3　无 CI；锁文件处于"半修复未提交"状态

- **证据**：
  - 仓库无 `.github/`（无任何 CI）
  - **HEAD 版 lock** 下 `npm ci` 实测失败：
    ```
    Missing: @deepseek-ai/dsh-attachment@0.2.2-rc.1 from lock file
    Missing: @deepseek-ai/dsh-brand@0.2.2-rc.1 from lock file
    Missing: @deepseek-ai/dsh-session-persistence@0.2.2-rc.1 from lock file
    Invalid: lock file's @opentelemetry/api@1.10.0 does not satisfy @opentelemetry/api@1.9.1
    ```
  - **工作区未提交 lock**（`git status` 显示 `M package-lock.json`）下 `npm ci --dry-run` **通过**（615 packages），
    且 12 个 workspace 条目齐全（已用 node 复核：工作区 12/12、HEAD 12/12）
  - 该工作区 lock 引入了 **31 条 `mirrors.cloud.tencent.com`** 源，与个人 `.npmrc` 镜像绑定
- **影响**：仓库的**可复现安装基线锚在未提交的工作区文件上**。任何人 clone HEAD 都装不上依赖、无法复现测试；而本地那 31 条个性化镜像源一旦提交，又会把别人的安装绑到腾讯云镜像上。
- **修复建议**：重建 lock 时**不要带本地镜像**（清 `.npmrc` 或显式 `--registry https://registry.npmjs.org/` 后再 `npm install`），提交一份纯净 lock；随后加最小 CI（`npm ci && npm run typecheck && npm test`）。注意 P0-4 修好前接 CI 会随机红灯。
- **工作量**：S

### P1-4　`writer-rag` 的 `llm` 依赖判定位置错

- **证据**：`packages/writer-rag/src/index.ts:75,199` —— `static inject = ['writer']` 却 `ctx.get('llm')`，llm 缺席时服务照常发布，直到 `embeddingBackend=llm` 首次检索才抛错；而 engine 同场景是 `inject: ['writer','llm']`。
- **影响**：两个包对同一个宿主能力的契约不一致，故障暴露点被推迟。
- **修复**：`backend=llm` 时把 `llm` 纳入 inject（条件激活），或构造期校验即刻抛错。
- **工作量**：S

---

## 4. P2 问题（择机）

| 编号 | 维度 | 位置 | 问题 | 工作量 |
|---|---|---|---|---|
| P2-1 | 存储 | `packages/writer-engine/src/index.ts:304-308,325-331` | 一致性检查「摘要代正文」丢了 hash 核对，LLM 调用期间改章会**新正文拼旧摘要**，报告不可复现 | S |
| P2-2 | 存储 | `packages/writer/README.md:40` 等 | `.writer/pending-archive.md` 是**只增的人工史料**，却与派生缓存同住 `.writer/`，而 `archive_point` 的 `git reset -- .writer`（`writer-tools/src/index.ts:359-361`）会把它挡在存档外 | S |
| P2-3 | 存储 | 派生重建入口 | 清掉 `.writer/derived` 后**没有批量重算入口**（`recompute_derived` 只能逐章），"派生可重建"的成本被低估 | M |
| P2-4 | 存储 | `packages/writer-ui/src/client/overview.ts:86,302` + `Panel.tsx:1129-1133` | 归档区声明"最新在前"实为倒序整体翻转，**截断隐藏的反而是最新几次** | S |
| P2-5 | 插件 | `packages/writer-store/src/index.ts:23-25` | `projectRoot` 是 required 但**零校验**（允许 `..`、相对路径按 cwd 解析），写错要到首次 save 才以"实体不存在"暴露 | S |
| P2-6 | 插件 | `packages/writer-rag/src/index.ts:45` | `embeddingBackend` 用 `string()` + 构造期白名单，未用 `Schema.union` 固化枚举 | S |
| P2-7 | 插件 | `packages/writer-rag/src/index.ts:87,94` | `VECTOR_CACHE_MAX=2000`/`TOKEN_CACHE_MAX=5000` 为 `private static readonly`，与官方"无可硬编码可调参数"冲突；长篇时命中率会周期性归零 | S |
| P2-8 | 插件 | `packages/writer-engine/src/prompts.ts:24,26` | 章节目标字数 1500-4000 / 300-800 硬编码在提示词里，与 `maxOutputTokens` 会互相漂移 | M |
| P2-9 | 插件 | `packages/writer-preset/cordis.patch.yml:68-72` | `isolate` 清单硬编码 4 项，**新增服务漏登记时只在运行期某会话挂载失败**，静态阶段无护栏 | S |
| P2-10 | 插件 | `packages/writer-guard/src/index.ts:45-49` | `watchedTools` 缺省清单与 `writer-tools` 注册表**双写**，新增工具易漏 | S |
| P2-11 | 维护性 | `packages/writer-ui/src/client/load.ts:18-296` | 浏览器半 13 处 `any`（目录列表/前件解析路径），`reader` 接口边界缺类型 | M |
| P2-12 | 维护性 | `README.md:23`、`packages/writer-preset/README.md:19` | 仍称面板为"侧边栏"，实际是 `conversation.view` 标签页（轮次 37 已迁）；`packages/writer-preset/README.md:19` 同错；`AGENTS.md:96` 仍写"273/273" | S |

---

## 5. 已达标的方面（这是项目真正的资产）

**维度一：包切分**
- `writer-domain` 是**真纯函数库**：8 个源文件仅 `node:crypto` 一个外部 import，零 cordis/fs/net。
- `writer-core` 是**真契约**：233 行零实现体、零 IO、零 LLM，唯一包间 import 是 `import type`（编译期擦除）。
- 以源码 import 为准的实际依赖图**无环、无越层**，14 条包间边**全部**已在 `dependencies` 声明；宿主依赖全部进 `peerDependencies` 且精确钉版、跨包一致。
- Consumer 一律 `ctx.get()` 可选消费，缺席时**分级降级并给出可行动文案**，不阻塞核心写作。

**维度二：存储**
- **不可重建派生：无**。`.writer/derived/*.json` 与 `recovery-snapshot.md` 全部可从 Markdown 重建，SoT 原则是真的守住了（同类项目最常见的就是这里破功）。
- 原子写实现正确：同目录 temp+rename、失败清理 tmp、`readDerived` 严格区分 ENOENT 与真 IO 错（不静默吞故障）。
- `contentHash` = sha256(排序 canonical + `\0` + 正文)，保存时以"落盘文本回解"锚定，读写一致；截断 hash 有**专项新手指引**——这是很成熟的细节。
- 乐观锁在单实例下 TOCTOU 闭合（双写恰一成功），失败方向安全（归档先落）。

**维度三：插件形态**
- 12 包形态**零违规**：4 个服务包全部 default-export 子类；3 个函数插件全部具名导出且无 default export；两个纯契约包无插件行。
- 注册**全部**走 cordis 可回收面（14 个 `defineTool`、各类 `ctx.on`），**零自建注册表、零模块级可变行为状态**。
- 生命周期清理到位：inflight Map 身份校验清理、`indexPromise` finally 复位、`saveChains` 尾环删、UI 的 `useEffect` 三处 cleanup 齐全。
- Schema 质量高：每个字段带中文 description，数值普遍有 `min/max`，跨字段约束（`chunkOverlap < chunkChars/2`）构造期响亮失败。

**维度四：测试**
- 测试密度约 **1:0.46**（测试行/源码行），32 个文件约 1000 条断言，**密度与风格都在同类项目上游**。
- 测试风格以"行为"为主而非实现细节；错误路径覆盖好（`assert.throws` 普遍带正则匹配中文错误文案）。
- 存在**契约测试**意识：`guard-contract.test.ts` 锁定"错误文案 ↔ 模式表"漂移即红——这是本项目最值得保留的工程品味。
- 但**资产不等于保障**：如上 P0-4，这套测试目前有一条稳定 flake，且无 CI 守护。**这是维度四判为"不达标"的唯一原因，也是最容易修的一项。**

---

## 6. 覆盖度声明

| 覆盖范围 | 状态 |
|---|---|
| writer-domain / core / store / engine / tools / rag / export / guard / skills | ✅ 四线全部静态通读 + 关键路径实测 |
| writer-bundle / writer-preset 的 patch 组合 | ✅ 静态审读（**未**做真实 profile 装配运行） |
| writer-ui **宿主半**（`src/index.ts`，11 行） | ✅ 已读 |
| writer-ui **浏览器半**（`src/client/*`，9 文件 1824 行） | ⚠️ **部分覆盖**：读了 `load.ts`/`overview.ts` 的接口面与类型质量，`Panel.tsx` 等渲染层只经第三方代理摘要，**未逐行审**，也**未做浏览器实测** |
| `references/` 两个子模块对照 | ✅ 已 `git submodule update --init` 拉取并用官方范式比对 |
| 运行时装配（overlay / profile 启动 / web 200） | ❌ **未跑**（只读约束下避免启动服务）；历史实测记录见 implementation-plan 轮次 17/35/37 |

**未覆盖风险**：UI 浏览器半的运行时行为、preset+bundle 同时安装的冲突（轮次 17 作者自己留痕"未在两者共存下验证"）、真实 LLM 端到端质量。

---

## 7. 有意偏离：裁定复核

| 留痕项 | 裁定是否仍成立 |
|---|---|
| 轮次 2⑦ 不 fsync | ✅ 成立（Markdown 有 git 兜底，性能取舍合理） |
| 轮次 2④「单用户可接受」 | ❌ **已失效**——想覆盖的是多会话并发，但单用户开两会话是常态（见 P0-1 实测） |
| 轮次 8 `root` getter | ⚠️ 前提成立但边界脆弱——仅在"单 Provider、本地 Markdown"下成立（见 P0-3） |
| 轮次 11④ `@deepseek-ai/*` 同置 deps+peer | ✅ 成立（dedupe 无风险） |
| 轮次 12 `.writer/` 隐藏目录 + gitignore | ✅ 存储位置成立；质疑的是"布局为何成公开契约"（P0-3），非位置本身 |
| 轮次 9② 跨进程向量缓存不共享 | ⚠️ 性能项，可接受；但与 P0-1 同源于"多实例假设" |
| 轮次 33⑤ recompute mark 竞态 | ✅ 成立（已有留痕，低风险） |

---

## 8. 架构健康度总评

**成熟度定位**：在"第三方 dsh 插件生态"这个坐标系里，本项目属于**上游水平**——不是 demo 级，而是有真实工程纪律的产物。它的强项（纯函数域库、SoT 可重建性、响亮失败面、契约测试）恰好是同类 AI 写作工具最容易烂掉的地方；它的弱项（抽象泄漏、并发假设、工程自动化）也恰好是"一个人写、单机跑"的项目最典型的盲区。

**三条最值得记住的判断**：

1. **它的分层是真的，但抽象面没跟上分层**。物理切包做得好（这是多数项目第一步就做不对的），但 `WriterService` 把"文件夹长什么样"写进了契约，属于**分层了却没倒置**。这正是通用架构原则里"Depend on abstractions, not on details"最经典的失分点。
2. **它把正确性想得很细，但假设面太窄**。hash 锚定、乐观锁、TOCTOU、失败方向安全——这些细节的成熟度超出这个规模的常态。可并发模型停在"进程内单实例"，而产品形态（多会话共用 `novel/`）越过了这条线，于是出现了唯一的**静默数据丢失**。
3. **它最大的可持续性风险不是代码，是欠自动化**。280 条测试全绿是资产，但没有 CI 守护它；13 万字符的迭代日志在替代 CI 承担"回归记忆"的职责。**文档承担了本该由自动化承担的职责**，这是这类项目老化最快的方式。

---

## 9. 未来 3–6 个月最值得投入的 3 件事

### ① 先把"绿"变成真的：修 flake + 纯净锁文件 + 接 CI（1–2 天，收益最高）
当前 `rag-service.test.ts` 有稳定 flake，HEAD 的 lock 又装不上——**"本地跑过了"这句话现在不成立**。修 flake（S）→ 用纯净 registry 重建 lock（S）→ 上一条 GitHub Actions（`ci → typecheck → test`）。**这是把已有资产转化为保障，投入产出比远高于任何新功能；而且不做这一步，后面所有改动的"已验证"都不可信。**

### ② 收窄存储抽象：让 `maintenance` 不再是一个跨包字符串（1–2 周）
把 `readDerived('maintenance', id)` 收成 `readMaintenance(chapterId)`，`root` 收敛为 `writeProjectFile/statProjectFile`。这一步完成后：10 处字面量归零、`listDerived` 可删、未来换 Provider 不必动 engine/rag/tools。**这是让架构从"切包正确"走到"依赖正确"的关键一跃。**

### ③ 修掉并发模型：单写者 + 唯一 tmp + 落盘瞬判据（3–5 天）
对应 P0-1 与 P0-2。这项工作还有一个隐性收益：它会逼着把"多会话共用一个小说目录"变成**显式的受支持场景**，从而把 `writer-preset` 的 projectRoot 隔离策略一并定清楚。当前这个场景既没被声明支持、也没被声明禁止，属于最危险的灰区。

> 若只能做一件：**做 ①**。它花的时间最少，但决定了后面所有工作的成果能不能被守住。
>
> 补充一条工程建议：CI 里跑测试时建议加 `--test-reruns`（Node 自带）或直接重复跑 3 次，把本次这类 flake 变成"每次都能抓到"而不是"偶尔红一次"。**flaky 测试最坏的影响不是它自己失败，而是它让人不再相信失败。**

---

## 附录：本次评审的实测脚本

所有探针均临时写入仓库外或 `packages/*/tests/zz-probe-*.test.ts` 后**已删除**，工作树未留痕
（`git status` 复核：仅 `package-lock.json` 与 `.dsh/`，均为评审前既有状态）。

- 探针 1（P0-2）：装好 store+engine 与脚本化 LLM 桩，在第 2 次 `stream` 调用时异步改写章节，读 `pending.md`。
- 探针 2（P0-1）：两个独立 `WriterStoreService` 实例向同一 `projectRoot` 各并发 `appendPending` 20 次。
- 探针 3（P0-4，排除"报文串包"）：本地 HTTP server + 500 轮 × 20 并发 `fetch`，归一化比对落到 server 的 `input`，0 次异常。
- 复核 4（锁文件状态）：用 node 直接读 `package-lock.json` 与 `git show HEAD:package-lock.json`，
  统计 `packages/*` workspace 条目与镜像源条目；`npm ci --dry-run` 分别在工作区与 HEAD 上对比。

复现要点：探针需 `npm install`（HEAD 的 lock 下 `npm ci` 不可用）并先 `npm run build`（包间裸导入经 `main` 解析 `lib/`）。
