/**
 * 纯函数域库：实体类型、frontmatter 解析/序列化、content_hash、伏笔状态机。
 * 无副作用、无 I/O，可独立单测。规划见 docs/implementation-plan.md §1.1。
 * @module dsh-writer-domain
 */
import { createHash } from 'node:crypto'

/** 实体种类（P1 白名单；engine/skills 接入后扩展查询面）。 */
export type EntityKind =
  | 'project'
  | 'principles'
  | 'outline'
  | 'chapter'
  | 'character'
  | 'plot'
  | 'event'
  | 'idea'
  | 'style'
  | 'worldbuilding'

export const ENTITY_KINDS: readonly EntityKind[] = [
  'project', 'principles', 'outline', 'chapter', 'character', 'plot', 'event', 'idea', 'style', 'worldbuilding',
]

/** frontmatter 值域：flat 标量 + JSON 内联（数组/对象经 JSON.parse）。 */
export type FrontmatterValue = string | number | boolean
export type Frontmatter = Record<string, FrontmatterValue>

/** 领域实体信封：正文与元数据的统一形状。 */
export interface WriterEntity {
  readonly kind: EntityKind
  /** 稳定标识：chapter=三位序号，character/plot/event=name slug。 */
  readonly id: string
  /** 相对 projectRoot 的路径（POSIX 分隔）。 */
  readonly path: string
  readonly frontmatter: Frontmatter
  /** 正文（不含 frontmatter 块）。 */
  readonly content: string
  /** contentHash(frontmatter, content)，用于乐观锁与索引对账。 */
  readonly hash: string
}

/**
 * 解析 Markdown 开头的 frontmatter 块。仅支持 flat `key: value` 行；
 * 值以 `{`/`[` 开头按 JSON 解析，`true`/`false`/数字按字面量，其余为字符串。
 * 无 frontmatter 块时返回空对象与全文。
 */
export function parseFrontmatter(raw: string): { frontmatter: Frontmatter; content: string } {
  // CRLF 归一：外部编辑器（Windows）保存的文件统一按 \n 语义解析
  const text = raw.startsWith('\uFEFF') ? raw.slice(1).replaceAll('\r\n', '\n') : raw.replaceAll('\r\n', '\n')
  if (!text.startsWith('---\n')) return { frontmatter: {}, content: text }
  const end = text.indexOf('\n---\n', 4)
  if (end < 0) return { frontmatter: {}, content: text }
  const block = text.slice(4, end)
  const content = text.slice(end + 5)
  const frontmatter: Frontmatter = {}
  for (const line of block.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const colon = trimmed.indexOf(':')
    if (colon <= 0) throw new Error(`frontmatter 行无法解析：${line}`)
    const key = trimmed.slice(0, colon).trim()
    const valueRaw = trimmed.slice(colon + 1).trim()
    frontmatter[key] = parseValue(valueRaw)
  }
  return { frontmatter, content }
}

function parseValue(valueRaw: string): FrontmatterValue {
  // 引号包裹优先（我们序列化的字符串值恒为 JSON 引号形式，杜绝 "true"/"5" 被字面量推断）
  if (valueRaw.startsWith('"')) {
    try {
      const parsed = JSON.parse(valueRaw)
      if (typeof parsed === 'string') return parsed
    } catch { /* 落回字面量推断 */ }
  }
  if (valueRaw === 'true') return true
  if (valueRaw === 'false') return false
  // 纯十进制数字才转 number（排除 0x/1e3/1_000 与前导零——前导零是字符串语义，如章节号 "002"）
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(valueRaw)) return Number(valueRaw)
  if (valueRaw.startsWith('{') || valueRaw.startsWith('[')) return valueRaw // JSON 内联保留原文（域库不做深解析）
  return stripQuotes(valueRaw)
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1)
  }
  return value
}

/** 序列化实体为 Markdown 文本（frontmatter + 正文，结尾恰好一个换行）。 */
export function serializeEntity(frontmatter: Frontmatter, content: string): string {
  const keys = Object.keys(frontmatter).sort()
  if (keys.length === 0) return ensureTrailingNewline(content)
  const lines = keys.map((key) => `${key}: ${formatValue(frontmatter[key])}`)
  return `---\n${lines.join('\n')}\n---\n${ensureTrailingNewline(content)}`
}

