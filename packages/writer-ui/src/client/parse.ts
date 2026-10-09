/**
 * 工具结果文本 → 结构化视图模型的纯函数解析器（面板与富卡片共用）。
 * 输入格式与 packages/writer-tools/src/index.ts 的渲染逐字对齐；解析失败一律返回
 * null（调用方回退为原文显示），绝不抛错——卡片不得比通用卡片差。
 */

/** writer_stats 的结构化快照。 */
export interface WriterStats {
  chapters: number
  totalChars: number
  volumes: { name: string; count: number }[]
  characters: number
  arcCoverage: string
  arcBroken: string[]
  foreshadow: { status: string; count: number }[]
  derivedCoverage: string
  staleChapters: string[]
}

/** 一次 write_chapter 结果的摘要。 */
export interface WriteChapterResult {
  mode: string
  chapterId: string
  chars: number
  patchesApplied: number
  patchesSkipped: number
  droppedSentences: number
  /** 「rewrite 判定无需修改」等非保存路径的原文首行。 */
  note: string | null
}

/** 审稿建议条目。 */
export interface ReviewSuggestion {
  severity: string
  dimension: string
  problem: string
}

export interface ReviewReport {
  count: number
  summary: string
  suggestions: ReviewSuggestion[]
}

/** 解析 writer_stats 输出（工具渲染格式；人物时间线一览不计入结构化字段）。 */
export function parseWriterStats(text: string): WriterStats | null {
  if (!text.includes('章节：')) return null
  const stats: WriterStats = {
    chapters: 0, totalChars: 0, volumes: [], characters: 0,
    arcCoverage: '', arcBroken: [], foreshadow: [], derivedCoverage: '', staleChapters: [],
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    let m = /^章节：(\d+) 章，共约 (\d+) 字$/.exec(trimmed)
    if (m !== null) { stats.chapters = Number(m[1]); stats.totalChars = Number(m[2]); continue }
    m = /^卷分布：(.+)$/.exec(trimmed)
    if (m !== null) {
      stats.volumes = m[1].split('、').map(part => /^(\D.*?)×(\d+)$/.exec(part)).filter((x): x is RegExpExecArray => x !== null)
        .map(x => ({ name: x[1], count: Number(x[2]) }))
      continue
    }
    m = /^人物：(\d+) 个$/.exec(trimmed)
    if (m !== null) { stats.characters = Number(m[1]); continue }
    m = /^人物弧线覆盖：(.+)$/.exec(trimmed)
    if (m !== null) {
      // 行内可能带「；⚠ 非法 timeline：a、b」尾段——覆盖率为其前段补回括号
      const warnAt = m[1].indexOf('；⚠ 非法 timeline：')
      if (warnAt >= 0) {
        stats.arcCoverage = `${m[1].slice(0, warnAt)}）`
        stats.arcBroken = m[1].slice(warnAt + '；⚠ 非法 timeline：'.length).replace(/）$/, '').split('、')
      } else {
        stats.arcCoverage = m[1]
      }
      continue
    }
    m = /^伏笔：(.+)$/.exec(trimmed)
    if (m !== null && m[1] !== '无') {
      stats.foreshadow = m[1].split('、').map(part => /^(\S+)×(\d+)$/.exec(part)).filter((x): x is RegExpExecArray => x !== null)
        .map(x => ({ status: x[1], count: Number(x[2]) }))
      continue
    }
    m = /^维护派生覆盖：(.+)$/.exec(trimmed)
    if (m !== null) {
      const staleAt = m[1].indexOf('（待维护 pass：')
      if (staleAt >= 0) {
        stats.derivedCoverage = m[1].slice(0, staleAt)
        stats.staleChapters = m[1].slice(staleAt + '（待维护 pass：'.length).replace(/）$/, '').split('、')
      } else {
        stats.derivedCoverage = m[1]
      }
    }
  }
  return stats
}

/** 解析 write_chapter 输出（保存回执 + 补丁协议 + 丢句告警）。 */
export function parseWriteChapter(text: string): WriteChapterResult | null {
  const saved = /^已完成 (\S+) 写作并保存 chapter\/(\d{3})（hash=\S+，字数≈(\d+)）$/m.exec(text)
  if (saved !== null) {
    const applied = /补丁协议：命中 (\d+) 条，跳过 (\d+) 条/.exec(text)
    const dropped = /丢句守卫告警（共 (\d+) 条原句未保留/.exec(text)
    return {
      mode: saved[1], chapterId: saved[2], chars: Number(saved[3]),
      patchesApplied: applied !== null ? Number(applied[1]) : 0,
      patchesSkipped: applied !== null ? Number(applied[2]) : 0,
      droppedSentences: dropped !== null ? Number(dropped[1]) : 0,
      note: null,
    }
  }
  const noop = /^rewrite 判定无需修改，未落盘（chapter\/(\d{3})/m.exec(text)
  if (noop !== null) {
    return { mode: 'rewrite-patch', chapterId: noop[1], chars: 0, patchesApplied: 0, patchesSkipped: 0, droppedSentences: 0, note: text.split('\n')[0] ?? null }
  }
  return null
}

/** 解析 review_chapter 输出（总评 + 逐条建议）。 */
export function parseReview(text: string): ReviewReport | null {
  const head = /^审稿完成（(\d+) 条建议）。总评：(.*)$/m.exec(text)
  if (head === null) {
    if (/^审稿完成，无结构化建议。/.test(text)) {
      return { count: 0, summary: /^审稿完成，无结构化建议。总评：(.*)$/m.exec(text)?.[1] ?? '', suggestions: [] }
    }
    return null
  }
  const suggestions: ReviewSuggestion[] = []
  for (const match of text.matchAll(/^\d+\. \[(\w+)\] ([^：]+)：(.+)$/gm)) {
    suggestions.push({ severity: match[1], dimension: match[2], problem: match[3] })
  }
  return { count: Number(head[1]), summary: head[2], suggestions }
}

/** 解析 foreshadow_update 输出（状态推进回执）。 */
export function parseForeshadow(text: string): { id: string; status: string } | null {
  const m = /^已更新伏笔 (\S+)（status=(\w+)，/m.exec(text)
  return m === null ? null : { id: m[1], status: m[2] }
}

/** 解析 consistency_check 输出（批次数与矛盾数）。 */
export function parseConsistency(text: string): { batches: string; issues: number } | null {
  const m = /^一致性检查完成（(.+?)），发现 (\d+) 条矛盾。/m.exec(text)
  return m === null ? null : { batches: m[1], issues: Number(m[2]) }
}
