/**
 * 宿主数据通道访问层：经 ctx.remote.workspaceFiles（list/read/changes）与 ctx.sessions
 * 主动读取当前会话工作区的 novel/ 项目文件（第一方 dsh-client-ui-sidebar-files 同范式；
 * 消费现成服务，不新增 remote 端点）。
 *
 * M1b：①readText 分页保险丝（页数/字节上限防协议异常 OOM）；②批量读有限并发（4 路）
 * + 进度回调；③单文件失败收集（清单呈现，不再整扫描失败）；④扫描 .writer/derived/
 * maintenance + client 侧内容哈希（与 domain 同口径）计算待维护章节；⑤pending-archive
 * 归档扫描；⑥watchProject 订阅 workspaceFiles.changes（不支持时降级手动刷新）；
 * ⑦会话切换经 sessions.list.subscribe（替换 2s 轮询）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { extractPendingSections, splitSource, type NovelScan, type PendingSection } from './overview.ts'
import { contentHashClient } from './hash.ts'

/** workspaceFiles remote 的本地最小契约（第一方同款调用面）。 */
interface WorkspaceFilesApi {
  list(sessionId: string, path: string, signal?: AbortSignal): Promise<{ ok: boolean; value?: any; error?: any }>
  read(sessionId: string, path: string, range: { offset?: number; limit?: number }, signal?: AbortSignal): Promise<{ ok: boolean; value?: any; error?: any }>
  /** 目录变更流（api/workspace-files changes；第一方 files 侧栏同款）。第三方可选消费。 */
  changes?(sessionId: string, path: string, signal?: AbortSignal): AsyncIterable<{ kind: 'ready' | 'change' }>
}

/** sessions 服务的本地最小契约（ObservableSnapshot：getSnapshot + subscribe）。 */
interface SessionsApi {
  list: {
    getSnapshot(): { byId?: Record<string, { retainedBy?: Record<string, number>; id?: string }> }
    subscribe?(listener: () => void): () => void
  }
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

/**
 * 当前活跃会话 id（main 视图持有的会话）。
 * 无 mainView 持有者返回 null（不取任意第一会话——键序不稳定且语义失真）；
 * 服务缺席/形状异常宽容返回 null。
 */
export function activeSessionId(): string | null {
  try {
    const list = browserCtx?.sessions?.list
    if (list === undefined || typeof list.getSnapshot !== 'function') return null
    const byId = list.getSnapshot()?.byId ?? {}
    const active = Object.values(byId).find(s => (s.retainedBy?.mainView ?? 0) > 0)
    return active?.id ?? null
  } catch {
    return null
  }
}

/** 订阅会话清单变化（会话切换/新建/关闭；observable 缺席时返回 noop 并告知不可用）。 */
export function subscribeSessions(listener: () => void): { dispose: () => void; supported: boolean } {
  const list = browserCtx?.sessions?.list
  if (list === undefined || typeof list.subscribe !== 'function') return { dispose: () => {}, supported: false }
  return { dispose: list.subscribe(listener), supported: true }
}

function remote(): WorkspaceFilesApi | null {
  return browserCtx?.remote?.workspaceFiles ?? null
}

// —— readText 保险丝（协议异常/超巨文件防 OOM；上限放宽到正常长篇单文件远不可及；
// 字数口径为 UTF-16 码元数（非字节——CJK 实际字节≈2 倍，上限语义偏松一倍，方向无害）——
const READ_MAX_PAGES = 400
const READ_MAX_CHARS = 8 * 1024 * 1024

/**
 * 读一个文本文件全文（按 eof 分页循环；读失败抛错；每页检查取消；页数/字节保险丝）。
 */
async function readText(sessionId: string, path: string, signal: AbortSignal): Promise<string> {
  const api = remote()
  if (api === null) throw new Error('workspaceFiles remote 不可用')
  let offset = 1
  let text = ''
  for (let page = 0; ; page++) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    if (page >= READ_MAX_PAGES) throw new Error(`read ${path} 超过 ${READ_MAX_PAGES} 页保险丝`)
    if (text.length > READ_MAX_CHARS) throw new Error(`read ${path} 超过 ${READ_MAX_CHARS} 字符保险丝`)
    const result = await api.read(sessionId, path, { offset }, signal)
    if (!result.ok) throw new Error(`read ${path} 失败: ${JSON.stringify(result.error ?? null)}`)
    const pageValue = result.value as { text: string; lines: number; eof: boolean }
    text += pageValue.text
    if (pageValue.eof || pageValue.lines === 0) return text
    offset += pageValue.lines
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

/** 批量读并发度（M1b 正确性修复包⑥：串行逐文件全量读在百章项目秒级放大）。 */
const READ_CONCURRENCY = 4

/** 有限并发映射（保持结果顺序；首个错误上抛，其余 worker 的迟到错误吞掉——并发取消场景 Promise.all 只抛首个，迟到的同因 rejection 不能变成 unhandled）。导出供单测。 */
export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>, signal: AbortSignal): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let failed = false
  let firstError: unknown = undefined
  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal.aborted) {
        if (!failed) { failed = true; firstError = new DOMException('aborted', 'AbortError') }
        return
      }
      const index = next++
      if (index >= items.length) return
      try {
        results[index] = await fn(items[index]!, index)
      } catch (error) {
        if (!failed) { failed = true; firstError = error }
        return
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  if (failed) throw firstError
  return results
}

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

