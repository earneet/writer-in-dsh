/**
 * store 派生数据与 pending.md 单测（P3）。
 * 运行：node --test packages/writer-store/tests/derived.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
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
    const archive = await readFile(join(root, 'pending-archive.md'), 'utf8')
    assert.match(archive, /已归档\] chapter\/001/)
    assert.match(archive, /建议 A/)
    assert.ok(archive.endsWith('\n'))
    // appendPendingArchive 仍可独立追加（归档头由调用方包装）
    await store.appendPendingArchive('# [已归档] chapter/002（t）\n\n## 其他\n- B\n')
    assert.match(await readFile(join(root, 'pending-archive.md'), 'utf8'), /chapter\/002/)
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

test('轮次 42（归档位置迁移）：仅旧布局存在 → append 触发整体搬移；旧文件删除；重复追加幂等不重复并入', async () => {
  const { store, root } = await makeStore()
  try {
    // 常规旧布局项目：归档在 .writer/ 下（随目录 gitignore 不可见）
    await mkdir(join(root, '.writer'), { recursive: true })
    await writeFile(join(root, '.writer', 'pending-archive.md'), '# 归档\n\n## [已归档] chapter/001（t）\n\n- 旧建议\n', 'utf8')
    await store.appendPendingArchive('# [已归档] chapter/002（t）\n\n## 其他\n- B\n')
    const moved = await readFile(join(root, 'pending-archive.md'), 'utf8')
    assert.match(moved, /chapter\/001/, '旧文件内容并入根下归档')
    assert.match(moved, /chapter\/002/, '本次追加落盘')
    await assert.rejects(() => readFile(join(root, '.writer', 'pending-archive.md'), 'utf8'), { code: 'ENOENT' }, '旧文件已删')
    // 幂等：旧文件已不存在，再追加只追加（旧段不重复并入）
    await store.appendPendingArchive('# [已归档] chapter/003（t）\n\n## 其他\n- C\n')
    const again = await readFile(join(root, 'pending-archive.md'), 'utf8')
    assert.match(again, /chapter\/003/)
    assert.equal((again.match(/chapter\/001/g) ?? []).length, 1, '旧段不重复并入（幂等）')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('轮次 42（归档位置迁移）：新旧并存（迁移中断态）拼接无丢失；archivePending 路径同样触发迁移', async () => {
  const { store, root } = await makeStore()
  try {
    await mkdir(join(root, '.writer'), { recursive: true })
    await writeFile(join(root, '.writer', 'pending-archive.md'), '# 归档\n\n## [已归档] chapter/001（t）\n\n- 旧建议\n', 'utf8')
    await writeFile(join(root, 'pending-archive.md'), '# 归档\n\n## [已归档] chapter/009（t）\n\n- 新段\n', 'utf8')
    // archivePending（pending_cleanup 工具路径）内部经 appendPendingArchive → 同一迁移
    await store.appendPending('## [维护 pass] chapter/005（t）待人工确认\n- 建议 X')
    await store.archivePending(() => ({ next: '', extracted: '# [已归档] chapter/005（t）\n\n## [维护 pass] chapter/005（t）待人工确认\n- 建议 X\n' }))
    const merged = await readFile(join(root, 'pending-archive.md'), 'utf8')
    assert.match(merged, /chapter\/001/, '旧布局段并入')
    assert.match(merged, /chapter\/009/, '根下既有段保留')
    assert.match(merged, /chapter\/005/, '归档式变更段落盘')
    await assert.rejects(() => readFile(join(root, '.writer', 'pending-archive.md'), 'utf8'), { code: 'ENOENT' }, '旧文件已删')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('轮次 42（对抗审查 #2）：store 装载即迁移——构造期 fire-and-forget，无需等待归档写入', async () => {
  const root = await mkdtemp(join(tmpdir(), 'writer-store-'))
  try {
    await mkdir(join(root, '.writer'), { recursive: true })
    await writeFile(join(root, '.writer', 'pending-archive.md'), '# 归档\n\n## [已归档] chapter/001（t）\n\n- 旧建议\n', 'utf8')
    // @ts-expect-error 测试桩：真实 Context 由 loader 提供
    new WriterStoreService(new Context(), { projectRoot: root }) // eslint-disable-line no-new -- 构造期副作用即被测行为
    await new Promise((resolve) => setTimeout(resolve, 50))
    const migrated = await readFile(join(root, 'pending-archive.md'), 'utf8')
    assert.match(migrated, /chapter\/001/, '旧归档已并入根下')
    await assert.rejects(() => readFile(join(root, '.writer', 'pending-archive.md'), 'utf8'), { code: 'ENOENT' }, '旧文件已删')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('轮次 42（对抗审查 #4①）：旧归档读取非 ENOENT（路径被目录占位）响亮失败，新文件不被污染', async () => {
  const { store, root } = await makeStore()
  try {
    await mkdir(join(root, '.writer', 'pending-archive.md'), { recursive: true })
    await assert.rejects(() => store.appendPendingArchive('# [已归档] chapter/002（t）\n\n## 其他\n- B\n'), /旧归档迁移读取失败/)
    assert.equal((await stat(join(root, '.writer', 'pending-archive.md'))).isDirectory(), true, '占位目录原样保留')
    await assert.rejects(() => readFile(join(root, 'pending-archive.md'), 'utf8'), { code: 'ENOENT' }, '目标文件未创建（section 未落盘，重试安全）')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('轮次 42（对抗审查 #3/#4③）：已并入检测防重复拼接 + 双实例并发迁移不产生多副本', async () => {
  const root = await mkdtemp(join(tmpdir(), 'writer-store-'))
  try {
    const legacy = '# 归档\n\n## [已归档] chapter/001（t）\n\n- 旧建议\n'
    await mkdir(join(root, '.writer'), { recursive: true })
    await writeFile(join(root, '.writer', 'pending-archive.md'), legacy, 'utf8')
    // 模拟「上次拼接成功、删旧失败」中断态：新文件已含旧全文
    await writeFile(join(root, 'pending-archive.md'), `${legacy}\n## [已归档] chapter/009（t）\n\n- 既有段\n`, 'utf8')
    // @ts-expect-error 测试桩：真实 Context 由 loader 提供
    const storeA = new WriterStoreService(new Context(), { projectRoot: root })
    // @ts-expect-error 测试桩：真实 Context 由 loader 提供
    const storeB = new WriterStoreService(new Context(), { projectRoot: root })
    const writes: Promise<void>[] = [
      storeA.appendPendingArchive('# [已归档] chapter/002（t）\n\n## 其他\n- B\n'),
      storeB.appendPendingArchive('# [已归档] chapter/003（t）\n\n## 其他\n- C\n'),
    ]
    const settled = await Promise.allSettled(writes)
    assert.equal(settled.filter((s) => s.status === 'rejected').length, 0, '并发写入不应报错')
    const text = await readFile(join(root, 'pending-archive.md'), 'utf8')
    assert.equal((text.match(/chapter\/001/g) ?? []).length, 1, '旧段恰一份（已并入检测 + 链串行，无重复拼接）')
    assert.match(text, /chapter\/009/, '既有段保留')
    assert.match(text, /chapter\/002/)
    assert.match(text, /chapter\/003/)
    await assert.rejects(() => readFile(join(root, '.writer', 'pending-archive.md'), 'utf8'), { code: 'ENOENT' }, '旧文件已删')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('轮次 38（P0-1）：两个独立 store 实例并发 appendPending——共享串行链，不静默丢段', async () => {
  const { root } = await makeStore()
  try {
    // 模拟「写作模式」preset 的形态：每个会话各自挂一组 store，projectRoot 同指一个小说目录
    // @ts-expect-error 测试桩：真实 Context 由 loader 提供
    const storeA = new WriterStoreService(new Context(), { projectRoot: root })
    // @ts-expect-error 测试桩：真实 Context 由 loader 提供
    const storeB = new WriterStoreService(new Context(), { projectRoot: root })
    const writes: Promise<void>[] = []
    for (let i = 0; i < 20; i++) {
      writes.push(storeA.appendPending(`## A-${i}\n内容`))
      writes.push(storeB.appendPending(`## B-${i}\n内容`))
    }
    const settled = await Promise.allSettled(writes)
    assert.equal(settled.filter((s) => s.status === 'rejected').length, 0, '并发追加不应报错')
    const text = await readFile(join(root, 'pending.md'), 'utf8')
    const sections = (text.match(/^## /gm) ?? []).length
    // 修复前：40 次写入只落 20 节（后写者按旧快照整体重写，先写者的段消失且零报错）
    assert.equal(sections, 40, `40 次并发追加应全部落盘，实际 ${sections} 节`)
    // 每个段都必须真实存在（不是重复计数）
    for (let i = 0; i < 20; i++) {
      assert.ok(text.includes(`## A-${i}\n`), `A-${i} 段存在`)
      assert.ok(text.includes(`## B-${i}\n`), `B-${i} 段存在`)
    }
    // 唯一 tmp 名：不残留固定名临时文件
    const leftovers = (await readdir(root)).filter((n) => n.endsWith('.tmp'))
    assert.deepEqual(leftovers, [], '无残留临时文件')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
