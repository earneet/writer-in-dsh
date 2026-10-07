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

export const ENTITY_KINDS: readonly EntityKind[] = [
  'project', 'principles', 'outline', 'chapter', 'character', 'plot', 'event', 'idea', 'style',
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
  if (!raw.startsWith('---\n')) return { frontmatter: {}, content: raw }
  const end = raw.indexOf('\n---\n', 4)
  if (end < 0) return { frontmatter: {}, content: raw }
  const block = raw.slice(4, end)
  const content = raw.slice(end + 5)
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
  if (valueRaw === 'true') return true
  if (valueRaw === 'false') return false
  if (valueRaw !== '' && !Number.isNaN(Number(valueRaw))) return Number(valueRaw)
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
  if (typeof value === 'string') return value
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
