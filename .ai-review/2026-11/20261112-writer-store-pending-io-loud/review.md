---
schema_version: 1
title: 'writer-store: IO 错误误判为不存在——pending.md 被静默截断重写、清单谎报为空'
module: writer-store
audit_type: bugfix
created_at: '2026-11-12T10:16:00+08:00'
updated_at: '2026-11-12T10:16:00+08:00'
owner: cxs
tags:
  - store
  - io
  - error-handling
  - pending
ticket: null
status: pending
target_files:
  - packages/writer-domain/tests/guard-contract.test.ts
  - packages/writer-store/src/index.ts
  - packages/writer-store/tests/derived.test.ts
  - packages/writer-store/tests/store.test.ts
current_revision: 1
revisions:
  - id: 1
    base_revision: d83917fb9fa2b2d9a0ec15556757c18f2a3897bb
    patch: 001.patch
    author: ai
gate_checks:
  - npm run typecheck
  - npm test
comments: []
human_decisions: []
approval: null
rejection: null
commit_message: 'fix(writer-store): IO 错误误判为不存在——pending.md 被静默截断重写、清单谎报为空'
---

# 问题与影响
- **触发场景（Concrete Case）**：pending.md 已存在但读取遇非 ENOENT IO 错（Windows 杀软/索引器瞬时独占句柄 EBUSY/EPERM、EACCES；或路径被目录占位 EISDIR）→ 四处 bare catch 把 existing 置空 → appendPending 以「仅含新节」的全文原子重写 pending.md，既有全部待办节静默消失且零报错；archivePendingLocked 同型且会把空文本喂给 mutator 后按结果重写清单。scanKind 的 readdir 遇非 ENOENT 错误时 list() 谎报空清单（如「无章节」），误导一致性检查（「范围内没有已写章节」）与组装器（丢前章上下文）。
- **不修复的影响**：人工确认队列（维护 pass 建议的唯一入口）可被一次瞬时 IO 故障无痕清空；长书项目的实体清单在权限/占用异常下给出误导性结论。

# 根因
- **代码位置**：packages/writer-store/src/index.ts 的 appendPendingLocked、archivePendingLocked、appendFileAtomic（三处 `catch { /* 首次创建 */ }`）与 scanKind 目录分支（`catch { return [] }`）。
- **触发链**：注释意图均为「文件/目录不存在按空处理」（ENOENT 语义），但写成了 bare catch；轮次 16/27 已把 readDerived/readRaw 两条读路径修成 ENOENT-only 分类，pending 三处写路径与 readdir 未跟进同一标准——同型漏网。

# 当前修复方案
- **核心改动**：四处统一改为 `code !== 'ENOENT'` 即响亮抛错（照抄 readRaw 既有口径，新错误前缀：pending.md 读取失败 / 归档文件读取失败 / 实体目录读取失败）；三条新前缀按基建 IO 错误加入 guard-contract 契约测试的 INTENTIONALLY_UNCLASSIFIED 白名单（有意不进业务错误预算）。
- **备选取舍**：不引入重试（瞬时占用由既有 renameWithRetry 在写侧兜底，读侧响亮失败即可暴露环境问题）；不区分 EBUSY/EACCES 等细类（排障靠错误串内嵌的原始 err）。新增 3 个回归测试（目录占位 pending.md / 目录占位归档文件 / 文件占位实体目录），全部走与 derived.test.ts 既有 dirblock 范式相同的确定性构造，不依赖 chmod（Windows 无 POSIX 权限位）。

# 需人工判断项
- **白名单归类**：三条新 IO 错误前缀归入「有意不分类」白名单（不进 guard 业务错误预算）——与本包既有「IO 落盘失败」家族同口径，如认为应进 validation 预算请指出。

# 验证证据
- **验证基线**：53916889d7abb032f867e2b36b12510889e58eb1
- **执行环境**：Windows 11 / Node v24.15.0 / npm 11.12.1；执行时 HEAD=b153253（轮次 39 仅触及 AGENTS/docs/bundle/preset 七文件，与本候选四文件零交集，补丁按 pathspec 相对基线导出并在 53916889 独立 worktree 验证 `git apply --check` 通过）。
- **执行结果摘要**：`npm run typecheck` 退出码 0（含全包 build）；`npm test` 退出码 0，289/289 通过（基线 286 + 本候选净增 3 例：pending.md 占位双拒绝、归档占位拒绝、实体目录占位拒绝），耗时约 5.2s（测试段）。
- **未覆盖风险**：EACCES/EBUSY 等真实权限/占用场景未直接模拟（测试用 EISDIR/ENOTDIR 代表非 ENOENT 类）；跨进程共享目录场景与本候选无关（既有留痕）。

# 审核记录

## 版本 1 (base: 53916889d7abb032f867e2b36b12510889e58eb1)
### 方案说明
store 四处 bare catch 改 ENOENT-only 响亮分类 + guard-contract 白名单同步 + 3 个确定性回归测试。文件导览：src/index.ts（四函数修复）、tests/derived.test.ts（pending/归档两例）、tests/store.test.ts（目录占位一例）、writer-domain/tests/guard-contract.test.ts（白名单三前缀）。
### 验证结果
typecheck 0 错；全量 289/289（新增 3 例全过）；补丁在基线 worktree 干净应用。
### 人类总体意见
待审核
### 意见处理结果
无