function formatValue(value: FrontmatterValue): string {
  // 字符串值恒以 JSON 引号形式落盘：杜绝 "true"/"5" 字面量漂移、转义 \n 与特殊字符（配合 parseValue 引号优先）
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`
}

/**
 * 内容哈希：frontmatter 键排序后的规范行 + 分隔符 + 正文，sha256 hex。
 * 乐观锁（read-before-update 双校验）与索引对账共用同一规范化。
 */
export function contentHash(frontmatter: Frontmatter, content: string): string {
  const canonical = Object.keys(frontmatter).sort().map((key) => `${key}=${formatValue(frontmatter[key])}`).join('\n')
  return createHash('sha256').update(`${canonical}\n\u0000\n${content}`).digest('hex')
}

/** 伏笔状态机（planned→planted→resolved/abandoned；milestones 之外无中间态）。 */
export type ForeshadowStatus = 'planned' | 'planted' | 'resolved' | 'abandoned'

export const FORESHADOW_TRANSITIONS: Readonly<Record<ForeshadowStatus, readonly ForeshadowStatus[]>> = {
  planned: ['planted', 'abandoned'],
  planted: ['resolved', 'abandoned'],
  resolved: [],
  abandoned: [],
}

/** 校验并执行状态迁移；非法迁移抛错（调用方反馈为业务错误，不熔断）。 */
export function transitionForeshadow(from: ForeshadowStatus, to: ForeshadowStatus): ForeshadowStatus {
  if (!FORESHADOW_TRANSITIONS[from].includes(to)) {
    throw new Error(`伏笔状态非法迁移：${from} → ${to}`)
  }
  return to
}

/**
 * 伏笔 milestones 的中间事件类型（references/novel-writer/docs/writing-workflow.md §6.2 四类）。
 */
export type ForeshadowMilestoneType = 'reinforcement' | 'partial_reveal' | 'callback' | 'red_herring'

/** 一条伏笔中间事件：章节锚 + 类型 + 说明。 */
export interface ForeshadowMilestone {
  type: ForeshadowMilestoneType
  chapter: string
  note?: string
}

/**
 * 解析 plot 实体 frontmatter 中的 milestones 字段（JSON 内联字符串）。
 * 缺失或空串返回空数组；格式非法抛错（响亮失败，不静默吞）。
 */
export function parseMilestones(raw: FrontmatterValue | undefined): ForeshadowMilestone[] {
  if (raw === undefined || raw === '') return []
  if (typeof raw !== 'string') throw new Error(`milestones 必须是 JSON 字符串：${String(raw)}`)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`milestones JSON 解析失败：${String(err)}`)
  }
  if (!Array.isArray(parsed)) throw new Error('milestones 必须是 JSON 数组')
  const validTypes: readonly string[] = ['reinforcement', 'partial_reveal', 'callback', 'red_herring']
  return parsed.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) throw new Error(`milestones[${i}] 非对象`)
    const { type, chapter, note } = entry as Record<string, unknown>
    if (typeof type !== 'string' || !validTypes.includes(type)) {
      throw new Error(`milestones[${i}] type 非法：${String(type)}（可选 reinforcement / partial_reveal / callback / red_herring）`)
    }
    if (typeof chapter !== 'string') {
      throw new Error(`milestones[${i}] 缺少 chapter 字符串字段`)
    }
    return typeof note === 'string' ? { type: type as ForeshadowMilestoneType, chapter, note } : { type: type as ForeshadowMilestoneType, chapter }
  })
}

// ---------------------------------------------------------------------------
// rewrite 补丁协议（规划 §1.1：{find,replace} 锚点匹配、唯一命中才替换、丢句守卫、不命中降级）
// ---------------------------------------------------------------------------

/** 一条改写补丁：`find` 为原文锚点（空白归一容错），`replace` 为替换文本。 */
export interface RewritePatch {
  find: string
  replace: string
}

/** 补丁应用结果：逐条统计命中与跳过（跳过原因供降级与告警）。 */
export interface RewritePatchResult {
  content: string
  applied: number
  skipped: { find: string; reason: 'not-found' | 'ambiguous' }[]
}

/** 空白归一：去除全部空白字符后做锚点比较（中文文本的换行/空格差异不敏感）。 */
function stripWhitespace(text: string): string {
  return text.replace(/\s+/g, '')
}

/**
 * 应用补丁序列：每条补丁在**当前**内容中找锚点（空白归一匹配），
 * 唯一命中才替换；零命中或歧义命中跳过并记录原因。未提及内容零触碰。
 */
export function applyRewritePatches(content: string, patches: readonly RewritePatch[]): RewritePatchResult {
  let current = content
  let applied = 0
  const skipped: RewritePatchResult['skipped'] = []
  for (const patch of patches) {
    const target = stripWhitespace(patch.find)
    if (target.length === 0) {
      skipped.push({ find: patch.find, reason: 'not-found' })
      continue
    }
    // 归一文 + 原文位置映射：normChars[i] 对应 original 下标 origIndexOf[i]（含尾界）
    const normChars: string[] = []
    const origIndexOf: number[] = []
    for (let i = 0; i < current.length; i++) {
      if (!/\s/.test(current[i])) {
        normChars.push(current[i])
        origIndexOf.push(i)
      }
    }
    const norm = normChars.join('')
    // 统计全部命中（重叠计一次），唯一才替换
    const hits: number[] = []
    let from = 0
    for (;;) {
      const at = norm.indexOf(target, from)
      if (at < 0) break
      hits.push(at)
      from = at + 1
    }
    if (hits.length === 0) {
      skipped.push({ find: patch.find, reason: 'not-found' })
      continue
    }
    if (hits.length > 1) {
      skipped.push({ find: patch.find, reason: 'ambiguous' })
      continue
    }
    const at = hits[0]
    // 替换只覆盖锚点的非空白跨度（末命中字符原下标 +1），锚点后的尾随空白/换行原样保留
    const startOrig = origIndexOf[at]
    const endOrig = origIndexOf[at + target.length - 1] + 1
    current = current.slice(0, startOrig) + patch.replace + current.slice(endOrig)
    applied++
  }
  return { content: current, applied, skipped }
}

/** rewrite 模型输出的两种形态：补丁协议（小改）或全文（大改）。 */
export type RewriteModelOutput =
  | { kind: 'patches'; patches: RewritePatch[] }
  | { kind: 'fulltext'; text: string }

/**
 * 解析 rewrite 模型输出：宽容提取首个 JSON 对象（允许前后缀寒暄与 Markdown 栅栏包裹），
 * 仅当其解析为对象且 `patches` 为逐项合法的 `{find,replace}` 数组时按补丁协议处理；
 * 否则一律视为全文（交给丢句守卫与引擎的 JSON 形守卫把关，不在此抛错）。
 */
export function parseRewriteModelOutput(raw: string): RewriteModelOutput {
  const asFulltext = (): RewriteModelOutput => ({ kind: 'fulltext', text: raw.trim() })
  const text = raw.trim()
  // 候选 1：整体即栅栏块；候选 2：首 { 到尾 } 的子串（剥掉寒暄/尾注）
  const fenced = text.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/)
  const candidates = fenced !== null ? [fenced[1].trim()] : [text, sliceBraces(text)].filter((s) => s.length > 0)
  for (const candidate of candidates) {
    if (!candidate.startsWith('{')) continue
    try {
      const parsed = JSON.parse(candidate) as { patches?: unknown }
      if (!Array.isArray(parsed.patches)) continue
      const patches: RewritePatch[] = []
      let entryValid = true
      for (const entry of parsed.patches) {
        if (typeof entry !== 'object' || entry === null) { entryValid = false; break }
        const { find, replace } = entry as Record<string, unknown>
        if (typeof find !== 'string' || typeof replace !== 'string') { entryValid = false; break }
        patches.push({ find, replace })
      }
      if (entryValid) return { kind: 'patches', patches }
    } catch {
      // 该候选不是合法 JSON，继续下一候选
    }
  }
  return asFulltext()
}

/** 取文本中首个 `{` 到最后一个 `}` 的子串；无配对返回空串。 */
function sliceBraces(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start >= 0 && end > start ? text.slice(start, end + 1) : ''
}

/** 按句末标点切句（中文为主，兼容 !?…;），空句丢弃。 */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[。！？!?…；;])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** 丢句守卫结果：dropped 为疑似蒸发的原句，retention 为原句保留率（0-1）。 */
export interface DroppedSentenceReport {
  dropped: string[]
  retention: number
}

/**
 * 丢句守卫（rewrite 全文路径）：原句在改写文中（空白归一）仍出现即视为保留；
 * 返回疑似蒸发的原句与保留率。只告警不回填，按句子粒度衡量避免深度改写误报。
 */
export function detectDroppedSentences(original: string, rewritten: string): DroppedSentenceReport {
  const sentences = splitSentences(original).filter((s) => s.replace(/[。！？!?…；;]/g, '').length > 1)
  if (sentences.length === 0) return { dropped: [], retention: 1 }
  const rewrittenNorm = stripWhitespace(rewritten)
  const dropped = sentences.filter((s) => !rewrittenNorm.includes(stripWhitespace(s)))
  const retention = 1 - dropped.length / sentences.length
  return { dropped, retention }
}

// ---------------------------------------------------------------------------
// 上下文组装器（规划 §1.1：预算是参数；principles 全量、本章大纲永不截断、防剧透过滤）
// ---------------------------------------------------------------------------

/** 组装器输入：实体集 + 本章序号 + 字符预算（预算是参数而非常量）。 */
export interface WritingContextInput {
  chapterNumber: number
  principles?: WriterEntity
  outline?: WriterEntity
  /** 全部已写章节（组装器自行做防剧透过滤：只注入序号小于本章的）。 */
  chapters: readonly WriterEntity[]
  characters: readonly WriterEntity[]
  plots: readonly WriterEntity[]
  events?: WriterEntity
  styleRefs?: readonly WriterEntity[]
  /** 预注入字符预算；超出按优先级降级（本章大纲与 principles 永不截断）。 */
  budgetChars: number
  /** 用户特别要求（最高优先，永不截断）。 */
  instruction?: string
}

/** 一个组装出的上下文分节。truncated=true 表示因预算截断过。 */
export interface ContextSection {
  title: string
  body: string
  truncated: boolean
}

/** 组装结果：按注入顺序的分节列表 + 实际用量。 */
export interface AssembledWritingContext {
  sections: ContextSection[]
  usageChars: number
}

/** 从大纲正文中抽取「第 N 章」小节（匹配 `### 第 N 章` / `## 第N章` 等形态；小节到下一个任意级别标题行终止，防止吞入后续卷/附录内容）；找不到返回 undefined。 */
export function extractChapterOutline(outlineContent: string, chapterNumber: number): string | undefined {
  const lines = outlineContent.split('\n')
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#{2,4}\s*第\s*(\d+)\s*章/)
    if (m !== null && Number(m[1]) === chapterNumber) {
      start = i
      break
    }
  }
  if (start < 0) return undefined
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join('\n').trim()
}

