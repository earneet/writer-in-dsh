---
schema_version: 1
title: 'writer-export: 附录 XHTML 用 HTML5 doctype——同书文档类型漂移，EPUB 2 严格校验失败'
module: writer-export
audit_type: bugfix
created_at: '2026-11-12T10:29:00+08:00'
updated_at: '2026-11-12T10:29:00+08:00'
owner: cxs
tags:
  - export
  - epub
  - xhtml
  - spec-compliance
ticket: null
status: pending
target_files:
  - packages/writer-export/src/render.ts
  - packages/writer-export/tests/export.test.ts
current_revision: 1
revisions:
  - id: 1
    base_revision: fb7e47a15630ee4eeb10e3f36cd74b036ebc86b2
    patch: 001.patch
    author: ai
gate_checks:
  - npm run typecheck
  - npm test
comments: []
human_decisions: []
approval: null
rejection: null
commit_message: 'fix(writer-export): 附录 XHTML 用 HTML5 doctype——同书文档类型漂移，EPUB 2 严格校验失败'
---

# 问题与影响
- **触发场景（Concrete Case）**：export_book(format="epub", include_outline=true 或 include_characters=true) → OEBPS/appendix-outline.xhtml / appendix-characters.xhtml 以 `<!DOCTYPE html>`（HTML5）开头，而同书章节/卷首文档均为 XHTML 1.1 DTD、OPF 声明 version="2.0" → EPUB 2 的内容文档要求 XHTML 1.1 doctype，epubcheck 报错；同一本书内文档类型漂移。
- **不修复的影响**：带附录的 ePub 导出物无法通过 epubcheck/严格阅读器（Apple Books 等）校验，用户无法定位是哪一个文档违规。

# 根因
- **代码位置**：packages/writer-export/src/render.ts renderPlainXhtml（对照 renderChapterXhtml/renderVolumeXhtml 均为 XHTML 1.1 DTD）。
- **触发链**：轮次 16 统一 XHTML 1.1 doctype 时只有章节/卷首两个渲染函数；轮次 32 给附录路径补控制字符剥离（BIZ-07 第五注入点）时未同步 doctype；export.test.ts:209 的附录用例只断言剥字符与 `<pre>`，未锁 doctype——历轮修复的盲区。

# 当前修复方案
- **核心改动**：renderPlainXhtml 的 doctype 换为与章节文档逐字相同的 XHTML 1.1 DTD 字符串（一行）；附录用例补 doctype 断言防再漂移。
- **备选取舍**：不为附录单独改用 HTML5 容器（EPUB 3 才允许，OPF 已钉 2.0）；不引入 epubcheck 到测试链（外部依赖，超出本仓测试面）。

# 需人工判断项
- **epubcheck 实测**：本机无 epubcheck，规范符合性依据 EPUB 2.0/OCF 对 XHTML 1.1 内容文档的要求与同书一致性判定；发布前跑一次 epubcheck 可作最终确认（见 docs/release-checklist 流程）。

# 验证证据
- **验证基线**：53916889d7abb032f867e2b36b12510889e58eb1
- **执行环境**：Windows 11 / Node v24.15.0 / npm 11.12.1；执行时 HEAD=b153253（轮次 39 与本候选两文件零交集；补丁在 53916889 独立 worktree 验证 `git apply --check` 通过）。
- **执行结果摘要**：`npm run typecheck` 退出码 0；`npm test` 退出码 0，286/286（测试数不变，附录用例内净增 1 条 doctype 断言）；export 两测试文件 16/16。
- **未覆盖风险**：epubcheck 未本地执行（外部工具不在仓内）；浏览器半渲染的附录展示不受 doctype 影响（宿主按 XHTML 解析同书文档）。

# 审核记录

## 版本 1 (base: 53916889d7abb032f867e2b36b12510889e58eb1)
### 方案说明
附录 doctype 与章节文档统一为 XHTML 1.1 DTD + 断言锁定。文件导览：src/render.ts（renderPlainXhtml 一行 + 注释）、tests/export.test.ts（附录用例补断言）。
### 验证结果
typecheck 0 错；全量 286/286；补丁在基线 worktree 干净应用。
### 人类总体意见
待审核
### 意见处理结果
无
