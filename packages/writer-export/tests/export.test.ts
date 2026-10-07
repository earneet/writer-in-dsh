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

test('renderChapterXhtml：合法 XML 骨架 + 转义正文', () => {
  const xhtml = renderChapterXhtml(BOOK.volumes[0].chapters[0])
  assert.ok(xhtml.startsWith('<?xml version="1.0" encoding="utf-8"?>'))
  assert.ok(xhtml.includes('xmlns="http://www.w3.org/1999/xhtml"'))
  assert.ok(!xhtml.includes('<script>'))
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
    [{ name: '第一卷', href: 'OEBPS/vol1.xhtml' }],
    [{ label: '第 1 章 夜行', href: 'OEBPS/chap001.xhtml' }],
    'urn:uuid:x',
  )
  assert.match(ncx, /<navPoint id="vol1"/)
  assert.match(ncx, /<navPoint id="chap2"/)
  assert.match(ncx, /<content src="OEBPS\/chap001\.xhtml"\/>/)
})
