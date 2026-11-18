import test from 'node:test'
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import WriterStoreService from '../src/index.ts'

async function workspace(t: test.TestContext) {
    const root = await mkdtemp(join(tmpdir(), 'writer-init-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    return root
}

function createStore(root?: string) {
    const ctx = new Context()
    const storage = new AsyncLocalStorage<{ session: { header: { cwd: string } } }>()
    ctx.provide('agents', { currentInitiator: () => storage.getStore() } as never)
    const store = new WriterStoreService(ctx, root ? { projectRoot: root } : {})
    return { store, run: <T>(cwd: string, fn: () => T) => storage.run({ session: { header: { cwd } } }, fn) }
}

test('空工作区初始化后可由同一服务读写，重复初始化不覆盖作品', async t => {
    const root = await workspace(t)
    const { store, run } = createStore()
    await run(root, async () => {
        assert.equal((await store.inspectProject(root)).status, 'empty')
        const result = await store.initializeProject(root)
        assert.equal(result.status, 'ready')
        assert.equal(store.root, join(root, 'novel'))
        const project = await store.get('project', 'project')
        assert.equal(project?.frontmatter.title, '未命名作品')
        await store.save('project', 'project', { frontmatter: { title: '我的书' } }, project!.hash)
        await assert.rejects(store.initializeProject(root), /已有|非空/)
        assert.equal((await store.get('project', 'project'))?.frontmatter.title, '我的书')
        for (const name of ['chapters', 'characters', 'plots', 'worldbuilding', 'style', 'exports', '.writer']) {
            assert.deepEqual(await readdir(join(root, 'novel', name)), [])
        }
        const ignore = await readFile(join(root, 'novel/.gitignore'), 'utf8')
        assert.match(ignore, /\.writer\//)
        assert.match(ignore, /exports\//)
        assert.deepEqual(await store.list('chapter'), [])
    })
})

test('非空、隐藏文件、冒名标记目录和 novel 文件不被视为空项目', async t => {
    for (const entry of ['notes.txt', '.hidden', 'project.md', 'novel']) {
        const root = await workspace(t)
        if (entry === 'project.md') await mkdir(join(root, entry))
        else await writeFile(join(root, entry), '原内容')
        const { store, run } = createStore()
        await run(root, async () => {
            assert.equal((await store.inspectProject(root)).status, 'blocked', entry)
            await assert.rejects(store.initializeProject(root), /非空|占用/)
            assert.deepEqual(await readdir(root), [entry])
        })
    }
})

test('固定路径与会话不匹配时拒绝初始化，已有平铺项目可显式打开', async t => {
    const root = await workspace(t)
    const other = await workspace(t)
    const { store } = createStore(join(other, 'novel'))
    assert.equal((await store.inspectProject(root)).status, 'mismatch')
    await assert.rejects(store.initializeProject(root), /路径|目录/)
    assert.deepEqual(await readdir(root), [])
    await writeFile(join(root, 'outline.md'), '# 旧作品大纲')
    const fixed = createStore(root).store
    const state = await fixed.inspectProject(root)
    assert.equal(state.status, 'ready')
    assert.equal(state.scanRoot, '.')
})

test('两个会话并发初始化同一工作区只成功一次，异项目索引和写入不串台', async t => {
    const a = await workspace(t)
    const b = await workspace(t)
    const { store, run } = createStore()
    const results = await Promise.allSettled([run(a, () => store.initializeProject(a)), run(a, () => store.initializeProject(a))])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    await run(b, () => store.initializeProject(b))
    await Promise.all([
        run(a, () => store.save('chapter', '001', { content: '甲项目正文' })),
        run(b, () => store.save('chapter', '001', { content: '乙项目正文' })),
    ])
    const [listA, listB] = await Promise.all([run(a, () => store.list('chapter')), run(b, () => store.list('chapter'))])
    assert.equal(listA[0]?.content.trim(), '甲项目正文')
    assert.equal(listB[0]?.content.trim(), '乙项目正文')
    assert.throws(() => store.root, /会话.*目录/)
})

test('欢迎页之后写入了文件时，初始化重新检查并保留文件', async t => {
    const root = await workspace(t)
    const { store, run } = createStore()
    await run(root, async () => {
        assert.equal((await store.inspectProject(root)).status, 'empty')
        await writeFile(join(root, 'new.txt'), '保留')
        await assert.rejects(store.initializeProject(root), /非空/)
        assert.equal(await readFile(join(root, 'new.txt'), 'utf8'), '保留')
        assert.deepEqual(await readdir(root), ['new.txt'])
    })
})

test('目录读取失败与未完成初始化不被当作空工作区', async t => {
    const root = await workspace(t)
    const { store, run } = createStore()
    await run(root, async () => {
        await assert.rejects(store.inspectProject(join(root, 'missing')), /目录|ENOENT/)
        await mkdir(join(root, 'novel'))
        await writeFile(join(root, 'novel/.initializing'), '')
        await mkdir(join(root, 'novel/chapters'))
        await mkdir(join(root, 'novel/characters'))
        const state = await store.inspectProject(root)
        assert.equal(state.status, 'blocked')
        assert.match(state.message ?? '', /未完成/)
    })
})

test('写入前目录变成非空或操作中断时保留原文件并如实标记未完成', async t => {
    const root = await workspace(t)
    const { store, run } = createStore()
    await run(root, async () => {
        const race = { throwIfAborted: () => writeFileSync(join(root, 'external.txt'), '外部文件') } as AbortSignal
        await assert.rejects(store.initializeProject(root, race), /非空|未完成/)
        assert.equal(await readFile(join(root, 'external.txt'), 'utf8'), '外部文件')
        assert.equal((await store.inspectProject(root)).status, 'blocked')
    })
    const another = await workspace(t)
    await run(another, async () => {
        let checks = 0
        const signal = { throwIfAborted: () => { if (++checks === 4) throw new Error('用户取消') } } as AbortSignal
        await assert.rejects(store.initializeProject(another, signal), /初始化未完成.*用户取消/)
        assert.match((await store.inspectProject(another)).message ?? '', /未完成/)
    })
})

test('通过目录链接打开空工作区时仍识别同一物理项目位置', async t => {
    const container = await workspace(t)
    const actual = join(container, 'actual')
    const alias = join(container, 'alias')
    await mkdir(actual)
    await symlink(actual, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const { store, run } = createStore()
    await run(alias, async () => {
        assert.equal((await store.inspectProject(alias)).status, 'empty')
        assert.equal((await store.initializeProject(alias)).status, 'ready')
        assert.equal((await store.get('project', 'project'))?.frontmatter.title, '未命名作品')
    })
})

test('旧归档无法迁移时仍可读取项目与重建索引', async t => {
    const root = await workspace(t)
    await mkdir(join(root, 'novel/.writer/pending-archive.md'), { recursive: true })
    await writeFile(join(root, 'novel/project.md'), '---\ntitle: "可读作品"\n---\n简介')
    const { store, run } = createStore()
    await run(root, async () => {
        assert.equal((await store.get('project', 'project'))?.frontmatter.title, '可读作品')
        assert.equal((await store.list('project'))[0]?.frontmatter.title, '可读作品')
    })
})
