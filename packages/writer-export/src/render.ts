/**
 * 导出渲染纯函数：书籍模型 → TXT/HTML/EPUB（XHTML）文档文本。
 * 全部输出经 HTML/XML 转义（XSS/XML 注入防线——正文是模型产物，不可信）。
 * 纯函数、无 I/O，可独立单测。@module dsh-writer-export/render
 */

/** 导出书籍模型：书名 + 作者 + 按卷组织的章节 + 可选附录。 */
export interface ExportBook {
  title: string
  author: string
  volumes: readonly ExportVolume[]
  /** 可选附录：大纲 / 人物小传（Markdown 文本）。 */
  outlineAppendix?: string
  charactersAppendix?: string
}

/** 一卷：卷名 + 章节列表。 */
export interface ExportVolume {
  name: string
  chapters: readonly ExportChapter[]
}

/** 一章：序号 + 标题 + 正文（Markdown）。 */
export interface ExportChapter {
  number: number
  title: string
  content: string
}

/** HTML/XML 文本转义（正文为模型产物，不可信——XSS/XML 注入防线）。 */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** XML 属性安全转义（与 escapeHtml 同义，语义命名区分用点）。 */
export function escapeXmlAttr(text: string): string {
  return escapeHtml(text)
}

/** 章节显示标题（无标题时退化为「第 N 章」）。 */
export function chapterLabel(chapter: ExportChapter): string {
  return `第 ${chapter.number} 章${chapter.title.length > 0 ? ` ${chapter.title}` : ''}`
}

/** 比较用归一化：去空白与常见中英文标点。 */
function normalizeForCompare(text: string): string {
  return text.replace(/[\s，。：:·、！？!?「」『』""'']/g, '')
}

/** 去掉开头的「第 N 章/节/卷」序号前缀（阿拉伯与中文数字都认），只剩核心标题文本。 */
function stripChapterPrefix(text: string): string {
  return text.replace(/^第[0-9一二三四五六七八九十百千零两]+[章节卷][\s]*/, '')
}

/**
 * HTML/ePub 渲染前的正文预处理：正文以 markdown 标题行开头、且其文本与生成标题
 * （第 N 章 标题）语义重复（忽略空白/标点与序号数字形态差异）时剥离该行，避免导出后
 * 出现字面「## 第二章 …」段落与生成标题重复。TXT 导出不做处理（保留原文为既定语义）。
 */
export function stripDuplicateHeading(chapter: ExportChapter): string {
  const match = chapter.content.match(/^\s*#{1,6}[ \t]+([^\n]*)\r?(?:\n|$)/)
  if (match === null) return chapter.content
  const heading = normalizeForCompare(match[1])
  if (heading.length === 0) return chapter.content
  const headingCore = stripChapterPrefix(heading)
  const titleCore = stripChapterPrefix(normalizeForCompare(chapter.title))
  const duplicate = heading === normalizeForCompare(chapterLabel(chapter))
    || (titleCore.length > 0 && headingCore === titleCore)
  return duplicate ? chapter.content.slice(match[0].length) : chapter.content
}

/** TXT 渲染：卷标题 + 章标题 + 原文（Markdown 原样保留）。 */
export function renderTxt(book: ExportBook): string {
  const parts: string[] = [book.title, book.author.length > 0 ? `作者：${book.author}` : '', '']
  for (const volume of book.volumes) {
    parts.push(`# ${volume.name}`)
    parts.push('')
    for (const chapter of volume.chapters) {
      parts.push(chapterLabel(chapter))
      parts.push('')
      parts.push(chapter.content.trimEnd())
      parts.push('')
    }
  }
  if (book.outlineAppendix !== undefined) parts.push('# 附录：大纲', '', book.outlineAppendix.trimEnd(), '')
  if (book.charactersAppendix !== undefined) parts.push('# 附录：人物小传', '', book.charactersAppendix.trimEnd(), '')
  return `${parts.join('\n').replace(/\n{3,}/g, '\n\n')}\n`
}

/** 打印友好的内嵌 CSS（HTML→浏览器打印→PDF 路径）。 */
export const HTML_PRINT_CSS = [
  'body { font-family: "Noto Serif CJK SC", "Source Han Serif SC", serif; margin: 0 auto; max-width: 42em; line-height: 1.8; color: #1a1a1a; }',
  'h1.book { text-align: center; font-size: 1.8em; margin: 3em 0 0.5em; }',
  'p.author { text-align: center; color: #555; margin-top: 0; }',
  'h2.volume { page-break-before: always; border-bottom: 1px solid #999; padding-bottom: 0.3em; margin-top: 2em; }',
  'h3.chapter { margin-top: 2em; }',
  '.chapter { page-break-before: always; }',
  '.appendix { page-break-before: always; }',
  '@media print { body { max-width: none; } }',
].join('\n')

/** HTML 渲染：转义正文 + 打印 CSS（浏览器打印为 PDF）。 */
export function renderHtml(book: ExportBook): string {
  const parts: string[] = []
  parts.push('<!DOCTYPE html>', '<html lang="zh-CN">', '<head>', '<meta charset="utf-8">', `<title>${escapeHtml(book.title)}</title>`, `<style>${HTML_PRINT_CSS}</style>`, '</head>', '<body>')
  parts.push(`<h1 class="book">${escapeHtml(book.title)}</h1>`)
  if (book.author.length > 0) parts.push(`<p class="author">${escapeHtml(book.author)}</p>`)
  for (const volume of book.volumes) {
    parts.push(`<h2 class="volume">${escapeHtml(volume.name)}</h2>`)
    for (const chapter of volume.chapters) {
      parts.push(`<section class="chapter"><h3>${escapeHtml(chapterLabel(chapter))}</h3>`)
      for (const paragraph of stripDuplicateHeading(chapter).split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0)) {
        parts.push(`<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`)
      }
      parts.push('</section>')
    }
  }
  if (book.outlineAppendix !== undefined) parts.push(`<section class="appendix"><h2>附录：大纲</h2><pre>${escapeHtml(book.outlineAppendix)}</pre></section>`)
  if (book.charactersAppendix !== undefined) parts.push(`<section class="appendix"><h2>附录：人物小传</h2><pre>${escapeHtml(book.charactersAppendix)}</pre></section>`)
  parts.push('</body>', '</html>')
  return `${parts.join('\n')}\n`
}

