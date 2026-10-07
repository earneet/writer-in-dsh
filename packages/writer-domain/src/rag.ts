/**
 * P4 RAG 纯函数域库：分块、中文关键词打分（自实现 TF-IDF，勿引入分词重依赖）、
 * RRF 融合、防剧透过滤、检索增强分节渲染。
 * 复刻映射来源 references/novel-writer-analysis.md §8（向量+FTS5 bm25+RRF+源类型权重；
 * 本仓降级为：CJK bigram TF-IDF 关键词先行 + 可选语义档后验，语义后端由 Provider 配置）。
 * 全部纯函数可独立单测。@module dsh-writer-domain/rag
 */
import { chapterNumberOf, type EntityKind, type WriterEntity } from './index.ts'

/** 一条检索语料块：实体派生（章节切片/摘要/条目）。 */
export interface RagChunk {
  /** 稳定块 id（`${refKind}/${refId}` + 可选 `#序号`）。 */
  id: string
  refKind: EntityKind
  refId: string
  title?: string
  text: string
  /** 章节块的序号（防剧透过滤锚）。 */
  chapterNumber?: number
}

/** 构建检索语料的输入：store 实体集 + 维护 pass 派生摘要（新鲜度由调用方裁定）。 */
export interface RagCorpusInput {
  chapters: readonly WriterEntity[]
  characters: readonly WriterEntity[]
  plots: readonly WriterEntity[]
  worldbuilding: readonly WriterEntity[]
  /** chapterId → 新鲜派生摘要（sourceHash 与当前 hash 一致才传入）。 */
  summaries: Readonly<Record<string, string>>
  /** 章节切片字符数（默认 600）与重叠（默认 80，须小于切片一半）。 */
  chunkChars?: number
  chunkOverlap?: number
}

/** 章节正文切片（保序、带重叠）；短于切片长度返回单片。 */
export function chunkChapterText(content: string, chunkChars: number, overlap: number): string[] {
  const size = Math.max(100, Math.floor(chunkChars))
  const step = Math.max(50, size - Math.max(0, Math.floor(overlap)))
  const text = content.trim()
  if (text.length === 0) return []
  if (text.length <= size) return [text]
  const chunks: string[] = []
  for (let at = 0; at < text.length; at += step) {
    chunks.push(text.slice(at, at + size))
    if (at + size >= text.length) break
  }
  return chunks
}

function chapterNumber(entity: WriterEntity): number | undefined {
  // 单一共用实现见 index.ts chapterNumberOf（组装器与 RAG 防剧透同规则：frontmatter 优先、数字 id 兜底、undefined 保守）
  return chapterNumberOf(entity)
}

/**
 * 构建检索语料块：章节原文切片 + 新鲜派生摘要 + 人物/伏笔/世界观条目（长条目切片）。
 * 摘要块排在章节原文块之前（id 序稳定），供关键词阶段统一打分。
 */
export function buildRagCorpus(input: RagCorpusInput): RagChunk[] {
  const chunkChars = input.chunkChars ?? 600
  const overlap = input.chunkOverlap ?? 80
  const chunks: RagChunk[] = []
  const push = (chunk: RagChunk): void => {
    if (chunk.text.trim().length > 0) chunks.push(chunk)
  }
  for (const chapter of input.chapters) {
    const number = chapterNumber(chapter)
    const title = typeof chapter.frontmatter['title'] === 'string' ? chapter.frontmatter['title'] : undefined
    const summary = input.summaries[chapter.id]
    if (summary !== undefined && summary.trim().length > 0) {
      push({ id: `chapter/${chapter.id}#summary`, refKind: 'chapter', refId: chapter.id, title, text: summary, chapterNumber: number })
    }
    for (const [i, piece] of chunkChapterText(chapter.content, chunkChars, overlap).entries()) {
      push({ id: `chapter/${chapter.id}#${i}`, refKind: 'chapter', refId: chapter.id, title, text: piece, chapterNumber: number })
    }
  }
  for (const character of input.characters) {
    push({ id: `character/${character.id}`, refKind: 'character', refId: character.id, title: character.id, text: character.content })
  }
  for (const plot of input.plots) {
    const status = String(plot.frontmatter['status'] ?? 'planned')
    push({ id: `plot/${plot.id}`, refKind: 'plot', refId: plot.id, title: plot.id, text: `状态：${status}\n${plot.content}` })
  }
  for (const world of input.worldbuilding) {
    push({ id: `worldbuilding/${world.id}`, refKind: 'worldbuilding', refId: world.id, title: world.id, text: world.content })
  }
  return chunks
}

/**
 * 查询/语料分词：CJK 字符 bigram + 拉丁/数字词（小写化）。
 * 自实现（原项目 jieba 分词依赖不引入）；中文 2 字词与 bigram 高度重合，召回可接受。
 */
export function tokenizeForSearch(text: string): string[] {
  const tokens: string[] = []
  const pushLatin = (word: string): void => {
    const lower = word.toLowerCase()
    if (lower.length > 0) tokens.push(lower)
  }
  let cjkRun = ''
  const flushCjk = (): void => {
    if (cjkRun.length >= 2) {
      for (let i = 0; i + 2 <= cjkRun.length; i++) tokens.push(cjkRun.slice(i, i + 2))
      if (cjkRun.length === 3) tokens.push(cjkRun)
    } else if (cjkRun.length === 1) {
      tokens.push(cjkRun) // 单字 CJK 也入词表（人名短姓等）
    }
    cjkRun = ''
  }
  for (const word of text.split(/[^\p{Script=Han}\p{L}\p{N}]+/u)) {
    if (word.length === 0) continue
    // 每个词内再按 CJK / 拉丁切分（混排如 "elin的剑"）
    let latin = ''
    for (const ch of word) {
      if (/\p{Script=Han}/u.test(ch)) {
        if (latin.length > 0) { pushLatin(latin); latin = '' }
        cjkRun += ch
      } else {
        if (cjkRun.length > 0) { flushCjk(); }
        latin += ch
      }
    }
    if (latin.length > 0) pushLatin(latin)
    if (cjkRun.length > 0) flushCjk()
  }
  return tokens
}

