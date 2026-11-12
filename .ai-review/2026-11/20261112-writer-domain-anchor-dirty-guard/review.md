---
schema_version: 1
title: 'writer-domain: 章节锚布尔/空串脏值被 Number() 伪造成 0/1 号章——假「已逾期」红线逐章注入'
module: writer-domain
audit_type: bugfix
created_at: '2026-11-12T10:26:00+08:00'
updated_at: '2026-11-12T10:26:00+08:00'
owner: cxs
tags:
  - domain
  - foreshadow
  - dirty-data
  - context-assembly
ticket: null
status: pending
target_files:
  - packages/writer-domain/src/index.ts
  - packages/writer-domain/src/rag.ts
  - packages/writer-domain/tests/rewrite.test.ts
current_revision: 1
revisions:
  - id: 1
    base_revision: c35c8af091e1f6c1d06654d92bbef4c310e33ab7
    patch: 001.patch
    author: ai
gate_checks:
  - npm run typecheck
  - npm test
comments: []
human_decisions: []
approval: null
rejection: null
commit_message: 'fix(writer-domain): 章节锚布尔/空串脏值被 Number() 伪造成 0/1 号章——假「已逾期」红线逐章注入'
---

# 问题与影响
- **触发场景（Concrete Case）**：模型调 writer_update 给 plot 写 `frontmatter={"planned_chapter": true}` 或空串（sanitizeFrontmatter 对标量原样放行，frontmatter 值域含 boolean）→ chapterAnchorOf 的 `Number(value)` 把 true/'' 折成 1/0 且通过 isFinite → 该 planned 伏笔自第 2 章起每次组装上下文都注入「🔴 此伏笔已逾期未设置，本章必须设置（plant）」，诱导模型逐章重复 plant；resolve_chapter 同型（假「已逾期未回收」红线）。
- **不修复的影响**：伏笔红线的可信度被脏数据击穿——每章伪红线挤占指令预算并诱导重复动作，与「脏值不误判/不误触发」的函数自身注释承诺相悖。

# 根因
- **代码位置**：packages/writer-domain/src/index.ts chapterAnchorOf（宽松 Number 转换只防了 NaN，没防 JS 的 Number(true)=1 / Number('')=0）。
- **触发链**：writer_update 的 frontmatter 值域允许 boolean（timeline 等字段确需 boolean）→ 脏锚落盘 → 组装器宽松转换成合法数值 → 逾期判定 `anchor < chapterNumber` 恒真。对照：同文件 chapterNumberOf 对 frontmatter 直接 typeof 判型，此处是唯一宽松转换漏点。

# 当前修复方案
- **核心改动**：chapterAnchorOf 显式拒绝 boolean 与空白串（按缺失返回 undefined）；函数转 export 并让 rag.ts filterChunksBySpoiler 的内联 `Number()` 副本改用同一实现——该处注释本就声称「与组装器同语义」，此前实为两份并行实现各自漂移（本候选行为面在组装器；rag 侧布尔/空串两版语义等价，属统一实现）。
- **备选取舍**：不在工具层拦死布尔（timeline 等 boolean 字段是合法需求，按字段白名单拦截会把校验面铺到每个消费方）；不在 parseFrontmatter 拒绝布尔（frontmatter 值域设计即含 boolean）。新增用例锁「布尔/空串锚不触发 🔴、仍以 🟡 活跃注入（不因脏值丢失伏笔）」。

# 需人工判断项
- **脏锚的持久化治理**：本修复只阻断脏锚的运行时危害，落盘的脏值仍在（writer_update 不校验 planned_chapter 取值）；如需入口校验（如 plot 锚字段白名单），属工具语义扩展请另行裁定。

# 验证证据
- **验证基线**：53916889d7abb032f867e2b36b12510889e58eb1
- **执行环境**：Windows 11 / Node v24.15.0 / npm 11.12.1；执行时 HEAD=b153253（轮次 39 与本候选三文件零交集；补丁在 53916889 独立 worktree 验证 `git apply --check` 通过）。
- **执行结果摘要**：`npm run typecheck` 退出码 0；`npm test` 退出码 0，287/287（基线 286 + 净增 1 例：布尔/空串锚双形态断言不触发红线且黄档保留）；rewrite/rag 两测试文件 29/29。
- **未覆盖风险**：rag 侧统一实现无独立行为差异用例（布尔/空串在过滤语义上与缺失等价，既有 rag.test 覆盖数值锚路径）；数字字符串带空白（如 ' 3 '）仍按 Number 解析为 3——宽松方向与既有 '003' 形态一致，未收紧。

# 审核记录

## 版本 1 (base: 53916889d7abb032f867e2b36b12510889e58eb1)
### 方案说明
chapterAnchorOf 布尔/空串守卫 + 导出统一 rag 内联副本 + 假红线回归测试。文件导览：src/index.ts（守卫与导出）、src/rag.ts（改用共用实现）、tests/rewrite.test.ts（脏值用例后新增一例）。
### 验证结果
typecheck 0 错；全量 287/287；补丁在基线 worktree 干净应用。
### 人类总体意见
待审核
### 意见处理结果
无
