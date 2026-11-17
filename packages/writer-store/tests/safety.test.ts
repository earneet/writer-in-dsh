import test from 'node:test'
import assert from 'node:assert/strict'
import fs, { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import WriterStoreService from '../src/index.ts'

async function setup() {
    const root = await mkdtemp(join(tmpdir(), 'writer-safety-'))
    // @ts-expect-error 独立测试无需宿主加载器。
    const store = new WriterStoreService(new Context(), { projectRoot: root })
    await store.appendPendingArchive('既有归档')
    return { root, store }
}

test('Windows 大小写别名并发保存：同一旧 hash 恰一次成功', { skip: process.platform !== 'win32' }, async () => {
    const { root, store } = await setup()
    try {
        const initial = await store.save('character', 'elin', { content: '原文' })
        const results = await Promise.allSettled([
            store.save('character', 'ELIN', { content: '改稿甲' }, initial.hash),
            store.save('character', 'elin', { content: '改稿乙' }, initial.hash),
        ])
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
        const failure = results.find(result => result.status === 'rejected')
        assert.ok(failure?.status === 'rejected')
        assert.match(String(failure.reason), /乐观锁失败/)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

for (const operation of ['pending', 'cleanup', 'archive', 'migration'] as const) {
    test(`读取故障保留旧数据：${operation}`, async (t) => {
        const { root, store } = await setup()
        try {
            const pending = join(root, 'pending.md')
            const archive = join(root, 'pending-archive.md')
            const legacy = join(root, '.writer', 'pending-archive.md')
            await writeFile(pending, '既有待办\n')
            if (operation === 'migration') {
                await mkdir(join(root, '.writer'), { recursive: true })
                await writeFile(legacy, '旧布局归档\n')
            }
            const target = operation === 'pending' || operation === 'cleanup' ? pending : archive
            const original = await readFile(target, 'utf8')
            const read = fs.readFile
            const mocked = t.mock.method(fs, 'readFile', async (...args: Parameters<typeof fs.readFile>) => {
                if (String(args[0]) === target) throw Object.assign(new Error('读取被占用'), { code: 'EACCES' })
                return read(...args)
            })
            syncBuiltinESMExports()
            try {
                const action = operation === 'pending' ? () => store.appendPending('新增待办')
                    : operation === 'cleanup' ? () => store.archivePending(text => ({ next: '', extracted: text }))
                    : () => store.appendPendingArchive('新增归档')
                await assert.rejects(action, /读取.*失败/)
            } finally {
                mocked.mock.restore()
                syncBuiltinESMExports()
            }
            assert.equal(await readFile(target, 'utf8'), original)
            if (operation === 'migration') assert.equal(await readFile(legacy, 'utf8'), '旧布局归档\n')
            await store.appendPending(operation === 'pending' ? '新增待办' : '恢复后待办')
            assert.match(await readFile(pending, 'utf8'), /既有待办/)
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })
}

test('真实 store 保存事件只抵达自己的 isolate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writer-isolate-'))
    try {
        // @ts-expect-error 独立测试无需宿主加载器。
        const ctx = new Context()
        const a = ctx.isolate('writer')
        const b = ctx.isolate('writer')
        const storeA = new WriterStoreService(a, { projectRoot: join(root, 'a') })
        new WriterStoreService(b, { projectRoot: join(root, 'b') })
        const seen: string[] = []
        a.on('writer/entity-saved', entity => { seen.push(`A:${entity.id}`) })
        b.on('writer/entity-saved', entity => { seen.push(`B:${entity.id}`) })
        await storeA.save('chapter', '001', { content: 'A 的正文' })
        assert.deepEqual(seen, ['A:001'])
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
