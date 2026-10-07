/**
 * 维护 pass 的分节 JSON schema 定义 + 抽取引用存在性校验（规划 §1.4）。
 * 全部纯函数：模型输出的解析、分节校验、按节重试的合并，供 engine 编排、可独立单测。
 * R-改进来源：原项目「引用脏值致入库失败」复发病——引用实体 id 不存在时拒收该节并按节重试。
 * @module dsh-writer-domain/maintenance
 */

/** 一条事实抽取：描述 + 可选的人物/伏笔引用（id 必须存在于实体集）。 */
export interface ExtractedFact {
  description: string
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
}

/** 一条人物状态抽取：章末该人物的状态快照（人物状态时间线的增量条目）。 */
export interface ExtractedCharacterState {
  character: string
  state: string
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

const FORESHADOW_ACTIONS: readonly string[] = ['planted', 'reinforcement', 'partial_reveal', 'callback', 'red_herring', 'resolved']

/**
 * 解析维护 pass 抽取输出：宽容提取首个 JSON 对象（允许栅栏与前后缀寒暄），
 * 仅收敛三个已知节的合法条目；无任何合法节返回 undefined（调用方按解析失败处理）。
 * 缺失的节收敛为空数组（模型可判定本章无该类信息）。
 */
export function parseMaintenanceExtraction(raw: string): Partial<MaintenanceExtraction> | undefined {
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
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const source = parsed as Record<string, unknown>
  const out: Partial<MaintenanceExtraction> = {}
  if (Array.isArray(source['facts'])) {
    const facts: ExtractedFact[] = []
    for (const entry of source['facts']) {
      if (typeof entry !== 'object' || entry === null) continue
      const { description, characters, plots } = entry as Record<string, unknown>
      if (typeof description !== 'string' || description.trim().length === 0) continue
      facts.push({
        description,
        ...(isStringArray(characters) ? { characters } : {}),
        ...(isStringArray(plots) ? { plots } : {}),
      })
    }
    out.facts = facts
  }
  if (Array.isArray(source['foreshadowEvents'])) {
    const events: ExtractedForeshadowEvent[] = []
    for (const entry of source['foreshadowEvents']) {
      if (typeof entry !== 'object' || entry === null) continue
      const { plot, action, note } = entry as Record<string, unknown>
      if (typeof plot !== 'string' || typeof action !== 'string' || !FORESHADOW_ACTIONS.includes(action)) continue
      events.push({
        plot,
        action: action as ExtractedForeshadowEvent['action'],
        ...(typeof note === 'string' && note.length > 0 ? { note } : {}),
      })
    }
    out.foreshadowEvents = events
  }
  if (Array.isArray(source['characterStates'])) {
    const states: ExtractedCharacterState[] = []
    for (const entry of source['characterStates']) {
      if (typeof entry !== 'object' || entry === null) continue
      const { character, state } = entry as Record<string, unknown>
      if (typeof character !== 'string' || typeof state !== 'string' || state.trim().length === 0) continue
      states.push({ character, state })
    }
    out.characterStates = states
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
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
  extraction: Partial<MaintenanceExtraction>,
  refs: ExtractionReferenceIndex,
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
      facts.errors.push(`fact「${fact.description.slice(0, 40)}」引用不存在的实体：${[...badChars.map((c) => `character/${c}`), ...badPlots.map((p) => `plot/${p}`)].join('、')}`)
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

  return { facts, foreshadowEvents, characterStates }
}

/** 维护 pass 派生记录（store 以 .writer/derived/ JSON 缓存落盘；sourceHash 锚定章节版本）。 */
export interface MaintenanceDerived {
  /** 产出锚定的章节 content_hash；与当前章节 hash 不符即视为过期。 */
  sourceHash: string
  summary: string
  extraction: MaintenanceExtraction
  updatedAt: string
}

/**
 * 重试节合并：用重试产出覆盖对应节（仅当该节在重试产出中出现且整体通过引用校验的条目非空或显式空）。
 * 纯函数，engine 按节重试后调用。
 */
export function mergeExtractionSections(
  base: MaintenanceExtraction,
  section: ExtractionSectionName,
  retry: ExtractedSectionEntries,
): MaintenanceExtraction {
  return { ...base, [section]: retry } as MaintenanceExtraction
}

/** 节条目的联合类型（mergeExtractionSections 的重试入参）。 */
export type ExtractedSectionEntries = ExtractedFact[] | ExtractedForeshadowEvent[] | ExtractedCharacterState[]
