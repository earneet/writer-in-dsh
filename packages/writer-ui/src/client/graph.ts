/**
 * buildEntityGraph：扫描结果 → 冻结实体图（纯函数，M1a）。
 *
 * - 宽容值在此 coerce 收敛（章号 "002"/中文数字/缺失回退文件名、planned_chapter/
 *   timeline chapter 数字→字符串），实体层不再出现 unknown；
 * - timeline 字段口径以 domain timeline.ts 权威 schema 收敛（{chapter,state} 双字符串，
 *   未知字段丢弃）；结构化校验复用 domain 纯函数 validateTimeline / parseMilestones
 *   （hash spike 实证：dsh-writer-domain 纯函数可打进 client bundle，见 build-client.mjs
 *   的 node:crypto 桩——contentHash 等依赖 node:crypto 的函数不可用，本模块不引用）；
 * - 脏值不静默吞：解析失败/校验错误计入 warnings（与 writer_stats 服务端口径一致）。
 */
import { parseMilestones, validateTimeline, type FrontmatterValue } from 'dsh-writer-domain'
import type {
  ChapterEntity, CharacterEntity, EntityGraph, EntityIndexes, OutlineEntity, OutlineNode,
  PlotEntity, RelationEdge, StyleRef, TimelineEvent,
} from './types.ts'
import { extractBodyRelations, splitSections, type ChapterSource, type CharacterSource, type NovelScan, type PlotSource } from './overview.ts'

// ---------------------------------------------------------------------------
// coerce 基元（宽容输入 → 冻结字段；graph 层私有，不外泄）
// ---------------------------------------------------------------------------

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

/**
 * 字符串或有限数字 → 字符串章锚（domain 章锚约定 = 三位序号；数字 3 与数字串 "3" 统一
 * 补零为 "003"，与 chapter id / timeline 章锚 "002" 同一约定，coerce 后直接满足 domain 校验）。
 */
function coerceChapterAnchor(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).padStart(3, '0')
  if (typeof value === 'string' && value.length > 0) {
    return /^\d+$/.test(value) ? value.padStart(3, '0') : value
  }
  return null
}

const CN_DIGITS: Readonly<Record<string, number>> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const CN_UNITS: Readonly<Record<string, number>> = { 十: 10, 百: 100, 千: 1000 }

/** 中文数字解析（一~九千九百九十九；"十二"/"一百零三" 等组合；**不支持位值串**如 "二零二五"；不匹配返回 null）。 */
function chineseNumber(text: string): number | null {
  if (!/^[零一二两三四五六七八九十百千]+$/.test(text)) return null
  let total = 0
  let current = 0
  for (const ch of text) {
    const digit = CN_DIGITS[ch]
    if (digit !== undefined) {
      current = digit
    } else {
      const unit = CN_UNITS[ch] ?? 0
      if (unit === 0) return null
      // "十"/"百" 前无数字按 1 计（"十二" = 12）
      total += (current === 0 ? 1 : current) * unit
      current = 0
    }
  }
  return total + current
}

/**
 * 章号宽容 coerce：数字 / 纯数字串（"002"→2）/ 中文数字（"十二"→12）；
 * 全部不可判定返回 null（排序时退化为文件名序，不毒化其余章节）。
 */
export function coerceChapterNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) return Number(value)
    return chineseNumber(value)
  }
  return null
}

/** 章号缺失时的回退锚：纯数字文件名 id（"007"→7）；非数字 id 返回 null。 */
function numberFromId(id: string): number | null {
  return /^\d+$/.test(id) ? Number(id) : null
}

function charCount(text: string): number {
  return text.replace(/\s/g, '').length
}

