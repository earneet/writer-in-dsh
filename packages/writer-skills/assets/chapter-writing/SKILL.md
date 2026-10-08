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
| 按指令改稿 | `write_chapter(mode="rewrite", instruction=...)` | 补丁协议优先：小改零触碰未提及内容；大改自动回退全文并跑丢句守卫 |

- 章节 id 是三位序号（`"002"`）。assist/rewrite 要求章节已存在；新章只能用 full。
- rewrite 必须给 `instruction`（改什么、往哪个方向改）；只改局部时可传 `selection`（选区原文）限定范围。

## 写作前必读

1. `writer_read(entity="principles", id="principles")` — 准则是最高约束（引擎也会全量注入，但你应知道红线是什么）。
2. `writer_read(entity="outline", id="outline")` 找到本章大纲 — 本章的结构契约，逐条落实。
3. `writer_read(entity="plot")` 列出伏笔 — 本章 🔴 必须设置/回收的项写进 `instruction`，让引擎注入伏笔指令。

## 防剧透纪律

- 上下文只注入**已写章节**（序号小于本章）；未来章节的大纲情节、事件、伏笔回收方式不得出现在正文或提示里。
- 悬念信息按「当前视角人物所知」过滤：读者与角色不知道的事，正文不能泄露。

## 伏笔指令格式

在 `instruction` 中用如下格式声明本章伏笔动作。该块会原文注入写作提示词，与引擎从伏笔档案自动注入的「伏笔指令」分节并列生效（写前先用 `writer_read(entity="plot")` 核对档案，两处不要矛盾）：

```
【本章伏笔】
- 必须设置：green-flame（第 2 章，绿焰与残页的关联首次露头）
- 必须回收：old-map（残页谜底在本章揭开）
- 活跃注意：keep-tone（已有伏笔，只可强化不可矛盾）
```

写完章节后，用 `foreshadow_update` 把状态机推进到实际发生的结果（见 foreshadow-guide 技能）。

## 工作流（一轮一章）

```
writer_read 准则/大纲/伏笔
  → write_chapter(full)
  → review_chapter（3+1 维审稿：情节/人物/设定一致性 + 文学质量）
  → 有 high 建议则 write_chapter(rewrite, instruction=按建议改)
  → foreshadow_update / timeline_update / writer_update 推进伏笔、人物状态时间线与事件（每条独立一轮，维护必须发生在审稿之后）
```

- **审稿先行**：维护类更新（伏笔状态、事件、人物状态）必须发生在 `review_chapter` 之后、基于审过稿的正文，禁止与 write 同轮。
- rewrite 结果里的「丢句守卫告警」是疑似蒸发的重要原句：逐条判断是否为有意删除，无意丢失就再 rewrite 补回。
- 补丁协议「跳过」条目（not-found / ambiguous）说明模型给的锚点没唯一命中：核对原文片段后重试一次，或改为全文大改。

## 保存纪律

- write_chapter 由引擎负责保存（内部走乐观锁），你不需要手工 writer_update 章节。
- 手工微调章节（改错别字等）仍走 `writer_update`：先 `writer_read` 取完整 hash，再填 `expectHash`。
