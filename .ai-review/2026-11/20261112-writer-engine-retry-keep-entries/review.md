---
schema_version: 1
title: 'writer-engine: 维护 pass 按节重试漏回节时已通过条目被静默清空'
module: writer-engine
audit_type: bugfix
created_at: '2026-11-12T10:22:30+08:00'
updated_at: '2026-11-12T10:22:30+08:00'
owner: cxs
tags:
  - engine
  - maintenance
  - extraction
  - retry
ticket: null
status: pending
target_files:
  - packages/writer-engine/src/index.ts
  - packages/writer-engine/src/prompts.ts
  - packages/writer-engine/tests/p3-integration.test.ts
current_revision: 1
revisions:
  - id: 1
    base_revision: ec196b855c103d4ab5e976537baa47686be6af96
    patch: 001.patch
    author: ai
gate_checks:
  - npm run typecheck
  - npm test
comments: []
human_decisions: []
approval: null
rejection: null
commit_message: 'writer-engine: 维护 pass 按节重试漏回节时已通过条目被静默清空'
---

# 问题与影响
- **触发场景（Concrete Case）**：首轮抽取 facts=[A（合法）, B（引用不存在实体被拒收）] → facts 节进重试；重试轮模型按「只需重新输出以下节」的提示合理漂移，漏回 facts 键（或只回其他节）→ parseMaintenanceExtraction 缺键、validateExtractionSections 收敛为 entries=[] → `extraction.facts = []` 整体覆盖 → A 静默丢失，planSectionRetry 见无 errors 不重试、不标 partial，派生记录与 pending.md 均无告警。
- **不修复的影响**：人工确认环按条目级缺项（少一条事实建议），无任何可发现信号；被丢的恰是首轮已通过校验的可靠条目。

# 根因
- **代码位置**：packages/writer-engine/src/index.ts doMaintenancePass 重试赋值段（`for (const section of retrySections)` 整体替换，无 presence 判断）；packages/writer-engine/src/prompts.ts buildExtractionUserPrompt 的 sectionNote 未要求重发节内全部条目。
- **触发链**：合并粒度=节且假定重试输出必含该节；缺席节经校验器归一为空数组后被无条件赋值——「已通过的节保留」的声示意图（注释与 H1 测试只覆盖节间保留）在节内条目级存在缺口。

# 当前修复方案
- **核心改动**：①赋值加缺节守卫——`parsed.<节> !== undefined` 才覆盖（缺席保留上一轮已通过条目，一行×3 分支）；②sectionNote 文案改为「重发的节请给出该节全部条目（含上一轮已通过的条目），不要只回修正项」（抑制「只回修正项」的另一半丢失面：节内只回 B′ 时 [A] 被 [B′] 覆盖）。
- **备选取意**：不做条目级合并（无稳定条目 id，按 description 匹配会引入去重歧义）；缺节不重新排队重试（缺席视作模型放弃修正，保留旧值已优于清空）。新增集成测试锁「漏回节保留已通过条目」分支。

# 需人工判断项
- **提示词缓解的边界**：「只回修正项」的覆盖面（B′ 替换 A）靠提示词抑制而非代码强制——若要求确定性防丢，需引入条目级合并或对重发节做条目数下限校验，属新机制，请裁定是否值得。

# 验证证据
- **验证基线**：53916889d7abb032f867e2b36b12510889e58eb1
- **执行环境**：Windows 11 / Node v24.15.0 / npm 11.12.1；执行时 HEAD=b153253（轮次 39 与本候选三文件零交集；补丁在 53916889 独立 worktree 验证 `git apply --check` 通过）。
- **执行结果摘要**：`npm run typecheck` 退出码 0；`npm test` 退出码 0，287/287（基线 286 + 净增 1 例：漏回节不清空 + 派生记录同步断言）；p3-integration 单文件 14/14。
- **未覆盖风险**：「重发节只含修正项 B′」分支无确定性代码防线（提示词缓解，见需人工判断项）；缺节 + 重试预算耗尽的组合路径与单次缺节路径同代码分支。

# 审核记录

## 版本 1 (base: 53916889d7abb032f867e2b36b12510889e58eb1)
### 方案说明
engine 重试赋值加 presence 守卫 + 重试提示词要求整节重发 + 缺节守卫回归测试。文件导览：src/index.ts（三分支守卫）、src/prompts.ts（sectionNote 一句）、tests/p3-integration.test.ts（H1 用例后新增一例）。
### 验证结果
typecheck 0 错；全量 287/287；补丁在基线 worktree 干净应用。
### 人类总体意见
待审核
### 意见处理结果
无
