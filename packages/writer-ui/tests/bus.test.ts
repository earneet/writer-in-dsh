/**
 * 数据总线单测（M1b）：版本化快照/订阅、会话桶隔离、callId 幂等、publishScan/watch 态。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { setBrowserContext } from '../src/client/load.ts'
import { publishScan, publishWatchState, readBus, recordToolResult, resetBus, subscribeBus } from '../src/client/bus.ts'
import { parseWriterStats } from '../src/client/parse.ts'

const STATS = '章节：3 章，共约 8500 字\n卷分布：第一卷×3\n人物：1 个\n人物弧线覆盖：1/1（timeline 共 2 条）\n伏笔：planned×1、planted×2\n维护派生覆盖：3/3\n'

/** 可切换活跃会话的 sessions mock（含 subscribe）。 */
function mockSessions() {
  let snapshot: { byId: Record<string, { id: string; retainedBy: Record<string, number> }> } = {
    byId: { s1: { id: 's1', retainedBy: { mainView: 1 } }, s2: { id: 's2', retainedBy: {} } },
  }
  const listeners = new Set<() => void>()
  setBrowserContext({
    sessions: {
      list: {
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
    },
  })
  return {
    /** 把 mainView 持有权切给某会话（触发 sessions 订阅者）。 */
    switchTo(id: string) {
      const byId: typeof snapshot.byId = {}
      for (const [key, value] of Object.entries(snapshot.byId)) byId[key] = { ...value, retainedBy: key === id ? { mainView: 1 } : {} }
      snapshot = { byId }
      for (const listener of listeners) listener()
    },
  }
}

test('会话桶隔离：写作动态按活跃会话分桶，切回不串台', () => {
  resetBus()
  const sessions = mockSessions()
  recordToolResult('writer_stats', STATS, { stats: parseWriterStats })
  assert.equal(readBus().live.activities.length, 1)
  // 切换活跃会话：新桶为空（旧桶数据保留待切回）
  sessions.switchTo('s2')
  assert.equal(readBus().live.activities.length, 0)
  recordToolResult('writer_stats', STATS, { stats: parseWriterStats })
  assert.equal(readBus().live.activities.length, 1)
  // 切回 s1：仍只有最初一条
  sessions.switchTo('s1')
  assert.equal(readBus().live.activities.length, 1)
  resetBus()
  setBrowserContext(null)
})

test('callId 幂等：重复渲染双调不重复记录', () => {
  resetBus()
  mockSessions()
  recordToolResult('writer_stats', STATS, { stats: parseWriterStats }, { callId: 'c1' })
  recordToolResult('writer_stats', STATS, { stats: parseWriterStats }, { callId: 'c1' })
  assert.equal(readBus().live.activities.length, 1)
  recordToolResult('writer_stats', STATS, { stats: parseWriterStats }, { callId: 'c2' })
  assert.equal(readBus().live.activities.length, 2)
  resetBus()
  setBrowserContext(null)
})

test('publishScan / publishWatchState / 订阅通知与快照引用稳定', () => {
  resetBus()
  mockSessions()
  let notifications = 0
  const dispose = subscribeBus(() => { notifications++ })
  publishScan({ root: 'novel', project: { title: '总线书' }, outline: null, chapters: [], plots: [], characters: [], worldbuildingCount: 0, pending: [] })
  const first = readBus()
  assert.equal(first.scan?.overview.title, '总线书')
  assert.equal(first.scan?.watched, null)
  // 无变更时快照引用稳定（useSyncExternalStore 判等依赖）
  assert.equal(readBus(), first)
  publishWatchState(true)
  assert.notEqual(readBus(), first)
  assert.equal(readBus().scan?.watched, true)
  assert.ok(notifications >= 2)
  // publishWatchState 同值不触发版本/通知
  const before = readBus()
  publishWatchState(true)
  assert.equal(readBus(), before)
  dispose()
  resetBus()
  setBrowserContext(null)
})

test('publishWatchState 在扫描前调用不伪造快照（暂存到下次 publishScan）', () => {
  resetBus()
  mockSessions()
  publishWatchState(true)
  assert.equal(readBus().scan, null)
  publishScan({ root: 'novel', project: null, outline: null, chapters: [], plots: [], characters: [], worldbuildingCount: 0, pending: [] })
  assert.equal(readBus().scan?.watched, true)
  resetBus()
  setBrowserContext(null)
})
