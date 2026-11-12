---
schema_version: 1
title: 'writer-domain: 组装器可降级分节截断用 UTF-16 slice——孤立代理项进入 LLM 提示词'
module: writer-domain
audit_type: bugfix
created_at: '2026-11-12T10:26:30+08:00'
updated_at: '2026-11-12T10:26:30+08:00'
owner: cxs
tags:
  - domain
  - context-assembly
  - unicode
  - truncation
ticket: null
status: pending
target_files:
  - packages/writer-domain/src/index.ts
  - packages/writer-domain/tests/rewrite.test.ts
current_revision: 1
revisions:
  - id: 1
    base_revision: abd326dba0a03b22a359afda8fa5b2f1482b6835
    patch: 001.patch
    author: ai
gate_checks:
  - npm run typecheck
  - npm test
comments: []
human_decisions: []
approval: null
rejection: null
commit_message: 'fix(writer-domain): 组装器可降级分节截断用 UTF-16 slice——孤立代理项进入 LLM 提示词'
---

# 问题与影响
- **触发场景（Concrete Case）**：contextBudgetChars 有限（默认 24000，assist 减半）且「前一章原文」「出场人物」「更早章节」等可降级分节的截断点恰好落在 emoji/扩展区汉字（U+20000+ 代理对）中间 → `trimmed.slice(0, used)` 产生孤立高代理项 + '…' → 该文本进入 llm.stream 的 user message，JSON 序列化产出 `\uD8XX` 转义——多数 LLM 网关拒收整次请求或静默替换为乱码，写作/审稿调用随机失败。
- **不修复的影响**：astral 字符富集的长章节在预算受限时（assist 模式最常见）触发间歇性模型调用失败，且错误指向网关而非本仓，排障困难。

# 根因
- **代码位置**：packages/writer-domain/src/index.ts assembleWritingContext 的 optional() 通用截断分支（`trimmed.slice(0, used)`）。
- **触发链**：轮次 33「截断码点安全统一」改了同文件 briefOf、更早章摘要、rag snippetOf 等截断点，optional() 是承接全部可降级分节的通用分支，被遗漏——同口径漏改。

# 当前修复方案
- **核心改动**：截断改用 truncateCodePoints（函数声明提升，同文件既有工具）；used 仍按 UTF-16 单位计预算，astral 富集文本实际注入码点数 ≤ used（保守方向，不超预算）。新增用例：全 astral 正文 + 强制截断 → 产物 well-formed（无孤立代理项）且保头。
- **备选取舍**：不改计费口径为码点（会全局改变分节预算行为，与 usageChars 断言面冲突）；不引入 String.prototype.isWellFormed 断言（target ES2022 无该 API，用代理对正则等效判定）。

# 需人工判断项
- 无

# 验证证据
- **验证基线**：53916889d7abb032f867e2b36b12510889e58eb1
- **执行环境**：Windows 11 / Node v24.15.0 / npm 11.12.1；执行时 HEAD=b153253（轮次 39 与本候选两文件零交集；补丁在 53916889 独立 worktree 验证 `git apply --check` 通过）。
- **执行结果摘要**：`npm run typecheck` 退出码 0；`npm test` 退出码 0，287/287（基线 286 + 净增 1 例：astral 截断 well-formed 断言）；rewrite.test.ts 22/22。
- **未覆盖风险**：llm 网关对孤立代理项的实际行为（拒收/替换）未在本地复现——修复以 well-formed 静态断言锁定，网关行为属外部面。

# 审核记录

## 版本 1 (base: 53916889d7abb032f867e2b36b12510889e58eb1)
### 方案说明
optional() 截断改 truncateCodePoints + astral 回归测试。文件导览：src/index.ts（一行替换 + 注释）、tests/rewrite.test.ts（截断用例后新增一例）。
### 验证结果
typecheck 0 错；全量 287/287；补丁在基线 worktree 干净应用。
### 人类总体意见
待审核
### 意见处理结果
无
