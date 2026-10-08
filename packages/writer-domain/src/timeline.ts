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
 * 条目顺序保持落盘顺序（单调性校验由 validateTimeline / detectTimelineInversions 负责，解析不重排）。
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
 * ① chapter 必须是三位序号；② state 去空白后非空；③ 章序单调不减（手写乱序 = 数据错误）。
 * 返回错误清单（空数组 = 通过）。
 */
export function validateTimeline(entries: readonly CharacterTimelineEntry[]): string[] {
  const errors: string[] = []
  let prev: number | undefined
  for (const [i, entry] of entries.entries()) {
    if (!CHAPTER_ID_RE.test(entry.chapter)) {
      errors.push(`timeline[${i}] 章节锚非法：${JSON.stringify(entry.chapter)}（须为三位序号）`)
      continue
    }
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

/**
 * 基于时间线的状态倒序矛盾检测（确定性，不调 LLM）：人物 timeline 中章序出现下降即倒序——
 * 状态按章节推进的前提被破坏（常见于手改 frontmatter 或改稿后未同步）。
 * 解析失败（非法 JSON/形状）同样作为矛盾报告（timeline 是人确认的权威数据，脏值必须暴露不可静默）。
 */
export function detectTimelineInversions(characters: readonly WriterEntity[]): { inversions: TimelineInversion[]; malformed: { characterId: string; reason: string }[] } {
  const inversions: TimelineInversion[] = []
  const malformed: { characterId: string; reason: string }[] = []
  for (const character of characters) {
    let entries: CharacterTimelineEntry[]
    try {
      entries = parseTimeline(character.frontmatter['timeline'])
    } catch (err) {
      malformed.push({ characterId: character.id, reason: String(err) })
      continue
    }
    for (let i = 1; i < entries.length; i++) {
      if (CHAPTER_ID_RE.test(entries[i].chapter) && CHAPTER_ID_RE.test(entries[i - 1].chapter)
        && Number(entries[i].chapter) < Number(entries[i - 1].chapter)) {
        inversions.push({ characterId: character.id, earlier: entries[i - 1], later: entries[i] })
      }
    }
  }
  return { inversions, malformed }
}

/** timeline 序列化为 frontmatter JSON 内联（与 milestones 写入形态一致）。 */
export function serializeTimeline(entries: readonly CharacterTimelineEntry[]): string {
  return JSON.stringify(entries)
}
