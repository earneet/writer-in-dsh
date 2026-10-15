/**
 * 宿主数据通道访问层：经 ctx.remote.workspaceFiles（list/read）与 ctx.sessions
 * 主动读取当前会话工作区的 novel/ 项目文件（第一方 dsh-client-ui-sidebar-files 同范式；
 * 消费现成服务，不新增 remote 端点）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { extractPendingSections, splitSource, type NovelScan, type PendingSection } from './overview.ts'

/** workspaceFiles remote 的本地最小契约（第一方同款调用面）。 */
interface WorkspaceFilesApi {
  list(sessionId: string, path: string, signal?: AbortSignal): Promise<{ ok: boolean; value?: any; error?: any }>
  read(sessionId: string, path: string, range: { offset?: number; limit?: number }, signal?: AbortSignal): Promise<{ ok: boolean; value?: any; error?: any }>
}

/** sessions 服务的本地最小契约（活跃会话探测；ObservableSnapshot.getSnapshot 读取）。 */
interface SessionsApi {
  list: { getSnapshot(): { byId?: Record<string, { retainedBy?: Record<string, number>; id?: string }> } }
}

type BrowserContext = Context & {
  remote?: { workspaceFiles?: WorkspaceFilesApi }
  sessions?: SessionsApi
}

let browserCtx: BrowserContext | null = null

/** apply 期注入浏览器半 Context（模块级单例，Panel/hooks 经此访问宿主服务；effect 清理时置 null 防悬空引用）。 */
export function setBrowserContext(ctx: { remote?: BrowserContext['remote']; sessions?: BrowserContext['sessions'] } | null): void {
  browserCtx = ctx as BrowserContext | null
}

/** 当前活跃会话 id（main 视图持有的会话；无活跃会话返回 null；服务缺席/形状异常宽容返回 null）。 */
export function activeSessionId(): string | null {
  try {
    const list = browserCtx?.sessions?.list
    if (list === undefined || typeof list.getSnapshot !== 'function') return null
    const state = list.getSnapshot()
    const byId = state?.byId ?? {}
    const active = Object.values(byId).find(s => (s.retainedBy?.mainView ?? 0) > 0)
    return active?.id ?? Object.keys(byId)[0] ?? null
  } catch {
    return null
  }
}

function remote(): WorkspaceFilesApi | null {
  return browserCtx?.remote?.workspaceFiles ?? null
}

/** 读一个文本文件全文（按 eof 分页循环；读失败抛错；每页检查取消，取消语义不外包给宿主 read 传播）。 */
async function readText(sessionId: string, path: string, signal: AbortSignal): Promise<string> {
  const api = remote()
  if (api === null) throw new Error('workspaceFiles remote 不可用')
  let offset = 1
  let text = ''
  for (;;) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    const result = await api.read(sessionId, path, { offset }, signal)
    if (!result.ok) throw new Error(`read ${path} 失败: ${JSON.stringify(result.error ?? null)}`)
    const page = result.value as { text: string; lines: number; eof: boolean }
    text += page.text
    if (page.eof || page.lines === 0) return text
    offset += page.lines
    if (!text.endsWith('\n')) text += '\n'
  }
}

/** 列目录（读失败/不存在返回 null）。 */
async function listDir(sessionId: string, path: string, signal: AbortSignal): Promise<any[] | null> {
  const api = remote()
  if (api === null) return null
  const result = await api.list(sessionId, path, signal)
  if (!result.ok) return null
  return (result.value as { entries: any[] }).entries
}

const mdFiles = (entries: any[]): any[] => entries.filter(e => e.type === 'file' && /\.md$/i.test(e.name))

/** 小说项目根的标记物：任一命中即认定（兼容 novel/ 子目录布局与项目根直铺布局；含 ideas.md——纯灵感起步项目也要能识别）。 */
const ROOT_MARKERS = ['project.md', 'principles.md', 'outline.md', 'ideas.md', 'events.md', 'chapters', 'characters', 'plots', 'worldbuilding']

/** 强标记（单命中即可判定项目根；目录名泛化，弱标记需两个以上防普通工作区误判）。 */
const STRONG_MARKERS = new Set(['project.md', 'principles.md', 'outline.md', 'ideas.md', 'events.md'])

/** 候选根是否判定为小说项目：强标记单命中，或弱标记（目录名）≥2 命中。 */
function looksLikeProject(entries: any[], lenient: boolean): boolean {
  const names = new Set(entries.map(e => e.name))
  const hits = ROOT_MARKERS.filter(marker => names.has(marker))
  if (lenient) return hits.length > 0
  const strong = hits.some(marker => STRONG_MARKERS.has(marker))
  return strong || hits.length >= 2
}