function chapterNumberOf(entity: WriterEntity): number | undefined {
  const n = entity.frontmatter['number']
  return typeof n === 'number' ? n : undefined
}

function briefOf(entity: WriterEntity, maxChars: number): string {
  const flat = entity.content.replace(/\s+/g, ' ').trim()
  return flat.length <= maxChars ? flat : `${flat.slice(0, maxChars)}…`
}

/**
 * 解析 frontmatter 里的章节锚（三位序号字符串或数字）；缺失/脏值（NaN）返回 undefined
 * （按缺失处理：伏笔红线不因脏数据静默误判，也不因脏数据误触发）。
 */
function chapterAnchorOf(value: FrontmatterValue | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/**
 * 写作上下文组装（纯函数）：按优先级装配预注入分节——
 * 用户要求 / principles 全量 / 本章大纲（永不截断）/ 伏笔指令（必须设置 + 逾期必须设置 + 活跃）/
 * 前一章原文（预算内全文，超出保头截断并标记）/ 人物精简摘要 / 更早章标题行 / 事件 / 风格示范首条。
 * 防剧透：只注入序号小于本章的章节；伏笔只注入未回收（planned/planted）且 planned_chapter 不晚于本章的。
 */
export function assembleWritingContext(input: WritingContextInput): AssembledWritingContext {
  const sections: ContextSection[] = []
  const must = (title: string, body: string): void => {
    if (body.trim().length > 0) sections.push({ title, body, truncated: false })
  }
  // 可降级分节：预算按「标题 + 正文 + 分隔」整节计费（与 usageChars 同口径），预算耗尽不再注入
  const optional = (title: string, body: string, remaining: number, truncatedFlag = true): number => {
    const trimmed = body.trim()
    if (trimmed.length === 0) return remaining
    const overhead = title.length + 2
    const used = Math.min(trimmed.length, Math.max(0, remaining - overhead))
    if (used <= 0) return remaining
    const sectionBody = used >= trimmed.length ? trimmed : `${trimmed.slice(0, used)}…`
    sections.push({ title, body: sectionBody, truncated: used < trimmed.length && truncatedFlag })
    return remaining - overhead - sectionBody.length
  }

  // —— 必注分节（不参与预算裁剪）——
  if (input.instruction !== undefined && input.instruction.trim().length > 0) {
    must('用户特别要求', input.instruction)
  }
  if (input.principles !== undefined) must('创作准则（全量）', input.principles.content)
  const chapterOutline = input.outline === undefined ? undefined : extractChapterOutline(input.outline.content, input.chapterNumber)
  if (chapterOutline !== undefined) must(`本章大纲（第 ${input.chapterNumber} 章）`, chapterOutline)

  // 必注部分先计费，剩余预算给可降级分节
  const mustChars = sections.reduce((sum, s) => sum + s.title.length + s.body.length + 2, 0)
  let remaining = Math.max(0, input.budgetChars - mustChars)

  // —— 伏笔指令 ——
  const foreshadowLines: string[] = []
  for (const plot of input.plots) {
    const status = String(plot.frontmatter['status'] ?? 'planned')
    if (status !== 'planned' && status !== 'planted') continue
    const anchor = chapterAnchorOf(plot.frontmatter['planned_chapter'])
    if (anchor !== undefined && anchor > input.chapterNumber) continue
    // planned 且 planned_chapter 已过 = 逾期未设置：本章必须设置（状态机 planned→planted；planned 不能直接 resolved）
    const overdue = status === 'planned' && anchor !== undefined && anchor < input.chapterNumber
    const dueHere = anchor === input.chapterNumber
    const marker = dueHere || overdue ? '🔴' : '🟡'
    const directive = dueHere
      ? '🔴 本章必须设置此伏笔'
      : overdue
        ? '🔴 此伏笔已逾期未设置，本章必须设置（plant）'
        : '活跃伏笔，注意一致性与可强化点'
    foreshadowLines.push(`${marker} ${plot.id}（${status}）：${directive}——${briefOf(plot, 120)}`)
  }
  if (foreshadowLines.length > 0) {
    // 伏笔指令是写作红线，优先级仅次于必注分节
    remaining = optional('伏笔指令', foreshadowLines.join('\n'), remaining, false)
  }

  // —— 前一章原文（防剧透：仅序号小于本章；预算内全文，超出保头截断，truncated 标记提示衔接缺失）——
  const previous = input.chapters
    .filter((c) => (chapterNumberOf(c) ?? 0) < input.chapterNumber)
    .sort((a, b) => (chapterNumberOf(b) ?? 0) - (chapterNumberOf(a) ?? 0))
  const prev = previous[0]
  if (prev !== undefined && remaining > 0) {
    remaining = optional(`前一章原文（第 ${chapterNumberOf(prev)} 章 ${prev.id}）`, prev.content, remaining)
  }

  // —— 人物精简摘要 ——
  if (remaining > 200 && input.characters.length > 0) {
    remaining = optional('出场人物（精简摘要）', input.characters.map((c) => `- ${c.id}：${briefOf(c, 100)}`).join('\n'), remaining)
  }

  // —— 更早章（标题行提示连续性）——
  if (remaining > 0 && previous.length > 1) {
    const earlier = previous.slice(1).map((c) => `- 第 ${chapterNumberOf(c)} 章 ${c.id}${typeof c.frontmatter['title'] === 'string' ? ` ${c.frontmatter['title']}` : ''}`)
    remaining = optional('更早章节（标题）', earlier.join('\n'), remaining)
  }

  // —— 事件（防剧透提示：events.md 为全书事件，仅注首部）——
  if (input.events !== undefined && remaining > 0) {
    remaining = optional('关键事件（节选）', input.events.content, remaining)
  }

  // —— 风格示范（首条）——
  if (input.styleRefs !== undefined && input.styleRefs.length > 0 && remaining > 0) {
    remaining = optional('风格示范（节选）', input.styleRefs[0].content, remaining)
  }

  const usageChars = sections.reduce((sum, s) => sum + s.title.length + s.body.length + 2, 0)
  return { sections, usageChars }
}

// ---------------------------------------------------------------------------
// 审稿契约（3+1 维：情节/人物/设定一致性 + 文学质量；ReviewSuggestion 结构化建议）
// ---------------------------------------------------------------------------

/** 3+1 审稿维度（references/novel-writer/docs/writing-workflow.md §8.1 收敛为 3+1）。 */
export const REVIEW_DIMENSIONS = ['情节一致性', '人物一致性', '设定一致性', '文学质量'] as const
export type ReviewDimension = (typeof REVIEW_DIMENSIONS)[number]

/** 一条结构化审稿建议（quote 定位问题原文；rewriteOption 可选改写方案）。 */
export interface ReviewSuggestion {
  dimension: string
  severity: 'high' | 'medium' | 'low'
  quote?: string
  problem: string
  suggestion: string
  rewriteOption?: string
}

/** 审稿报告：建议列表 + 总评。 */
export interface ReviewReport {
  suggestions: ReviewSuggestion[]
  summary: string
}

const SEVERITIES = ['high', 'medium', 'low'] as const

/**
 * 解析模型审稿输出：提取首个 JSON 对象（允许代码栅栏），校验 suggestions 数组并逐条收敛；
 * 完全不合法返回 undefined（调用方按解析失败处理，不部分捏造）。
 */
export function parseReviewReport(raw: string): ReviewReport | undefined {
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
  const { suggestions, summary } = parsed as Record<string, unknown>
  if (!Array.isArray(suggestions)) return undefined
  const valid: ReviewSuggestion[] = []
  for (const entry of suggestions) {
    if (typeof entry !== 'object' || entry === null) continue
    const s = entry as Record<string, unknown>
    if (typeof s.dimension !== 'string' || typeof s.problem !== 'string' || typeof s.suggestion !== 'string') continue
    const severity = (SEVERITIES as readonly string[]).includes(String(s.severity)) ? s.severity as ReviewSuggestion['severity'] : 'medium'
    valid.push({
      dimension: s.dimension,
      severity,
      ...(typeof s.quote === 'string' && s.quote.length > 0 ? { quote: s.quote } : {}),
      problem: s.problem,
      suggestion: s.suggestion,
      // 有意简化：参考源（writing-workflow.md §8.2）的 rewriteOption 是对象（text+replaceRange），
      // 本仓 DSH 工具路径只取改写文本字符串，quote 定位交给补丁协议的 find 锚点
      ...(typeof s.rewriteOption === 'string' && s.rewriteOption.length > 0 ? { rewriteOption: s.rewriteOption } : {}),
    })
  }
  return { suggestions: valid, summary: typeof summary === 'string' ? summary : '' }
}

/**
 * quote 校验：丢弃「提供了 quote 但（空白归一后）不在正文中出现」的建议（模型幻觉引文）；
 * 未提供 quote 的建议保留（quote 是可选字段）。
 */
export function filterSuggestionsByQuotes(report: ReviewReport, chapterContent: string): ReviewReport {
  const contentNorm = stripWhitespace(chapterContent)
  const suggestions = report.suggestions.filter((s) => s.quote === undefined || contentNorm.includes(stripWhitespace(s.quote)))
  return { suggestions, summary: report.summary }
}

/** focus 过滤：只保留 dimension 命中焦点集合的建议；focus 为空/缺省时全保留。 */
export function filterSuggestionsByFocus(report: ReviewReport, focus?: readonly string[]): ReviewReport {
  if (focus === undefined || focus.length === 0) return report
  const allow = new Set(focus.map((f) => f.trim()).filter((f) => f.length > 0))
  return { suggestions: report.suggestions.filter((s) => allow.has(s.dimension)), summary: report.summary }
}

// ---------------------------------------------------------------------------
// writeChapter / reviewChapter 引擎契约类型（供 core 抽象基类与 engine/tools 共用）
// ---------------------------------------------------------------------------

/** 章节写作请求；signal 由工具层透传（exec.signal 观测）。 */
export interface ChapterWriteRequest {
  /** 三位序号（与 store 章节实体 id 一致）。 */
  chapterId: string
  mode: 'full' | 'assist' | 'rewrite'
  /** 写作/续写/改写指令。 */
  instruction?: string
  /** full 模式创建新章时的标题。 */
  title?: string
  /** rewrite 模式可选选区锚（限制改写范围提示）。 */
  selection?: string
  signal?: AbortSignal
}

/** 实际执行的改写路径（补丁协议命中与否决定 patch/full）。 */
export type ChapterWriteMode = 'full' | 'assist' | 'rewrite-patch' | 'rewrite-full'

/** 章节写作结果：保存后的实体 + 模式 + 补丁统计与丢句告警。 */
export interface ChapterWriteResult {
  chapter: WriterEntity
  mode: ChapterWriteMode
  patchStats?: { applied: number; skipped: number; skippedReasons: string[] }
  droppedSentences?: string[]
}

// P3 治理：维护 pass 分节 schema/校验（maintenance.ts）与一致性检查纯函数（consistency.ts）
export * from './maintenance.ts'
export * from './consistency.ts'
