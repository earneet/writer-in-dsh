/**
 * pending.md 待办清单的分区纯函数（P7：清偿轮次 8 限制⑤——只追加不归档）。
 * 待办节形态：`## [维护 pass] chapter/001（时间）待人工确认` / `## [recompute mark] chapter/001 ...`——
 * **归属只认节头行**（稳定约定）：节正文常含跨章引用（伏笔建议指向后续章），按正文归属会把
 * 其他章的提醒连带移出活跃清单（审查 M 级裁定）。按章归档 = 把该章的全部节移出 pending.md，
 * 由调用方追加进归档文件（.writer/pending-archive.md）。全部纯函数可独立单测。
 * @module dsh-writer-domain/pending
 */

/** 一个待办节：头行（含 `## ` 前缀）与随 body 到下一节或文末的正文。 */
export interface PendingSection {
  header: string
  body: string
}

/**
 * 切分 pending.md 为节列表：首个 `## ` 头行之前的内容不算节（preamble，分区时原样保留在 keep）。
 * 围栏代码块（```）内的 `## ` 行不算节界（防撕裂含 Markdown 示例的节正文）。
 * 节按出现顺序返回。
 */
export function splitPendingSections(text: string): { preamble: string; sections: PendingSection[] } {
  if (text.trim().length === 0) return { preamble: '', sections: [] }
  const normalized = text.replaceAll('\r\n', '\n')
  const lines = normalized.split('\n')
  const sections: PendingSection[] = []
  let preambleEnd = lines.length
  let current: PendingSection | undefined
  let fenced = false
  for (const [i, line] of lines.entries()) {
    if (/^```/.test(line.trim())) fenced = !fenced
    if (!fenced && /^## /.test(line)) {
      if (current !== undefined) sections.push(current)
      current = { header: line, body: '' }
      if (preambleEnd === lines.length) preambleEnd = i
      continue
    }
    if (current !== undefined) current.body += (current.body.length > 0 ? '\n' : '') + line
  }
  if (current !== undefined) sections.push(current)
  const preamble = lines.slice(0, preambleEnd).join('\n')
  return { preamble: preamble.length > 0 ? `${preamble}\n` : '', sections }
}

/** 节归属的章节 id：**只认头行**的 `chapter/<三位序号>`（正文跨章引用不算归属，防过度归档）。 */
export function sectionChapterIds(section: PendingSection): Set<string> {
  const ids = new Set<string>()
  for (const m of section.header.matchAll(/chapter\/(\d{3})/g)) ids.add(m[1])
  return ids
}

/** 重建 pending.md 文本：preamble + 节列表（节间空行分隔，保证再追加时节界清晰）。 */
export function renderPending(preamble: string, sections: readonly PendingSection[]): string {
  if (sections.length === 0) return preamble
  const body = sections.map((s) => `${s.header}\n${stripTrailingNewlines(s.body)}`).join('\n\n')
  return preamble.length > 0 ? `${preamble}${body}\n` : `${body}\n`
}

/** 剥节尾换行（含 CRLF 残留的孤立 \r）。 */
function stripTrailingNewlines(text: string): string {
  return text.replace(/[\r\n]+$/, '')
}

/**
 * 按章分区：头行归属该章的节移入 archived，其余（含正文提及该章但头行不归属的节与 preamble）
 * 保留在 keep。archived 为空串表示该章没有可归档的待办节。再归档幂等：同章二次调用后 archived 为空。
 */
export function partitionPendingByChapter(text: string, chapterId: string): { keep: string; archived: string } {
  if (!/^\d{3}$/.test(chapterId)) {
    throw new Error(`章节 id 必须为三位序号：${JSON.stringify(chapterId)}`)
  }
  const { preamble, sections } = splitPendingSections(text)
  const keepSections: PendingSection[] = []
  const archivedSections: PendingSection[] = []
  for (const section of sections) {
    if (sectionChapterIds(section).has(chapterId)) archivedSections.push(section)
    else keepSections.push(section)
  }
  return {
    keep: renderPending(preamble, keepSections),
    archived: archivedSections.length === 0 ? '' : `${archivedSections.map((s) => `${s.header}\n${stripTrailingNewlines(s.body)}`).join('\n\n')}\n`,
  }
}
