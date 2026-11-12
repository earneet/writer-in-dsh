---
schema_version: 1
title: 'writer-tools: archive_point 在零提交仓库首存档时排除命令静默失败——exports 与 .writer 全部入库'
module: writer-tools
audit_type: bugfix
created_at: '2026-11-12T10:36:00+08:00'
updated_at: '2026-11-12T07:08:15.796Z'
owner: cxs
tags:
  - tools
  - archive
  - git
  - error-handling
ticket: null
status: approved
target_files:
  - packages/writer-tools/src/index.ts
  - packages/writer-tools/tests/tools.test.ts
current_revision: 1
revisions:
  - id: 1
    base_revision: 18c7dd3e09e93193de56de72692aef552ef8a2d9
    patch: 001.patch
    author: ai
gate_checks:
  - npm run typecheck
  - npm test
comments: []
human_decisions: []
approval:
  approved_by: cxs
  approved_at: '2026-11-12T07:08:15.795Z'
  gate_checks:
    - npm run typecheck
    - npm test
  gate_results:
    - command: npm run typecheck
      exit_code: 0
      duration_ms: 12200
    - command: npm test
      exit_code: 0
      duration_ms: 15578
  confirmed_decisions: []
  waived_decisions: []
rejection: null
commit_message: 'writer-tools: archive_point 在零提交仓库首存档时排除命令静默失败——exports 与 .writer 全部入库'
---

# 问题与影响
- **触发场景（Concrete Case）**：新项目 git init 后从未 commit（无 HEAD）→ 导出过 epub（exports/book.epub 存在）→ archive_point → `git add -A` 暂存全部 → `git reset -- .writer exports` 因 unborn HEAD 抛 "fatal: Failed to resolve 'HEAD'" 被 `.catch(() => {})` 吞掉 → 首个存档点把 exports/book.epub（整本书）与 .writer/derived 全部提交，与该行注释声明的「不入存档」意图相反。
- **不修复的影响**：用户首次使用存档点即把可再生的导出物/派生缓存写入版本历史（epub 为二进制，仓库快速膨胀，且历史已污染不可逆）。

# 根因
- **代码位置**：packages/writer-tools/src/index.ts archive_point 的 unstage 段（`git reset -- <paths>` 隐式依赖 HEAD 存在；catch 兜底注释只考虑「已 gitignore 项目该命令是空操作」，未考虑空仓库）。
- **触发链**：`git reset -- paths` 的默认 tree 源是 HEAD；unborn 分支无 HEAD → fatal → 吞错 → 暂存区保留 add -A 的全部内容 → commit 全量入库。

# 当前修复方案
- **核心改动**：reset 失败时回退 `git rm --cached -r --ignore-unmatch -- .writer exports`（纯索引操作，不需要 HEAD）——有 HEAD 仓库行为不变（reset 成功不触发回退）。新增 e2e 测试：临时目录 git init 不 commit + 预置 exports/.writer/正文 → archive_point → 断言提交树（ls-tree）不含 exports/ 与 .writer/、正文照常入档。
- **备选取舍**：不预检 HEAD 再选命令（多一次进程调用，收益相同）；不把 `.catch(() => {})` 改为响亮失败（未 gitignore 且无这些目录的项目 reset 是空操作失败，属合法路径，回退后仍静默符合「尽力排除」语义）。

# 需人工判断项
- 无

# 验证证据
- **验证基线**：53916889d7abb032f867e2b36b12510889e58eb1
- **执行环境**：Windows 11 / Node v24.15.0 / npm 11.12.1 / git（本机 PATH）；执行时 HEAD=b153253（轮次 39 与本候选两文件零交集；补丁在 53916889 独立 worktree 验证 `git apply --check` 通过）。
- **执行结果摘要**：`npm run typecheck` 退出码 0；`npm test` 退出码 0，287/287（基线 286 + 净增 1 例：零提交仓库首存档三断言，真实 git 子进程 e2e，约 1.3s）；tools.test.ts 11/11。
- **未覆盖风险**：`git rm --cached` 回退分支在有 HEAD 但 reset 因其他原因失败（如 index.lock 竞争）时的语义是「从索引移除已暂存项」，与 reset 等价，未单测该复合路径；CI（ubuntu）与本地 Windows 双平台 git 行为一致（均标准 git）。

# 审核记录

## 版本 1 (base: 53916889d7abb032f867e2b36b12510889e58eb1)
### 方案说明
unstage 命令加无 HEAD 回退 + 真实 git e2e 测试。文件导览：src/index.ts（archive_point unstage 段）、tests/tools.test.ts（archive 用例后新增一例，补 execFile/promisify 导入）。
### 验证结果
typecheck 0 错；全量 287/287；补丁在基线 worktree 干净应用。
### 人类总体意见
待审核
### 意见处理结果
无

## 版本 1 (base: 18c7dd3e09e93193de56de72692aef552ef8a2d9)

### 验证结果

<!-- ai-review:validation -->
### 门禁执行结果

- 工作目录: F:\workspace_2\writer-in-dsh · 基线: 564370a09bf3812af399062774946d5f41dde910 · 平台: win32 / node v24.21.0 · 执行时间: 2026-11-12T07:08:12.208Z

| 结果 | 命令 | 退出码 | 耗时 |
| --- | --- | --- | --- |
| 通过 | `npm run typecheck` | 0 | 12.2s |
| 通过 | `npm test` | 0 | 15.6s |
<!-- /ai-review:validation -->

### 人类总体意见

批准（cxs）
