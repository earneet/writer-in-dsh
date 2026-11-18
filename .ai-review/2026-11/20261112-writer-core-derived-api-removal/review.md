---
schema_version: 1
title: 'writer-core: 删除 deprecated 的 readDerived/writeDerived/deleteDerived/listDerived 派生存取公开面'
module: writer-core
audit_type: shrink
created_at: '2026-11-12T10:36:30+08:00'
updated_at: '2026-11-13T16:52:10+08:00'
owner: cxs
tags:
  - core
  - store
  - api-cleanup
  - deprecated-removal
ticket: null
status: pending
target_files:
  - packages/writer-core/src/index.ts
  - packages/writer-engine/tests/p3-integration.test.ts
  - packages/writer-engine/tests/p4.test.ts
  - packages/writer-rag/tests/rag-service.test.ts
  - packages/writer-store/src/index.ts
  - packages/writer-store/tests/derived.test.ts
current_revision: 2
revisions:
  - id: 1
    base_revision: a0877eaa1aadfb04346fe9e1bb5c25fff49bf523
    patch: 001.patch
    author: ai
  - id: 2
    base_revision: a0877eaa1aadfb04346fe9e1bb5c25fff49bf523
    patch: 002.patch
    author: ai
gate_checks:
  - npm run typecheck
  - npm test
comments:
  - id: cmwehbmmsmprd
    revision: 1
    file: ''
    line: 0
    author: cxs
    content: 确认一下，这确实是过时代码吗？
    status: resolved
    created_at: '2026-11-13T04:31:07.348Z'
  - id: cmweq8hzalgf3
    revision: 1
    file: ''
    line: 0
    author: cxs
    content: 执行
    status: resolved
    created_at: '2026-11-13T08:40:37.894Z'
human_decisions: []
approval: null
rejection: null
commit_message: 'writer-core: 删除 deprecated 的 readDerived/writeDerived/deleteDerived/listDerived 派生存取公开面'
---

# 问题与影响
- **触发条件与现象**：`WriterService` 暴露的 `readDerived/writeDerived/deleteDerived/listDerived` 四个通用派生存取方法已无任何生产消费者，消费者只要继续调用就会重新把磁盘 kind 字面量 `'maintenance'` 当成交叉包 ABI。
- **影响范围**：`dsh-writer-core`（抽象契约）+ `dsh-writer-store`（Provider 实现）+ 三处测试种子。包未 npm publish，无外部消费者。当前包内 grep 显示四个方法仅剩 `writer-core` 抽象、`writer-store` 实现与测试种子调用，`writer-engine` / `writer-rag` / `writer-tools` 生产代码零命中。

# 根因
- **代码位置**：`packages/writer-core/src/index.ts` 中 `WriterService` 的四个 `@deprecated` 抽象；`packages/writer-store/src/index.ts` 中对应实现与 `derivedPath(kind, id)`。
- **触发链**：轮次 38 的 P0-3 分两步走，第一步只做「业务方法上提 + 消费者迁移」，并注明旧方法第二步删除；`docs/fix-plan.md` 的「不在本轮范围（留痕）」已明确记录这一步待办。

# 当前修复方案
- **核心改动**：`writer-core` 删除四个抽象；`writer-store` 的 `readMaintenance`、`writeMaintenance`、`deleteMaintenance` 改为各自包含读、写、删实现的业务方法，并删除四个旧公开方法和 `listDerived`；`derivedPath` 去掉 kind 参数，路径固定为 `.writer/derived/maintenance/<id>.json`；另修正两处仍提及已删除方法的注释。测试种子和断言全部改用业务方法。
- **备选取舍**：保留一个私有 `readDerived` 通用方法、供将来第二种 kind 复用——本方案不采纳，因为按 YAGNI 当前只有一种 kind；`root` 不在本候选内，因为它仍有活跃的生产消费者，删除前必须先设计替代 API。