// ---------------------------------------------------------------------------
// EPUB（2.0.1）：XHTML 章节文档 + container.xml / content.opf / toc.ncx
// ---------------------------------------------------------------------------

/** 单个 XHTML 章节文档（转义正文，段落化；EPUB 2 严格规范要求 XHTML 1.1 DTD 声明）。 */
export function renderChapterXhtml(chapter: ExportChapter): string {
  const paragraphs = stripDuplicateHeading(chapter).split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0)
  const body = paragraphs.map((p) => `    <p>${escapeHtml(p).replaceAll('\n', '<br/>')}</p>`).join('\n')
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">',
    '<html xmlns="http://www.w3.org/1999/xhtml">',
    '  <head>',
    `    <title>${escapeHtml(chapterLabel(chapter))}</title>`,
    '    <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>',
    '  </head>',
    '  <body>',
    `    <h2>${escapeHtml(chapterLabel(chapter))}</h2>`,
    body,
    '  </body>',
    '</html>',
    '',
  ].join('\n')
}

/** 卷首 XHTML（进 manifest 与 spine，作为该卷的分节标题页；NCX 目录同序引用）。 */
export function renderVolumeXhtml(volume: ExportVolume): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">',
    '<html xmlns="http://www.w3.org/1999/xhtml">',
    '  <head>',
    `    <title>${escapeHtml(volume.name)}</title>`,
    '    <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>',
    '  </head>',
    '  <body>',
    `    <h1>${escapeHtml(volume.name)}</h1>`,
    '  </body>',
    '</html>',
    '',
  ].join('\n')
}

/** META-INF/container.xml：指向 OPF 包文档。 */
export function renderContainerXml(opfPath: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="${escapeXmlAttr(opfPath)}" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>\n`
}

/** EPUB 章节清单条目（opf spine 顺序 = 文档顺序）。 */
export interface EpubManifestItem {
  id: string
  href: string
  mediaType: string
}

/**
 * content.opf 渲染：manifest（全部文档 + ncx）+ spine（卷首/章节顺序）。
 * @param book - 书籍模型（标题/作者进 DC 元数据）。
 * @param items - manifest 条目（含 ncx，id 固定 "ncx"）。
 * @param spineOrder - spine 引用的 item id 顺序。
 * @param uuid - 书籍唯一标识（dcterms:identifier）。
 */
export function renderContentOpf(book: ExportBook, items: readonly EpubManifestItem[], spineOrder: readonly string[], uuid: string): string {
  const manifest = items.map((i) => `    <item id="${escapeXmlAttr(i.id)}" href="${escapeXmlAttr(i.href)}" media-type="${escapeXmlAttr(i.mediaType)}"/>`).join('\n')
  const spine = spineOrder.map((id) => `    <itemref idref="${escapeXmlAttr(id)}"/>`).join('\n')
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0">',
    '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">',
    `    <dc:title>${escapeHtml(book.title)}</dc:title>`,
    `    <dc:creator opf:role="aut">${escapeHtml(book.author)}</dc:creator>`,
    '    <dc:language>zh-CN</dc:language>',
    `    <dc:identifier id="bookid">${escapeHtml(uuid)}</dc:identifier>`,
    '  </metadata>',
    '  <manifest>',
    manifest,
    '  </manifest>',
    '  <spine toc="ncx">',
    spine,
    '  </spine>',
    '</package>',
    '',
  ].join('\n')
}

/** toc.ncx 渲染（EPUB2 目录）。navPoint 顺序 = spine 顺序（卷首与所属章节交错，阅读器「下一项」不跳卷）；
 * content src 相对 NCX 文件自身（NCX 在 OEBPS/ 内，故用不带目录前缀的文件名）。 */
export function renderTocNcx(book: ExportBook, tocItems: readonly { label: string; href: string }[], uuid: string): string {
  const navPoints = tocItems.map((item, i) => {
    const order = i + 1
    return `    <navPoint id="nav${order}" playOrder="${order}"><navLabel><text>${escapeHtml(item.label)}</text></navLabel><content src="${escapeXmlAttr(item.href)}"/></navPoint>`
  })
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">',
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">',
    '  <head>',
    // NCX 2005-1 DTD：meta 为空元素，值在 content 属性
    `    <meta name="dtb:uid" content="${escapeXmlAttr(uuid)}"/>`,
    '    <meta name="dtb:depth" content="1"/>',
    '  </head>',
    `  <docTitle><text>${escapeHtml(book.title)}</text></docTitle>`,
    '  <navMap>',
    ...navPoints,
    '  </navMap>',
    '</ncx>',
    '',
  ].join('\n')
}
