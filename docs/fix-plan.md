# 修复计划（依据 docs/architecture-review.md）

> 目标：消除 4 个 P0 + 当天可落地的 P1/P2，且每阶段可独立验证。
> 原则：**行为零变化**除被指认的缺陷本身；既有断言不放宽、测试数只增不减；不 commit、留工作区待审。

## 阶段总览

| 阶段 | 对应问题 | 改动面 | 验证方式 |
|---|---|---|---|
| 0 | — | 本文件 + 基线存档 | 记录 280 测试基线 |
| 1 | P0-4 | `writer-rag` 测试与 `rankByEmbeddings` | 该文件 12 跑 0 败 |
| 2 | P0-1 | `writer-store` 串行链与 tmp 名 | 双实例探针 40 写落 40 节 |
| 3 | P0-2 | `writer-engine` 落盘前重判 | TOCTOU 探针 pending 只 1 节 |
| 4 | P0-3 | `writer-core` + store + 3 消费者 | `readDerived('maintenance'` 零命中 |
| 5 | P1-1 / P1-4 | `writer-rag` | 单测 + 工具回执可见降级 |
| 6 | P1-2 / P2-9 / P2-5 | preset 包 + 契约测试 + store 校验 | 新增测试通过 |
| 7 | P1-3 | lock + `.github/` | `npm ci` 成功 |
| 8 | P2-12 | 文档 | 陈述与代码一致 |
| 9 | — | 对抗审查 | 全量重复跑 5 次 0 败 |

## 关键设计决策

### D1（P0-1）单写者：按 projectRoot 共享串行链
问题根因是串行链是**每 Service 实例私有**的 `saveChains`，而 preset 给每个会话各挂一组 store 指向同一 `novel/`。
方案：把链表提到 module 级 `WeakMap`/`Map`，key = `projectRoot + '\u0000' + 资源名`。
- 用 module 级而非 ctx 级：跨 isolate realm 仍共享同一模块实例（realm 隔离的是服务注册符号，不是模块代码）。
- 固定 tmp 名 `pending.md.tmp` 改唯一 tmp 名（与 `writeDerived` 同范式），消除并发 rename 互踩。
- **收口补充：rename 有界重试**——串行化消除自撞后，验证轮发现 Windows 上对同一文件的高频连续 rename 仍会被杀软/索引器瞬时锁住（EPERM/EACCES/EBUSY，全量 5 跑偶发 1 次）；新增 `renameWithRetry`（3 次退避重试后才响亮报错），全部 5 处 rename 点统一接入。
- 代价：多进程（两个 dsh 进程）仍无保护——属已知限制，与轮次 9② 同口径留痕，不在本轮范围。

### D2（P0-2）TOCTOU：判据紧贴落盘
现状 L245 判 `changedDuringRun`，L254 才 `appendPending`，中间隔着 `writeDerived` 的 await。
方案：把重读判据挪到 `appendPending` 之前最后一步（`writeDerived` 之后重新 `get` 并比对 `chapter.hash`），使判定与写入之间的窗口最小化。
**对抗审查修正**：初版曾额外按「补跑轮（depth>0）不写 pending」全量抑制，审查证明属过度修正——「保存落在首轮运行期内」路径下，补跑轮锚定的正是最新版，末尾复验未变则**应当**写 pending；否则自动触发路径（丢弃返回值）+ 后续 pass 命中 up-to-date 短路，该版待办永久不落清单。终态：仅以 `changedDuringRun` 为唯一判据。
注意：**不做分布式事务**——仍是"尽力而为"的收敛语义，但窗口从"两次 IO"缩到"一次 await"，并补测试锁定「旧摘要零出现 + 最新版待办恰好一节」。

### D3（P0-3）业务方法上提，旧 API 暂留
第一步只在 core 增 `readMaintenance(chapterId): Promise<MaintenanceDerived | undefined>`，store 实现内部仍走派生存取；3 个消费者 10 处字面量迁过去。
`readDerived` 等保留（第二条曲线再删），保证行为零变化、可回滚。

### D4（P1-1）降级可见
`search()` 返回值增加可选 `degraded` 字段；engine 的 RAG 分节与 `writer_search` 工具回执**显式打印**降级原因。
`semanticCandidates: 0` 表示关闭语义腿（schema 下限从 3 放到 0）。

### D5（P1-2）preset 依赖自包含
补 `@deepseek-ai/dsh-persona`、`dsh-agent-instructions`、`dsh-tool-{bash,pwsh,fs,skill,todo,ask-user}` 到 `dependencies`，版本钉 `0.2.2-rc.1`（与其余宿主依赖一致）。

### D6（P1-3）纯净 lock
清掉 31 条 `mirrors.cloud.tencent.com` 源，用默认 registry 重建；CI 用 `npm ci` 保证可复现。

## 不在本轮范围（留痕）
- P0-3 第二步：删除 `readDerived`/`writeDerived`/`deleteDerived`/`root` 等旧 API。**修改后审查补充裁定**：`listDerived` 一并列入第二步删除面——它生产代码零调用，且传磁盘 kind 字符串会重新泄漏 `'maintenance'` 字面量，成为抽象回流的后门（全部已标 @deprecated）。
- P0-1 跨进程场景（两个 dsh 进程共享目录）。
- 已知活性边界（修改后审查留痕）：①Linux 大小写敏感文件系统上仅大小写不同的项目根共链（仅多余串行，保守方向）；②章节连续两次改写均落在「首轮 + 补跑」两轮运行窗口内时，最新版 pending 建议静默丢失（depth 上限的有界活性代价，轮次 33 既定口径；下次保存/flush 自愈）。
- lockfile 重建的传递依赖漂移留痕见 implementation-plan §8 轮次 38（非 dev 漂移仅 zod 4.4.3→4.6.7，本仓 12 包不 import zod；`@deepseek-ai/*` 钉版零漂移）。
- `@google/genai@2.21.0` hasInstallScript 未入根 allowScripts——旧 lock 同状的非本轮旧账，记入 release-checklist 备查（是否放行其安装脚本待发布时裁定）。
- P2-1/2/3/4/6/7/8/10/11：按"低风险则顺带、否则留痕"原则处理，逐条在收口报告说明。