function preview(text: string, limit = 200): string {
  const flat = text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

// ---------------------------------------------------------------------------
// 实体构建
// ---------------------------------------------------------------------------

function buildChapter(source: ChapterSource): ChapterEntity {
  const fm = source.frontmatter
  const id = source.name.replace(/\.md$/, '')
  return {
    id,
    title: str(fm.title, source.name),
    volume: str(fm.volume, source.subdir ?? ''),
    number: coerceChapterNumber(fm.number) ?? numberFromId(id),
    status: str(fm.status, ''),
    storyline: str(fm.storyline, ''),
    chars: charCount(source.content),
    path: source.subdir !== undefined ? `chapters/${source.subdir}/${source.name}` : `chapters/${source.name}`,
    preview: preview(source.content),
  }
}

function buildPlot(source: PlotSource, warnings: string[]): PlotEntity {
  const fm = source.frontmatter
  const id = source.name.replace(/\.md$/, '')
  let milestones: PlotEntity['milestones'] = []
  try {
    milestones = parseMilestones(fm.milestones as FrontmatterValue | undefined)
  } catch (err) {
    warnings.push(`plot/${id}：milestones 解析失败（${String(err)}）`)
  }
  return {
    id,
    hint: str(fm.hint, source.name),
    status: str(fm.status, 'unknown'),
    type: str(fm.type, fm.status !== undefined ? 'foreshadow' : ''),
    plannedChapter: coerceChapterAnchor(fm.planned_chapter),
    plantedChapter: coerceChapterAnchor(fm.planted_chapter),
    resolvedChapter: coerceChapterAnchor(fm.resolved_chapter),
    milestones,
    preview: preview(source.content),
  }
}

/** 宽容解析「数组或 JSON 字符串数组」（timeline/milestones/relations 的存放形态；坏值计告警不抛错）。 */
function parseJsonishArray(value: unknown): { items: unknown[]; error: string | null } {
  if (Array.isArray(value)) return { items: value, error: null }
  if (typeof value === 'string' && value.length > 0) {
    try {
      const parsed: unknown = JSON.parse(value)
      if (Array.isArray(parsed)) return { items: parsed, error: null }
      return { items: [], error: 'timeline 不是 JSON 数组' }
    } catch (err) {
      return { items: [], error: `timeline JSON 解析失败：${String(err)}` }
    }
  }
  return { items: [], error: null }
}

/**
 * frontmatter timeline → 条目（domain schema 收敛：{chapter,state} 双字符串，未知字段丢弃；
 * 数字型 chapter coerce 为字符串；字符串裸条目不计——domain 权威 schema 只认对象条目）。
 */
function buildTimeline(raw: unknown, ownerId: string, warnings: string[]): TimelineEvent[] {
  const { items, error } = parseJsonishArray(raw)
  if (error !== null) {
    warnings.push(`characters/${ownerId}：${error}`)
    return []
  }
  const entries: TimelineEvent[] = []
  for (const item of items) {
    if (item === null || typeof item !== 'object') {
      warnings.push(`characters/${ownerId}：timeline 含非对象条目（${JSON.stringify(item)}），已丢弃`)
      continue
    }
    const record = item as Record<string, unknown>
    const chapter = coerceChapterAnchor(record.chapter)
    const state = str(record.state, '')
    if (chapter === null || state.length === 0) {
      warnings.push(`characters/${ownerId}：timeline 条目缺 chapter/state（${JSON.stringify(item)}），已丢弃`)
      continue
    }
    entries.push({ chapter, state })
  }
  // 结构化校验复用 domain 纯函数（章锚三位序号/同章重复/倒序等——与 writer_stats 同口径）
  for (const err of validateTimeline(entries)) warnings.push(`characters/${ownerId}：${err}`)
  return entries
}

/** frontmatter relations → 关系边（name/target + relation/desc 字段名宽容）。 */
function buildFrontmatterRelations(value: unknown, ownerId: string): RelationEdge[] {
  const { items } = parseJsonishArray(value)
  const edges: RelationEdge[] = []
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const name = str(record.name ?? record.target ?? record.with, '')
    if (name.length === 0) continue
    edges.push({ owner: ownerId, name, desc: str(record.relation ?? record.desc ?? record.description ?? record.note, '') })
  }
  return edges
}

function buildCharacter(source: CharacterSource, warnings: string[]): CharacterEntity {
  const fm = source.frontmatter
  const id = source.name.replace(/\.md$/, '')
  const timeline = buildTimeline(fm.timeline, id, warnings)
  // 关系：frontmatter 结构化优先，正文「## 关系」小节补充（按名字去重）
  const relations: RelationEdge[] = [...buildFrontmatterRelations(fm.relations, id)]
  for (const body of extractBodyRelations(source.content)) {
    if (!relations.some(r => r.name === body.name)) relations.push({ owner: id, name: body.name, desc: body.desc })
  }
  return {
    id,
    name: str(fm.name, id),
    role: str(fm.role, ''),
    arc: str(fm.arc, ''),
    timeline,
    relations,
    sections: splitSections(source.content),
  }
}

/** outline 正文小节 → 节点（`第 N 章` 小节带章号锚；卷/其他小节 chapterNumber=null）。 */
function buildOutlineNodes(content: string): OutlineNode[] {
  return splitSections(content).map(section => {
    const m = /^第\s*(\d+)\s*章/.exec(section.title)
    return { title: section.title, chapterNumber: m !== null ? Number(m[1]) : null, body: section.body }
  })
}

function buildOutline(scan: NovelScan): OutlineEntity | null {
  if (scan.outline === null) return null
  const fm = scan.outline.frontmatter
  const nodes = buildOutlineNodes(scan.outline.content)
  const synopsis = str(fm.synopsis, '')
  if (synopsis.length === 0 && nodes.length === 0) return null
  return {
    synopsis,
    volumes: typeof fm.volumes === 'number' && Number.isFinite(fm.volumes) ? fm.volumes : 0,
    chapterTarget: typeof fm.chapters === 'number' && Number.isFinite(fm.chapters) ? fm.chapters : 0,
    nodes,
  }
}

