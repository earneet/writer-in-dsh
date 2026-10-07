/**
 * store 层集成单测：临时目录驱动的 Markdown SoT 读写、乐观锁、原子写、索引重建。
 * 运行：node --test packages/writer-store/tests/store.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
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

test('创建 → 读取 → 乐观锁更新 → 陈旧 hash 拒绝', async () => {
  const { store, root } = await makeStore()
  try {
    const saved = await store.save('chapter', '001', { content: '第一段。', frontmatter: { title: '夜' } })
    assert.equal(saved.frontmatter.title, '夜')
    const disk = await readFile(join(root, 'chapters/001.md'), 'utf8')
    assert.ok(disk.startsWith('---\n'))
    // 正规更新：携带最新 hash
    const updated = await store.save('chapter', '001', { content: '第一段。\n第二段。', frontmatter: { title: '夜' } }, saved.hash)
    assert.notEqual(updated.hash, saved.hash)
    // 陈旧 hash 拒绝
    await assert.rejects(
      () => store.save('chapter', '001', { content: 'x' }, saved.hash),
      /乐观锁失败/,
    )
    // 磁盘未被回退
    const after = await readFile(join(root, 'chapters/001.md'), 'utf8')
    assert.ok(after.includes('第二段'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('H1 回归：无锁 save 已存在实体被拒（防 "new" 静默覆盖）', async () => {
  const { store, root } = await makeStore()
  try {
    await store.save('chapter', '001', { content: '原文' })
    await assert.rejects(
      () => store.save('chapter', '001', { content: '覆盖' }),
      /实体已存在.*expectHash/,
    )
    const disk = await readFile(join(root, 'chapters/001.md'), 'utf8')
    assert.ok(disk.includes('原文'), '磁盘内容未被覆盖')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('乐观锁指向不存在的实体被拒', async () => {
  const { store, root } = await makeStore()
  try {
    await assert.rejects(
      () => store.save('chapter', '404', { content: 'x' }, 'deadbeef'),
      /实体不存在/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Windows 保留名 id 被拒', async () => {
  const { store, root } = await makeStore()
  try {
    await assert.rejects(() => store.save('chapter', 'con', { content: 'x' }), /id 非法/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('get 直读磁盘：外部编辑后立即可见', async () => {
  const { store, root } = await makeStore()
  try {
    await store.save('chapter', '001', { content: '旧' })
    const path = join(root, 'chapters/001.md')
    await writeFile(path, '---\ntitle: 外部改\n---\n新', 'utf8')
    const got = await store.get('chapter', '001')
    assert.equal(got?.content, '新')
    assert.equal(got?.frontmatter.title, '外部改')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('path traversal 被拒', async () => {
  const { store, root } = await makeStore()
  try {
    await assert.rejects(() => store.save('chapter', '../evil', { content: 'x' }), /id 非法/)
    await assert.rejects(() => store.save('chapter', 'a/b', { content: 'x' }), /id 非法/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('单文件实体 id 必须为 kind', async () => {
  const { store, root } = await makeStore()
  try {
    await assert.rejects(() => store.save('principles', 'other', { content: 'x' }), /单文件实体/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('外部编辑后 rebuildIndex 感知新内容（索引可重建）', async () => {
  const { store, root } = await makeStore()
  try {
    await store.save('chapter', '001', { content: 'a' })
    await mkdir(join(root, 'characters'), { recursive: true })
    await writeFile(join(root, 'characters/new.md'), '---\nname: 新\n---\n人物', 'utf8')
    await store.rebuildIndex()
    const chars = await store.list('character')
    assert.equal(chars.length, 1)
    assert.equal(chars[0].frontmatter.name, '新')
    const got = await store.get('chapter', '001')
    assert.equal(got?.content, 'a\n', 'serializeEntity 补齐尾换行')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('目录缺失的 kind 列表为空', async () => {
  const { store, root } = await makeStore()
  try {
    assert.deepEqual(await store.list('plot'), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('N1 回归：坏 frontmatter 文件不毒化全局索引', async () => {
  const { store, root } = await makeStore()
  try {
    await store.save('chapter', '001', { content: '好文件' })
    await mkdir(join(root, 'chapters'), { recursive: true })
    await writeFile(join(root, 'chapters/bad.md'), '---\n没有冒号的坏行\n---\nx', 'utf8')
    const chapters = await store.list('chapter')
    assert.equal(chapters.length, 1, '坏文件被跳过，好文件仍在')
    assert.equal(chapters[0].id, '001')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('N3 回归：store 层拒绝写入 project 配置', async () => {
  const { store, root } = await makeStore()
  try {
    await assert.rejects(() => store.save('project', 'project', { content: 'x' }), /只读/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
