/**
 * Consumer：TXT / HTML（打印 PDF）/ ePub 导出，发布 `ctx.writerExport`。
 * 按卷组织、XSS/XML 转义（正文为模型产物不可信）；独立禁用 = 不安装本包
 * （export_book 工具经 ctx.get 可选消费，缺席不阻塞核心写作）。规划见 docs/implementation-plan.md §1.7。
 * @module dsh-writer-export
 */
import { type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { ExportService, type ExportRequest, type ExportResult } from 'dsh-writer-core'
import type { WriterEntity } from 'dsh-writer-domain'
import {
  chapterLabel, escapeHtml, renderChapterXhtml, renderContainerXml, renderContentOpf, renderHtml,
  renderTxt, renderTocNcx, renderVolumeXhtml, type EpubManifestItem, type ExportBook, type ExportChapter, type ExportVolume,
} from './render.ts'
import { buildZip } from './zip.ts'

/** 插件配置。 */
export interface Config {
  /** 导出输出目录（相对项目根；outputPath 请求参数可覆盖）。 */
  defaultOutputDir: string
}

export const Config: Schema<Config> = Schema.object({
  defaultOutputDir: Schema.string().default('exports').description('导出输出目录（相对项目根）'),
})

/** 章节排序键：frontmatter number 优先，退化为 id 数值。 */
function numberOf(chapter: WriterEntity): number {
  const n = chapter.frontmatter['number']
  return typeof n === 'number' ? n : Number(chapter.id)
}

/** 卷名：frontmatter volume（字符串或数字）；缺失归「正文」卷。 */
function volumeNameOf(chapter: WriterEntity): string {
  const v = chapter.frontmatter['volume']
  const name = v === undefined ? '' : String(v).trim()
  return name.length > 0 ? name : '正文'
}

/**
 * 导出服务。default-export 类插件（服务惯例）：发布 `ctx.writerExport`，
 * tools 的 export_book 经 `ctx.get('writerExport')` 可选消费。
 */
export default class WriterExportServiceImpl extends ExportService {
  static inject = ['writer']
  static Config = Config

  private readonly defaultOutputDir: string

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.defaultOutputDir = config.defaultOutputDir
  }

  async exportBook(request: ExportRequest): Promise<ExportResult> {
    if (request.format !== 'txt' && request.format !== 'html' && request.format !== 'epub') {
      throw new Error(`未知导出格式：${String(request.format)}（可选 txt / html / epub）`)
    }
    const [outline, characters, chapters] = await Promise.all([
      this.ctx.writer.get('outline', 'outline'),
      this.ctx.writer.list('character'),
      this.ctx.writer.list('chapter'),
    ])
    if (chapters.length === 0) throw new Error('项目没有已写章节，无可导出内容')

    // 卷组织：按章节序号排序后按 volume 分组（保持卷的出场顺序）
    const sorted = [...chapters].sort((a, b) => numberOf(a) - numberOf(b))
    const volumeMap = new Map<string, ExportChapter[]>()
    for (const chapter of sorted) {
      const volume = volumeNameOf(chapter)
      const list = volumeMap.get(volume) ?? []
      list.push({
        number: numberOf(chapter),
        title: typeof chapter.frontmatter['title'] === 'string' ? chapter.frontmatter['title'] : '',
        content: chapter.content,
      })
      volumeMap.set(volume, list)
    }
    let volumes: ExportVolume[] = [...volumeMap.entries()].map(([name, list]) => ({ name, chapters: list }))
    if (request.volume !== undefined && request.volume.length > 0) {
      volumes = volumes.filter((v) => v.name === request.volume || v.name === `第${request.volume}卷` || v.name === `第 ${request.volume} 卷`)
      if (volumes.length === 0) throw new Error(`没有名为 ${JSON.stringify(request.volume)} 的卷（现有卷：${[...volumeMap.keys()].join('、')}）`)
    }
    const book: ExportBook = {
      title: typeof outline?.frontmatter['title'] === 'string' ? outline.frontmatter['title'] : '未命名作品',
      author: typeof outline?.frontmatter['author'] === 'string' ? outline.frontmatter['author'] : '',
      volumes,
      ...(request.includeOutline === true && outline !== undefined ? { outlineAppendix: outline.content } : {}),
      ...(request.includeCharacters === true && characters.length > 0
        ? { charactersAppendix: characters.map((c) => `## ${c.id}\n${c.content}`).join('\n\n') }
        : {}),
    }

    const relPath = request.outputPath ?? join(this.defaultOutputDir, `book.${request.format}`)
    // 输出路径限制在项目根内：绝对路径或 ../ 逃逸拒绝（虽有 ask 门禁，纵深防御）
    const absPath = join(this.ctx.writer.root, relPath)
    const relCheck = relative(this.ctx.writer.root, absPath)
    if (isAbsolute(relPath) || relCheck.startsWith('..') || isAbsolute(relCheck)) {
      throw new Error(`输出路径必须在项目根内（相对路径，不得含 ../ 或为绝对路径）：${JSON.stringify(relPath)}`)
    }
    await mkdir(dirname(absPath), { recursive: true })
    let bytes: number
    if (request.format === 'epub') {
      const zip = buildEpub(book)
      await writeFile(absPath, zip)
      bytes = zip.byteLength
    } else {
      const text = request.format === 'txt' ? renderTxt(book) : renderHtml(book)
      await writeFile(absPath, text, 'utf8')
      bytes = Buffer.byteLength(text, 'utf8')
    }
    const chapterCount = volumes.reduce((sum, v) => sum + v.chapters.length, 0)
    return { path: relative(this.ctx.writer.root, absPath).split(sep).join('/'), chapters: chapterCount, bytes }
  }
}

