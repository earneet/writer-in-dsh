/**
 * writer-export 集成单测：真实 store + 导出服务（共享 Context 桩，writer 实例直接挂属性代理位），
 * 验证卷组织、输出路径、XSS 转义与 EPUB 结构落地到产物文件。
 * 运行：node --test packages/writer-export/tests/service.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import WriterStoreService from 'dsh-writer-store'
import WriterExportServiceImpl from '../src/index.ts'

interface Setup { exporter: WriterExportServiceImpl; store: WriterStoreService; root: string }

async function makeSetup(): Promise<Setup> {
  const root = await mkdtemp(join(tmpdir(), 'writer-export-'))
  // @ts-expect-error 测试桩：真实 Context 由 loader 提供，此处仅需要服务实例与 emit 透传
  const ctx = new Context()
  const store = new WriterStoreService(ctx, { projectRoot: root })
  const exporter = new WriterExportServiceImpl(ctx, { defaultOutputDir: 'exports' })
  // 导出服务只消费 ctx.writer；把已构造的 store 实例挂到属性代理位（测试装配，绕过 loader 注入序）
  Object.defineProperty(ctx, 'writer', { value: store, configurable: true })
  return { exporter, store, root }
}

async function seedProject(store: WriterStoreService): Promise<void> {
  await store.save('outline', 'outline', { content: '# 大纲\n## 第一卷\n…', frontmatter: { title: '灯塔街异闻', author: '测试者' } })
  await store.save('chapter', '001', { content: '第一章正文。<script>x</script>', frontmatter: { number: 1, title: '夜行', volume: '第一卷' } })
  await store.save('chapter', '002', { content: '第二章正文。', frontmatter: { number: 2, title: '残页', volume: '第一卷' } })
  await store.save('chapter', '003', { content: '第三章正文。', frontmatter: { number: 3, title: '无卷' } })
  await store.save('character', 'elin', { content: '巡灯人。' })
}

test('txt 导出：卷组织 + 附录 + 相对路径返回', async () => {
  const { exporter, store, root } = await makeSetup()
  try {
    await seedProject(store)
    const result = await exporter.exportBook({ format: 'txt', includeOutline: true })
    assert.equal(result.chapters, 3)
    assert.equal(result.path, 'exports/book.txt')
    const text = await readFile(join(root, 'exports/book.txt'), 'utf8')
    assert.ok(text.includes('灯塔街异闻'))
    assert.ok(text.includes('# 第一卷'))
    assert.ok(text.includes('第 3 章 无卷'), '无卷章节归「正文」卷且不丢')
    assert.ok(text.includes('附录：大纲'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('html 导出：XSS 转义落地到产物', async () => {
  const { exporter, store, root } = await makeSetup()
  try {
    await seedProject(store)
    await exporter.exportBook({ format: 'html' })
    const html = await readFile(join(root, 'exports/book.html'), 'utf8')
    assert.ok(!html.includes('<script>x</script>'))
    assert.ok(html.includes('&lt;script&gt;'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('epub 导出：mimetype 首个 stored + 全条目结构 + 人物附录', async () => {
  const { exporter, store, root } = await makeSetup()
  try {
    await seedProject(store)
    const result = await exporter.exportBook({ format: 'epub', includeCharacters: true })
    assert.equal(result.chapters, 3)
    const zip = await readFile(join(root, 'exports/book.epub'))
    assert.equal(zip.subarray(0, 4).toString('latin1'), 'PK\x03\x04')
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    assert.equal(view.getUint16(8, true), 0, '首条目（mimetype）stored 不压缩')
    assert.ok(zip.subarray(30, 38).toString('utf8') === 'mimetype', '首条目名 = mimetype')
    assert.ok(zip.subarray(38, 58).toString('utf8') === 'application/epub+zip', 'mimetype 内容 stored 原样')
    const text = zip.toString('latin1')
    for (const needle of ['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/toc.ncx', 'OEBPS/vol1.xhtml', 'OEBPS/chap001.xhtml', 'OEBPS/appendix-characters.xhtml']) {
      assert.ok(text.includes(needle), `${needle} 在 zip 中`)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('卷过滤 + 自定义输出路径；未知卷响亮失败；空项目拒绝导出', async () => {
  const { exporter, store, root } = await makeSetup()
  try {
    await seedProject(store)
    const filtered = await exporter.exportBook({ format: 'txt', volume: '第一卷', outputPath: 'out/vol1.txt' })
    assert.equal(filtered.chapters, 2)
    const text = await readFile(join(root, 'out/vol1.txt'), 'utf8')
    assert.ok(!text.includes('第 3 章'))
    await assert.rejects(() => exporter.exportBook({ format: 'txt', volume: '不存在的卷' }), /没有名为/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
  const empty = await makeSetup()
  try {
    await assert.rejects(() => empty.exporter.exportBook({ format: 'txt' }), /没有已写章节/)
  } finally {
    await rm(empty.root, { recursive: true, force: true })
  }
})
