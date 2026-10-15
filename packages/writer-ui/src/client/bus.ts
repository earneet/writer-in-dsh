/**
 * 写作面板数据总线（M1b）：模块级 store——冷扫描产物（实体图投影）+ 工具动态合并、
 * 版本化快照、subscribe。
 *
 * 硬约束（roadmap §4.1 M1b）：**总线不是第二真源**——快照全部可从 novel/ 全量扫描 +
 * 本客户端工具结果重建（内存派生物，刷新即失由冷扫描兜底）。
 *
 * 会话桶（轮次 22 §7.1 #5 清偿）：toolview props 无 sessionId，记录时以
 * activeSessionId() 解析当前活跃会话为桶键（无活跃会话落 '_anonymous' 单桶）——
 * 同一客户端内不同会话的写作动态不再串台。
 * 卡片记录幂等（轮次 22 §7.1 #4 清偿）：recordToolResult 由卡片 useEffect 调用，
 * callId 已见过则跳过（FIFO 淘汰上限防泄漏）；幂等**依赖宿主 callId**（§1.5 公共
 * props，result 阶段恒在）——缺席时不去重（如实声明，不做内容键兜底：同工具同回执
 * 的合法重复调用会被误杀）。
 */
import type { EntityGraph, NovelOverview } from './types.ts'
import { buildEntityGraph } from './graph.ts'
import { buildOverview } from './project.ts'
import type { NovelScan } from './overview.ts'
import { activeSessionId } from './load.ts'
import type { ReviewReport, WriteChapterResult, WriterStats } from './parse.ts'

/** 一条写作动态（时间线倒序展示）。 */
export interface WriterActivity {
  time: string
  tool: string
  summary: string
}

/** 一个会话桶的写作动态快照（stats/writes/activities 等）。 */
export interface WriterLiveState {
  stats: WriterStats | null
  lastWrite: WriteChapterResult | null
  lastReview: ReviewReport | null
  writes: WriteChapterResult[]
  activities: WriterActivity[]
}

/** 冷扫描在总线中的快照部分。 */
export interface ScanState {
  root: string
  overview: NovelOverview
  graph: EntityGraph
  /** 实体图宽容解析告警（坏 JSON/脏锚/章号冲突等）。 */
  warnings: string[]
  failedFiles: string[]
  staleChapters: string[]
  /** changes 订阅状态：true=已接管增量刷新 / false=不支持（手动刷新兜底）/ null=未决。 */
  watched: boolean | null
}

/** 总线快照（version 单调递增；live 为当前活跃会话桶）。 */
export interface WriterBusSnapshot {
  version: number
  scan: ScanState | null
  live: WriterLiveState
}

const ANONYMOUS = '_anonymous'
const emptyLive = (): WriterLiveState => ({ stats: null, lastWrite: null, lastReview: null, writes: [], activities: [] })

const liveBuckets = new Map<string, WriterLiveState>()
let scanState: ScanState | null = null
let version = 0
const listeners = new Set<() => void>()
const seenCallIds = new Map<string, true>()
const SEEN_CALL_IDS_MAX = 500
let pendingWatched: boolean | null = null

function currentBucket(): string {
  return activeSessionId() ?? ANONYMOUS
}

function liveOf(bucket: string): WriterLiveState {
  return liveBuckets.get(bucket) ?? emptyLive()
}

function notify(): void {
  for (const listener of listeners) listener()
}

// 快照缓存：version/bucket 未变时返回同一引用（useSyncExternalStore 判等依赖）
let cachedSnapshot: WriterBusSnapshot | null = null
let cachedBucket = ''

/** 读取总线快照（引用稳定：无变更/无桶切换时返回同一对象）。 */
export function readBus(): WriterBusSnapshot {
  const bucket = currentBucket()
  if (cachedSnapshot === null || cachedSnapshot.version !== version || bucket !== cachedBucket) {
    cachedSnapshot = { version, scan: scanState, live: liveOf(bucket) }
    cachedBucket = bucket
  }
  return cachedSnapshot
}

/** 订阅总线变更（返回退订函数）。 */
export function subscribeBus(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 发布一次成功扫描（构建实体图 + 投影总览；watched 取 changes 订阅接线方的最新标记）。 */
export function publishScan(scan: NovelScan): void {
  const graph = buildEntityGraph(scan)
  scanState = {
    root: scan.root,
    overview: buildOverview(scan),
    graph,
    warnings: graph.warnings,
    failedFiles: scan.failedFiles ?? [],
    staleChapters: scan.staleChapters ?? [],
    watched: scanState?.watched ?? pendingWatched,
  }
  version++
  notify()
}

/** 更新 changes 订阅状态（扫描未就绪时暂存，下次 publishScan 生效；不伪造空快照）。 */
export function publishWatchState(watched: boolean | null): void {
  if (scanState === null) {
    pendingWatched = watched
    return
  }
  if (scanState.watched === watched) return
  scanState = { ...scanState, watched }
  version++
  notify()
}

function now(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

/** recordToolResult 的解析器集（卡片按工具类型供给；未供给仅记动态行）。 */
export interface RecordParsers {
  stats?: (text: string) => WriterStats | null
  write?: (text: string) => WriteChapterResult | null
  review?: (text: string) => ReviewReport | null
}

/**
 * 卡片在 result 阶段经 useEffect 调用：记录一次工具结果并更新当前活跃会话桶。
 * callId 幂等（重复渲染/严格模式双调不重复记录）；label 为卡片已算出的摘要文案。
 */
export function recordToolResult(tool: string, content: string, parse: RecordParsers, options: { callId?: string; label?: string } = {}): void {
  if (options.callId !== undefined) {
    if (seenCallIds.has(options.callId)) return
    seenCallIds.set(options.callId, true)
    if (seenCallIds.size > SEEN_CALL_IDS_MAX) {
      for (const key of seenCallIds.keys()) {
        seenCallIds.delete(key)
        if (seenCallIds.size <= SEEN_CALL_IDS_MAX) break
      }
    }
  }
  const bucket = currentBucket()
  const state = liveOf(bucket)
  const next: WriterLiveState = { ...state, writes: [...state.writes], activities: [...state.activities] }
  if (parse.stats !== undefined) {
    const stats = parse.stats(content)
    if (stats !== null) next.stats = stats
  }
  if (parse.write !== undefined) {
    const write = parse.write(content)
    if (write !== null) {
      next.lastWrite = write
      next.writes.unshift(write)
      if (next.writes.length > 20) next.writes.length = 20
    }
  }
  if (parse.review !== undefined) {
    const review = parse.review(content)
    if (review !== null) next.lastReview = review
  }
  const summary = options.label !== undefined && options.label.length > 0
    ? options.label
    : content.split('\n').find(line => line.trim().length > 0) ?? tool
  next.activities.unshift({ time: now(), tool, summary })
  if (next.activities.length > 30) next.activities.length = 30
  liveBuckets.set(bucket, next)
  version++
  notify()
}

/** 丢弃全部桶与扫描态（测试隔离用；生产生命周期与页面一致）。 */
export function resetBus(): void {
  liveBuckets.clear()
  scanState = null
  seenCallIds.clear()
  pendingWatched = null
  version++
  cachedSnapshot = null
  notify()
}