/** 组装 EPUB zip 字节：mimetype 首个且不压缩（OPF/OCF 规范要求）。 */
function buildEpub(book: ExportBook): Uint8Array {
  // dc:identifier 用真 UUID（书名派生会随改名漂移且同题冲突）
  const uuid = `urn:uuid:${randomUUID()}`
  const items: EpubManifestItem[] = []
  const spine: string[] = []
  // tocItems 顺序 = spine 顺序（卷首与所属章节交错）；href 相对 NCX 自身（同在 OEBPS/ 内，不带前缀）
  const tocItems: { label: string; href: string }[] = []
  const files: { name: string; data: string }[] = []
  let chapterIdx = 0
  for (const volume of book.volumes) {
    const volId = `vol${volumeHrefCount(tocItems) + 1}`
    items.push({ id: volId, href: `${volId}.xhtml`, mediaType: 'application/xhtml+xml' })
    spine.push(volId)
    tocItems.push({ label: volume.name, href: `${volId}.xhtml` })
    files.push({ name: `OEBPS/${volId}.xhtml`, data: renderVolumeXhtml(volume) })
    for (const chapter of volume.chapters) {
      chapterIdx++
      const chapId = `chap${String(chapterIdx).padStart(3, '0')}`
      items.push({ id: chapId, href: `${chapId}.xhtml`, mediaType: 'application/xhtml+xml' })
      spine.push(chapId)
      tocItems.push({ label: chapterLabel(chapter), href: `${chapId}.xhtml` })
      files.push({ name: `OEBPS/${chapId}.xhtml`, data: renderChapterXhtml(chapter) })
    }
  }
  if (book.outlineAppendix !== undefined) {
    items.push({ id: 'appendix-outline', href: 'appendix-outline.xhtml', mediaType: 'application/xhtml+xml' })
    spine.push('appendix-outline')
    tocItems.push({ label: '附录：大纲', href: 'appendix-outline.xhtml' })
    files.push({ name: 'OEBPS/appendix-outline.xhtml', data: renderPlainXhtml('附录：大纲', book.outlineAppendix) })
  }
  if (book.charactersAppendix !== undefined) {
    items.push({ id: 'appendix-characters', href: 'appendix-characters.xhtml', mediaType: 'application/xhtml+xml' })
    spine.push('appendix-characters')
    tocItems.push({ label: '附录：人物小传', href: 'appendix-characters.xhtml' })
    files.push({ name: 'OEBPS/appendix-characters.xhtml', data: renderPlainXhtml('附录：人物小传', book.charactersAppendix) })
  }
  items.push({ id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml' })
  files.push({ name: 'OEBPS/toc.ncx', data: renderTocNcx(book, tocItems, uuid) })
  files.push({ name: 'OEBPS/content.opf', data: renderContentOpf(book, items, spine, uuid) })
  files.push({ name: 'META-INF/container.xml', data: renderContainerXml('OEBPS/content.opf') })
  // mimetype 必须首个且不压缩（stored-only 构建器天然满足）
  return buildZip([{ name: 'mimetype', data: 'application/epub+zip' }, ...files])
}

/** 卷 id 计数辅助（卷首文档已入 tocItems 的数量即当前卷序号）。 */
function volumeHrefCount(tocItems: readonly { href: string }[]): number {
  return tocItems.filter((t) => t.href.startsWith('vol')).length
}

/** 附录类 XHTML（预格式文本）。 */
function renderPlainXhtml(title: string, text: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!DOCTYPE html>',
    '<html xmlns="http://www.w3.org/1999/xhtml">',
    '  <head>',
    `    <title>${escapeHtml(title)}</title>`,
    '    <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>',
    '  </head>',
    '  <body>',
    `    <h2>${escapeHtml(title)}</h2>`,
    `    <pre>${escapeHtml(text)}</pre>`,
    '  </body>',
    '</html>',
    '',
  ].join('\n')
}
