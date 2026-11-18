import test from 'node:test'
import assert from 'node:assert/strict'
import { publishScan, publishWatchState, readBus, recordToolResult, resetBus } from '../src/client/bus.ts'
import { buildOverview } from '../src/client/project.ts'
import type { NovelScan } from '../src/client/overview.ts'

const scan = (title: string): NovelScan => ({ root: 'novel', project: { title }, outline: null, chapters: [], plots: [], characters: [], worldbuildingCount: 0, pending: [] })

test('工作台：保留两会话扫描，迟到回执及同 callId 按来源隔离', () => {
    resetBus()
    publishScan(scan('甲'), 'a')
    publishScan(scan('乙'), 'b')
    publishWatchState(true, 'a')
    recordToolResult('writer_read', '甲回执', {}, { sessionId: 'a', callId: 'same' })
    recordToolResult('writer_read', '乙回执', {}, { sessionId: 'b', callId: 'same' })
    assert.equal(readBus('a').scan?.overview.title, '甲')
    assert.equal(readBus('b').scan?.overview.title, '乙')
    assert.equal(readBus('b').scan?.watched, null)
    assert.equal(readBus('a').live.activities[0]?.summary, '甲回执')
    assert.equal(readBus('b').live.activities[0]?.summary, '乙回执')
    assert.equal(readBus('c').scan, null)
    assert.equal(readBus('b'), readBus('b'))
    resetBus()
})

test('工作台：回收逾期只读取 resolve_chapter，保留伏笔全文及章定位', () => {
    const overview = buildOverview({ ...scan('书'), chapters: [{ name: '005.md', frontmatter: { number: 5 }, content: '正文' }], plots: [
        { name: 'future.md', frontmatter: { status: 'planted', planned_chapter: '001', planted_chapter: '004', resolve_chapter: '009' }, content: '完整正文'.repeat(100) },
        { name: 'late.md', frontmatter: { status: 'planted', planned_chapter: '001', resolve_chapter: '003' }, content: '旧线索' },
    ] })
    const future = overview.plotRows.find(row => row.id === 'future')!
    assert.equal(future.overdue, false)
    assert.equal(future.resolveChapter, '009')
    assert.equal(future.content, '完整正文'.repeat(100))
    assert.equal(overview.plotRows.find(row => row.id === 'late')?.overdue, true)
    assert.equal(overview.chapterRows[0]?.number, 5)
    assert.equal(overview.chapterRows[0]?.path, 'chapters/005.md')
})

test('工作台：无来源会话的回执不写入当前活跃项目', async () => {
    const { setBrowserContext } = await import('../src/client/load.ts')
    resetBus()
    setBrowserContext({ sessions: { list: { getSnapshot: () => ({ byId: { a: { id: 'a', retainedBy: { mainView: 1 } } } }) } } })
    recordToolResult('writer_read', '无来源回执', {})
    assert.equal(readBus('a').live.activities.length, 0)
    assert.equal(readBus('_anonymous').live.activities.length, 1)
    resetBus()
    setBrowserContext(null)
})
