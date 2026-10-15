/**
 * M1b 增量订阅与扫描健壮性单测（mock remote 流）：
 * watchProject 三路径（ready/change/ended/unsupported/abort）、mapPool 并发与取消、
 * readText 分页拼接与保险丝、「工具落盘→变更帧→重扫→总线新值」环路（函数级接线）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mapPool, scanNovel, setBrowserContext, watchProject } from '../src/client/load.ts'
import { publishScan, readBus, resetBus } from '../src/client/bus.ts'

/** 可控 changes 流：外部 push 帧 / 结束 / 抛错。 */
function controlledStream() {
  const queue: Array<{ kind: 'ready' | 'change' } | { kind: 'error'; error: unknown } | { kind: 'done' }> = []
  let wake: (() => void) | null = null
  return {
    push(frame: { kind: 'ready' | 'change' }): void {
      queue.push(frame)
      wake?.()
    },
    end(): void {
      queue.push({ kind: 'done' })
      wake?.()
    },
    fail(error: unknown): void {
      queue.push({ kind: 'error', error })
      wake?.()
    },
    stream: (async function* () {
      for (;;) {
        while (queue.length === 0) await new Promise<void>(resolve => { wake = resolve })
        wake = null
        const item = queue.shift()!
        if (item.kind === 'done') return
        if (item.kind === 'error') throw item.error
        yield item
      }
    })(),
  }
}

/** 挂一个带 changes 流的 mock remote（watchProject 经 setBrowserContext 取 remote）。 */
function mockChangesRemote(stream: AsyncIterable<{ kind: 'ready' | 'change' }>): void {
  setBrowserContext({ remote: { workspaceFiles: { changes: () => stream } } as never } as never)
}

test('watchProject：ready 一次 + change 逐帧回调 + 流结束 ended', async () => {
  const controller = new AbortController()
  const feed = controlledStream()
  mockChangesRemote(feed.stream)
  let ready = 0
  const changes: number[] = []
  const watching = watchProject('s1', 'novel', controller.signal, () => { changes.push(1) }, () => { ready++ })
  feed.push({ kind: 'ready' })
  feed.push({ kind: 'change' })
  feed.push({ kind: 'change' })
  await new Promise(r => setTimeout(r, 20))
  feed.end()
  assert.equal(await watching, 'ended')
  assert.equal(ready, 1)
  assert.equal(changes.length, 2)
  setBrowserContext(null)
})

test('watchProject：watch-unsupported 错误码降级 / abort 返回 ended', async () => {
  const feed = controlledStream()
  mockChangesRemote(feed.stream)
  const watching = watchProject('s1', 'novel', new AbortController().signal, () => {})
  feed.fail({ code: 'workspace-file/watch-unsupported', message: 'no watch' })
  assert.equal(await watching, 'unsupported')
  const controller = new AbortController()
  const feed2 = controlledStream()
  mockChangesRemote(feed2.stream)
  const watching2 = watchProject('s1', 'novel', controller.signal, () => {})
  controller.abort()
  feed2.push({ kind: 'change' })
  assert.equal(await watching2, 'ended')
  setBrowserContext(null)
})

