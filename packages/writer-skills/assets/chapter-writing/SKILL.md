---
name: chapter-writing
description: "章节写作规范：write_chapter 三模式（full 整章 / assist 续写 / rewrite 补丁协议改写）的选择与上下文纪律——防剧透、伏笔指令格式、read-before-update、审稿先行。用户要求写一章、续写、改写章节时使用。"
whenToUse: "调用 write_chapter / review_chapter 工具进行章节生成、续写、改写、审稿时。"
---

# 章节写作规范（chapter-writing）

## 模式选择

| 场景 | 模式 | 说明 |
|---|---|---|
| 写全新一章 | `write_chapter(mode="full")` | 引擎自动组装上下文（准则全量 + 本章大纲 + 前一章原文 + 人物摘要 + 伏笔指令）；可传 `title` 建新章 |
| 从结尾继续写 | `write_chapter(mode="assist")` | 轻上下文续写，追加到现有正文尾部，不改已有句子 |
| 改动选中的正文 | `write_chapter(mode="rewrite", instruction=..., request_id=...)` | 整组补丁必须在原选区内逐字定位且互不重叠，任何一条失败都保留原稿 |
| 整章改稿 | `write_chapter(mode="rewrite", instruction=..., request_id=...)` | 作者在工作台发起整章改稿并批准工具请求后执行；全文路径附带丢句告警 |

- 章节 id 是三位序号（`"002"`）。assist/rewrite 要求章节已存在；新章只能用 full。
- rewrite 必须给 `instruction` 和作者登记的 `request_id`。局部改稿请让作者在工作台从当前正文选择唯一原文。

## 写作前准备

引擎组装上下文时会全量注入准则、本章大纲、前文与伏笔指令——**默认信任引擎组装**，不必逐个全文 read（省上下文）。需要模型亲自做的只有：

1. `writer_read(entity="plot")` 盘点伏笔——把本章 🔴 必须设置/回收的项写进 `instruction`（与引擎自动注入的伏笔指令分节并列生效）。
2. 需要特殊风格时读对应 `style` 实体并在 `instruction` 引用。

## 防剧透纪律

- 上下文只注入**已写章节**（序号小于本章）；未来章节的大纲情节、事件、伏笔回收方式不得出现在正文或提示里。
- `events.md` 的章节事件使用 `## 第 N 章` 标题（允许零填充和空格），子标题继承该章；引擎保留本章及更早事件。首个章标题前只放全局已确认事实，未来事件必须放在对应章标题下。
- 悬念信息按「当前视角人物所知」过滤：读者与角色不知道的事，正文不能泄露。

## 伏笔指令格式

在 `instruction` 中可用如下格式声明本章伏笔动作。**引擎从 plots 档案自动注入的「伏笔指令」是权威**（写前用 `writer_read(entity="plot")` 核对档案，保证档案数据正确）；手工块只是给引擎的补充强调，两处不一致时以档案为准并修正手工块：

```
【本章伏笔】
- 必须设置：green-flame（第 2 章，绿焰与残页的关联首次露头）
- 必须回收：old-map（残页谜底在本章揭开）
- 活跃注意：keep-tone（已有伏笔，只可强化不可矛盾）
```

写完章节后，用 `foreshadow_update` 把状态机推进到实际发生的结果（见 foreshadow-guide 技能）。

## 工作流（一轮一章）

```
writer_read(entity="plot") 盘点伏笔
  → write_chapter(full)
  → review_chapter（3+1 维审稿：情节/人物/设定一致性 + 文学质量）
  → 有 high 建议则请作者确认修改范围并登记改稿请求，再按建议执行
  → foreshadow_update / timeline_update / writer_update 推进伏笔、人物状态时间线与事件（每条独立一轮，维护必须发生在审稿之后）
  → 章后维护清单（见下节）
```

- **审稿先行**：维护类更新（伏笔状态、事件、人物状态）必须发生在 `review_chapter` 之后、基于审过稿的正文，禁止与 write 同轮。
- rewrite 结果里的「丢句守卫告警」是疑似蒸发的重要原句：逐条判断是否为有意删除，无意丢失就再 rewrite 补回。
- 选区改稿被拒绝时，向作者说明原稿已保留，请作者核对后重新选定范围，或明确发起整章改稿。整章补丁的「跳过」条目（not-found / ambiguous）说明相应锚点未能唯一命中。

## 章后维护清单

write_chapter 保存后引擎会**异步**跑维护 pass（摘要 + 事实/伏笔/人物状态抽取），建议项稍后追加到 `pending.md`。完整闭环：

1. **读 pending.md**（项目根的 `pending.md`，用宿主文件读取工具；它不是 writer 实体）：本章建议节含伏笔事件与人物状态升级建议（附可直接提交的 JSON）。
2. **确认落实**：人物状态建议用 `timeline_update` 升格到权威时间线；伏笔建议用 `foreshadow_update`；不同意的留在清单或口头说明作废。
3. **归档清理**：该章建议全部处理后 `pending_cleanup(chapter)` 归档清空。
4. **收尾排空**：任务结束前 `maintenance_flush()` 等待本项目的完整维护任务和版本补跑收敛；停止等待不取消共享后台维护，headless 进程退出仍会截断未完成任务。
5. **存档点**：重要节点（一卷写完、大改后）用 `archive_point(message)` 建 git 存档点。

改稿后（write_chapter rewrite 或作者手工编辑章节）：`recompute_derived(chapter_range)` 重算下游派生。跨章矛盾怀疑时用 `consistency_check(scope?)` 全书检查。查证设定细节用 `writer_search(query, chapter_limit=当前章号)`。

## 保存纪律

- write_chapter 由引擎负责保存（内部走乐观锁），你不需要手工 writer_update 章节。
- 手工微调章节（改错别字等）仍走 `writer_update`：先 `writer_read` 取完整 hash，再填 `expectHash`。
