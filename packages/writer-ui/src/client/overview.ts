/**
 * 冷启动总览聚合（纯函数）：从 novel/ 扫描到的原始文件集合计算面板数据。
 *
 * 与 novel-writer 的「打开项目即拉存储」范式对齐：不依赖本会话跑过工具；
 * 输入是 workspaceFiles remote 拉到的 Markdown 文本，解析复用 domain 纯函数
 * （parseFrontmatter），输出直接可渲染的视图模型。
 */
import { parseFrontmatter, type Frontmatter } from 'dsh-writer-domain'

/** 一章的原始文件（frontmatter + 正文）。 */
export interface ChapterSource {
  name: string
  frontmatter: Frontmatter
  content: string
}

/** 一条情节/伏笔的原始文件（frontmatter 足够）。 */
export interface PlotSource {
  name: string
  frontmatter: Frontmatter
}

/** 项目级 frontmatter（project.md）。 */
export type ProjectSource = Frontmatter | null

/** 扫描结果（load.ts 产出，本模块消费）。 */
export interface NovelScan {
  root: string
  project: ProjectSource
  chapters: ChapterSource[]
  plots: PlotSource[]
  characterCount: number
  pendingLines: string[]
}

/** 最近一章行。 */
export interface ChapterRow {
  id: string
  title: string
  volume: string
  chars: number
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
  characterCount: number
  recentChapters: ChapterRow[]
  pendingLines: string[]
}

function charCount(text: string): number {
  // 正文字数口径：去空白后的码点数（与 writer_stats 的「约 N 字」近似一致）
  return text.replace(/\s/g, '').length
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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
    characterCount: scan.characterCount,
    recentChapters: sorted.slice(-5).reverse().map(ch => ({
      id: ch.name.replace(/\.md$/, ''),
      title: str(ch.frontmatter.title, ch.name),
      volume: str(ch.frontmatter.volume, ''),
      chars: charCount(ch.content),
    })),
    pendingLines: scan.pendingLines.slice(0, 8),
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

/** pending.md 的待办行提取（列表项行，去掉前缀符号；标题/空行忽略）。 */
export function extractPendingLines(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^[-*]\s+\S/.test(line))
    .map(line => line.replace(/^[-*]\s+/, ''))
}