test('mapPool：并发度不超限 + 结果保序 + 首错上抛（迟到错误不逃逸）', async () => {
  const signal = new AbortController().signal
  let active = 0
  let maxActive = 0
  const items = Array.from({ length: 20 }, (_, i) => i)
  const result = await mapPool(items, 4, async (item) => {
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise(r => setTimeout(r, 5))
    active--
    return item * 2
  }, signal)
  assert.deepEqual(result, items.map(i => i * 2))
  assert.ok(maxActive <= 4, `并发度 ${maxActive} 超限`)
  // 首个错误上抛；其余 worker 的迟到同因错误被吞（不产生 unhandled rejection）
  let unhandled: unknown = null
  const onUnhandled = (e: unknown): void => { unhandled = e }
  process.on('unhandledRejection', onUnhandled)
  try {
    await assert.rejects(mapPool([0, 1, 2, 3], 4, async (item) => {
      await new Promise(r => setTimeout(r, 5))
      if (item === 1) throw new Error('boom')
      return item
    }, signal), /boom/)
    await new Promise(r => setTimeout(r, 30))
    assert.equal(unhandled, null)
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('mapPool：abort 抛 AbortError 且不再消费后续项', async () => {
  const controller = new AbortController()
  const consumed: number[] = []
  const started = mapPool([0, 1, 2, 3, 4, 5], 2, async (item) => {
    consumed.push(item)
    await new Promise(r => setTimeout(r, 10))
    return item
  }, controller.signal)
  await new Promise(r => setTimeout(r, 5))
  controller.abort()
  await assert.rejects(started, { name: 'AbortError' })
  assert.ok(!consumed.includes(5), 'abort 后不应继续消费后续项')
})

/** 构造 mock remote 文件系统（分页 read 支持小页尺寸以锁定页拼接契约）。 */
function mockRemote(fs: Map<string, unknown>, opts: { pageSize?: number; neverEof?: boolean } = {}) {
  const entries = (path: string) => {
    const value = fs.get(path)
    return Array.isArray(value) ? value : undefined
  }
  return {
    workspaceFiles: {
      async list(_sid: string, path: string) {
        const e = entries(path)
        return e === undefined ? { ok: false, error: { message: `no such dir ${path}` } } : { ok: true, value: { entries: e } }
      },
      async read(_sid: string, path: string, range: { offset?: number } = {}) {
        const text = fs.get(path)
        if (typeof text !== 'string') return { ok: false, error: { message: `no such file ${path}` } }
        // neverEof：模拟协议异常（每页恒有内容且永不到达 eof）——触发 readText 页数保险丝
        if (opts.neverEof === true && (range.offset ?? 1) > 1) {
          return { ok: true, value: { text: '更多内容', lines: 1, eof: false } }
        }
        const lines = text.split('\n')
        const size = opts.pageSize ?? lines.length
        const offset = range.offset ?? 1
        const page = lines.slice(offset - 1, offset - 1 + size)
        return {
          ok: true,
          value: {
            text: page.join('\n'),
            lines: page.length,
            eof: opts.neverEof === true ? false : offset - 1 + size >= lines.length,
          },
        }
      },
      changes: undefined,
    },
  }
}

function minimalProject(): Map<string, unknown> {
  return new Map<string, unknown>([
    ['', [{ name: 'novel', type: 'directory' }]],
    ['novel', [{ name: 'project.md', type: 'file' }, { name: 'chapters', type: 'directory' }]],
    ['novel/project.md', '---\ntitle: "环路书"\n---\n'],
    ['novel/chapters', [{ name: '001.md', type: 'file' }]],
    ['novel/chapters/001.md', '---\nnumber: 1\n---\n初始正文四个字\n'],
  ])
}

test('scanNovel：小分页拼接还原全文（页间换行契约）+ never-eof 触发保险丝入失败清单', async () => {
  const fs = minimalProject()
  setBrowserContext({ remote: mockRemote(fs, { pageSize: 2 }) as never })
  const scan = await scanNovel('s1', new AbortController().signal)
  // 每页 2 行的拼接结果与整读一致（页间补 \n 契约；content 为剥 frontmatter 后正文）
  assert.equal(scan.chapters[0]!.content, '初始正文四个字\n')
  setBrowserContext({ remote: mockRemote(fs, { pageSize: 2, neverEof: true }) as never })
  const fused = await scanNovel('s1', new AbortController().signal)
  assert.equal(fused.chapters.length, 0)
  assert.equal(fused.failedFiles?.includes('novel/chapters/001.md'), true)
  setBrowserContext(null)
})

test('环路（函数级接线）：工具落盘→变更帧→重扫→总线新值（实体变更达页签）', async () => {
  resetBus()
  const fs = minimalProject()
  const sessions = { list: { getSnapshot: () => ({ byId: { s1: { id: 's1', retainedBy: { mainView: 1 } } } }) } }
  setBrowserContext({ remote: mockRemote(fs), sessions: sessions as never })

  // 初扫 + 发布（Panel 扫描 effect 的等价接线）
  publishScan(await scanNovel('s1', new AbortController().signal))
  assert.equal(readBus().scan!.overview.totalChars, 7)

  // watch 接管 + 模拟工具落盘（write_chapter 改稿）→ change 帧 → 重扫 → 新值
  const controller = new AbortController()
  const feed = controlledStream()
  const base = mockRemote(fs) as { workspaceFiles: Record<string, unknown> }
  const remoteWithChanges = { workspaceFiles: { ...base.workspaceFiles, changes: () => feed.stream } }
  setBrowserContext({ remote: remoteWithChanges as never, sessions: sessions as never })
  let invalidated = false
  const watching = watchProject('s1', 'novel', controller.signal, () => { invalidated = true }, () => {})
  feed.push({ kind: 'ready' })
  // 工具落盘：改写 001 章正文（模拟 write_chapter/timeline_update 保存）
  fs.set('novel/chapters/001.md', '---\nnumber: 1\n---\n改稿后的正文有八个字\n')
  feed.push({ kind: 'change' })
  await new Promise(r => setTimeout(r, 20))
  assert.equal(invalidated, true)
  // Panel 去抖后的重扫动作（此处直接执行）
  publishScan(await scanNovel('s1', new AbortController().signal))
  assert.equal(readBus().scan!.overview.totalChars, 10)
  controller.abort()
  feed.end()
  await watching
  resetBus()
  setBrowserContext(null)
})
