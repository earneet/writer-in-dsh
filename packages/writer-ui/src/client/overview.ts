/**
 * 冷启动总览聚合（纯函数）：从 novel/ 扫描到的原始文件集合计算面板数据。
 *
 * 与 novel-writer 的「打开项目即拉存储」范式对齐：不依赖本会话跑过工具；
 * 输入是 workspaceFiles remote 拉到的 Markdown 文本，解析复用 domain 纯函数
 * （parseFrontmatter），输出直接可渲染的视图模型（概况 + 章节/伏笔/人物/待办四栏）。
 */
import { parseFrontmatter, type Frontmatter } from 'dsh-writer-domain'

/** 一章的原始文件（frontmatter + 正文）。 */
export interface ChapterSource {
  name: string
  frontmatter: Frontmatter
  content: string
}

/** 一条情节/伏笔的原始文件（frontmatter + 正文，正文供展开预览）。 */
export interface PlotSource {
  name: string
  frontmatter: Frontmatter
  content: string
}

/** 一个人物的原始文件（frontmatter + 正文分节，正文含背景/性格/关系等章节）。 */
export interface CharacterSource {
  name: string
  frontmatter: Frontmatter
  content: string
}

/** 大纲原始文件（outline.md 的 frontmatter + 正文分节）。 */
export interface OutlineSource {
  frontmatter: Frontmatter
  content: string
}

/** 项目级 frontmatter（project.md）。 */
export type ProjectSource = Frontmatter | null

/** 扫描结果（load.ts 产出，本模块消费）。 */
export interface NovelScan {
  root: string
  project: ProjectSource
  outline: OutlineSource | null
  chapters: ChapterSource[]
  plots: PlotSource[]
  characters: CharacterSource[]
  worldbuildingCount: number
  /** 待办分节（extractPendingSections 产出：倒序 + 跨 pass 去重 + [x] 过滤）。 */
  pending: PendingSection[]
}

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

/** 伏笔行（伏笔页签；preview 为展开预览文本）。 */
export interface PlotRow {
  id: string
  hint: string
  status: string
  type: string
  plannedChapter: string
  preview: string
}

/** 人物时间线条目（frontmatter timeline 结构化字段；JSON 字符串或数组均可）。 */
export interface TimelineEntry {
  chapter: string
  state: string
}

/** 人物关系条目（frontmatter relations 或正文「## 关系」小节解析）。 */
export interface RelationEntry {
  name: string
  desc: string
}

/** 人物正文小节（## 标题切分）。 */
export interface SectionEntry {
  title: string
  body: string
}

/** 人物行（人物页签；展开详情 = 正文小节 + 时间线 + 关系）。 */
export interface CharacterRow {
  id: string
  name: string
  role: string
  arc: string
  timelineCount: number
  relationCount: number
  timeline: TimelineEntry[]
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

/** 冷启动总览视图模型。 */
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
}

function charCount(text: string): number {
  // 正文字数口径：去空白后的码点数（与 writer_stats 的「约 N 字」近似一致）
  return text.replace(/\s/g, '').length
}

/** 展开预览文本：去标题/列表记号、折叠空白（CJK 字符间不留空格）、截断。 */
function preview(text: string, limit = 200): string {
  const flat = text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .replace(/(?<=[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]) (?=[\u3400-\u9fff\u3000-\u303f\uff00-\uffef])/g, '')
    .trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

function str(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.length > 0) return value
  return fallback
}

/** 字符串或有限数字 → 展示文本（frontmatter 裸数字常见：chapter/planned_chapter 等）。 */
function strNum(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function chapterRow(source: ChapterSource): ChapterRow {
  return {
    id: source.name.replace(/\.md$/, ''),
    title: str(source.frontmatter.title, source.name),
    volume: str(source.frontmatter.volume, ''),
    chars: charCount(source.content),
    status: str(source.frontmatter.status, ''),
    storyline: str(source.frontmatter.storyline, ''),
    preview: preview(source.content),
  }
}

function plotRow(source: PlotSource): PlotRow {
  const fm = source.frontmatter
  const planned = fm.planned_chapter ?? fm.planted_chapter ?? ''
  return {
    id: source.name.replace(/\.md$/, ''),
    hint: str(fm.hint, source.name),
    status: str(fm.status, 'unknown'),
    type: str(fm.type, fm.status !== undefined ? 'foreshadow' : ''),
    plannedChapter: strNum(planned, ''),
    preview: preview(source.content),
  }
}

/** 宽容解析「数组或 JSON 字符串数组」（timeline/relations 的两种存放形态）。 */
function parseJsonishArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed
    } catch { /* 容忍坏 JSON */ }
  }
  return []
}

