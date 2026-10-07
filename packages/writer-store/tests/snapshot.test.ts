/**
 * P4 store 快照读单测：解析缓存不破坏「list 恒反映磁盘现状」语义
 * （外部修改 mtime/size 变化即失效重读；删除/新增文件即时可见；重复 list 结果一致）。
 * 运行：node --test packages/writer-store/tests/snapshot.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import WriterStoreService from '../src/index.ts'

async function makeStore(): Promise<{ store: WriterStoreService; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'writer-store-snap-'))
  // @ts-expect-error 测试桩：真实 Context 由 loader 提供
  const ctx = new Context()
  const store = new WriterStoreService(ctx, { projectRoot: root })
  return { store, root }
}

test('快照读：外部编辑（mtime/size 变化）后 list 反映新内容', async () => {
  const { store, root } = await makeStore()
  try {
    await store.save('character', 'elin', { content: '旧设定' })
    const first = await store.list('character')
    assert.equal(first[0].content.trim(), '旧设定')
    // 外部编辑器改写（绕过 store.save；utimes 显式推移 mtime，规避同刻分辨率；无 frontmatter 块）
    await writeFile(join(root, 'characters/elin.md'), '新设定\n', 'utf8')
    await utimes(join(root, 'characters/elin.md'), new Date(), new Date(Date.now() + 5000))
    const second = await store.list('character')
    assert.equal(second[0].content.trim(), '新设定', 'mtime 变化即缓存失效')
    // 未变更的重复 list 结果一致（快照读复用）
    const third = await store.list('character')
    assert.equal(third[0].hash, second[0].hash)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('快照读：文件删除后 list 即时收缩', async () => {
  const { store, root } = await makeStore()
  try {
    await store.save('character', 'a', { content: 'A' })
    await store.save('character', 'b', { content: 'B' })
    assert.equal((await store.list('character')).length, 2)
    await rm(join(root, 'characters/b.md'))
    assert.equal((await store.list('character')).length, 1, '删除即时可见')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('快照读：save 落盘后 list 反映新 hash（自写路径不读旧缓存）', async () => {
  const { store, root } = await makeStore()
  try {
    await store.save('character', 'elin', { content: 'v1' })
    const h1 = (await store.list('character'))[0].hash
    const e1 = await store.get('character', 'elin')
    await store.save('character', 'elin', { content: 'v2' }, e1!.hash)
    const after = (await store.list('character'))[0]
    assert.equal(after.content.trim(), 'v2')
    assert.notEqual(after.hash, h1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
