/**
 * 写作面板的会话级状态：从工具结果文本派生的视图模型（模块级存储）。
 *
 * 数据流：富卡片（toolview）在 result 阶段解析工具输出并 record()；侧边栏面板按
 * sessionId 读取快照。v1 取舍（README 留痕）：不依赖宿主 remote（第三方不能加端点）、
 * 不读全量会话事件窗口——面板反映「本会话内已发生的写作工具动态」，跨会话不共享。
 * 变更通知用版本号 + 轮询（面板 useEffect 每 800ms 对账一次），自包含零依赖。
 */
import type { ReviewReport, WriteChapterResult, WriterStats } from './parse.ts'

/** 一条写作动态（时间线倒序展示）。 */
export interface WriterActivity {
  time: string
  tool: string
  summary: string
}

/** 一个会话的写作面板快照。 */
export interface WriterPanelState {
  version: number
  stats: WriterStats | null
  lastWrite: WriteChapterResult | null
  lastReview: ReviewReport | null
  writes: WriteChapterResult[]
  activities: WriterActivity[]
}

type Listener = () => void

const states = new Map<string, WriterPanelState>()
const listeners = new Set<Listener>()

function stateOf(sessionId: string): WriterPanelState {
  let state = states.get(sessionId)
  if (state === undefined) {
    state = { version: 0, stats: null, lastWrite: null, lastReview: null, writes: [], activities: [] }
    states.set(sessionId, state)
  }
  return state
}

function mutate(sessionId: string, mutator: (state: WriterPanelState) => void): void {
  const state = stateOf(sessionId)
  // 派生视图模型按不可变快照更新（面板 useMemo 依赖引用判等）
  const next: WriterPanelState = { ...state, version: state.version + 1, activities: [...state.activities], writes: [...state.writes] }
  mutator(next)
  states.set(sessionId, next)
  for (const listener of listeners) listener()
}

function now(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

/** 富卡片在 result 阶段调用：记录一次工具结果并更新派生快照（label 为卡片已算出的摘要文案）。 */
export function recordToolResult(sessionId: string, tool: string, content: string, parse: {
  stats?: (text: string) => WriterStats | null
  write?: (text: string) => WriteChapterResult | null
  review?: (text: string) => ReviewReport | null
}, label?: string): void {
  const key = sessionId.length > 0 ? sessionId : '_anonymous'
  mutate(key, (state) => {
    if (parse.stats !== undefined) {
      const stats = parse.stats(content)
      if (stats !== null) state.stats = stats
    }
    if (parse.write !== undefined) {
      const write = parse.write(content)
      if (write !== null) {
        state.lastWrite = write
        state.writes.unshift(write)
        if (state.writes.length > 20) state.writes.length = 20
      }
    }
    if (parse.review !== undefined) {
      const review = parse.review(content)
      if (review !== null) state.lastReview = review
    }
    state.activities.unshift({ time: now(), tool, summary: label ?? content.split('\n')[0] ?? tool })
    if (state.activities.length > 30) state.activities.length = 30
  })
}

/** 面板读取当前快照（不存在返回空态）。 */
export function readPanelState(sessionId: string): WriterPanelState | undefined {
  return states.get(sessionId.length > 0 ? sessionId : '_anonymous')
}

/** 面板订阅变更（返回退订函数）。 */
export function subscribePanel(_listener: Listener): () => void {
  listeners.add(_listener)
  return () => { listeners.delete(_listener) }
}
