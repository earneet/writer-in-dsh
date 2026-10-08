/**
 * 人物状态时间线的纯函数（P5：轮次 8 限制⑥结构化升格）。
 * character 实体 frontmatter 的 `timeline` 字段 = `[{chapter, state}]` JSON 内联——
 * 随章节维护的显式结构化派生数据（写入人物卡即人确认），兼作弧线追踪与矛盾检测载体。
 * 与派生缓存 characterStates 的分工：timeline 是**人确认后的权威**（frontmatter SoT），
 * characterStates 是维护 pass 的**建议**（.writer/derived/ 缓存，经 pending.md 提示升格到 timeline）。
 * 全部纯函数可独立单测。@module dsh-writer-domain/timeline
 */
import type { FrontmatterValue, WriterEntity } from './index.ts'

/** 一条人物状态时间线条目：chapter = 三位序号章节锚，state = 该章章末状态描述。 */
export interface CharacterTimelineEntry {
  chapter: string
  state: string
}

/** 章节锚格式：三位序号（与 chapter 实体 id 同一约定）。 */
const CHAPTER_ID_RE = /^\d{3}$/

/**
 * 解析 character frontmatter 的 timeline 字段（JSON 内联字符串，与 milestones 同形态）。
 * 缺失/空串返回空数组；JSON 非法或形状不符抛错（响亮失败——timeline 是人确认的权威数据，静默吞错会毒化弧线）。
 * 条目顺序保持落盘顺序（单调性校验由 validateTimeline / inspectTimelines 负责，解析不重排）。
 * 条目上未知字段（state/chapter 之外）静默丢弃（serialize 往返以这两个字段为准，不透传扩展键）。
 */
export function parseTimeline(raw: FrontmatterValue | undefined): CharacterTimelineEntry[] {
  if (raw === undefined || raw === '') return []
  if (typeof raw !== 'string') throw new Error(`timeline 必须是 JSON 字符串：${String(raw)}`)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`timeline JSON 解析失败：${String(err)}`)
  }
  if (!Array.isArray(parsed)) throw new Error('timeline 必须是 JSON 数组')
  return parsed.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) throw new Error(`timeline[${i}] 非对象`)
    const { chapter, state } = entry as Record<string, unknown>
    if (typeof chapter !== 'string') throw new Error(`timeline[${i}] 缺少 chapter 字符串字段`)
    if (typeof state !== 'string') throw new Error(`timeline[${i}] 缺少 state 字符串字段`)
    return { chapter, state }
  })
}

/**
 * 时间线追加/更新（幂等于章节锚）：同章条目替换（重写该章状态），否则按章号升序插入。
 * 入参先整体校验（章锚格式 + state 非空 + 现有条目单调），保证产物满足全部领域约束。
 * 改稿场景：对早期章节改写后 appendTimelineEntry 同章覆盖即可刷新弧线，无需人工重排。
 */
export function appendTimelineEntry(existing: readonly CharacterTimelineEntry[], entry: CharacterTimelineEntry): CharacterTimelineEntry[] {
  const errors = validateTimeline(existing)
  if (errors.length > 0) throw new Error(`现有 timeline 非法，拒绝追加：${errors.join('；')}`)
  const state = entry.state.trim()
  if (!CHAPTER_ID_RE.test(entry.chapter)) {
    throw new Error(`timeline 章节锚非法：${JSON.stringify(entry.chapter)}（须为三位序号，如 "002"）`)
  }
  if (state.length === 0) throw new Error('timeline state 不能为空')
  const next = existing.filter((e) => e.chapter !== entry.chapter)
  const at = next.findIndex((e) => e.chapter > entry.chapter)
  const item = { chapter: entry.chapter, state }
  if (at < 0) next.push(item)
  else next.splice(at, 0, item)
  return next
}

/**
 * 时间线领域校验（不抛错的查询形态，供展示/检查路径使用）：
 * ① chapter 必须是三位序号；② state 去空白后非空；③ 章序单调不减；
 * ④ 同章不重复（append 同章覆盖语义隐含每章唯一，手写重复必须暴露而非静默双计）。
 * 返回错误清单（空数组 = 通过）。
 */
export function validateTimeline(entries: readonly CharacterTimelineEntry[]): string[] {
  const errors: string[] = []
  const seenChapters = new Set<string>()
  let prev: number | undefined
  for (const [i, entry] of entries.entries()) {
    if (!CHAPTER_ID_RE.test(entry.chapter)) {
      errors.push(`timeline[${i}] 章节锚非法：${JSON.stringify(entry.chapter)}（须为三位序号）`)
      continue
    }
    if (seenChapters.has(entry.chapter)) {
      errors.push(`timeline[${i}] 章节锚重复：chapter/${entry.chapter} 已有条目（append 同章覆盖，每章只应一条）`)
    }
    seenChapters.add(entry.chapter)
    if (entry.state.trim().length === 0) {
      errors.push(`timeline[${i}]（chapter/${entry.chapter}）state 为空`)
    }
    const n = Number(entry.chapter)
    if (prev !== undefined && n < prev) {
      errors.push(`timeline[${i}] 章序倒序：chapter/${entry.chapter} 排在 chapter/${String(prev).padStart(3, '0')} 之后`)
    }
    prev = n
  }
  return errors
}

