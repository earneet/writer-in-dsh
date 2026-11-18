import test from 'node:test'
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import WriterStore from '../../writer-store/src/index.ts'
import WriterEngine from '../src/index.ts'

test('共享引擎按项目隔离同章号维护、计数与排空', async t => {
    const a = await mkdtemp(join(tmpdir(), 'writer-engine-workspace-'))
    const b = await mkdtemp(join(tmpdir(), 'writer-engine-workspace-'))
    t.after(() => Promise.all([a, b].map(root => rm(root, { recursive: true, force: true }))))
    const ctx = new Context()
    const storage = new AsyncLocalStorage<{ session: { header: { cwd: string } } }>()
    ctx.provide('agents', { currentInitiator: () => storage.getStore() } as never)
    const run = <T>(cwd: string, fn: () => T) => storage.run({ session: { header: { cwd } } }, fn)
    const store = new WriterStore(ctx, {})
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    t.after(release)
    ctx.provide('llm', { stream: async function* () {
        calls++
        await gate
        const text = '{"facts":[],"foreshadowEvents":[],"characterStates":[]}'
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'finish', reason: { kind: 'stop' } }
    } } as never)
    const engine = new WriterEngine(ctx, { provider: 'test', model: 'test', maxOutputTokens: 1000, temperature: 0, contextBudgetChars: 24000, autoMaintenance: false, extractionRetries: 0 })
    for (const [root, content] of [[a, '甲项目正文'], [b, '乙项目正文']]) {
        await run(root!, async () => { await store.initializeProject(root!); await store.save('chapter', '001', { content }) })
    }
    const passA = run(a, () => engine.maintenancePass('001'))
    await t.waitFor(() => assert.equal(calls, 1))
    assert.equal(run(b, () => engine.pendingMaintenanceCount()), 0)
    await run(b, () => engine.drainMaintenance())
    const passB = run(b, () => engine.maintenancePass('001'))
    await t.waitFor(() => assert.equal(calls, 2))
    release()
    await Promise.all([passA, passB])
    const [derivedA, derivedB] = await Promise.all([run(a, () => store.readMaintenance('001')), run(b, () => store.readMaintenance('001'))])
    assert.ok(derivedA && derivedB)
    assert.notEqual(derivedA.sourceHash, derivedB.sourceHash)
})