// ---------------------------------------------------------------------------
// 实体图组装（含双向索引）
// ---------------------------------------------------------------------------

/** 从扫描结果构建实体图（纯函数；脏值计入 warnings，绝不抛错）。 */
export function buildEntityGraph(scan: NovelScan): EntityGraph {
  const warnings: string[] = []

  // 章节：章号 coerce 排序（localeCompare numeric 兜底文件名序）
  const chapters = scan.chapters
    .map(buildChapter)
    .sort((a, b) => (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER)
      || a.id.localeCompare(b.id, undefined, { numeric: true }))
  const characters = scan.characters.map(c => buildCharacter(c, warnings))
  const plots = scan.plots.map(p => buildPlot(p, warnings))
  const outline = buildOutline(scan)

  // —— 索引：章号 ↔ 章节（跨卷同名章号冲突不静默：卷子目录布局下 chapters/卷二/001.md 与
  // chapters/卷一/001.md 同 number——索引取首者并计告警，与「脏值不静默吞」口径一致）——
  const chapterByNumber = new Map<number, ChapterEntity>()
  for (const chapter of chapters) {
    if (chapter.number === null) continue
    const existing = chapterByNumber.get(chapter.number)
    if (existing === undefined) chapterByNumber.set(chapter.number, chapter)
    else warnings.push(`${chapter.path}：章号 ${chapter.number} 与 ${existing.path} 冲突，章号索引取首者`)
  }

  // —— 索引：人物 ↔ 关系反查（边按「对方名字」与「对方名字解析出的实体 id」双键入索引）——
  const relationsByTarget = new Map<string, RelationEdge[]>()
  const addTarget = (key: string, edge: RelationEdge): void => {
    const normalized = key.trim()
    if (normalized.length === 0) return
    const list = relationsByTarget.get(normalized)
    if (list === undefined) relationsByTarget.set(normalized, [edge])
    else list.push(edge)
  }
  const idByName = new Map<string, string>()
  for (const character of characters) idByName.set(character.name.trim(), character.id)
  for (const character of characters) {
    for (const edge of character.relations) {
      addTarget(edge.name, edge)
      // 名字能解析到实体 id 时补 id 键（relations 写名字、其他实体引用 id 的两种形态都能反查）
      const targetId = idByName.get(edge.name.trim())
      if (targetId !== undefined) addTarget(targetId, edge)
    }
  }

  // —— 索引：大纲章号 ↔ 节点 ——
  const outlineByChapterNumber = new Map<number, OutlineNode>()
  if (outline !== null) {
    for (const node of outline.nodes) {
      if (node.chapterNumber !== null && !outlineByChapterNumber.has(node.chapterNumber)) {
        outlineByChapterNumber.set(node.chapterNumber, node)
      }
    }
  }

  // —— 索引：伏笔 ↔ 种植/回收章 ——
  const plotsByChapter = new Map<number, { planted: PlotEntity[]; resolved: PlotEntity[] }>()
  const anchorOf = (anchor: string | null): number | null => {
    if (anchor === null) return null
    const n = Number(anchor)
    return Number.isFinite(n) ? n : null
  }
  for (const plot of plots) {
    const plantedAt = anchorOf(plot.plantedChapter) ?? anchorOf(plot.plannedChapter)
    const resolvedAt = anchorOf(plot.resolvedChapter)
    if (plantedAt !== null) {
      const slot = plotsByChapter.get(plantedAt) ?? { planted: [], resolved: [] }
      slot.planted.push(plot)
      plotsByChapter.set(plantedAt, slot)
    }
    if (resolvedAt !== null) {
      const slot = plotsByChapter.get(resolvedAt) ?? { planted: [], resolved: [] }
      slot.resolved.push(plot)
      plotsByChapter.set(resolvedAt, slot)
    }
  }

  const indexes: EntityIndexes = { relationsByTarget, chapterByNumber, outlineByChapterNumber, plotsByChapter }

  return {
    chapters,
    characters,
    plots,
    worldEntries: (scan.worldbuildingNames ?? []).map(name => ({ id: name.replace(/\.md$/, '') })),
    ideas: scan.ideas !== undefined ? { id: 'idea', sections: splitSections(scan.ideas.content) } : null,
    principles: scan.principles !== undefined ? { id: 'principles', sections: splitSections(scan.principles.content) } : null,
    events: scan.events !== undefined ? { id: 'event', sections: splitSections(scan.events.content) } : null,
    styleRefs: (scan.style ?? []).map(s => ({ id: s.name.replace(/\.md$/, ''), sections: splitSections(s.content) }) satisfies StyleRef),
    outline,
    indexes,
    warnings,
  }
}
