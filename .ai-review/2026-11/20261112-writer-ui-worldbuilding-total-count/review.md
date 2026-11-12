---
schema_version: 1
title: 'writer-ui: 世界观超读取上限时概况统计格显示已读数（≤24）而非总数'
module: writer-ui
audit_type: bugfix
created_at: '2026-11-12T10:39:00+08:00'
updated_at: '2026-11-12T10:39:00+08:00'
owner: cxs
tags:
  - ui
  - scan
  - worldbuilding
  - stats
ticket: null
status: pending
target_files:
  - packages/writer-ui/src/client/load.ts
  - packages/writer-ui/src/client/project.ts
  - packages/writer-ui/tests/project.test.ts
  - packages/writer-ui/tests/watch.test.ts
current_revision: 1
revisions:
  - id: 1
    base_revision: 4af40f30d74d7366de0aceb9633e22925481bba0
    patch: 001.patch
    author: ai
gate_checks:
  - npm run typecheck
  - npm test
comments: []
human_decisions: []
approval: null
rejection: null
commit_message: 'writer-ui: 世界观超读取上限时概况统计格显示已读数（≤24）而非总数'
---

# 问题与影响
- **触发场景（Concrete Case）**：novel/worldbuilding/ 放 25 个 .md → 冷扫描按 WORLDBUILDING_MAX=24 截断读取 → scan.worldbuildingCount 取已读取记录数（24）→ 概况页「世界观 24」统计格数字错误（实际 25）；设定页虽有「另有 1 条未加载」披露行，但统计格本身的数字与事实不符。
- **不修复的影响**：超过 24 条世界观设定的长篇项目，面板概况统计恒少计；截断路径此前零测试（WORLDBUILDING_MAX/worldbuildingTruncated 全仓无测试引用）。

# 根因
- **代码位置**：packages/writer-ui/src/client/load.ts（阶段一 names 全量清单只用来算截断数后即丢弃，返回值从「读到的 worldbuilding 记录」反推 count）；packages/writer-ui/src/client/project.ts:254（又取 graph.worldEntries.length，同样是截断后的数组长度）。
- **触发链**：v8 读取上限保险丝引入时计数口径跟着截断走——总数在扫描层丢失，投影层无从恢复。

# 当前修复方案
- **核心改动**：load.ts 保留 worldbuildingTotal（=names 全量数）并作为 worldbuildingCount 返回；project.ts 统计格改直通 scan.worldbuildingCount（卡片 worldRows 仍只含已读取条目，截断披露行不变）。新增 2 例：scan 层（mock remote 放 25 条，断言总数 25/上限 24/截断 1）与投影层（错位 fixture 断言直通）。
- **备选取舍**：不提高/移除读取上限（读放大保护是 v8 审查裁定，本候选只纠正计数口径）。

# 需人工判断项
- 无

# 验证证据
- **验证基线**：53916889d7abb032f867e2b36b12510889e58eb1
- **执行环境**：Windows 11 / Node v24.15.0 / npm 11.12.1；执行时 HEAD=b153253（轮次 39 与本候选四文件零交集；补丁在 53916889 独立 worktree 验证 `git apply --check` 通过）。
- **执行结果摘要**：`npm run typecheck` 退出码 0；`npm test` 退出码 0，288/288（基线 286 + 净增 2 例：scan 层截断三断言 + 投影层直通断言）；watch/project 两测试文件 22/22。
- **未覆盖风险**：浏览器端真实渲染未测（统计格组件消费 overview.worldbuildingCount 的接线由既有 contract/overview 测试面覆盖；本项目测试面为纯函数层，浏览器半由 browser-test 脚本兜底——该脚本需本机环境，见审查报告 B 类）。

# 审核记录

## 版本 1 (base: 53916889d7abb032f867e2b36b12510889e58eb1)
### 方案说明
worldbuilding 总数穿透扫描层 + 投影层直通 + 两层回归测试。文件导览：src/client/load.ts（total 计数与返回）、src/client/project.ts（统计格直通一行）、tests/watch.test.ts 与 tests/project.test.ts（各一例）。
### 验证结果
typecheck 0 错；全量 288/288；补丁在基线 worktree 干净应用。
### 人类总体意见
待审核
### 意见处理结果
无
