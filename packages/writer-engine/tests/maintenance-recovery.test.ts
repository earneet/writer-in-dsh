import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import WriterStore from 'dsh-writer-store/src/index.ts'
import WriterEngine from '../src/index.ts'
import { partitionPendingByChapter } from 'dsh-writer-domain'

const empty = JSON.stringify({ facts: [], foreshadowEvents: [], characterStates: [] })

async function setup(existingRoot?: string) {
    const root = existingRoot ?? await mkdtemp(join(tmpdir(), 'writer-maintenance-recovery-'))
    // @ts-expect-error 独立测试无需宿主加载器。
    const ctx = new Context()
    const store = new WriterStore(ctx, { projectRoot: root })
    const llm = {
        calls: 0, replies: [] as string[], requests: [] as string[], hook: undefined as undefined | ((call: number) => Promise<void>),
        async *stream(options: { messages: { content: { text?: string }[] }[] }): AsyncGenerator<StreamChunk> {
            const call = ++this.calls
            this.requests.push(options.messages[0].content.map(part => part.text ?? '').join(''))
            await this.hook?.(call)
            const text = this.replies.shift() ?? (call % 2 ? '章节摘要。' : empty)
            yield { type: 'block-start', index: 0, blockType: 'text' }
            yield { type: 'text-delta', index: 0, text }
            yield { type: 'block-end', index: 0, block: { type: 'text', text } }
            yield { type: 'finish', reason: { kind: 'stop' } }
        },
    }
    ctx.provide('llm', llm)
    const engine = new WriterEngine(ctx, { provider: 'stub', model: 'stub', maxOutputTokens: 1024, temperature: 0, contextBudgetChars: 24000, autoMaintenance: false, extractionRetries: 0 })
    const chapter = await store.get('chapter', '001') ?? await store.save('chapter', '001', { content: '原始章节。' })
    return { root, store, llm, engine, chapter }
}

