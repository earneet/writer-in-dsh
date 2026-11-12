---
schema_version: 1
title: 'writer-export: 空作者时 OPF 无条件渲染空 dc:creator——epubcheck 校验错误且与 HTML 路径不同型'
module: writer-export
audit_type: bugfix
created_at: '2026-11-12T10:31:30+08:00'
updated_at: '2026-11-12T12:52:53.691Z'
owner: cxs
tags:
  - export
  - epub
  - opf
  - metadata
ticket: null
status: rejected
target_files:
  - packages/writer-export/src/render.ts
  - packages/writer-export/tests/export.test.ts
current_revision: 1
revisions:
  - id: 1
    base_revision: eb9b14f9e51912006632bdbb1fab8c64b77d0c5e
    patch: 001.patch
    author: ai
gate_checks:
  - npm run typecheck
  - npm test
comments: []
human_decisions: []
approval: null
rejection:
  rejected_by: cxs
  rejected_at: '2026-11-12T12:52:53.691Z'
  reason: 这个不是问题
  related_symbols:
    - 'export function renderContentOpf(book: ExportBook, items: readonly EpubManifestI'
    - test('EPUB 结构文档：container/opf/ncx 均含必需元素且转义', () =>
commit_message: 'writer-export: 空作者时 OPF 无条件渲染空 dc:creator——epubcheck 校验错误且与 HTML 路径不同型'
---

# 问题与影响
- **触发场景（Concrete Case）**：outline.md 无 author frontmatter（author 默认 ''）→ export_book(format="epub") → content.opf 含 `<dc:creator opf:role="aut"></dc:creator>` 空元素 → epubcheck 报 empty element 校验错误；同一本书 HTML 导出正常（renderHtml 有 `book.author.length > 0` 分支，空作者不渲染）。
- **不修复的影响**：无作者设定的项目导出的 ePub 无法通过严格校验；两条渲染路径对同一状态（无作者）行为不一致。

# 根因
- **代码位置**：packages/writer-export/src/render.ts renderContentOpf（dc:creator 无条件渲染）；对照 renderHtml（有非空分支）与 dc:title 的「未命名作品」兜底——author 无兜底且无条件渲染。
- **触发链**：dc:creator 在 EPUB 2 / DCMES 是可选元素，空串来源是 index.ts 的 `author: ''` 默认值；OPF 渲染漏配条件分支。

# 当前修复方案
- **核心改动**：`book.author.length > 0` 才渲染 dc:creator（spread 条件行，与 HTML 路径同口径）；测试补两断言（空作者不含 dc:creator、非空作者渲染且转义）。
- **备选取舍**：不写死「佚名」兜底（虚构元数据不如省略可选元素诚实；HTML 路径既有先例也是省略）。

# 需人工判断项
- **空作者元数据口径**：若发布流程希望 ePub 恒有 dc:creator（如统一「佚名」），请改走兜底方案——本候选选择与 HTML 路径一致的省略语义。

# 验证证据
- **验证基线**：53916889d7abb032f867e2b36b12510889e58eb1
- **执行环境**：Windows 11 / Node v24.15.0 / npm 11.12.1；执行时 HEAD=b153253（轮次 39 与本候选两文件零交集；补丁在 53916889 独立 worktree 验证 `git apply --check` 通过）。
- **执行结果摘要**：`npm run typecheck` 退出码 0；`npm test` 退出码 0，286/286（测试数不变，EPUB 结构用例内净增 2 条断言）；export 两测试文件 16/16。
- **未覆盖风险**：epubcheck 未本地执行（同候选 20261112-writer-export-appendix-doctype 的披露）；NCX 的 docTitle 不含 author，无同型问题。

# 审核记录

## 版本 1 (base: 53916889d7abb032f867e2b36b12510889e58eb1)
### 方案说明
dc:creator 条件渲染（空作者省略）+ 双向断言。文件导览：src/render.ts（renderContentOpf 一处 spread）、tests/export.test.ts（EPUB 结构用例补断言）。
### 验证结果
typecheck 0 错；全量 286/286；补丁在基线 worktree 干净应用。
### 人类总体意见
待审核
### 意见处理结果
无

## 版本 1 (base: eb9b14f9e51912006632bdbb1fab8c64b77d0c5e)

### 放弃
这个不是问题
