---
schema_version: 1
title: 'writer-domain: 删除零引用的 mergeExtractionSections/ExtractedSectionEntries 死导出'
module: writer-domain
audit_type: delete
created_at: '2026-11-12T10:41:00+08:00'
updated_at: '2026-11-12T10:41:00+08:00'
owner: cxs
tags:
  - domain
  - dead-code
  - maintenance
ticket: null
status: pending
target_files:
  - packages/writer-domain/src/maintenance.ts
current_revision: 1
revisions:
  - id: 1
    base_revision: 38855c6393d2dd1e3ddb6d1fa418c244490099e7
    patch: 001.patch
    author: ai
gate_checks:
  - npm run typecheck
  - npm test
comments: []
human_decisions: []
approval: null
rejection: null
commit_message: 'refactor(writer-domain): 删除零引用的 mergeExtractionSections/ExtractedSectionEntries 死导出'
---

# 问题与影响
- **触发场景（Concrete Case）**：死代码（非运行时缺陷）——`mergeExtractionSections` 及其入参类型 `ExtractedSectionEntries` 自 P3 初版导出以来全仓零引用（engine 的按节重试在 writer-engine/src/index.ts:220-225 内联实现，从未调用该函数）；全仓 grep（packages 全部 src+tests、skills assets、dev.cordis.yml、各 cordis.patch.yml、docs）仅定义处与 implementation-plan 轮次 8 历史记录命中。
- **不修复的影响**：误导性 API——函数文档宣称「engine 按节重试后调用」实为谎言，且其「仅当该节在重试产出中出现才覆盖」的 presence 语义从未被内联实现继承（相关行为缺口已由候选 20261112-writer-engine-retry-keep-entries 修复）；后续读者可能误信契约或误复活错误版本。

# 根因
- **代码位置**：packages/writer-domain/src/maintenance.ts:183-196。
- **触发链**：P3 初版设计的节合并 API 在 engine 实际实现时被内联取代，导出未清理；38 轮审查聚焦行为面，未覆盖「导出面与宣称职责的一致性」。

# 当前修复方案
- **核心改动**：删除两个导出（函数 + 联合类型，共 14 行）；`ExtractionSectionName` 保留（engine/logic 真实消费）。无行为变化，typecheck + 全量测试自证。
- **备选取舍**：不「复活契约函数替代 engine 内联」（内联已由缺节守卫修复且有集成测试锁定，替换为函数调用属无收益重排，反而扩大补丁面）。

# 需人工判断项
- **包公共 API 面**：dsh-writer-domain 定位为可独立引用的纯函数域库（尚未发布 npm），导出面理论上可供外部消费者使用——本候选按「零引用 + 文档职责为假 + 契约语义已被内联实现取代」判定为死代码；若认为域库应保留通用节合并工具函数，请否决本候选。

# 验证证据
- **验证基线**：53916889d7abb032f867e2b36b12510889e58eb1
- **执行环境**：Windows 11 / Node v24.15.0 / npm 11.12.1；执行时 HEAD=b153253（轮次 39 与本候选文件零交集；补丁在 53916889 独立 worktree 验证 `git apply --check` 通过）。
- **执行结果摘要**：`npm run typecheck` 退出码 0（全仓无残余引用即编译自证）；`npm test` 退出码 0，286/286（删除无测试面损失）。
- **未覆盖风险**：无运行时面（纯删除）；域库未来外部消费者的潜在使用已在需人工判断项披露。

# 审核记录

## 版本 1 (base: 53916889d7abb032f867e2b36b12510889e58eb1)
### 方案说明
删除 maintenance.ts 尾部两个零引用导出。文件导览：src/maintenance.ts（-14 行，无其他改动）。
### 验证结果
typecheck 0 错；全量 286/286；补丁在基线 worktree 干净应用。
### 人类总体意见
待审核
### 意见处理结果
无