/** 一条人物时间线矛盾（章序倒序；供一致性检查的「人物一致性」维度）。 */
export interface TimelineInversion {
  characterId: string
  /** 倒序对：前一条目（章号较大）与后一条目（章号较小）。 */
  earlier: CharacterTimelineEntry
  later: CharacterTimelineEntry
}

/** 人物时间线体检结果：倒序对 / 无法解析 / 可解析但违反领域校验的条目。 */
export interface TimelineInspection {
  inversions: TimelineInversion[]
  /** 解析失败（非法 JSON/形状/非字符串脏值）的人物与原因。 */
  malformed: { characterId: string; reason: string }[]
  /** 解析成功但 validateTimeline 报错的人物与错误清单（章锚非法/state 空/同章重复等）。 */
  invalid: { characterId: string; errors: string[] }[]
}

/**
 * 人物时间线体检（一致性检查的确定性数据源，不调 LLM）：
 * ①章序下降报告倒序对（相邻对比较，与 detectTimeAnchorInversions 同范式——只报「紧邻倒退」，非全对枚举）；
 * ②解析失败计入 malformed（timeline 是人确认的权威数据，脏值必须暴露不可静默）；
 * ③解析成功再过 validateTimeline，形状/重复条目错误计入 invalid（堵「JSON 合法但章锚脏」逃逸）。
 */
export function inspectTimelines(characters: readonly WriterEntity[]): TimelineInspection {
  const result: TimelineInspection = { inversions: [], malformed: [], invalid: [] }
  for (const character of characters) {
    let entries: CharacterTimelineEntry[]
    try {
      entries = parseTimeline(character.frontmatter['timeline'])
    } catch (err) {
      result.malformed.push({ characterId: character.id, reason: String(err) })
      continue
    }
    const errors = validateTimeline(entries)
    if (errors.length > 0) result.invalid.push({ characterId: character.id, errors })
    for (let i = 1; i < entries.length; i++) {
      const a = entries[i - 1].chapter
      const b = entries[i].chapter
      if (CHAPTER_ID_RE.test(a) && CHAPTER_ID_RE.test(b) && Number(b) < Number(a)) {
        result.inversions.push({ characterId: character.id, earlier: entries[i - 1], later: entries[i] })
      }
    }
  }
  return result
}

/** 人物弧线覆盖统计（writer_stats 的展示数据源，纯函数）。 */
export interface TimelineArcCoverage {
  /** 有非空 timeline 的人物数。 */
  withTimeline: number
  /** 全部人物数（分母）。 */
  characters: number
  /** timeline 条目总数。 */
  entries: number
  /** 每个人物一行展示：最新章锚（取最大章号，倒序数据不误导）与条目数；无时间线标 (无)。 */
  arcs: { id: string; lastChapter?: string; count: number }[]
  /** timeline 无法解析的人物（不毒化其余统计）。 */
  broken: string[]
}

/** 人物弧线覆盖统计：解析失败计 broken；lastChapter 取条目最大章号（不依赖落盘顺序）。 */
export function arcCoverageOf(characters: readonly WriterEntity[]): TimelineArcCoverage {
  const coverage: TimelineArcCoverage = { withTimeline: 0, characters: characters.length, entries: 0, arcs: [], broken: [] }
  for (const character of characters) {
    try {
      const timeline = parseTimeline(character.frontmatter['timeline'])
      if (timeline.length > 0) {
        coverage.withTimeline++
        coverage.entries += timeline.length
        const lastChapter = timeline.reduce((max, e) => (CHAPTER_ID_RE.test(e.chapter) && e.chapter > max ? e.chapter : max), '000')
        coverage.arcs.push({ id: character.id, lastChapter, count: timeline.length })
      } else {
        coverage.arcs.push({ id: character.id, count: 0 })
      }
    } catch {
      coverage.broken.push(character.id)
      coverage.arcs.push({ id: character.id, count: 0 })
    }
  }
  return coverage
}

/** timeline 序列化为 frontmatter JSON 内联（与 milestones 写入形态一致）。 */
export function serializeTimeline(entries: readonly CharacterTimelineEntry[]): string {
  return JSON.stringify(entries)
}