/** frontmatter timeline → 条目（chapter + state；两种形态、字段名宽容）。 */
function timelineEntries(value: unknown): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  for (const item of parseJsonishArray(value)) {
    if (item !== null && typeof item === 'object') {
      const record = item as Record<string, unknown>
      const chapter = strNum(record.chapter ?? record.at, '')
      const state = str(record.state ?? record.summary ?? record.event, '')
      if (chapter.length > 0 || state.length > 0) entries.push({ chapter, state })
    } else if (typeof item === 'string' && item.trim().length > 0) {
      entries.push({ chapter: '', state: item.trim() })
    }
  }
  return entries
}

/** frontmatter relations → 条目（name/target + relation/desc 字段名宽容）。 */
function relationEntries(value: unknown): RelationEntry[] {
  const entries: RelationEntry[] = []
  for (const item of parseJsonishArray(value)) {
    if (item === null || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const name = str(record.name ?? record.target ?? record.with, '')
    const desc = str(record.relation ?? record.desc ?? record.description ?? record.note, '')
    if (name.length > 0) entries.push({ name, desc })
  }
  return entries
}

/** 正文按 `## ` 标题切分小节（首个标题前的导语并入「简介」；开头的一级标题视为文件名头，剥离）。 */
export function splitSections(content: string): SectionEntry[] {
  const sections: SectionEntry[] = []
  const parts = content.split(/^##\s+/m)
  const preamble = (parts[0] ?? '').replace(/^#\s+\S[^\n]*\n?/, '').trim()
  if (preamble.length > 0) sections.push({ title: '简介', body: preamble })
  for (let i = 1; i < parts.length; i++) {
    const nl = parts[i]!.indexOf('\n')
    const title = (nl >= 0 ? parts[i]!.slice(0, nl) : parts[i]!).replace(/#+\s*$/, '').trim()
    const body = (nl >= 0 ? parts[i]!.slice(nl + 1) : '').trim()
    if (title.length > 0 || body.length > 0) sections.push({ title: title.length > 0 ? title : '—', body })
  }
  return sections
}

/** 正文「关系」小节的列表项解析（`- **名字**：描述` / `- 名字：描述`）。 */
export function extractBodyRelations(content: string): RelationEntry[] {
  const section = splitSections(content).find(s => /关系/.test(s.title))
  if (section === undefined) return []
  const entries: RelationEntry[] = []
  for (const rawLine of section.body.split('\n')) {
    const line = rawLine.trim()
    const m = /^[-*]\s+\*\*(.+?)\*\*\s*[：:]\s*(.*)$/.exec(line) ?? /^[-*]\s+([^*：:\s][^：:]*)[：:]\s*(.*)$/.exec(line)
    if (m !== null && m[1]!.trim().length > 0) entries.push({ name: m[1]!.trim(), desc: m[2]!.trim() })
  }
  return entries
}

function characterRow(source: CharacterSource): CharacterRow {
  const fm = source.frontmatter
  const timeline = timelineEntries(fm.timeline)
  // 关系：frontmatter 结构化优先，正文「## 关系」小节补充（按名字去重）
  const relations = [...relationEntries(fm.relations)]
  for (const body of extractBodyRelations(source.content)) {
    if (!relations.some(r => r.name === body.name)) relations.push(body)
  }
  return {
    id: source.name.replace(/\.md$/, ''),
    name: str(fm.name, source.name.replace(/\.md$/, '')),
    role: str(fm.role, ''),
    arc: str(fm.arc, ''),
    timelineCount: timeline.length,
    relationCount: relations.length,
    timeline,
    relations,
    sections: splitSections(source.content),
  }
}

/** 大纲视图模型（outline.md frontmatter synopsis/volumes/chapters + 正文小节）。 */
function outlineOverview(source: OutlineSource | null | undefined): OutlineOverview | null {
  if (source === null || source === undefined) return null
  const fm = source.frontmatter
  const synopsis = str(fm.synopsis, '')
  const sections = splitSections(source.content)
  if (synopsis.length === 0 && sections.length === 0) return null
  return {
    synopsis,
    volumes: num(fm.volumes) ?? 0,
    chapterTarget: num(fm.chapters) ?? 0,
    sections,
  }
}

/** 从扫描结果计算总览（纯函数，单测覆盖）。 */
export function buildOverview(scan: NovelScan): NovelOverview {
  const sorted = [...scan.chapters].sort((a, b) => {
    const an = num(a.frontmatter.number) ?? 0
    const bn = num(b.frontmatter.number) ?? 0
    return an - bn || a.name.localeCompare(b.name)
  })
  const totalChars = sorted.reduce((sum, ch) => sum + charCount(ch.content), 0)

  const volumeMap = new Map<string, number>()
  for (const ch of sorted) {
    const volume = str(ch.frontmatter.volume, '未分卷')
    volumeMap.set(volume, (volumeMap.get(volume) ?? 0) + 1)
  }

  const foreshadowMap = new Map<string, number>()
  for (const plot of scan.plots) {
    const status = str(plot.frontmatter.status, 'unknown')
    foreshadowMap.set(status, (foreshadowMap.get(status) ?? 0) + 1)
  }

  const project = scan.project
  const targetWords = project !== null ? num(project.target_words) : null
  const chapterTarget = project !== null ? num(project.chapters) : null

  const chapterRows = sorted.map(chapterRow)
  const characterRows = scan.characters.map(characterRow)
    .sort((a, b) => b.timelineCount - a.timelineCount || a.id.localeCompare(b.id))

  return {
    title: project !== null ? str(project.title, '未命名项目') : '未命名项目',
    genre: project !== null ? str(project.genre, '') : '',
    targetWords: targetWords ?? 0,
    chapterTarget: chapterTarget ?? 0,
    chapters: sorted.length,
    totalChars,
    progress: targetWords !== null && targetWords > 0 ? Math.min(totalChars / targetWords, 1) : null,
    volumes: [...volumeMap.entries()].map(([name, count]) => ({ name, count })),
    foreshadow: [...foreshadowMap.entries()].map(([status, count]) => ({ status, count })),
    outline: outlineOverview(scan.outline),
    recentChapters: chapterRows.slice(-5).reverse(),
    chapterRows,
    plotRows: scan.plots.map(plotRow).sort((a, b) => a.status.localeCompare(b.status) || a.id.localeCompare(b.id)),
    characterRows,
    worldbuildingCount: scan.worldbuildingCount,
    pendingSections: scan.pending,
    pendingLineTotal: scan.pending.reduce((sum, section) => sum + section.lines.length, 0),
  }
}

/** 解析一个 Markdown 文件为 frontmatter + 正文（扫描入口用；坏 frontmatter 宽容回退）。 */
export function splitSource(raw: string): { frontmatter: Frontmatter; content: string } {
  try {
    return parseFrontmatter(raw)
  } catch {
    return { frontmatter: {}, content: raw }
  }
}

/**
 * pending.md → 待办分节（倒序 + 去重 + 过滤）。
 *
 * - 按 `## ` 标题切分；首个标题前的散列表项归入「待办」节（放最末，视为最旧）。
 * - 分节倒序输出（pending.md 追加写，**最新维护 pass 在文件末尾**——旧实现取文件前
 *   30 行恰是最旧一次 pass）。
 * - 跨分节按归一化文本去重（保留最新一次的出现）。
 * - `[x] 已完成` 行过滤。
 */
export function extractPendingSections(text: string): PendingSection[] {
  const parts = text.split(/^##\s+/m)
  const sections: PendingSection[] = []
  const preambleLines = pendingListLines(parts[0] ?? '')
  if (preambleLines.length > 0) sections.push({ heading: '待办', lines: preambleLines })
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i] ?? ''
    const nl = part.indexOf('\n')
    const heading = (nl >= 0 ? part.slice(0, nl) : part).trim()
    const body = nl >= 0 ? part.slice(nl + 1) : ''
    const lines = pendingListLines(body)
    if (heading.length > 0 || lines.length > 0) sections.push({ heading: heading.length > 0 ? heading : '—', lines })
  }
  // 倒序（最新在前）+ 跨节去重（保留最新出现）
  const seen = new Set<string>()
  const result: PendingSection[] = []
  for (const section of sections.reverse()) {
    const lines = section.lines.filter(line => {
      const key = line.replace(/\s+/g, '')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (lines.length > 0) result.push({ heading: section.heading, lines })
  }
  return result
}

/** 一段文本里的待办列表行（剥 `- `/`* ` 前缀；过滤 `[x]` 已完成行）。 */
function pendingListLines(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^[-*]\s+\S/.test(line))
    .map(line => line.replace(/^[-*]\s+/, ''))
    .filter(line => !/^\[x\]\s*/i.test(line))
}
