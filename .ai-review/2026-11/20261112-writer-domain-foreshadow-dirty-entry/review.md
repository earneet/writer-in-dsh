---
schema_version: 1
title: 'writer-domain: 伏笔脏值入口防护——未知状态抛 TypeError 逃逸分类、章锚无格式校验致红线静默失效'
module: writer-domain
audit_type: bugfix
created_at: '2026-11-12T10:25:00+08:00'
updated_at: '2026-11-12T10:25:00+08:00'
owner: cxs
tags:
  - domain
  - foreshadow
  - guard
  - validation
  - tools
ticket: null
status: pending
target_files:
  - packages/writer-domain/src/guard.ts
  - packages/writer-domain/src/index.ts
  - packages/writer-domain/tests/domain.test.ts
  - packages/writer-domain/tests/guard.test.ts
  - packages/writer-tools/src/index.ts
  - packages/writer-tools/tests/tools.test.ts
current_revision: 1
revisions:
  - id: 1
    base_revision: 0166098d0f9c55aabcd3426df49a5464ebfe93b8
    patch: 001.patch
    author: ai
gate_checks:
  - npm run typecheck
  - npm test
comments: []
human_decisions: []
approval: null
rejection: null
commit_message: 'writer-domain: 伏笔脏值入口防护——未知状态抛 TypeError 逃逸分类、章锚无格式校验致红线静默失效'
---

# 问题与影响
- **触发场景（Concrete Case）**：两个同族入口缺口。①plot 的 frontmatter status 被手编/模型经 writer_update 误写为 "Planted"/"draft"（writer_update 不校验 status 取值）→ foreshadow_update 以 `as` 强转传入 transitionForeshadow → `FORESHADOW_TRANSITIONS['draft']` 为 undefined → `.includes` 抛原生 `TypeError: Cannot read properties of undefined`，classifyBusinessError 无从归类（计失败数但拿不到 illegal-transition 纠偏指引）。②foreshadow_update 传 `chapter="第七章"` → 成功落盘 planted_chapter/resolved_chapter/milestones[].chapter 脏锚 → chapterAnchorOf 按缺失处理 → 该伏笔「本章必须设置/回收」红线永不触发且无告警。
- **不修复的影响**：①模型面对不可读 TypeError 无法自纠（错误预算观测失明）；②伏笔纪律红线被脏锚静默废掉，planned 伏笔可无限逾期不入指令。

# 根因
- **代码位置**：packages/writer-domain/src/index.ts transitionForeshadow（查表不判空）；packages/writer-tools/src/index.ts foreshadow_update 的 plant/resolve/milestone 三分支（chapter 只查必填不查格式——对照同文件 pending_cleanup 的 `/^\d{3}$/` 与 timeline_update 经 appendTimelineEntry 的硬校验）。
- **触发链**：①类型签名 ForeshadowStatus 运行时无守卫，脏值直达查表；②参数描述写了「三位序号」但入口无校验，脏锚落盘后在组装器/防剧透过滤中被「按缺失」容错吞掉。

# 当前修复方案
- **核心改动**：①transitionForeshadow 查表改 `?? []` 判空，未知状态抛 `伏笔状态非法迁移：X → Y（合法状态：…）`（保留既有前缀，guard illegal-transition 模式不变即命中）；②foreshadow_update 两个 chapter 消费分支加 `/^\d{3}$/` 入口校验，新前缀 `伏笔章锚必须为三位序号` 同步进 domain guard.ts validation 模式（契约测试守门）；③测试三面补强（domain 未知状态两断言、guard 分类两断言、tools 脏章锚两断言）。
- **备选取舍**：不在 writer_update 拦截 status 取值（通用写入口加 plot 专属字段语义会把校验面铺到每个 frontmatter 键，属更大的 schema 治理）；不在 domain 层拦 chapter 字符串（章锚不是 domain 函数入参而是 frontmatter 数据，入口校验在工具层最贴近错误源）。

# 需人工判断项
- **status 取值治理**：writer_update 仍可写入任意 status 字符串（本候选只保证读到脏值时错误可读可分类）——是否给 plot.status 加白名单校验属工具语义扩展，请裁定。

# 验证证据
- **验证基线**：53916889d7abb032f867e2b36b12510889e58eb1
- **执行环境**：Windows 11 / Node v24.15.0 / npm 11.12.1；执行时 HEAD=b153253（轮次 39 与本候选六文件零交集；补丁在 53916889 独立 worktree 验证 `git apply --check` 通过）。
- **执行结果摘要**：`npm run typecheck` 退出码 0；`npm test` 退出码 0，286/286（测试数不变，既有用例内净增 6 条断言：domain 2 + guard 2 + tools 2）；四测试文件定向 35/35。
- **未覆盖风险**：writer_ui parse.ts 对 foreshadow_update 回执的解析不受影响（回执文案未变）；脏 status 经 UI 面板展示口径未动（三色按字面值归灰档，既有行为）。

# 审核记录

## 版本 1 (base: 53916889d7abb032f867e2b36b12510889e58eb1)
### 方案说明
伏笔域脏值入口防护：domain 状态机查表判空 + tools 章锚格式校验 + guard 模式表同步 + 三面断言。文件导览：writer-domain/src/index.ts（transitionForeshadow）、writer-domain/src/guard.ts（validation 模式）、writer-tools/src/index.ts（两分支校验）、三个测试文件的既有用例内补断言。
### 验证结果
typecheck 0 错；全量 286/286；补丁在基线 worktree 干净应用。
### 人类总体意见
待审核
### 意见处理结果
无
