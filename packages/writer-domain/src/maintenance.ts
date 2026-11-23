/**
 * 维护 pass 的分节 JSON schema 定义 + 抽取引用存在性校验（规划 §1.4）。
 * 全部纯函数：模型输出的解析与分节校验，供 engine 编排按节重试、可独立单测。
 * R-改进来源：原项目「引用脏值致入库失败」复发病——引用实体 id 不存在时拒收该节并按节重试。
 * @module dsh-writer-domain/maintenance
 */

/** 一条事实抽取：描述 + 可选的人物/伏笔引用（id 必须存在于实体集）。 */
export interface ExtractedFact {
  description: string
  quote?: string
  characters?: string[]
  plots?: string[]
}

/**
 * 一条伏笔事件抽取：模型在本章观察到的伏笔动作。
 * action 词汇与伏笔状态机/里程碑对齐：planted / reinforcement / partial_reveal / callback / red_herring / resolved。
 */
export interface ExtractedForeshadowEvent {
  plot: string
  action: 'planted' | 'reinforcement' | 'partial_reveal' | 'callback' | 'red_herring' | 'resolved'
  note?: string
  quote?: string
}

/** 一条人物状态抽取：章末该人物的状态快照（人物状态时间线的增量条目）。 */
export interface ExtractedCharacterState {
  character: string
  state: string
  quote?: string
}

/** 维护 pass 第二次调用的分节 schema：三个互不依赖的节，坏一节不拖累其余两节。 */
export interface MaintenanceExtraction {
  facts: ExtractedFact[]
  foreshadowEvents: ExtractedForeshadowEvent[]
  characterStates: ExtractedCharacterState[]
}

/** 引用存在性校验的实体 id 清单（engine 从 store 实体集构造）。 */
export interface ExtractionReferenceIndex {
  chapters: readonly string[]
  characters: readonly string[]
  plots: readonly string[]
}

/** 分节名（重试与合并以节为单位）。 */
export type ExtractionSectionName = 'facts' | 'foreshadowEvents' | 'characterStates'

export const EXTRACTION_SECTIONS = ['facts', 'foreshadowEvents', 'characterStates'] as const
export const MAINTENANCE_VALIDATION_VERSION = 1
const FORESHADOW_ACTIONS: readonly string[] = ['planted', 'reinforcement', 'partial_reveal', 'callback', 'red_herring', 'resolved']

type ParsedExtraction = Partial<MaintenanceExtraction> & { shapeErrors?: Partial<Record<ExtractionSectionName, string[]>> }

/**
 * 解析维护 pass 抽取输出：宽容提取首个 JSON 对象（允许栅栏与前后缀寒暄），
 * 保留可识别的有效条目，并记录无效条目的位置供维护重试。
 */