/** 关键词阶段单块得分。 */
export interface KeywordScore {
  chunkId: string
  score: number
}

/**
 * 关键词打分（TF-IDF 语义自实现）：查询 token 在块内的频次 × 逆文档频次（含查询 token 的块数越少越显著）。
 * 返回按得分降序的排名；零分块不返回。
 */
export function keywordScores(query: string, chunks: readonly RagChunk[]): KeywordScore[] {
  const queryTokens = new Set(tokenizeForSearch(query))
  if (queryTokens.size === 0 || chunks.length === 0) return []
  const tokenCounts: Map<string, number>[] = chunks.map((chunk) => {
    const counts = new Map<string, number>()
    for (const token of tokenizeForSearch(chunk.text)) counts.set(token, (counts.get(token) ?? 0) + 1)
    return counts
  })
  const docFreq = new Map<string, number>()
  for (const counts of tokenCounts) {
    for (const token of queryTokens) {
      if (counts.has(token)) docFreq.set(token, (docFreq.get(token) ?? 0) + 1)
    }
  }
  const results: KeywordScore[] = []
  for (const [i, chunk] of chunks.entries()) {
    let score = 0
    for (const [token, df] of docFreq) {
      const tf = tokenCounts[i].get(token)
      if (tf === undefined) continue
      // 加 log(1 + tf) 抑制长块刷频；idf = 1 + log(N / df)（df≥1）
      score += Math.log1p(tf) * (1 + Math.log(chunks.length / df))
    }
    if (score > 0) results.push({ chunkId: chunk.id, score })
  }
  return results.sort((a, b) => b.score - a.score)
}

/** RRF 融合（k=60 惯例）：多路排名按名次倒数求和；缺路等价于该路不参与。 */
export function rrfFuse(rankings: readonly (readonly string[])[]): Map<string, number> {
  const fused = new Map<string, number>()
  for (const ranking of rankings) {
    for (const [rank, chunkId] of ranking.entries()) {
      fused.set(chunkId, (fused.get(chunkId) ?? 0) + 1 / (60 + rank + 1))
    }
  }
  return fused
}

/** 防剧透过滤的伏笔语境：与 assembleWritingContext 伏笔指令同款规则。 */
export interface SpoilerFilterInput {
  /** 当前写作章号：章节块只保留序号小于本章的。 */
  chapterNumber: number
  /** 全部伏笔实体（判定未回收伏笔的 planned_chapter 泄漏）。 */
  plots: readonly WriterEntity[]
}

/**
 * 防剧透过滤（纯函数）：①章节/章节摘要块只保留序号小于当前章的，**章号不可判定（frontmatter 脏
 * 且文件名非数字）的章节块保守剔除**——检索命中早章原文不得以脏数据为通道突破剧透红线；
 * ②未回收伏笔（planned/planted）planned_chapter 晚于本章的 plot 块剔除
 * （与组装器「只注入未回收且 planned_chapter 不晚于本章」一致）。
 */
export function filterChunksBySpoiler(chunks: readonly RagChunk[], filter: SpoilerFilterInput): RagChunk[] {
  return chunks.filter((chunk) => {
    if (chunk.refKind === 'chapter') {
      // chapterNumber===undefined 的章节块（含摘要块）一律不可见（保守红线）
      return chunk.chapterNumber !== undefined && chunk.chapterNumber < filter.chapterNumber
    }
    if (chunk.refKind === 'plot') {
      const plot = filter.plots.find((p) => p.id === chunk.refId)
      if (plot === undefined) return true
      const status = String(plot.frontmatter['status'] ?? 'planned')
      if (status !== 'planned' && status !== 'planted') return true
      const anchor = Number(plot.frontmatter['planned_chapter'])
      // planned_chapter 缺失按「不晚于本章」处理（脏值按缺失，与组装器 chapterAnchorOf 同语义）
      if (!Number.isFinite(anchor)) return true
      return anchor <= filter.chapterNumber
    }
    return true
  })
}

/** 一条检索命中（Provider 对外形状；snippet 已截断）。 */
export interface RagHit {
  chunkId: string
  refKind: EntityKind
  refId: string
  title?: string
  snippet: string
  score: number
  chapterNumber?: number
}

/** 渲染检索增强分节正文（供 assembleWritingContext 之后的追加注入）。 */
export function renderRagSection(hits: readonly RagHit[]): string {
  return hits.map((hit) => {
    const origin = hit.chapterNumber !== undefined ? `第 ${hit.chapterNumber} 章 ` : ''
    return `- 【${hit.refKind}/${hit.refId}】${origin}${hit.title !== undefined ? `${hit.title}：` : ''}${hit.snippet}`
  }).join('\n')
}

/** 码点安全截片段落（复用 index.ts 的 truncateCodePoints 语义，独立实现避免循环依赖）。 */
export function snippetOf(text: string, maxChars: number): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${Array.from(trimmed).slice(0, maxChars).join('')}…`
}
