---
schema_version: 1
title: 'writer-core: 删除 deprecated 的 readDerived/writeDerived/deleteDerived/listDerived 派生存取公开面'
module: writer-core
audit_type: shrink
created_at: '2026-11-12T10:36:30+08:00'
updated_at: '2026-11-13T08:40:37.894Z'
owner: cxs
tags:
  - core
  - store
  - api-cleanup
  - deprecated-removal
ticket: null
status: changes_requested
target_files:
  - packages/writer-core/src/index.ts
  - packages/writer-engine/tests/p3-integration.test.ts
  - packages/writer-engine/tests/p4.test.ts
  - packages/writer-rag/tests/rag-service.test.ts
  - packages/writer-store/src/index.ts
  - packages/writer-store/tests/derived.test.ts
current_revision: 1
revisions:
  - id: 1
    base_revision: a0877eaa1aadfb04346fe9e1bb5c25fff49bf523
    patch: 001.patch
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
    status: unresolved
    created_at: '2026-11-13T04:31:07.348Z'
  - id: cmweq8hzalgf3
    revision: 1
    file: ''
    line: 0
    author: cxs
    content: 执行
    status: unresolved
    created_at: '2026-11-13T08:40:37.894Z'
human_decisions: []
approval: null
rejection: null
commit_message: 'writer-core: 删除 deprecated 的 readDerived/writeDerived/deleteDerived/listDerived 派生存取公开面'
---

# 问题与影响
- **触发场景（Concrete Case）**：死 API 面——`readDerived/writeDerived/deleteDerived/listDerived` 四个抽象方法自轮次 38 第一步迁移后生产代码零调用（grep 全仓：engine/rag/tools 均已走 readMaintenance/writeMaintenance/deleteMaintenance 业务方法），仅剩 store 内部接线与测试种子直呼。docs/fix-plan.md「不在本轮范围（留痕）」节已明确裁定：P0-3 第二步删除面含这四个方法（`root` 因有活跃消费者另案）。
- **不修复的影响**：磁盘 kind 字面量的抽象回流后门持续敞开（listDerived 会把 `'maintenance'` 重新泄漏给消费者——fix-plan 原文）；@deprecated 面滞留增加后续维护者的契约困惑。

# 根因
- **代码位置**：packages/writer-core/src/index.ts WriterService 抽象（四个 @deprecated 方法）；packages/writer-store/src/index.ts 对应实现（read/write/deleteDerived + listDerived）。
- **触发链**：轮次 38 P0-3 第一步只做「业务方法上提 + 消费者迁移」（行为零变化、可回滚），删除面被刻意推迟为第二步——本候选即执行该既定第二步。

# 当前修复方案
- **核心改动**：core 删除四个抽象声明；store 的 readMaintenance/writeMaintenance/deleteMaintenance 改为自包含实现（原 Derived 方法体并入，kind 钉 MAINTENANCE_KIND），删除四个公开实现与 listDerived；测试迁移——derived.test.ts 三个用例改走业务方法（id 校验/坏 JSON/dirblock 覆盖保留，kind 校验用例随参数删除），p3-integration/p4/rag-service 的种子与断言迁移（补全 MaintenanceDerived 必填字段）。行为零变化（读写路径逐字保留）。
- **备选取舍**：保留私有 readDerived 通用方法供未来第二种派生 kind 复用——YAGNI（当前唯一 kind 是 maintenance，出现第二种时再抽）；`root` 不在本候选（有活跃生产消费者，删除需先设计替代路径 API，见审查报告 Deferred）。

# 需人工判断项
- **未发布包的破坏性变更**：四方法属 dsh-writer-core 公开抽象（包尚未 npm publish，无外部消费者）——若发布计划要求保守 ABI，可推迟到 0.x 首发前批量清理；fix-plan 已裁定删除，本候选按裁定执行。

# 验证证据
- **验证基线**：53916889d7abb032f867e2b36b12510889e58eb1
- **执行环境**：Windows 11 / Node v24.15.0 / npm 11.12.1；执行时 HEAD=b153253（轮次 39 与本候选六文件零交集；补丁在 53916889 独立 worktree 验证 `git apply --check` 通过）。
- **执行结果摘要**：`npm run typecheck` 退出码 0（strict 全仓编译即「零残余引用」的机器证明）；`npm test` 退出码 0，286/286（derived 三用例改写不减少，种子迁移后语义等价）；定向四测试文件 31/31。
- **未覆盖风险**：外部子类化 WriterService 的假想消费者（包未发布，实际不存在）；lib/ 预构建产物在合入后由 build 重建。

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
