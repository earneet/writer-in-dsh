---
schema_version: 1
title: 'writer-domain: 删除零引用的 mergeExtractionSections/ExtractedSectionEntries 死导出'
module: writer-domain
audit_type: delete
created_at: '2026-11-12T10:41:00+08:00'
updated_at: '2026-11-12T09:55:00.001Z'
owner: cxs
tags:
  - domain
  - dead-code
  - maintenance
ticket: null
status: approved
target_files:
  - packages/writer-domain/src/maintenance.ts
current_revision: 2
revisions:
  - id: 1
    base_revision: 38855c6393d2dd1e3ddb6d1fa418c244490099e7
    patch: 001.patch
    author: ai
  - id: 2
    base_revision: 38855c6393d2dd1e3ddb6d1fa418c244490099e7
    patch: 002.patch
    author: ai
gate_checks:
  - npm run typecheck
  - npm test
comments:
  - id: cmwdcufv317n3
    revision: 1
    file: ''
    line: 0
    author: cxs
    content: 再次复核该问题，确保待删除的代码确实无引用
    status: resolved
    created_at: '2026-11-12T09:38:00.783Z'
human_decisions: []
approval:
  approved_by: cxs
  approved_at: '2026-11-12T09:43:57.511Z'
  gate_checks:
    - npm run typecheck
    - npm test
  gate_results:
    - command: npm run typecheck
      exit_code: 0
      duration_ms: 12396
    - command: npm test
      exit_code: 0
      duration_ms: 15169
  confirmed_decisions: []
  waived_decisions: []
rejection: null
commit_message: 'writer-domain: 删除零引用的 mergeExtractionSections/ExtractedSectionEntries 死导出'
---

# 问题与影响
- **触发条件与现象**：死代码（非运行时缺陷）——`mergeExtractionSections` 及其入参类型 `ExtractedSectionEntries` 自 P3 初版导出以来全仓零引用；engine 的按节重试在 `writer-engine/src/index.ts` 内联实现，从未调用该函数。
- **影响范围**：仅 writer-domain 导出面与文档可读性；无运行时、存储或端侧影响。

# 根因
- **代码位置**：`packages/writer-domain/src/maintenance.ts`（基线 38855c 的第 182-196 行）。
- **触发链**：P3 初版规划的节合并 API 在 engine 实现时被内联取代，导出与模块头注释（“按节重试的合并”）未同步清理，形成宣称职责与实现不符的误导性 API。

# 当前修复方案
- **核心改动**：删除 `mergeExtractionSections` 函数与 `ExtractedSectionEntries` 联合类型（共 15 行）；同步修正模块头注释中残留的“按节重试的合并”表述，避免删函数后仍有失真的职责说明。`ExtractionSectionName` / `ExtractedFact` / `ExtractedForeshadowEvent` / `ExtractedCharacterState` 全部保留（engine 与测试真实消费）。
- **复核结论（回应 c1）**：全仓（packages 全部 src/tests、skills 资产、dev.cordis.yml、cordis.patch.yml、docs）检索两个符号，除 `docs/implementation-plan.md` 轮次 8 的历史记录外零命中；`index.ts` 为 `export *` 桶导出，无其他显式再导出；`maintenance.test.ts` 仅导入 `parseMaintenanceExtraction` / `validateExtractionSections`；`writer-engine` 仅消费保留的 `ExtractionSectionName`。
- **备选取舍**：不复活契约函数替代 engine 内联（内联已由缺节守卫修复并有集成测试锁定，替换属无收益重排）；不新增“导出不存在”静态测试（删除行为由 typecheck 与桶导出面天然覆盖，新增测试反而扩大补丁面）。

# 需人工判断项
- **包公共 API 面**：dsh-writer-domain 是可独立引用的纯函数域库（尚未发布 npm），导出面理论上可被外部消费者使用——本候选按“零引用 + 文档职责为假 + 契约语义已被内联实现取代”判定为死代码；若认为域库应保留通用节合并工具函数，请否决。
- **门禁未执行**：本轮运行环境的 DSH 沙箱授权失败（`SetNamedSecurityInfoW failed (Win32 5): grantWrite(F:\workspace_2\writer-in-dsh)`），`npm run typecheck`、`npm test` 与补丁 `git apply --check` 均未能实际执行；合并前必须在可执行环境补跑，不得以本轮记录当作通过证据。

# 验证证据
- **验证基线**：`38855c6393d2dd1e3ddb6d1fa418c244490099e7`
- **执行环境**：Windows 11；工作区 HEAD 为 `90645f9`（审核意见元数据提交），`packages/writer-domain/src/maintenance.ts` 与基线无其他改动交集；本轮 shell 无法启动，npm/node 未实际执行。
- **执行结果摘要**：
  - `npm run typecheck`：**未执行**（沙箱授权失败，命令未能启动）。
  - `npm test`：**未执行**（同上）。
  - 静态复核：两个待删符号全仓 grep 仅命中 `docs/implementation-plan.md` 的历史记录；测试导入面、桶导出面、engine 消费面均确认不涉及被删符号。
- **未覆盖风险**：门禁与补丁可应用性未经机器验证；新增的模块头注释改动虽为注释级，仍需 typecheck 最终确认。删除本身为零运行时面改动。

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

## 版本 2 (base: 38855c6393d2dd1e3ddb6d1fa418c244490099e7)
### 相对上一版的变化
- **基线变化**：保持 `38855c6393d2dd1e3ddb6d1fa418c244490099e7` 不变；工作区 HEAD `90645f9` 仅为审核意见元数据提交，业务文件与基线一致。
- **基线说明**：版本 1 记录中的验证基线 `53916889` 与 frontmatter 的 `38855c` 在 `maintenance.ts` 上内容相同（其间该文件无改动），本版统一按 `38855c` 记录。
- **代码与方案调整**：针对 c1 重做全仓引用复核，确认两个符号零引用；删除本体与 001 一致，另补一处模块头注释勘误（删去“按节重试的合并”），属注释级改动，无行为变化。
- **补丁**：`002.patch` 为相对 38855c 的全量 diff（含 001 的删除与本次注释勘误），不含 `.ai-review/` 变更。
### 方案说明
最终形态：maintenance.ts 不再导出 `mergeExtractionSections` 与 `ExtractedSectionEntries`，模块头只描述真实职责（解析 + 分节校验）；按节重试的编排仍由 writer-engine 内联实现。
### 验证结果
`npm run typecheck` / `npm test` 因 DSH 沙箱授权失败未能执行，详见「验证证据」；已完成符号级静态复核。合并前需补跑门禁。
### 意见处理结果
- **c1（再次复核待删代码确实无引用）**：已处理并标记 `resolved`。复核范围与结论见「当前修复方案」；未发现任何源码、测试、配置或技能资产引用这两个导出。

## 版本 2 (base: 38855c6393d2dd1e3ddb6d1fa418c244490099e7)

### 验证结果

<!-- ai-review:validation -->
### 门禁执行结果

- 工作目录: F:\workspace_2\writer-in-dsh · 基线: 2dec9f765c42eb0bc93411f62f3cf6db62ab86c7 · 平台: win32 / node v24.21.0 · 执行时间: 2026-11-12T09:43:54.394Z

| 结果 | 命令 | 退出码 | 耗时 |
| --- | --- | --- | --- |
| 通过 | `npm run typecheck` | 0 | 12.4s |
| 通过 | `npm test` | 0 | 15.2s |
<!-- /ai-review:validation -->

### 人类总体意见

批准（cxs）
