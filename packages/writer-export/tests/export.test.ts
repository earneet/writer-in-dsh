/**
 * writer-export 纯函数单测：zip 构建器（CRC/顺序/结构）、转义、TXT/HTML/EPUB 渲染。
 * 运行：node --test packages/writer-export/tests/export.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { crc32, buildZip } from '../src/zip.ts'
import {
  escapeHtml, renderChapterXhtml, renderContainerXml, renderContentOpf, renderHtml, renderTxt, renderTocNcx,
} from '../src/render.ts'
const BOOK = {
  title: '测试书',
  author: '某人',
  volumes: [
    {
      name: '第一卷',
      chapters: [
        { number: 1, title: '夜行', content: '第一段。\n\n第二段。<script>alert(1)</script>&\'"' },
        { number: 2, title: '', content: '第二章无题。' },
      ],
    },
  ],
} as const

test('buildZip：中央目录往返——EOCD → 中央目录 → 本地头 → 数据逐条解出并核对 CRC', () => {
  const entries = [
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: '<container/>' },
    { name: 'OEBPS/中文 name.xhtml', data: '内容🎯' },
  ]
  const zip = buildZip(entries)
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  // EOCD（尾 22 字节，无注释）
  const eocd = zip.byteLength - 22
  assert.equal(view.getUint32(eocd, true), 0x06054b50)
  const count = view.getUint16(eocd + 10, true)
  const cdOffset = view.getUint32(eocd + 16, true)
  assert.equal(count, entries.length)
  // 中央目录逐条目：签名/名长/大小/crc/本地偏移 → 定位本地头 → 名与数据比对
  const decoder = new TextDecoder()
  let at = cdOffset
  for (const entry of entries) {
    assert.equal(view.getUint32(at, true), 0x02014b50, '中央目录条目签名')
    const nameLen = view.getUint16(at + 28, true)
    const size = view.getUint32(at + 24, true)
    const crc = view.getUint32(at + 16, true)
    const localOff = view.getUint32(at + 42, true)
    const name = decoder.decode(zip.subarray(at + 46, at + 46 + nameLen))
    assert.equal(name, entry.name)
    // 本地头
    assert.equal(view.getUint32(localOff, true), 0x04034b50)
    const localNameLen = view.getUint16(localOff + 26, true)
    const dataStart = localOff + 30 + localNameLen
    const data = zip.subarray(dataStart, dataStart + size)
    assert.equal(crc32(data), crc, `${entry.name} 数据 CRC 与中央目录一致`)
    const text = decoder.decode(data)
    assert.equal(text, entry.data, 'stored 条目数据原样')
    at += 46 + nameLen
  }
})

test('crc32：标准测试向量', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926)
  assert.equal(crc32(new Uint8Array(0)), 0)
})

test('buildZip：mimetype 首个且 stored；条目可按本地头定位', () => {
  const zip = buildZip([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: '<container/>' },
  ])
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  assert.equal(view.getUint32(0, true), 0x04034b50, '首个本地文件头签名')
  // 首条目无数据描述符且方法为 0（stored）
  assert.equal(view.getUint16(8, true), 0, '压缩方法 stored')
  const encoder = new TextEncoder()
  const mime = encoder.encode('application/epub+zip')
  assert.equal(view.getUint32(18, true), mime.length)
  // EOCD 在尾部且条目数为 2
  assert.equal(view.getUint32(zip.byteLength - 22, true), 0x06054b50)
  assert.equal(view.getUint16(zip.byteLength - 22 + 10, true), 2)
})

test('escapeHtml：五种字符全转义（XSS/XML 防线）', () => {
  assert.equal(escapeHtml('<script>a&&b</script>'), '&lt;script&gt;a&amp;&amp;b&lt;/script&gt;')
  assert.equal(escapeHtml('"x\'y"'), '&quot;x&#39;y&quot;')
})

test('renderTxt：卷/章标题 + 原文 + 尾换行', () => {
  const txt = renderTxt(BOOK)
  assert.ok(txt.includes('# 第一卷'))
  assert.ok(txt.includes('第 1 章 夜行'))
  assert.ok(txt.includes('第 2 章'))
  assert.ok(txt.endsWith('\n'))
})

test('renderHtml：正文转义无裸 <script>，卷/章分节', () => {
  const html = renderHtml(BOOK)
  assert.ok(!html.includes('<script>'), '模型正文的 script 已转义')
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('<h2 class="volume">第一卷</h2>'))
  assert.ok(html.includes('<h3>第 1 章 夜行</h3>'))
  assert.ok(html.includes('@media print'))
})

test('renderChapterXhtml：合法 XML 骨架 + 转义正文 + XHTML 1.1 DTD（EPUB 2 严格规范）', () => {
  const xhtml = renderChapterXhtml(BOOK.volumes[0].chapters[0])
  assert.ok(xhtml.startsWith('<?xml version="1.0" encoding="utf-8"?>'))
  assert.ok(xhtml.includes('DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN"'), 'XHTML 1.1 doctype')
  assert.ok(xhtml.includes('xmlns="http://www.w3.org/1999/xhtml"'))
  assert.ok(!xhtml.includes('<script>'))
})

test('stripDuplicateHeading：HTML/ePub 渲染剥离与生成标题重复的首行 markdown 标题；TXT 语义不变', () => {
  const chapter = { number: 2, title: '残页', content: '## 第二章 残页\n\n约纳斯的手一直在抖。\n\n第二段。' }
  const html = renderHtml({ title: '书', author: '', volumes: [{ name: '第一卷', chapters: [chapter] }] })
  assert.ok(html.includes('<h3>第 2 章 残页</h3>'), '生成标题在')
  assert.ok(!html.includes('## 第二章'), '重复的首行 markdown 标题被剥离')
  assert.ok(html.includes('约纳斯的手一直在抖。'), '正文保留')
  const xhtml = renderChapterXhtml(chapter)
  assert.ok(!xhtml.includes('## 第二章'), 'XHTML 同样剥离')
  const txt = renderTxt({ title: '书', author: '', volumes: [{ name: '第一卷', chapters: [chapter] }] })
  assert.ok(txt.includes('## 第二章 残页'), 'TXT 保留原文（既定语义）')
  // 非重复标题（内容不同的 markdown 头）不误删
  const keep = { number: 3, title: '风暴', content: '## 场景：灯塔内部\n\n正文。' }
  const keptHtml = renderHtml({ title: '书', author: '', volumes: [{ name: '第一卷', chapters: [keep] }] })
  assert.ok(keptHtml.includes('## 场景：灯塔内部'), '与章标题无关的 markdown 头保留')
})

test('EPUB 结构文档：container/opf/ncx 均含必需元素且转义', () => {
  const container = renderContainerXml('OEBPS/content.opf')
  assert.match(container, /full-path="OEBPS\/content\.opf"/)
  const opf = renderContentOpf(
    { title: 'T&a', author: '', volumes: [], outlineAppendix: undefined, charactersAppendix: undefined },
    [
      { id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml' },
      { id: 'chap001', href: 'chap001.xhtml', mediaType: 'application/xhtml+xml' },
    ],
    ['chap001'],
    'urn:uuid:x',
  )
  assert.match(opf, /<dc:title>T&amp;a<\/dc:title>/, '标题经 XML 转义')
  assert.match(opf, /unique-identifier="bookid"/)
  assert.match(opf, /<itemref idref="chap001"\/>/)
  const ncx = renderTocNcx(
    { title: 'T', author: '', volumes: [], outlineAppendix: undefined, charactersAppendix: undefined },
    [
      { label: '第一卷', href: 'vol1.xhtml' },
      { label: '第 1 章 夜行', href: 'chap001.xhtml' },
      { label: '第 2 章', href: 'chap002.xhtml' },
    ],
    'urn:uuid:x',
  )
  // navPoint 顺序 = spine 顺序（卷首与章节交错）；src 相对 NCX 自身（不带 OEBPS/ 前缀）
  assert.ok(ncx.indexOf('navLabel><text>第一卷') < ncx.indexOf('第 1 章 夜行'), '卷首先于其章节')
  assert.ok(ncx.indexOf('第 1 章 夜行') < ncx.indexOf('第 2 章'), '章节顺序保持')
  assert.match(ncx, /<content src="chap001\.xhtml"\/>/)
  assert.ok(!ncx.includes('OEBPS/'), 'NCX src 不带 OEBPS/ 前缀')
  assert.match(ncx, /<meta name="dtb:uid" content="urn:uuid:x"\/>/, 'meta 值在 content 属性（DTD 合规）')
})