# 需人工判断项
- **公开抽象缩小**：四个方法属于 `dsh-writer-core` 公开抽象，虽未发布但仍是可被外部子类化的契约；本候选按 fix-plan 裁定删除，若坚持保守 ABI 可推迟到 0.x 首发前统一清理。
- **kind 校验移除**：`derivedPath` 不再接受外部 kind，随之删除了 kind 路径安全校验与对应断言（`kind 非法` 用例）；请确认 kind 钉死为常量后这层防护确无用武之地。
- **id 校验保留与否**：`derivedPath` 现存 id 白名单校验（`A-Za-z0-9_.-`，拒 Windows 保留名），只服务测试种子与内部调用；若也想一并收缩可指出。

# 验证证据
- **验证基线**：`a0877eaa1aadfb04346fe9e1bb5c25fff49bf523`
- **执行环境**：Windows NT 10.0.22621 / Node v24.15.0 / npm 11.12.1
- **执行结果摘要**：
  - `npm run typecheck` → 退出码 0，12.2s，strict 全仓（含 12 包 build）零错。
  - `npm test` → 退出码 0，15.6s，296 用例 / 296 通过 / 0 失败。
  - 定向四测试文件（derived / p3-integration / p4 / rag-service）→ 退出码 0，36/36。
  - 补丁回放：还原工作区后 `git apply --check 002.patch` 与 `git apply 002.patch` 均退出码 0，应用后内容与验证时的文件逐字节一致。
- **未覆盖风险**：无外部子类 `WriterService` 的假想消费者（未发布，实际不存在）；`lib/` 预构建产物需合入后由 build 重建。

# 审核记录

## 版本 1 (base: 53916889d7abb032f867e2b36b12510889e58eb1)
### 方案说明
执行 fix-plan 裁定的 P0-3 第二步（Derived 四方法删除面）。文件导览：writer-core/src/index.ts（-四抽象）、writer-store/src/index.ts（业务方法自包含化 + 删四实现）、writer-store/tests/derived.test.ts（业务方法化改写）、engine 两测试 + rag 测试（种子/断言迁移）。
### 验证结果
typecheck 0 错；全量 286/286；补丁在基线 worktree 干净应用。
### 人类总体意见
待审核
### 意见处理结果
无

## 版本 2 (base: a0877eaa1aadfb04346fe9e1bb5c25fff49bf523)
### 相对上一版的变化
- **基线变化**：`53916889` → `a0877eaa`。记录上的 v1 基线是旧提交，本版按要求在 `a0877eaa` 上重建并重新生成全量补丁；`revisions` 的 v1 条目同步更正为 `a0877eaa`，因为现存 `001.patch` 已在该基线上 `git apply --check` 通过（无内容改动）。
- **代码与方案调整**：
  - `cmwehbmmsmprd`（确认是否过时代码）→ 已核实：`writer-engine` / `writer-rag` / `writer-tools` 生产代码对四个方法零调用，`docs/fix-plan.md` 已把删除面列为既定第二步，并在正文与编译期类型检查中双重佐证。
  - `cmweq8hzalgf3`（执行）→ 已在基线 `a0877eaa` 上重建补丁并跑通全部门禁；本版额外做了两处「删除方法后遗留点」的收尾（见下条）。
  - 收尾一：`derivedPath` 去掉已无调用方传入的 `kind` 参数与 kind 校验，路径钉死 `MAINTENANCE_KIND`。
  - 收尾二：修正两处仍提及 `writeDerived` / `readDerived` 的注释，避免注释指向已删除的符号。
### 方案说明
与 v1 思路一致（删除四个通用派生存取抽象，业务方法自包含），另加上述两处收尾。`target_files` 实际与 `002.patch` 的六个文件一一对应（补丁仅覆盖本候选文件——基线之后其他人的候选改动不在补丁内）。
### 验证结果
`npm run typecheck` 退出码 0（12.2s）；`npm test` 退出码 0（296/296，15.6s）；定向四文件 36/36；补丁在干净工作区 `git apply --check` / `git apply` 均成功，回放后文件与验证时一致。工作区已还原，仅 `.ai-review/` 有改动。
