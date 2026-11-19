/**
 * M1b 增量订阅与扫描健壮性单测（mock remote 流）：
 * watchProject 三路径（ready/change/ended/unsupported/abort）、mapPool 并发与取消、
 * readText 分页拼接与保险丝、「工具落盘→变更帧→重扫→总线新值」环路（函数级接线）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { WorkspaceFiles } from '@deepseek-ai/dsh-api-workspace-files'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { mapPool, scanNovel, setBrowserContext, watchProject, WORLDBUILDING_MAX } from '../src/client/load.ts'
import { publishScan, readBus, resetBus } from '../src/client/bus.ts'
import { buildOverview } from '../src/client/project.ts'
import { contentHashClient } from '../src/client/hash.ts'
import { splitSource } from '../src/client/overview.ts'

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
function mockRemote(fs: Map<string, unknown>, opts: { pageSize?: number; neverEof?: boolean; hostLineWindow?: boolean } = {}) {
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
        const lines = opts.hostLineWindow && text.length === 0 ? []
          : (opts.hostLineWindow ? text.replace(/\n$/, '') : text).split('\n')
        const size = opts.pageSize ?? lines.length
        const offset = range.offset ?? 1
        const page = lines.slice(offset - 1, offset - 1 + size)
        return {
          ok: true,
          value: {
            text: page.join('\n'),
            lines: page.length,
            eof: opts.neverEof === true ? false : offset - 1 + size >= lines.length,
            ...(opts.hostLineWindow ? { bytes: Buffer.byteLength(text, 'utf8'), version: path } : {}),
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

test('内容哈希一致的部分维护结果仍显示为待维护，完成后清除提示', async () => {
    const fs = minimalProject()
    const chapter = splitSource(fs.get('novel/chapters/001.md') as string)
    const sourceHash = await contentHashClient(chapter.frontmatter, chapter.content)
    fs.set('novel/.writer/derived/maintenance', [{ name: '001.json', type: 'file' }])
    const record = 'novel/.writer/derived/maintenance/001.json'
    setBrowserContext({ remote: mockRemote(fs) as never })
    try {
        const scan = () => scanNovel('s1', new AbortController().signal)
        fs.set(record, JSON.stringify({ sourceHash, partial: true }))
        assert.deepEqual((await scan()).staleChapters, ['001'])
        fs.set(record, JSON.stringify({ sourceHash, partial: false }))
        assert.deepEqual((await scan()).staleChapters ?? [], [])
        fs.set(record, JSON.stringify({ sourceHash }))
        assert.deepEqual((await scan()).staleChapters ?? [], [])
    } finally { setBrowserContext(null) }
})

test('工作台归档原文：保留完成项、重复项和非列表段落及来源路径', async () => {
    const fs = minimalProject()
    const raw = '# 归档\n\n## chapter/001\n\n人工说明段落。\n- [x] 已确认状态\n- 重复建议\n\n## chapter/002\n\n- 重复建议\n\n'
    ;(fs.get('novel') as unknown[]).push({ name: 'pending-archive.md', type: 'file' })
    fs.set('novel/pending-archive.md', raw)
    setBrowserContext({ remote: mockRemote(fs, { hostLineWindow: true, pageSize: 2 }) as never })
    const scan = await scanNovel('s1', new AbortController().signal)
    assert.deepEqual(scan.archiveSources, [{ path: 'novel/pending-archive.md', text: raw }])
    assert.deepEqual(buildOverview(scan).archiveSources, scan.archiveSources)
    setBrowserContext(null)
})

test('实际宿主读取 UTF-8 BOM 与 CRLF 行窗口时，工作台核对当前章并保留完整归档', async t => {
    const workspace = await mkdtemp(join(tmpdir(), 'writer-ui-host-read-'))
    t.after(() => rm(workspace, { recursive: true, force: true }))
    await mkdir(join(workspace, 'novel/chapters'), { recursive: true })
    const chapterPath = 'novel/chapters/001.md'
    const archivePath = 'novel/pending-archive.md'
    const pendingPath = 'novel/pending.md'
    const chapterText = '\uFEFF---\r\nnumber: 1\r\n---\r\n第一段。\r\n\r\n第二段。\r\n'
    const archiveText = '\uFEFF# 归档\r\n\r\n## chapter/001\r\n- [x] 保留原文'
    const chapter = splitSource(chapterText)
    const sourceHash = await contentHashClient(chapter.frontmatter, chapter.content)
    await Promise.all([
        writeFile(join(workspace, 'novel/project.md'), '\uFEFF---\r\ntitle: "登记作品"\r\n---\r\n'),
        writeFile(join(workspace, chapterPath), chapterText),
        writeFile(join(workspace, pendingPath), `\uFEFF## [维护 pass] chapter/001（本轮）待人工确认\r\n<!-- writer-pending-source:${sourceHash} -->\r\n- 核对版本。\r\n`),
        writeFile(join(workspace, archivePath), archiveText),
    ])
    const ctx = new Context()
    const local = await ctx.plugin(LocalFileSystem, { cwd: workspace })
    t.after(() => local.dispose())
    ctx.provide('sandboxPolicy', { workspaceRoot: workspace, resolve: () => ({ mode: 'workspace-write', workspaceRoot: workspace }) } as never)
    const files = new WorkspaceFiles(ctx, { maxLines: 2, maxEntries: 100, maxBytes: 1024, maxFileBytes: 1024 } as never)
    const scope = { sessionId: 'bom-test', workspaceRoot: workspace } as never
    const signal = new AbortController().signal
    const readFirstPage = await files.read(scope, chapterPath, {}, signal)
    assert.equal(readFirstPage.text, '---\r\nnumber: 1\r')
    assert.equal(readFirstPage.bytes, Buffer.byteLength(chapterText))
    const byteReads: [string, unknown][] = []
    let changeChapterBeforePrefix = false
    setBrowserContext({ remote: { workspaceFiles: {
        list: async (_id, path) => {
            try { return { ok: true, value: await files.list(scope, path, signal) } }
            catch (error) { return { ok: false, error } }
        },
        read: async (_id, path, range) => ({ ok: true, value: await files.read(scope, path, range, signal) }),
        readBytes: async (_id: string, path: string, options: Parameters<WorkspaceFiles['readBytes']>[2]) => {
            byteReads.push([path, options])
            if (changeChapterBeforePrefix && path === chapterPath) {
                await writeFile(join(workspace, chapterPath), `${chapterText}并发保存的正文。\r\n`)
            }
            return { ok: true, value: await files.readBytes(scope, path, options, signal) }
        },
    } } } as Parameters<typeof setBrowserContext>[0])
    t.after(() => setBrowserContext(null))
    const scan = await scanNovel('bom-test', signal)
    assert.deepEqual(scan.failedFiles ?? [], [])
    assert.equal(scan.project?.title, '登记作品')
    assert.equal(scan.pending[0]?.state, 'current')
    assert.deepEqual(scan.archiveSources, [{ path: archivePath, text: archiveText }])
    assert.equal(byteReads.length, 4)
    for (const [, options] of byteReads) assert.deepEqual(options, { range: { offset: 0, length: 3 } })
    changeChapterBeforePrefix = true
    const changed = await scanNovel('bom-test', signal)
    assert.deepEqual(changed.failedFiles, [chapterPath])
    assert.equal(changed.pending[0]?.state, 'unknown')
})

test('待确认按源章哈希和同章标记区分新旧建议，相同文字在各版本均可查', async () => {
    const fs = minimalProject()
    const path = 'novel/chapters/001.md'
    const chapter = splitSource(fs.get(path) as string)
    const currentHash = await contentHashClient(chapter.frontmatter, chapter.content)
    const oldHash = await contentHashClient(chapter.frontmatter, '改稿前正文')
    ;(fs.get('novel') as unknown[]).push({ name: 'pending.md', type: 'file' })
    fs.set('novel/pending.md', [
        '## [维护 pass] chapter/001（旧稿）待人工确认',
        `<!-- writer-pending-source:${oldHash} -->`,
        '- 核对旧稿事实',
        '## [维护 pass] chapter/001（标记前）待人工确认',
        `<!-- writer-pending-source:${currentHash} -->`,
        '- 相同建议',
        '## [recompute mark] chapter/001 派生已标记过期（标记时刻）',
        '## [维护 pass] chapter/001（另一旧版本）待人工确认',
        `<!-- writer-pending-source:${oldHash} -->`,
        '- 核对旧稿事实',
        '## [维护 pass] chapter/001（最新）待人工确认',
        `<!-- writer-pending-source:${currentHash} -->`,
        '- 相同建议',
    ].join('\n'))
    setBrowserContext({ remote: mockRemote(fs, { hostLineWindow: true, pageSize: 2 }) as never })
    try {
        const scan = () => scanNovel('s1', new AbortController().signal)
        const versions = async () => buildOverview(await scan()).pendingSections.map(section => [section.state, section.sourceHash, section.lines[0]])
        assert.deepEqual(await versions(), [
            ['current', currentHash, '相同建议'],
            ['stale', oldHash, '核对旧稿事实'],
            ['invalidated', currentHash, '相同建议'],
            ['invalidated', oldHash, '核对旧稿事实'],
        ])
        fs.set(path, '又修改了一次')
        assert.equal((await versions())[0]?.[0], 'stale')
    } finally { setBrowserContext(null) }
})

test('待确认遇到旧节、源章读取失败和缺失时保留原建议并要求版本待核', async () => {
    const fs = minimalProject()
    const hash = 'a'.repeat(64)
    const nestedBody = '仅面板可读的卷内稿件。\n'
    const nestedHash = await contentHashClient({}, nestedBody)
    const malformedBody = '---\n无效元数据\n---\n稿件暂不可用于核对。\n'
    const malformedHash = await contentHashClient({}, malformedBody)
    ;(fs.get('novel') as unknown[]).push({ name: 'pending.md', type: 'file' })
    ;(fs.get('novel/chapters') as unknown[]).push({ name: '003.md', type: 'file' }, { name: '卷一', type: 'directory' })
    fs.set('novel/chapters/卷一', [{ name: '002.md', type: 'file' }])
    fs.set('novel/chapters/卷一/002.md', nestedBody)
    fs.set('novel/chapters/003.md', malformedBody)
    fs.set('novel/pending.md', [
        '## [维护 pass] chapter/001（旧格式）待人工确认',
        '- 旧格式正文',
        '## [维护 pass] chapter/001（文件不可读）待人工确认',
        `<!-- writer-pending-source:${hash} -->`,
        '- 读失败建议',
        '## [维护 pass] chapter/002（仅有卷内同名稿）待人工确认',
        `<!-- writer-pending-source:${nestedHash} -->`,
        '- 卷内文件不替代顶层来源',
        '## [维护 pass] chapter/003（元数据无效）待人工确认',
        `<!-- writer-pending-source:${malformedHash} -->`,
        '- 坏元数据不使用宽容回退核对',
        '## [维护 pass] chapter/004（无章稿）待人工确认',
        `<!-- writer-pending-source:${hash} -->`,
        '- 缺文件建议',
    ].join('\n'))
    fs.delete('novel/chapters/001.md')
    setBrowserContext({ remote: mockRemote(fs) as never })
    try {
        const scan = await scanNovel('s1', new AbortController().signal)
        assert.deepEqual(scan.failedFiles, ['novel/chapters/001.md'])
        assert.deepEqual(scan.pending.map(section => [section.state, section.sourceHash, section.lines[0]]), [
            ['unknown', hash, '缺文件建议'],
            ['unknown', malformedHash, '坏元数据不使用宽容回退核对'],
            ['unknown', nestedHash, '卷内文件不替代顶层来源'],
            ['unknown', hash, '读失败建议'],
            ['unknown', undefined, '旧格式正文'],
        ])
    } finally { setBrowserContext(null) }
})

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

test('scanNovel（轮次 42）：归档双来源——根下 pending-archive.md 为主 + 旧布局 .writer/ 兜底合并', async () => {
  const fs = minimalProject()
  fs.set('novel', [{ name: 'project.md', type: 'file' }, { name: 'chapters', type: 'directory' }, { name: 'pending-archive.md', type: 'file' }])
  fs.set('novel/pending-archive.md', '# 归档\n\n## [已归档] chapter/003（2026-11-01T00:00:00.000Z）\n\n- 新段\n')
  fs.set('novel/.writer', [{ name: 'pending-archive.md', type: 'file' }])
  fs.set('novel/.writer/pending-archive.md', '# 归档\n\n## [已归档] chapter/001（2026-10-01T00:00:00.000Z）\n\n- 旧段\n')
  setBrowserContext({ remote: mockRemote(fs) as never })
  const scan = await scanNovel('s1', new AbortController().signal)
  assert.equal(scan.pendingArchive?.length, 2, '两来源各一节合并')
  assert.ok(scan.pendingArchive?.[0]?.heading.includes('003'), '根下来源在前')
  assert.ok(scan.pendingArchive?.[1]?.heading.includes('001'), '旧布局兜底在后')
  // 仅旧布局（迁移未触发的纯读项目）：兜底读仍可见，历史段不消失
  fs.delete('novel/pending-archive.md')
  fs.set('novel', [{ name: 'project.md', type: 'file' }, { name: 'chapters', type: 'directory' }])
  const legacyOnly = await scanNovel('s1', new AbortController().signal)
  assert.equal(legacyOnly.pendingArchive?.length, 1, '仅旧布局时兜底节可见')
  assert.ok(legacyOnly.pendingArchive?.[0]?.heading.includes('001'))
  setBrowserContext(null)
})

test('scanNovel：worldbuilding 超读取上限——总数与截断数如实返回（统计格用总数而非已读数）', async () => {
  const fs = minimalProject()
  const wbEntries: unknown[] = []
  for (let i = 1; i <= WORLDBUILDING_MAX + 1; i++) {
    const name = `entry-${String(i).padStart(2, '0')}.md`
    wbEntries.push({ name, type: 'file' })
    fs.set(`novel/worldbuilding/${name}`, `---\n---\n设定条目 ${i}\n`)
  }
  fs.set('novel/worldbuilding', wbEntries)
  setBrowserContext({ remote: mockRemote(fs) as never })
  // 修复前：worldbuildingCount 取已读取记录数（≤上限），概况统计格把 25 条项目显示成 24
  const scan = await scanNovel('s1', new AbortController().signal)
  assert.equal(scan.worldbuildingCount, WORLDBUILDING_MAX + 1, '总数（非已读取条数）')
  assert.equal(scan.worldbuilding?.length, WORLDBUILDING_MAX, '读取上限仍生效（防读放大）')
  assert.equal(scan.worldbuildingTruncated, 1, '截断数如实披露')
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
