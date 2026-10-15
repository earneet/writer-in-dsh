/**
 * 扫描侧类型与 Markdown 解析基元。
 *
 * M1b 换源后：视图模型类型迁至 types.ts（本文件 type 再导出保持旧引用兼容）、总览
 * 聚合在 project.ts（实体图投影）；本模块保留 NovelScan 扫描形状 + splitSections/
 * extractBodyRelations/splitSource/extractPendingSections 解析基元（graph.ts 与扫描共用）。
 */
import { parseFrontmatter, type Frontmatter } from 'dsh-writer-domain'
import type { PendingSection, RelationEntry, SectionEntry } from './types.ts'

// 视图模型类型的家在 types.ts（M1b 迁移；此处 type 再导出兼容旧引用——TimelineEntry
// 迁移后更名为实体层同名 TimelineEvent）
export type {
  ChapterRow, CharacterRow, NextStep, NovelOverview, OutlineOverview, PendingSection,
  PlotRow, RelationEntry, SectionEntry, TimelineEvent,
} from './types.ts'
export type { TimelineEvent as TimelineEntry } from './types.ts'

/** 一章的原始文件（frontmatter + 正文；subdir = 一层卷子目录名，顶层章节缺省）。 */
export interface ChapterSource {
  name: string
  frontmatter: Frontmatter
  content: string
  subdir?: string
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

/** 大纲/单文件实体的原始文件（frontmatter + 正文分节）。 */
export interface OutlineSource {
  frontmatter: Frontmatter
  content: string
}

/** 项目级 frontmatter（project.md）。 */
export type ProjectSource = Frontmatter | null

/** 扫描产出的单文件实体/项目文件统一形状（frontmatter + 正文）。 */
export type SingletonSource = { frontmatter: Frontmatter; content: string }

/** 扫描结果（load.ts 产出，本模块与 graph/project 消费）。 */
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
  // —— M1a 扫描缺口补全（对照 writer-store KIND_LAYOUT；面板暂不消费，实体图消费）——
  /** 单文件实体 principles.md（KIND_LAYOUT:30）。 */
  principles?: OutlineSource
  /** 单文件实体 events.md（KIND_LAYOUT:35；全书事件权威 SoT）。 */
  events?: OutlineSource
  /** 单文件实体 ideas.md（KIND_LAYOUT:36）。 */
  ideas?: OutlineSource
  /** style/ 目录（KIND_LAYOUT:37；风格示范 few-shot）。 */
  style?: PlotSource[]
  /** worldbuilding 条目 id 清单（M1a 仅扫描名字；全文读取随 M1b 总线）。 */
  worldbuildingNames?: string[]
  // —— M1b 数据总线扩展（全部 optional：旧形状扫描结果与既有 fixture 不破坏）——
  /** 单文件读取失败清单（部分失败语义：不使整扫描失败，面板呈现「N 个文件读取失败」）。 */
  failedFiles?: string[]
  /** 待维护 pass 章节清单（client 内容哈希 vs derived sourceHash 同口径比对）。 */
  staleChapters?: string[]
  /** .writer/pending-archive.md 归档分节（倒序：最新归档在前）。 */
  pendingArchive?: PendingSection[]
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