test('维护待办读取失败后普通重试补投，已归档结果不回流', async () => {
    const x = await setup()
    try {
        await mkdir(join(x.root, 'pending.md'))
        await assert.rejects(() => x.engine.maintenancePass('001'), /读取失败/)
        await rmdir(join(x.root, 'pending.md'))
        await x.engine.maintenancePass('001')
        assert.equal(x.llm.calls, 2)
        const pending = await readFile(join(x.root, 'pending.md'), 'utf8')
        assert.equal(pending.match(/## \[维护 pass\]/g)?.length, 1)
        await x.store.archivePending(text => {
            const parts = partitionPendingByChapter(text, '001')
            return { next: parts.keep, extracted: parts.archived }
        })
        await x.engine.maintenancePass('001')
        assert.equal((await readFile(join(x.root, 'pending.md'), 'utf8')).trim(), '')
        assert.equal(x.llm.calls, 2)
        await x.store.deleteMaintenance('001')
        x.llm.replies.push('同一正文重新生成的摘要。', JSON.stringify({ facts: [{ description: '已确认内容换了说法。' }], foreshadowEvents: [], characterStates: [] }))
        await x.engine.maintenancePass('001')
        assert.equal((await readFile(join(x.root, 'pending.md'), 'utf8')).trim(), '')
        assert.equal(x.llm.calls, 4)
    } finally {
        await rm(x.root, { recursive: true, force: true })
    }
})

test('维护待办追加成功但回执失败后重试不重复，也不覆盖新派生', async () => {
    const x = await setup()
    try {
        const append = x.store.appendPending.bind(x.store)
        let fail = true
        x.store.appendPending = async (...args) => {
            await append(...args)
            if (fail) { fail = false; throw new Error('投递回执中断') }
        }
        await assert.rejects(() => x.engine.maintenancePass('001'), /投递回执中断/)
        await x.engine.maintenancePass('001')
        assert.equal((await readFile(join(x.root, 'pending.md'), 'utf8')).match(/## \[维护 pass\]/g)?.length, 1)
        const newer = await x.store.save('chapter', '001', { content: '新版章节。' }, x.chapter.hash)
        await x.engine.maintenancePass('001')
        const derived = await x.store.readMaintenance('001')
        assert.equal(derived?.sourceHash, newer.hash)
        assert.equal(x.llm.calls, 4)
    } finally {
        await rm(x.root, { recursive: true, force: true })
    }
})

for (const archived of [false, true]) {
    test(`完整维护结果抑制同正文缓存重建后的 partial 回流：archived=${archived}`, async () => {
        const x = await setup()
        try {
            x.llm.replies.push('完整摘要。', JSON.stringify({ facts: [{ description: '已确认事实。' }], foreshadowEvents: [], characterStates: [] }))
            await x.engine.maintenancePass('001')
            if (archived) await x.store.archivePending(text => {
                const parts = partitionPendingByChapter(text, '001')
                return { next: parts.keep, extracted: parts.archived }
            })
            const before = await readFile(join(x.root, 'pending.md'), 'utf8')
            await x.store.deleteMaintenance('001')
            x.llm.replies.push('不完整的新摘要。', JSON.stringify({ facts: [{ description: '已确认事实。' }], foreshadowEvents: [{ plot: 'missing', action: 'planted' }], characterStates: [] }))
            assert.equal((await x.engine.maintenancePass('001')).partial, true)
            assert.equal((await x.store.readMaintenance('001'))?.partial, true)
            assert.equal(await readFile(join(x.root, 'pending.md'), 'utf8'), before)
        } finally {
            await rm(x.root, { recursive: true, force: true })
        }
    })
}

test('partial 缓存在正文不变时仍可经公开重算修复', async () => {
    const x = await setup()
    try {
        x.llm.replies.push('摘要。', JSON.stringify({ facts: [{ description: '此前通过的事实。' }], foreshadowEvents: [{ plot: 'missing', action: 'planted' }], characterStates: [] }))
        assert.equal((await x.engine.maintenancePass('001')).partial, true)
        x.llm.replies.push('完整摘要。', JSON.stringify({ facts: [{ description: '此前通过的事实。' }], foreshadowEvents: [], characterStates: [] }))
        const result = await x.engine.recomputeDerived('001')
        assert.equal(result[0].status, 'recomputed')
        assert.equal(x.llm.calls, 4)
        assert.notEqual((await x.store.readMaintenance('001'))?.partial, true)
        assert.doesNotMatch(x.llm.requests[3], /改稿前的既有抽取记录/)
        assert.deepEqual((await x.store.readMaintenance('001'))?.extraction.facts, [{ description: '此前通过的事实。' }])
    } finally {
        await rm(x.root, { recursive: true, force: true })
    }
})

for (const phase of ['cached', 'generating'] as const) {
    test(`旧维护恢复复用另一实例完成的新版结果：${phase}`, async t => {
        const a = await setup()
        let release!: () => void
        let entered!: () => void
        const gate = new Promise<void>(resolve => { release = resolve })
        const blocked = new Promise<void>(resolve => { entered = resolve })
        let pass: Promise<unknown> | undefined
        try {
            if (phase === 'cached') {
                await a.engine.maintenancePass('001')
                const get = a.store.get.bind(a.store)
                let reads = 0
                a.store.get = async (...args) => {
                    const result = await get(...args)
                    if (args[0] === 'chapter' && ++reads === 2) { entered(); await gate }
                    return result
                }
            } else {
                a.llm.hook = async call => { if (call === 1) { entered(); await gate } }
            }
            pass = a.engine.maintenancePass('001')
            await blocked
            const b = await setup(a.root)
            const latest = await b.store.save('chapter', '001', { content: '其他实例完成的新版。' }, a.chapter.hash)
            b.llm.replies.push('新任务已经完成。', empty)
            await b.engine.maintenancePass('001')
            release()
            await pass
            const record = await b.store.readMaintenance('001')
            assert.equal(record?.sourceHash, latest.hash)
            assert.equal(record?.summary, '新任务已经完成。')
            assert.equal(a.llm.calls, 2)
        } finally {
            release()
            await pass
            await rm(a.root, { recursive: true, force: true })
        }
    })
}

test('坏形状维护缓存按缺失重建，合法 JSON 不阻断维护', async () => {
    const x = await setup()
    try {
        const good = { sourceHash: x.chapter.hash, summary: '摘要', extraction: { facts: [], foreshadowEvents: [], characterStates: [] }, updatedAt: '2026-11-18T00:00:00Z' }
        for (const value of [null, [], {}, { ...good, extraction: {} }, { ...good, summary: 3 }, { ...good, partial: 'true' }]) {
            await x.store.writeDerived('maintenance', '001', value)
            assert.equal(await x.store.readMaintenance('001'), undefined)
        }
        await x.store.writeDerived('maintenance', '001', null)
        assert.equal((await x.engine.recomputeDerived('001'))[0].status, 'recomputed')
        assert.equal(x.llm.calls, 2)
    } finally {
        await rm(x.root, { recursive: true, force: true })
    }
})

for (const archived of [false, true]) {
    test(`显式 mark 建立新投递轮次，普通删缓存仍不回流：archived=${archived}`, async () => {
        const x = await setup()
        try {
            await x.engine.maintenancePass('001')
            const archive = () => x.store.archivePending(text => {
                const parts = partitionPendingByChapter(text, '001')
                return { next: parts.keep, extracted: parts.archived }
            })
            if (archived) await archive()
            await x.engine.recomputeDerived('001', { mode: 'mark' })
            x.llm.replies.push('显式重算的新建议。', empty)
            assert.equal((await x.engine.recomputeDerived('001'))[0].status, 'recomputed')
            assert.match(await readFile(join(x.root, 'pending.md'), 'utf8'), /显式重算的新建议/)
            await archive()
            await x.store.deleteMaintenance('001')
            x.llm.replies.push('普通缓存重建不能回流。', empty)
            await x.engine.maintenancePass('001')
            assert.equal((await readFile(join(x.root, 'pending.md'), 'utf8')).trim(), '')
        } finally {
            await rm(x.root, { recursive: true, force: true })
        }
    })
}

test('mark 之后延迟的旧缓存投递不能占用新轮次', async () => {
    const a = await setup()
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const blocked = new Promise<void>(resolve => { entered = resolve })
    let pass: Promise<unknown> | undefined
    try {
        a.llm.replies.push('第一轮旧摘要。', empty)
        await a.engine.maintenancePass('001')
        const get = a.store.get.bind(a.store)
        let reads = 0
        a.store.get = async (...args) => {
            const result = await get(...args)
            if (args[0] === 'chapter' && ++reads === 2) { entered(); await gate }
            return result
        }
        pass = a.engine.maintenancePass('001')
        await blocked
        const b = await setup(a.root)
        await b.engine.recomputeDerived('001', { mode: 'mark' })
        release()
        await pass
        b.llm.replies.push('新轮次真正重算的摘要。', empty)
        await b.engine.recomputeDerived('001')
        const afterMark = (await readFile(join(a.root, 'pending.md'), 'utf8')).split('## [recompute mark]')[1]
        assert.doesNotMatch(afterMark, /第一轮旧摘要/)
        assert.match(afterMark, /新轮次真正重算的摘要/)
    } finally {
        release()
        await pass
        await rm(a.root, { recursive: true, force: true })
    }
})

test('同正文较慢的 partial 不能覆盖另一实例已经完成的缓存', async () => {
    const a = await setup()
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const blocked = new Promise<void>(resolve => { entered = resolve })
    a.llm.hook = async call => { if (call === 1) { entered(); await gate } }
    a.llm.replies.push('迟到的部分摘要。', JSON.stringify({ facts: [], foreshadowEvents: [{ plot: 'missing', action: 'planted' }], characterStates: [] }))
    const pass = a.engine.maintenancePass('001')
    try {
        await blocked
        const b = await setup(a.root)
        b.llm.replies.push('已经完成的完整摘要。', empty)
        await b.engine.maintenancePass('001')
        release()
        await pass
        const record = await b.store.readMaintenance('001')
        assert.notEqual(record?.partial, true)
        assert.equal(record?.summary, '已经完成的完整摘要。')
    } finally {
        release()
        await pass
        await rm(a.root, { recursive: true, force: true })
    }
})

test('待办排队期间改稿，落盘前在章节锁内拒绝旧建议', async () => {
    const x = await setup()
    let release!: () => void
    let entered!: () => void
    let queued!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const blocked = new Promise<void>(resolve => { entered = resolve })
    const deliveryQueued = new Promise<void>(resolve => { queued = resolve })
    const appendArchive = x.store.appendPendingArchive.bind(x.store)
    x.store.appendPendingArchive = async text => { entered(); await gate; await appendArchive(text) }
    const archive = x.store.archivePending(() => ({ next: '', extracted: '其他章节的归档。' }))
    let pass: Promise<unknown> | undefined
    try {
        await blocked
        const append = x.store.appendPending.bind(x.store)
        x.store.appendPending = async (...args) => { queued(); await append(...args) }
        x.llm.replies.push('旧建议不应出现。', empty, '最新建议应保留。', empty)
        pass = x.engine.maintenancePass('001')
        await deliveryQueued
        await x.store.save('chapter', '001', { content: '排队期间改稿。' }, x.chapter.hash)
        release()
        await archive
        await pass
        const pending = await readFile(join(x.root, 'pending.md'), 'utf8')
        assert.doesNotMatch(pending, /旧建议不应出现/)
        assert.match(pending, /最新建议应保留/)
    } finally {
        release()
        await archive
        await pass
        await rm(x.root, { recursive: true, force: true })
    }
})

test('单次排空等待维护后的版本检查和补跑，不在旧缓存时返回', async t => {
    const x = await setup()
    let releaseFirst!: () => void
    let releaseFollowup!: () => void
    const first = new Promise<void>(resolve => { releaseFirst = resolve })
    const followup = new Promise<void>(resolve => { releaseFollowup = resolve })
    x.llm.hook = async call => { if (call === 1) await first; if (call === 3) await followup }
    const pass = x.engine.maintenancePass('001')
    try {
        await t.waitFor(() => assert.equal(x.llm.calls, 1))
        const latest = await x.store.save('chapter', '001', { content: '修改后的章节。' }, x.chapter.hash)
        let drained = false
        const flush = x.engine.drainMaintenance().then(() => { drained = true })
        releaseFirst()
        await t.waitFor(() => assert.equal(x.llm.calls, 3))
        assert.equal(drained, false)
        assert.equal(x.engine.pendingMaintenanceCount(), 1)
        const newest = await x.store.save('chapter', '001', { content: '补跑期间再次修改。' }, latest.hash)
        releaseFollowup()
        await flush
        assert.equal((await x.store.readMaintenance('001'))?.sourceHash, newest.hash)
        assert.equal(x.llm.calls, 6)
        assert.match(x.llm.requests[2], /修改后的章节/)
        assert.match(x.llm.requests[4], /补跑期间再次修改/)
        assert.equal(x.engine.pendingMaintenanceCount(), 0)
    } finally {
        releaseFirst()
        releaseFollowup()
        await pass
        await rm(x.root, { recursive: true, force: true })
    }
})

test('排空取消只终止等待者，共享后台维护继续', async t => {
    const x = await setup()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    x.llm.hook = async call => { if (call === 1) await gate }
    const pass = x.engine.maintenancePass('001')
    try {
        await t.waitFor(() => assert.equal(x.llm.calls, 1))
        const controller = new AbortController()
        const waiting = x.engine.drainMaintenance(controller.signal)
        controller.abort()
        const outcome = await Promise.race([
            waiting.then(() => 'success', error => error.name),
            new Promise<string>(resolve => setImmediate(() => resolve('still-waiting'))),
        ])
        assert.equal(outcome, 'AbortError')
        assert.equal(x.engine.pendingMaintenanceCount(), 1)
        release()
        await pass
        assert.equal((await x.store.readMaintenance('001'))?.sourceHash, x.chapter.hash)
    } finally {
        release()
        await pass
        await rm(x.root, { recursive: true, force: true })
    }
})
