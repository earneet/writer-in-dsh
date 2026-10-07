---
name: foreshadow-guide
description: "伏笔追踪指南：状态机语义（planned→planted→resolved/abandoned）、milestones 四类中间事件、foreshadow_update 工具用法与写作时的伏笔纪律。用户要求设置/回收/追踪伏笔、检查伏笔完整性时使用。"
whenToUse: "操作 plots/ 伏笔实体、调用 foreshadow_update、章节写后推进伏笔状态时。"
---

# 伏笔追踪指南（foreshadow-guide）

## 状态机（一条记录跟踪全程）

```
planned ──plant──→ planted ──resolve──→ resolved
   │                   │
   └──────abandon──────┴──→ abandoned（明确放弃，留档）
```

- 状态落在伏笔实体 frontmatter：`status` / `planned_chapter` / `planted_chapter` / `resolved_chapter` / `hint` / `milestones`（JSON 数组）。
- 迁移只能沿箭头方向（`foreshadow_update` 会拒绝非法迁移并报错）；`resolved`/`abandoned` 是终态。
- 已 planted 的伏笔不可删除，只能 abandon（保留叙事痕迹）。

## milestones 四类中间事件

| 类型 | 语义 | 示例 |
|---|---|---|
| `reinforcement` | 强化：再次提醒读者伏笔存在 | 绿焰在后续章节再次出现 |
| `partial_reveal` | 部分揭示：给出线索但不揭底 | 残页显示一半内容 |
| `callback` | 回收呼应：正文回扣已设伏笔 | 揭示绿焰与地底之物的关联 |
| `red_herring` | 烟雾弹：有意误导（最终要向读者交代） | 假嫌疑人线索 |

milestone 只记节点不改状态；状态推进（plant/resolve）与节点记录（milestone）是两类动作。

## 工具用法

```
foreshadow_update(id, action="plant",    chapter="003", expectHash=<read 的完整 hash>)
foreshadow_update(id, action="resolve",  chapter="007", expectHash=...)
foreshadow_update(id, action="abandon",  expectHash=...)
foreshadow_update(id, action="milestone", chapter="005", milestone_type="partial_reveal",
                  milestone_note="残页只揭了一半", expectHash=...)
```

- **read-before-update**：动手前 `writer_read(entity="plot", id=...)` 取完整 hash；hash 不符说明过期，重读。
- 一次只推进一条伏笔；改完回报新状态与 hash。

## 写作时的伏笔纪律

1. **写前**：`writer_read(entity="plot")` 盘点——`planned_chapter` 等于本章的是 🔴 必须设置项；`planned` 且 `planned_chapter` 已过的是 🔴 已逾期项（同样必须**设置**——状态机禁止 planned 直接 resolve，只能先 planted）；planted 的是 🟡 活跃项（只可强化不可矛盾）。把结论写进 `write_chapter` 的 `instruction`（格式见 chapter-writing 技能）。
2. **写后**：按正文实际发生的内容用 `foreshadow_update` 推进状态、补 milestone——正文没写到的不要凭大纲「预支」推进。
3. **完整性自查**：被问「伏笔还有哪些没收」时——列出所有 `planted`（悬置中）与 `planned`（未设）项及其 `planned_chapter`；`planned_chapter` 已过的项标记「逾期」（逾期指未设置，不是未回收）。resolved/abandoned 只在核对历史时提及。
4. 新伏笔来自灵感消化（ideas → plots 单向流）：创建用 `writer_update(entity="plot", expectHash="new")`，frontmatter 至少含 `status: planned` 与 `planned_chapter`。
