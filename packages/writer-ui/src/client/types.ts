/**
 * 实体模型接口冻结（roadmap §4.1 M1a）。
 *
 * 面向 M1b 数据总线 / M2 右栏工作台的**冻结接口**：字段口径以 domain 权威 schema
 * 收敛（timeline → dsh-writer-domain/timeline.ts 的 {chapter,state} 双字符串；
 * milestones → parseMilestones 的 {type,chapter,note?}），扫描宽容值（数字型章号、
 * JSON 字符串形态）在 buildEntityGraph 内 coerce，实体层不再出现 unknown。
 * 面板（overview.ts 视图模型）本里程碑零改动——本文件只新增、不迁移。
 * M1b 换源起本文件同时是**视图模型类型的家**（roadmap M1a 留痕的 SectionEntry 迁移
 * 兑现：视图类型自 overview.ts 迁入，overview/project/Panel 反向引用本文件）。
 */

/** 人物正文小节（## 标题切分）。 */
export interface SectionEntry {
  title: string
  body: string
}

/** 人物关系条目（frontmatter relations 或正文「## 关系」小节解析）。 */
export interface RelationEntry {
  name: string
  desc: string
}

/** 伏笔中间事件（domain ForeshadowMilestone 的 UI 冻结形态）。 */
export interface PlotMilestone {
  type: 'reinforcement' | 'partial_reveal' | 'callback' | 'red_herring'
  chapter: string
  note?: string
}

/** 人物状态时间线条目（domain CharacterTimelineEntry 同 schema：chapter/state 双字符串）。 */
export interface TimelineEvent {
  chapter: string
  state: string
}

/** 一条人物关系边（owner = 声明该关系的人物，name = 对方名字）。 */
export interface RelationEdge {
  owner: string
  name: string
  desc: string
}

/** 章节实体（章号 coerce：数字 / "002" / 中文数字 / 缺失回退数字文件名，均失败为 null）。 */
export interface ChapterEntity {
  id: string
  title: string
  /** 卷名：frontmatter.volume 优先，缺失回退一层卷子目录名，再缺为空串。 */
  volume: string
  /** coerce 后的章号（排序/索引键；不可判定为 null）。 */
  number: number | null
  status: string
  storyline: string
  chars: number
  /** 相对项目根的 POSIX 路径（含卷子目录前缀；顶层章为 chapters/<id>.md）。 */
  path: string
  preview: string
}

/** 伏笔/情节实体（字段级纳入 milestones + planted/resolved_chapter）。 */
export interface PlotEntity {
  id: string
  hint: string
  type: string
  status: string
  /** coerce 为字符串的章锚（"066" / 66 → "66"）；缺失为 null。 */
  plannedChapter: string | null
  plantedChapter: string | null
  resolvedChapter: string | null
  milestones: PlotMilestone[]
  preview: string
}

/** 人物实体。 */
export interface CharacterEntity {
  id: string
  name: string
  role: string
  arc: string
  timeline: TimelineEvent[]
  relations: RelationEdge[]
  sections: SectionEntry[]
}

/** 世界观条目（M1a 仅扫描 id 清单；全文读取随 M1b 总线落地）。 */
export interface WorldEntry {
  id: string
}

/** 灵感碎片（单文件实体 ideas.md；原文不可覆盖——「原文」语义在 M2 设定库呈现）。 */
export interface IdeaSource {
  id: 'idea'
  sections: SectionEntry[]
}

/** 创作准则（单文件实体 principles.md；写作时全量注入的红线/基调）。 */
export interface PrincipleSource {
  id: 'principles'
  sections: SectionEntry[]
}

/** 重要事件（单文件实体 events.md，全书事件视角的权威 SoT）。 */
export interface KeyEventSource {
  id: 'event'
  sections: SectionEntry[]
}

/** 风格示范（style/ 目录条目；语感腔调 few-shot）。 */
export interface StyleRef {
  id: string
  sections: SectionEntry[]
}

/** 大纲节点（outline.md 的 `##+` 小节；章节小节携带章号锚）。 */
export interface OutlineNode {
  title: string
  /** `第 N 章` 小节解析出的章号（卷/其他小节为 null）。 */
  chapterNumber: number | null
  body: string
}

/** 大纲实体（outline.md 整体：frontmatter 概要 + 节点清单）。 */
export interface OutlineEntity {
  synopsis: string
  volumes: number
  chapterTarget: number
  nodes: OutlineNode[]
}

/**
 * 双向索引（roadmap §4.1：人物↔关系反查、章节↔大纲章号、伏笔↔种植/回收章）。
 * 全部 Map 结构，键缺省时查空（get 返回 undefined），调用方零防御。
 */
export interface EntityIndexes {
  /** 人物名字或 id → 指向该人物的关系边（反查「谁声明与我有关系」）。 */
  relationsByTarget: Map<string, RelationEdge[]>
  /** 章号 → 章节实体（chapter.number 非 null 者入索引；不可判定章号不入）。 */
  chapterByNumber: Map<number, ChapterEntity>
  /** 章号 → 大纲对应小节节点（章节↔大纲联动）。 */
  outlineByChapterNumber: Map<number, OutlineNode>
  /** 章号 → 该章种植/回收的伏笔（伏笔↔种植/回收章双向）。 */
  plotsByChapter: Map<number, { planted: PlotEntity[]; resolved: PlotEntity[] }>
}