/** 一个待读文件任务（dir 为项目内相对目录；subdir 为章卷子目录名）。 */
interface ReadTask {
  dir: string
  name: string
  subdir?: string
}

/** 扫描进度（done/total 按文件读取计）。 */
export type ScanProgress = (done: number, total: number) => void

/**
 * 扫描 novel/ 项目：定位根目录，收集章/情节/人物/世界观/四单文件实体/待办/归档/派生新鲜度。
 * 单文件读取失败不使整扫描失败——计入 failedFiles 清单呈现（M1b 正确性修复包④）。
 */
export async function scanNovel(sessionId: string, signal: AbortSignal, onProgress?: ScanProgress): Promise<NovelScan> {
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
  const projectEntries = rootEntries

  // —— 阶段一：列目录，收集待读文件任务 ——
  const tasks: ReadTask[] = []
  const chaptersDir = join(root, 'chapters')
  {
    const entries = await listDir(sessionId, chaptersDir, signal)
    if (entries !== null) {
      for (const entry of entries) {
        if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        if (entry.type === 'file' && /\.md$/i.test(entry.name)) {
          tasks.push({ dir: chaptersDir, name: entry.name })
        } else if (entry.type === 'dir') {
          // 一层卷子目录（chapters/卷一/001.md 布局——M1a 裁定：支持一层，不深递归）
          const subEntries = await listDir(sessionId, join(chaptersDir, entry.name), signal)
          if (subEntries === null) continue
          for (const sub of mdFiles(subEntries)) tasks.push({ dir: chaptersDir, name: sub.name, subdir: entry.name })
        }
      }
    }
  }
  for (const dirName of ['plots', 'characters', 'style']) {
    const entries = await listDir(sessionId, join(root, dirName), signal)
    if (entries !== null) for (const entry of mdFiles(entries)) tasks.push({ dir: join(root, dirName), name: entry.name })
  }
  // 单文件实体与项目文件（根目录命中才读）
  const rootFiles = ['project.md', 'outline.md', 'principles.md', 'events.md', 'ideas.md', 'pending.md', '.writer/pending-archive.md']
  for (const name of rootFiles) {
    if (name.includes('/')) {
      // 归档在 .writer/ 子目录：目录列举缺失时静默跳过（.writer 可能整体 gitignore 不可见）
      const dir = join(root, '.writer')
      const entries = await listDir(sessionId, dir, signal)
      if (entries !== null && entries.some(e => e.type === 'file' && e.name === 'pending-archive.md')) {
        tasks.push({ dir, name: 'pending-archive.md' })
      }
    } else if (projectEntries.some(e => e.type === 'file' && e.name === name)) {
      tasks.push({ dir: root, name })
    }
  }
  // 派生维护产物（.writer/derived/maintenance/<chapterId>.json）
  const maintenanceDir = join(root, '.writer/derived/maintenance')
  const maintenanceEntries = await listDir(sessionId, maintenanceDir, signal)
  if (maintenanceEntries !== null) {
    for (const entry of maintenanceEntries) {
      if (entry.type === 'file' && /\.json$/i.test(entry.name)) tasks.push({ dir: maintenanceDir, name: entry.name })
    }
  }

  // —— 阶段二：有限并发批量读（单文件失败收集，进度回调按完成文件计）——
  const failedFiles: string[] = []
  let done = 0
  const readResults = await mapPool(tasks, READ_CONCURRENCY, async (task) => {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    let raw: string | null
    try {
      raw = await readText(sessionId, join(task.dir, task.name), signal)
    } catch (error) {
      if (signal.aborted) throw error
      failedFiles.push(join(task.dir, task.name))
      raw = null
    }
    done++
    onProgress?.(done, tasks.length)
    return { task, raw }
  }, signal)

  // —— 阶段三：按任务目录归类为扫描结果 ——
  const chapters: any[] = []
  const plots: any[] = []
  const characters: any[] = []
  const style: any[] = []
  const singletons = new Map<string, { frontmatter: any; content: string }>()
  const maintenance = new Map<string, { sourceHash?: string; updatedAt?: string }>()
  for (const { task, raw } of readResults) {
    if (raw === null) continue
    const parsed = splitSource(raw)
    const record = { name: task.name, frontmatter: parsed.frontmatter, content: parsed.content, ...(task.subdir !== undefined ? { subdir: task.subdir } : {}) }
    if (task.dir === chaptersDir) chapters.push(record)
    else if (task.dir === join(root, 'plots')) plots.push(record)
    else if (task.dir === join(root, 'characters')) characters.push(record)
    else if (task.dir === join(root, 'style')) style.push(record)
    else if (task.dir === maintenanceDir) {
      try {
        const json = JSON.parse(raw) as { sourceHash?: string; updatedAt?: string }
        // 键 = 章节文件名去 .json（与 store 派生落盘口径一致，扁平不分子目录）；
        // 跨卷同名章节共享同一条派生记录（store 侧同样按 id 扁平落盘）——比对结果
        // 逐章独立：内容哈希匹配者为新鲜，另一章计待维护（合理信号而非误报）
        maintenance.set(task.name.replace(/\.json$/i, ''), { sourceHash: json.sourceHash, updatedAt: json.updatedAt })
      } catch { /* 坏派生 JSON：按缺失处理（该章计待维护），不使扫描失败 */ }
    } else singletons.set(task.name, parsed)
  }

  // worldbuilding：条目 id 清单（M1a 口径；全文读取随需）
  let worldbuildingNames: string[] = []
  const worldbuildingEntries = await listDir(sessionId, join(root, 'worldbuilding'), signal)
  if (worldbuildingEntries !== null) worldbuildingNames = mdFiles(worldbuildingEntries).map(e => e.name)

  // 大纲/项目/待办/归档
  const outline = singletons.get('outline.md') ?? null
  let project: any = null
  const projectFile = singletons.get('project.md')
  if (projectFile !== undefined) {
    project = projectFile.frontmatter
  } else if (outline !== null) {
    // 无 project.md（旧布局）：书名回退取大纲首个一级标题（通用标题不算书名）
    const heading = outline.content.split('\n').find((line: string) => /^#\s+\S/.test(line))?.replace(/^#\s+/, '').trim() ?? ''
    project = /^(大纲|outline|目录|toc)$/i.test(heading) || heading.length === 0 ? null : { title: heading }
  }
  const pending: PendingSection[] = singletons.has('pending.md') ? extractPendingSections(singletons.get('pending.md')!.content) : []
  const pendingArchive: PendingSection[] = singletons.has('pending-archive.md') ? extractPendingSections(singletons.get('pending-archive.md')!.content) : []

  // —— 派生新鲜度（维护徽章数据源）：client 内容哈希与 derived sourceHash 同口径比对 ——
  // 章节缺失派生或哈希不一致 = 待维护 pass（与服务端 writer_stats staleChapters 同语义；
  // 分歧留痕：remote 读取失败的章节不入本清单（计入 failedFiles），服务端按全量章节判）。
  const staleChapters: string[] = []
  {
    const hashed = await mapPool(chapters, READ_CONCURRENCY, async (chapter) => {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      const id = String(chapter.name).replace(/\.md$/, '')
      const derived = maintenance.get(id)
      if (derived === undefined || derived.sourceHash === undefined) return id
      const hash = await contentHashClient(chapter.frontmatter, chapter.content)
      return hash === derived.sourceHash ? null : id
    }, signal)
    for (const id of hashed) if (id !== null) staleChapters.push(id)
    staleChapters.sort()
  }

  const singleton = (name: string) => singletons.get(name)
  return {
    root: root === '' ? '.' : root, project, outline, chapters, plots, characters, worldbuildingCount: worldbuildingNames.length, pending,
    ...(singleton('principles.md') !== undefined ? { principles: singleton('principles.md')! } : {}),
    ...(singleton('events.md') !== undefined ? { events: singleton('events.md')! } : {}),
    ...(singleton('ideas.md') !== undefined ? { ideas: singleton('ideas.md')! } : {}),
    ...(style.length > 0 ? { style } : {}),
    ...(worldbuildingNames.length > 0 ? { worldbuildingNames } : {}),
    ...(failedFiles.length > 0 ? { failedFiles } : {}),
    ...(staleChapters.length > 0 ? { staleChapters } : {}),
    ...(pendingArchive.length > 0 ? { pendingArchive } : {}),
  }
}

/** watch 结果：'unsupported'（fs 不支持 watch / 服务缺席，降级手动刷新）或 'ended'（流关闭）。 */
export type WatchOutcome = 'unsupported' | 'ended'

/**
 * 订阅项目目录变更（workspaceFiles.changes，目录粒度；工具落盘即触发→重扫描）。
 * onReady 在 watch 就绪时回调一次（标记增量刷新已接管）；onInvalidated 在每次变更帧
 * 时回调（去抖由调用方负责）；signal 中止即退订。
 */
export async function watchProject(sessionId: string, dir: string, signal: AbortSignal, onInvalidated: () => void, onReady?: () => void): Promise<WatchOutcome> {
  const api = remote()
  if (api === null || api.changes === undefined) return 'unsupported'
  let stream: AsyncIterator<{ kind: 'ready' | 'change' }> | undefined
  try {
    // await 兼容同步返回 iterable 与 Promise<iterable> 两种宿主形态
    const iterable = await api.changes(sessionId, dir, signal)
    stream = iterable[Symbol.asyncIterator]()
    for (;;) {
      if (signal.aborted) return 'ended'
      const frame = await stream.next()
      if (frame.done === true) return 'ended'
      if (frame.value.kind === 'ready') onReady?.()
      if (frame.value.kind === 'change') onInvalidated()
    }
  } catch (error) {
    // RemoteError code 形态宽容判断（不引入宿主错误类依赖）
    const code = (error as { code?: string } | null)?.code
    if (code === 'workspace-file/watch-unsupported') return 'unsupported'
    if (signal.aborted) return 'ended'
    // 其余错误（连接断开等）不抛出面板——按流结束处理，调用方靠手动刷新兜底
    return 'ended'
  } finally {
    try { await stream?.return?.() } catch { /* 流清理失败不影响降级路径 */ }
  }
}