/** 扫描 novel/ 项目：定位根目录（<cwd>/novel 或工作区根本身），收集章/情节/人物数/待办。 */
export async function scanNovel(sessionId: string, signal: AbortSignal): Promise<NovelScan> {
  // 根目录探测：优先 novel/ 子目录（轮次 18 布局；子目录名即强语境，宽松判定）；
  // '.'/' 为工作区根本身（旧布局直铺——目录名泛化，从严判定防误认普通工作区）。
  const rootCandidates = ['novel', '.', '']
  let root = ''
  let rootEntries: any[] | null = null
  for (const candidate of rootCandidates) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    const entries = await listDir(sessionId, candidate, signal)
    if (entries === null || !looksLikeProject(entries, candidate === 'novel')) continue
    // '.' 与 '' 等价（工作区根本身）；后续 join 用 '' 前缀
    root = candidate === '.' ? '' : candidate
    rootEntries = entries
    break
  }
  if (rootEntries === null) throw new Error('未找到小说项目目录（novel/ 或工作区根需含 outline/chapters/characters/plots 等标记）')
  const join = (dir: string, name: string): string => dir === '' ? name : `${dir}/${name}`

  const chapters: any[] = []
  {
    const entries = await listDir(sessionId, join(root, 'chapters'), signal)
    if (entries !== null) {
      for (const entry of entries) {
        if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        if (entry.type === 'file' && /\.md$/i.test(entry.name)) {
          const raw = await readText(sessionId, join(join(root, 'chapters'), entry.name), signal)
          const { frontmatter, content } = splitSource(raw)
          chapters.push({ name: entry.name, frontmatter, content })
        } else if (entry.type === 'dir') {
          // 一层卷子目录（chapters/卷一/001.md 布局——M1a 裁定：支持一层，不深递归）
          const subEntries = await listDir(sessionId, join(join(root, 'chapters'), entry.name), signal)
          if (subEntries === null) continue
          for (const sub of subEntries) {
            if (signal.aborted) throw new DOMException('aborted', 'AbortError')
            if (sub.type !== 'file' || !/\.md$/i.test(sub.name)) continue
            const raw = await readText(sessionId, join(join(join(root, 'chapters'), entry.name), sub.name), signal)
            const { frontmatter, content } = splitSource(raw)
            chapters.push({ name: sub.name, frontmatter, content, subdir: entry.name })
          }
        }
      }
    }
  }

  const plots: any[] = []
  const plotEntries = await listDir(sessionId, join(root, 'plots'), signal)
  if (plotEntries !== null) {
    for (const entry of mdFiles(plotEntries)) {
      const raw = await readText(sessionId, join(join(root, 'plots'), entry.name), signal)
      const { frontmatter, content } = splitSource(raw)
      plots.push({ name: entry.name, frontmatter, content })
    }
  }

  const characters: any[] = []
  const characterEntries = await listDir(sessionId, join(root, 'characters'), signal)
  if (characterEntries !== null) {
    for (const entry of mdFiles(characterEntries)) {
      const raw = await readText(sessionId, join(join(root, 'characters'), entry.name), signal)
      const { frontmatter, content } = splitSource(raw)
      characters.push({ name: entry.name, frontmatter, content })
    }
  }

  let worldbuildingCount = 0
  let worldbuildingNames: string[] = []
  const worldbuildingEntries = await listDir(sessionId, join(root, 'worldbuilding'), signal)
  if (worldbuildingEntries !== null) {
    worldbuildingNames = mdFiles(worldbuildingEntries).map(e => e.name)
    worldbuildingCount = worldbuildingNames.length
  }

  // —— M1a 扫描缺口补全（对照 writer-store KIND_LAYOUT；单文件实体 + style/ 目录）——
  const projectEntries = rootEntries ?? []
  const readSingleton = async (fileName: string): Promise<any | undefined> => {
    if (!projectEntries.some(e => e.type === 'file' && e.name === fileName)) return undefined
    return splitSource(await readText(sessionId, join(root, fileName), signal))
  }
  const principles = await readSingleton('principles.md')
  const events = await readSingleton('events.md')
  const ideas = await readSingleton('ideas.md')

  const style: any[] = []
  const styleEntries = await listDir(sessionId, join(root, 'style'), signal)
  if (styleEntries !== null) {
    for (const entry of mdFiles(styleEntries)) {
      const raw = await readText(sessionId, join(join(root, 'style'), entry.name), signal)
      const { frontmatter, content } = splitSource(raw)
      style.push({ name: entry.name, frontmatter, content })
    }
  }

  // 大纲：novel/outline.md（旧布局为根 outline.md），frontmatter + 正文分节均保留
  let outline: any = null
  const outlineName = projectEntries.some(e => e.type === 'file' && e.name === 'outline.md') ? 'outline.md' : null
  if (outlineName !== null) {
    outline = splitSource(await readText(sessionId, join(root, outlineName), signal))
  }

  let project: any = null
  if (projectEntries.some(e => e.type === 'file' && e.name === 'project.md')) {
    project = splitSource(await readText(sessionId, join(root, 'project.md'), signal)).frontmatter
  } else if (outline !== null) {
    // 无 project.md（旧布局）：书名回退取大纲首个一级标题（通用标题不算书名）
    const heading = outline.content.split('\n').find((line: string) => /^#\s+\S/.test(line))?.replace(/^#\s+/, '').trim() ?? ''
    project = /^(大纲|outline|目录|toc)$/i.test(heading) || heading.length === 0 ? null : { title: heading }
  }

  let pending: PendingSection[] = []
  if (projectEntries.some(e => e.type === 'file' && e.name === 'pending.md')) {
    pending = extractPendingSections(await readText(sessionId, join(root, 'pending.md'), signal))
  }

  return {
    root: root === '' ? '.' : root, project, outline, chapters, plots, characters, worldbuildingCount, pending,
    ...(principles !== undefined ? { principles } : {}),
    ...(events !== undefined ? { events } : {}),
    ...(ideas !== undefined ? { ideas } : {}),
    ...(style.length > 0 ? { style } : {}),
    ...(worldbuildingNames.length > 0 ? { worldbuildingNames } : {}),
  }
}
