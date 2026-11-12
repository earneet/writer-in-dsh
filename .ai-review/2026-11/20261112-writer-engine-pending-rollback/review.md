---
schema_version: 1
title: 'writer-engine: 维护 pass 待办追加失败不回滚——该章人工确认建议永久丢失'
module: writer-engine
audit_type: bugfix
created_at: '2026-11-12T10:19:30+08:00'
updated_at: '2026-11-12T10:19:30+08:00'
owner: cxs
tags:
  - engine
  - maintenance
  - pending
  - error-handling
ticket: null
status: pending
target_files:
  - packages/writer-engine/src/index.ts
  - packages/writer-engine/tests/p3-integration.test.ts
current_revision: 1
revisions:
  - id: 1
    base_revision: 717c368582feba6ae3b917da3f0ab1ac402df7e5
    patch: 001.patch
    author: ai
gate_checks:
  - npm run typecheck
  - npm test
comments: []
human_decisions: []
approval: null
rejection: null
commit_message: 'writer-engine: 维护 pass 待办追加失败不回滚——该章人工确认建议永久丢失'
---

# 问题与影响
- **触发场景（Concrete Case）**：doMaintenancePass 已 writeMaintenance 落盘（锚定 sourceHash=当前章节 hash）后，appendPending 抛错（rename 重试耗尽/IO 故障）或进程在两步之间被杀 → 下次 maintenancePass 命中 up-to-date 短路（L181-183）不再调模型也不补 pending → 该章本轮全部待办建议（事实/伏笔事件/人物状态升格建议）在章节再次被改写前永久缺席 pending.md，用户重试得到 no-op。
- **不修复的影响**：维护 pass 的人工确认环（pending.md 是唯一入口）出现无自愈路径的静默缺口；P7 的 drainMaintenance 只覆盖协作退出，无法覆盖本失败面。

# 根因
- **代码位置**：packages/writer-engine/src/index.ts doMaintenancePass 尾段（writeMaintenance → changedDuringRun 判定 → appendPending 顺序执行，L252-262）。
- **触发链**：writeMaintenance 是不可逆「提交点」（hash 锚定 + up-to-date 短路），而 pending.md 追加排在提交点之后且失败无回滚——两步落盘非原子，失败方向选错。

# 当前修复方案
- **核心改动**：appendPending 包 try/catch，失败时 `deleteMaintenance(chapterId)` 回滚已锚定的派生记录后 rethrow 原错误；下次触发（保存/flush/显式调用）自然重跑全 pass 并补 pending。回滚本身失败仅告警不吞原错误（此时退化为旧行为）。
- **备选取舍**：不调序为「pending 先于 derived」（会引入重复节：pass 成功而 pending 已写的场景需去重，复杂度更高且改变既有幂等断言）；不引入两阶段提交（进程内场景过度设计）。代价是回滚后重试多一次模型调用（摘要+抽取），可接受——宁多一次调用，不丢人工确认环。新增集成测试：appendPending 首次失败 → 断言派生已回滚 + 重试真正重跑（llm 调用计数）+ 待办落清单。

# 需人工判断项
- **回滚代价口径**：失败回滚后下次触发会重跑两次模型调用（而非只补 pending）——确认接受该成本换简单性；若倾向「仅补 pending 的轻量重试」需引入派生记录部分标记，属新机制另行设计。

# 验证证据
- **验证基线**：53916889d7abb032f867e2b36b12510889e58eb1
- **执行环境**：Windows 11 / Node v24.15.0 / npm 11.12.1；执行时 HEAD=b153253（轮次 39 与本候选两文件零交集；补丁在 53916889 独立 worktree 验证 `git apply --check` 通过）。
- **执行结果摘要**：`npm run typecheck` 退出码 0；`npm test` 退出码 0，287/287（基线 286 + 净增 1 例：回滚→重跑→待办落盘三断言链），p3-integration 单文件 14/14。
- **未覆盖风险**：两步之间进程被杀（kill -9）场景无法在单测内模拟，与回滚代码路径相同（无 pending 且派生已锚定的状态由下次 up-to-date 短路暴露）——该残留面与既有「非协作退出」留痕同口径。

# 审核记录

## 版本 1 (base: 53916889d7abb032f867e2b36b12510889e58eb1)
### 方案说明
engine doMaintenancePass 尾段 appendPending 失败回滚 + 集成回归测试。文件导览：src/index.ts（try/catch 回滚 + 注释）、tests/p3-integration.test.ts（文末新增一例）。
### 验证结果
typecheck 0 错；全量 287/287；补丁在基线 worktree 干净应用。
### 人类总体意见
待审核
### 意见处理结果
无