/** 实体图（buildEntityGraph 产物；M1b 总线与 M2 视图的数据基座）。 */
export interface EntityGraph {
  chapters: ChapterEntity[]
  characters: CharacterEntity[]
  plots: PlotEntity[]
  worldEntries: WorldEntry[]
  ideas: IdeaSource | null
  principles: PrincipleSource | null
  events: KeyEventSource | null
  styleRefs: StyleRef[]
  outline: OutlineEntity | null
  indexes: EntityIndexes
  /** 宽容解析/脏值告警（坏 JSON、章锚非法、倒序等——双侧口径一致，不静默吞）。 */
  warnings: string[]
}

/** 分页参数位（M1b `store.getEntities(kind, {cursor})` 的接口占位，兑现 §4.2 性能行）。 */
export interface PageParams {
  /** 上一页返回的 nextCursor；缺省从头开始。 */
  cursor?: string
  /** 页大小（实现可钳制上限；缺省取全量）。 */
  limit?: number
}

/** 分页结果。 */
export interface Page<T> {
  items: T[]
  /** 还有下一页时为下一页首项 id；取尽为 null。 */
  nextCursor: string | null
}

// ---------------------------------------------------------------------------
// 视图模型行类型（M1b 自 overview.ts 迁入；视图语义注释见原定义处与 project.ts）
// ---------------------------------------------------------------------------

/** 章节行（章节页签 + 概况最近章节；preview 为展开预览文本）。 */
export interface ChapterRow {
  id: string
  title: string
  volume: string
  chars: number
  status: string
  storyline: string
  preview: string
}

/**
 * 伏笔行（伏笔页签；preview 为展开预览文本）。
 * 决策面字段：risk 三色档（red=planted 超期未回收/yellow=停滞或无锚活跃/gray=planned
 * 未种植/none=已收束或新鲜）、overdue 逾期标记、dueDelta 计划章与当前章差值。
 */
export interface PlotRow {
  id: string
  hint: string
  status: string
  type: string
  plannedChapter: string
  preview: string
  risk: 'red' | 'yellow' | 'gray' | 'none'
  overdue: boolean
  dueDelta: number | null
}

/** 人物行（人物页签；展开详情 = 正文小节 + 时间线 + 关系）。 */
export interface CharacterRow {
  id: string
  name: string
  role: string
  arc: string
  timelineCount: number
  relationCount: number
  timeline: TimelineEvent[]
  relations: RelationEntry[]
  sections: SectionEntry[]
}

/** 大纲视图模型（大纲页签）。 */
export interface OutlineOverview {
  synopsis: string
  volumes: number
  chapterTarget: number
  sections: SectionEntry[]
}

/** 待办分节（pending.md 的 `## ` 标题 + 该节列表行）。 */
export interface PendingSection {
  heading: string
  lines: string[]
}

/** 下一步情境卡（概况页决策面；计算见 project.ts nextStepOf）。 */
export interface NextStep {
  kind: 'outline' | 'first-chapter' | 'maintain' | 'next-chapter'
  title: string
  hint: string
}

/** 冷启动总览视图模型（M1b 起由 project.ts 从实体图投影）。 */
export interface NovelOverview {
  title: string
  genre: string
  targetWords: number
  chapterTarget: number
  chapters: number
  totalChars: number
  progress: number | null // 完成率（0-1，无目标时 null）
  volumes: Array<{ name: string; count: number }>
  foreshadow: Array<{ status: string; count: number }>
  outline: OutlineOverview | null
  recentChapters: ChapterRow[]
  chapterRows: ChapterRow[]
  plotRows: PlotRow[]
  characterRows: CharacterRow[]
  worldbuildingCount: number
  /** 待办分节（倒序：最新维护 pass 在前；跨 pass 建议已去重、[x] 已过滤）。 */
  pendingSections: PendingSection[]
  /** 去重后的待办总行数（面板截断提示用）。 */
  pendingLineTotal: number
  /** 伏笔三色汇总（红=超期未回收/黄=停滞或活跃/灰=未种植）。 */
  riskSummary: { red: number; yellow: number; gray: number }
  /** 当前章（全部章节最大章号；无章 null）。 */
  currentChapter: number | null
  /** 待维护 pass 章节清单（维护徽章数据源）。 */
  staleChapters: string[]
  /** 单文件读取失败清单（部分失败提示条）。 */
  failedFiles: string[]
  /** 归档分节（.writer/pending-archive.md，倒序）。 */
  pendingArchive: PendingSection[]
  /** 下一步情境卡。 */
  nextStep: NextStep
}

/**
 * 按 id 稳定序分页（cursor = 首项 id；limit 缺省/非正数取全量）。
 * cursor 未命中（过期/非法）返回空页——与「缺省从头开始」语义可区分，防消费方循环重放首页。
 */
export function paginate<T extends { id: string }>(items: readonly T[], params: PageParams): Page<T> {
  const limit = typeof params.limit === 'number' && Number.isInteger(params.limit) && params.limit > 0 ? params.limit : items.length
  const start = params.cursor === undefined ? 0 : items.findIndex((item) => item.id === params.cursor)
  if (start < 0) return { items: [], nextCursor: null }
  const page = items.slice(start, start + limit)
  const next = start + limit < items.length ? items[start + limit] ?? null : null
  return { items: page, nextCursor: next !== null ? next.id : null }
}
