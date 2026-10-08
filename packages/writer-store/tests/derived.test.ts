/**
 * store 派生数据与 pending.md 单测（P3）。
 * 运行：node --test packages/writer-store/tests/derived.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import WriterStoreService from '../src/index.ts'

async function makeStore(): Promise<{ store: WriterStoreService; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'writer-store-'))
  // @ts-expect-error 测试桩：真实 Context 由 loader 提供，此处仅需要 emit 透传
  const ctx = new Context()
  const store = new WriterStoreService(ctx, { projectRoot: root })
  return { store, root }
}

test('派生数据：写入 → 读取 → 删除 → 清单', async () => {
  const { store, root } = await makeStore()
  try {
    await store.writeDerived('maintenance', '001', { sourceHash: 'abc', summary: '摘要' })
    const got = await store.readDerived('maintenance', '001')
    assert.deepEqual(got, { sourceHash: 'abc', summary: '摘要' })
    assert.deepEqual(await store.listDerived('maintenance'), ['001'])
    await store.writeDerived('maintenance', '002', { sourceHash: 'def' })
    assert.deepEqual(await store.listDerived('maintenance'), ['001', '002'])
    await store.deleteDerived('maintenance', '001')
    assert.equal(await store.readDerived('maintenance', '001'), undefined)
    assert.deepEqual(await store.listDerived('maintenance'), ['002'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('派生数据：不存在/坏 JSON 按缺失处理；kind 与 id 做路径安全校验', async () => {
  const { store, root } = await makeStore()
  try {
    assert.equal(await store.readDerived('maintenance', '404'), undefined)
    await mkdir(join(root, '.writer/derived/maintenance'), { recursive: true })
    await writeFile(join(root, '.writer/derived/maintenance/bad.json'), '{broken', 'utf8')
    assert.equal(await store.readDerived('maintenance', 'bad'), undefined, '坏 JSON 不抛错按缺失处理')
    await assert.rejects(() => store.writeDerived('Maintenance', '001', {}), /kind 非法/)
    await assert.rejects(() => store.writeDerived('maintenance', '../evil', {}), /id 非法/)
    await assert.rejects(() => store.writeDerived('maintenance', 'con', {}), /id 非法/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('派生数据：ENOENT 按缺失、其他 IO 错（路径被目录占位）响亮失败不静默', async () => {
  const { store, root } = await makeStore()
  try {
    // 目录占位派生文件路径：readFile 得到 EISDIR（非 ENOENT 的 IO 错误）→ 修复前被静默当缺失
    await mkdir(join(root, '.writer/derived/maintenance/dirblock.json'), { recursive: true })
    await assert.rejects(() => store.readDerived('maintenance', 'dirblock'), /派生数据读取失败/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('appendPending：首建 → 追加（原子写，尾换行规整）', async () => {
  const { store, root } = await makeStore()
  try {
    await store.appendPending('## 第一条\n- 待办 A')
    await store.appendPending('## 第二条\n- 待办 B')
    const text = await readFile(join(root, 'pending.md'), 'utf8')
    assert.ok(text.includes('## 第一条'))
    assert.ok(text.includes('## 第二条'))
    assert.ok(text.endsWith('\n'), '恰一个尾换行')
    assert.match(text, /待办 A\n## 第二条/, '两节之间未混入多余空行断裂')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('archivePending（P7 归档语义）：锁定区内先归档后改清单；空提取零写入', async () => {
  const { store, root } = await makeStore()
  try {
    await store.appendPending('## [维护 pass] chapter/001（t）待人工确认\n- 建议 A')
    // 空 extracted：no-op，两文件都不动
    const noop = await store.archivePending(() => ({ next: '不应落盘', extracted: '' }))
    assert.equal(noop, '')
    assert.match(await readFile(join(root, 'pending.md'), 'utf8'), /chapter\/001/)
    // 归档式变更：mutator 在链内读到最新文本；先写归档再重写清单
    const extracted = await store.archivePending((text) => {
      assert.match(text, /chapter\/001/, 'mutator 在链内读到最新文本')
      return { next: '', extracted: '# [已归档] chapter/001（t）\n\n## [维护 pass] chapter/001（t）待人工确认\n- 建议 A\n' }
    })
    assert.match(extracted, /已归档/)
    assert.equal((await readFile(join(root, 'pending.md'), 'utf8')).trim(), '', '清空后的 pending.md 为空文本（非删除）')
    const archive = await readFile(join(root, '.writer', 'pending-archive.md'), 'utf8')
    assert.match(archive, /已归档\] chapter\/001/)
    assert.match(archive, /建议 A/)
    assert.ok(archive.endsWith('\n'))
    // appendPendingArchive 仍可独立追加（归档头由调用方包装）
    await store.appendPendingArchive('# [已归档] chapter/002（t）\n\n## 其他\n- B\n')
    assert.match(await readFile(join(root, '.writer', 'pending-archive.md'), 'utf8'), /chapter\/002/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('root getter 返回项目根', async () => {
  const { store, root } = await makeStore()
  try {
    assert.equal(store.root, root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
