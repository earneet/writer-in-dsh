/**
 * 扫描侧类型与 Markdown 解析基元。
 *
 * M1b 换源后：视图模型类型迁至 types.ts（本文件 type 再导出保持旧引用兼容）、总览
 * 聚合在 project.ts（实体图投影）；本模块保留 NovelScan 扫描形状 + splitSections/
 * extractBodyRelations/splitSource/extractPendingSections 解析基元（graph.ts 与扫描共用）。
 */
import { parseFrontmatter, sectionChapterIds, splitPendingSections, type Frontmatter } from 'dsh-writer-domain'
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
  /** worldbuilding 条目全文记录（设定页数据源；name/frontmatter/content）。
   * 迁移留痕（v8）：旧键 `worldbuildingNames?: string[]`（仅名单）改为本全文形态——
   * 形式上是字段替换；旧形状（只带 names）会被解释为 0 条世界观实体（graph 消费方
   * 仅包内，无外部持有者）。读取条目数有上限（WORLDBUILDING_MAX），超出截断并在
   * scan 标记 worldbuildingTruncated。 */
  worldbuilding?: PlotSource[]
  /** worldbuilding 条目超过读取上限被截断的数量（0/缺省 = 未截断）。 */
  worldbuildingTruncated?: number
  // —— M1b 数据总线扩展（全部 optional：旧形状扫描结果与既有 fixture 不破坏）——
  /** 单文件读取失败清单（部分失败语义：不使整扫描失败，面板呈现「N 个文件读取失败」）。 */
  failedFiles?: string[]
  /** 待维护 pass 章节清单（client 内容哈希 vs derived sourceHash 同口径比对）。 */
  staleChapters?: string[]
  /** 项目根 pending-archive.md 归档分节（倒序：最新归档在前；旧布局 .writer/ 兜底合并）。 */
  pendingArchive?: PendingSection[]
  archiveSources?: { path: string; text: string }[]
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
export function splitSource(raw: string): { frontmatter: Frontmatter; content: string; invalidFrontmatter?: true } {
  try {
    return parseFrontmatter(raw)
  } catch {
    return { frontmatter: {}, content: raw, invalidFrontmatter: true }
  }
}

/**
 * pending.md → 待办分节（倒序 + 去重 + 过滤）。
 *
 * - 按 `## ` 标题切分；首个标题前的散列表项归入「待办」节（放最末，视为最旧）。
 * - 分节倒序输出（pending.md 追加写，**最新维护 pass 在文件末尾**——旧实现取文件前
 *   30 行恰是最旧一次 pass）。
 * - 同一来源版本与标记轮次内按归一化文本去重（保留最新一次的出现）。
 * - `[x] 已完成` 行过滤。
 */
export function extractPendingSections(text: string, chapterHashes?: ReadonlyMap<string, string>): PendingSection[] {
    const { preamble, sections } = splitPendingSections(text)
    const marks = new Map<string, number>()
    const seen = new Set<string>()
    const result: PendingSection[] = []
    for (const { header, body } of [...sections.reverse(), { header: '## 待办', body: preamble }]) {
        const heading = header.slice(3).trim() || '—'
        const [, kind, generatedChapter] = /^\[(维护 pass|recompute mark)\] chapter\/(\d{3})(?=$|[\s（])/.exec(heading) ?? []
        const chapterIds = [...sectionChapterIds({ header, body })]
        const chapterId = generatedChapter ?? (chapterIds.length === 1 ? chapterIds[0] : undefined)
        const laterMarks = chapterId === undefined ? 0 : marks.get(chapterId) ?? 0
        if (chapterId !== undefined && kind === 'recompute mark') {
            marks.set(chapterId, laterMarks + 1)
            continue
        }
        const sourceHash = kind === '维护 pass' ? /^<!-- writer-pending-source:([0-9a-f]{64}) -->$/.exec(body.split('\n', 1)[0] ?? '')?.[1] : undefined
        const scope = chapterHashes === undefined ? '' : `${chapterId ?? ''}:${sourceHash ?? ''}:${laterMarks}:`
        const lines = pendingListLines(body).filter(line => {
            const key = scope + line.replace(/\s+/g, '')
            if (seen.has(key)) return false
            seen.add(key)
            return true
        })
        if (lines.length === 0) continue
        if (chapterHashes === undefined) {
            result.push({ heading, lines })
            continue
        }
        const currentHash = chapterId === undefined ? undefined : chapterHashes.get(chapterId)
        const state = laterMarks > 0 ? 'invalidated'
            : sourceHash === undefined || currentHash === undefined ? 'unknown'
            : sourceHash === currentHash ? 'current' : 'stale'
        result.push({ heading, lines, state, ...(chapterId === undefined ? {} : { chapterId }), ...(sourceHash === undefined ? {} : { sourceHash }) })
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
