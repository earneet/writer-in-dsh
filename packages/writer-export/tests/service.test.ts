/**
 * writer-export 集成单测：真实 store + 导出服务（共享 Context 桩，writer 实例直接挂属性代理位），
 * 验证卷组织、输出路径、XSS 转义与 EPUB 结构落地到产物文件。
 * 运行：node --test packages/writer-export/tests/service.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, mkdir, readdir, symlink } from 'node:fs/promises'
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

for (const format of ['txt', 'html', 'epub'] as const) {
    test(`${format} 导出以 project 为书名作者来源，兼容旧大纲元数据`, async () => {
        const { exporter, store, root } = await makeSetup()
        try {
            await seedProject(store)
            await exporter.exportBook({ format })
            assert.ok((await readFile(join(root, `exports/book.${format}`))).includes(Buffer.from('灯塔街异闻')))
            await store.save('project', 'project', { content: '项目简介。', frontmatter: { title: '项目中的正式书名', author: '项目作者' } })
            const updated = await exporter.exportBook({ format })
            assert.equal(updated.path, `exports/book-2.${format}`)
            const output = await readFile(join(root, updated.path))
            assert.ok(output.includes(Buffer.from('项目中的正式书名')))
            assert.ok(output.includes(Buffer.from('项目作者')))
            assert.ok(!output.includes(Buffer.from('灯塔街异闻')))
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })
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
    const filtered = await exporter.exportBook({ format: 'txt', volume: '第一卷', outputPath: 'exports/out/vol1.txt' })
    assert.equal(filtered.chapters, 2)
    const text = await readFile(join(root, filtered.path), 'utf8')
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

test('导出拒绝原稿路径与目录联接，原稿字节保持一致', async () => {
    const { exporter, store, root } = await makeSetup()
    try {
        await seedProject(store)
        const chapterPath = join(root, 'chapters/001.md')
        const before = await readFile(chapterPath)
        for (const path of ['chapters/001.md', 'CHAPTERS/001.md', 'project.md', 'pending.md', 'pending-archive.md', 'exports/../chapters/001.txt', join(root, 'exports/x.txt')]) {
            await assert.rejects(exporter.exportBook({ format: 'txt', outputPath: path }), /导出路径/)
        }
        await mkdir(join(root, 'exports'))
        await symlink(join(root, 'chapters'), join(root, 'exports/source'), process.platform === 'win32' ? 'junction' : 'dir')
        await assert.rejects(exporter.exportBook({ format: 'txt', outputPath: 'exports/source/x.txt' }), /导出路径/)
        assert.deepEqual(await readFile(chapterPath), before)
        await assert.rejects(readFile(join(root, 'chapters/x.txt')), { code: 'ENOENT' })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('并发导出生成不同完整成品，旧文件不变', async () => {
    const { exporter, store, root } = await makeSetup()
    try {
        await seedProject(store)
        const original = await exporter.exportBook({ format: 'epub' })
        const before = await readFile(join(root, original.path))
        const results = await Promise.all([exporter.exportBook({ format: 'epub' }), exporter.exportBook({ format: 'epub' })])
        assert.deepEqual(results.map(result => result.path).sort(), ['exports/book-2.epub', 'exports/book-3.epub'])
        for (const result of results) assert.equal((await readFile(join(root, result.path))).byteLength, result.bytes)
        assert.deepEqual(await readFile(join(root, original.path)), before)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('配置拒绝权威目录，发布冲突失败后清理临时文件', async () => {
    const { exporter, store, root } = await makeSetup()
    try {
        for (const dir of ['CHAPTERS', '.writer/out', 'project.md/sub']) {
            assert.throws(() => new WriterExportServiceImpl(store.ctx, { defaultOutputDir: dir }), /独立目录/)
        }
        await seedProject(store)
        const existing = await exporter.exportBook({ format: 'txt' })
        const original = await readFile(join(root, existing.path))
        await mkdir(join(root, 'exports/blocked.txt'))
        await assert.rejects(exporter.exportBook({ format: 'txt', outputPath: 'exports/blocked.txt' }), /非普通文件/)
        assert.deepEqual((await readdir(join(root, 'exports'))).sort(), ['blocked.txt', 'book.txt'])
        assert.deepEqual(await readFile(join(root, existing.path)), original)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