export function parseMaintenanceExtraction(raw: string): ParsedExtraction | undefined {
  let text = raw.trim()
  const fenced = text.match(/```[a-zA-Z]*\s*\n([\s\S]*?)\n?```/)
  if (fenced !== null) text = fenced[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const source = parsed as Record<string, unknown>
  const out: ParsedExtraction = {}
  for (const section of EXTRACTION_SECTIONS) {
      const value = source[section]
      if (value !== undefined && !Array.isArray(value)) (out.shapeErrors ??= {})[section] = [`${section} 必须是数组`]
  }
  if (Array.isArray(source['facts'])) {
    const facts: ExtractedFact[] = []
    for (const entry of source['facts']) {
      if (typeof entry !== 'object' || entry === null) continue
      const { description, characters, plots, quote } = entry as Record<string, unknown>
      if (typeof description !== 'string' || !description.trim()
          || !validQuote(quote) || (characters !== undefined && !isStringArray(characters)) || (plots !== undefined && !isStringArray(plots))) continue
      facts.push({
        description,
        ...(quote === undefined ? {} : { quote }),
        ...(isStringArray(characters) ? { characters } : {}),
        ...(isStringArray(plots) ? { plots } : {}),
      })
    }
    out.facts = facts
    recordInvalidEntries('facts', source.facts.length - facts.length, out)
  }
  if (Array.isArray(source['foreshadowEvents'])) {
    const events: ExtractedForeshadowEvent[] = []
    for (const entry of source['foreshadowEvents']) {
      if (typeof entry !== 'object' || entry === null) continue
      const { plot, action, note, quote } = entry as Record<string, unknown>
      if (typeof plot !== 'string' || !plot.trim() || typeof action !== 'string' || !FORESHADOW_ACTIONS.includes(action)
          || !validQuote(quote) || (note !== undefined && typeof note !== 'string')) continue
      events.push({
        plot,
        action: action as ExtractedForeshadowEvent['action'],
        ...(quote === undefined ? {} : { quote }),
        ...(typeof note === 'string' && note.length > 0 ? { note } : {}),
      })
    }
    out.foreshadowEvents = events
    recordInvalidEntries('foreshadowEvents', source.foreshadowEvents.length - events.length, out)
  }
  if (Array.isArray(source['characterStates'])) {
    const states: ExtractedCharacterState[] = []
    for (const entry of source['characterStates']) {
      if (typeof entry !== 'object' || entry === null) continue
      const { character, state, quote } = entry as Record<string, unknown>
      if (typeof character !== 'string' || !character.trim() || typeof state !== 'string' || !state.trim() || !validQuote(quote)) continue
      states.push({ character, state, ...(quote === undefined ? {} : { quote }) })
    }
    out.characterStates = states
    recordInvalidEntries('characterStates', source.characterStates.length - states.length, out)
  }
  return out
}

function recordInvalidEntries(section: ExtractionSectionName, count: number, out: ParsedExtraction): void {
    if (count > 0) (out.shapeErrors ??= {})[section] = [`${section} 有 ${count} 条形状非法`]
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

function validQuote(value: unknown): value is string | undefined {
    return value === undefined || (typeof value === 'string' && value.trim().length > 0)
}

/** 单节校验结果：合法条目 + 拒收原因（供按节重试的反馈提示词）。 */
export interface SectionValidation<T> {
  section: ExtractionSectionName
  entries: T[]
  /** 引用不存在等原因逐条记录；空数组 = 本节全部通过。 */
  errors: string[]
}

/**
 * 分节引用存在性校验：facts 校验 characters/plots 引用；foreshadowEvents 校验 plot 引用与 action 词汇；
 * characterStates 校验 character 引用。引用不存在的条目拒收并给出可读原因（该节整体重试）。
 */
export function validateExtractionSections(
  extraction: ParsedExtraction,
  refs: ExtractionReferenceIndex,
  required: readonly ExtractionSectionName[] = EXTRACTION_SECTIONS,
  evidence?: { text: string; required: boolean },
): {
  facts: SectionValidation<ExtractedFact>
  foreshadowEvents: SectionValidation<ExtractedForeshadowEvent>
  characterStates: SectionValidation<ExtractedCharacterState>
} {
  const characters = new Set(refs.characters)
  const plots = new Set(refs.plots)

  const facts: SectionValidation<ExtractedFact> = { section: 'facts', entries: [], errors: [] }
  for (const fact of extraction.facts ?? []) {
    const badChars = (fact.characters ?? []).filter((id) => !characters.has(id))
    const badPlots = (fact.plots ?? []).filter((id) => !plots.has(id))
    if (badChars.length > 0 || badPlots.length > 0) {
      facts.errors.push(`fact「${Array.from(fact.description).slice(0, 40).join('')}」引用不存在的实体：${[...badChars.map((c) => `character/${c}`), ...badPlots.map((p) => `plot/${p}`)].join('、')}`)
      continue
    }
    facts.entries.push(fact)
  }

  const foreshadowEvents: SectionValidation<ExtractedForeshadowEvent> = { section: 'foreshadowEvents', entries: [], errors: [] }
  for (const event of extraction.foreshadowEvents ?? []) {
    if (!plots.has(event.plot)) {
      foreshadowEvents.errors.push(`foreshadowEvent 引用不存在的伏笔：plot/${event.plot}`)
      continue
    }
    foreshadowEvents.entries.push(event)
  }

  const characterStates: SectionValidation<ExtractedCharacterState> = { section: 'characterStates', entries: [], errors: [] }
  for (const state of extraction.characterStates ?? []) {
    if (!characters.has(state.character)) {
      characterStates.errors.push(`characterState 引用不存在的人物：character/${state.character}`)
      continue
    }
    characterStates.entries.push(state)
  }

  const result = { facts, foreshadowEvents, characterStates }
  for (const section of required) {
      result[section].errors.push(...(extraction.shapeErrors?.[section] ?? (extraction[section] === undefined ? [`缺少 ${section} 节`] : [])))
      if (evidence) {
          const { entries, errors } = result[section]
          for (let index = entries.length - 1; index >= 0; index--) {
              const quote = entries[index].quote
              if (quote === undefined ? !evidence.required : evidence.text.includes(quote)) continue
              entries.splice(index, 1)
              errors.push(`${section} 有条目缺少可在当前章稿逐字核验的引文`)
          }
      }
  }
  return result
}

/** 维护 pass 派生记录（store 以 .writer/derived/ JSON 缓存落盘；sourceHash 锚定章节版本）。 */
export interface MaintenanceDerived {
  /** 产出锚定的章节 content_hash；与当前章节 hash 不符即视为过期。 */
  sourceHash: string
  summary: string
  extraction: MaintenanceExtraction
  updatedAt: string
  validationVersion?: number
  evidenceRequired?: boolean
  /** 重试预算耗尽仍有条目被拒收时为 true（rejected 记录拒收原因；pending.md 同步提示）。 */
  partial?: boolean
  rejected?: string[]
}
