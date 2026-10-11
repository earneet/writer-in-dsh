/**
 * 宿主数据通道访问层：经 ctx.remote.workspaceFiles（list/read）与 ctx.sessions
 * 主动读取当前会话工作区的 novel/ 项目文件（第一方 dsh-client-ui-sidebar-files 同范式；
 * 消费现成服务，不新增 remote 端点）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { extractPendingLines, splitSource, type NovelScan } from './overview.ts'

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

/** apply 期注入浏览器半 Context（模块级单例，Panel/hooks 经此访问宿主服务）。 */
export function setBrowserContext(ctx: BrowserContext): void {
  browserCtx = ctx
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

/** 读一个文本文件全文（按 eof 分页循环；读失败抛错）。 */
async function readText(sessionId: string, path: string, signal: AbortSignal): Promise<string> {
  const api = remote()
  if (api === null) throw new Error('workspaceFiles remote 不可用')
  let offset = 1
  let text = ''
  for (;;) {
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

/** 小说项目根的标记物：任一命中即认定（兼容 novel/ 子目录布局与项目根直铺布局，无章节也能识别）。 */
const ROOT_MARKERS = ['project.md', 'principles.md', 'outline.md', 'chapters', 'characters', 'plots', 'worldbuilding']

const hasMarker = (entries: any[]): boolean => entries.some(e => ROOT_MARKERS.includes(e.name))

/** 扫描 novel/ 项目：定位根目录（<cwd>/novel 或工作区根本身），收集章/情节/人物数/待办。 */
export async function scanNovel(sessionId: string, signal: AbortSignal): Promise<NovelScan> {
  // 根目录探测：优先 novel/ 子目录（轮次 18 布局）；'.'/' 为工作区根本身（旧布局，大纲阶段
  // 无 chapters/ 也要能识别——两个根路径写法都试）；最后兜底本仓库 dev overlay 的示例项目。
  const rootCandidates = ['novel', '.', '', 'example-project/novel', 'example-project/novel/_demo-green-flame']
  let root = ''
  let rootEntries: any[] | null = null
  for (const candidate of rootCandidates) {
    const entries = await listDir(sessionId, candidate, signal)
    if (entries === null || !hasMarker(entries)) continue
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
      for (const entry of mdFiles(entries)) {
        const raw = await readText(sessionId, join(join(root, 'chapters'), entry.name), signal)
        const { frontmatter, content } = splitSource(raw)
        chapters.push({ name: entry.name, frontmatter, content })
      }
    }
  }

  const plots: any[] = []
  const plotEntries = await listDir(sessionId, join(root, 'plots'), signal)
  if (plotEntries !== null) {
    for (const entry of mdFiles(plotEntries)) {
      const raw = await readText(sessionId, join(join(root, 'plots'), entry.name), signal)
      plots.push({ name: entry.name, frontmatter: splitSource(raw).frontmatter })
    }
  }

  const characters: any[] = []
  const characterEntries = await listDir(sessionId, join(root, 'characters'), signal)
  if (characterEntries !== null) {
    for (const entry of mdFiles(characterEntries)) {
      const raw = await readText(sessionId, join(join(root, 'characters'), entry.name), signal)
      characters.push({ name: entry.name, frontmatter: splitSource(raw).frontmatter })
    }
  }

  let worldbuildingCount = 0
  const worldbuildingEntries = await listDir(sessionId, join(root, 'worldbuilding'), signal)
  if (worldbuildingEntries !== null) worldbuildingCount = mdFiles(worldbuildingEntries).length

  const projectEntries = rootEntries ?? []
  let project: any = null
  if (projectEntries.some(e => e.type === 'file' && e.name === 'project.md')) {
    project = splitSource(await readText(sessionId, join(root, 'project.md'), signal)).frontmatter
  } else if (projectEntries.some(e => e.type === 'file' && e.name === 'outline.md')) {
    // 无 project.md（旧布局）：书名回退取大纲首个一级标题（通用标题不算书名）
    const outline = await readText(sessionId, join(root, 'outline.md'), signal)
    const heading = outline.split('\n').find(line => /^#\s+\S/.test(line))?.replace(/^#\s+/, '').trim() ?? ''
    project = /^(大纲|outline|目录|toc)$/i.test(heading) || heading.length === 0 ? null : { title: heading }
  }

  let pendingLines: string[] = []
  if (projectEntries.some(e => e.type === 'file' && e.name === 'pending.md')) {
    pendingLines = extractPendingLines(await readText(sessionId, join(root, 'pending.md'), signal))
  }

  return { root: root === '' ? '.' : root, project, chapters, plots, characters, worldbuildingCount, pendingLines }
}
