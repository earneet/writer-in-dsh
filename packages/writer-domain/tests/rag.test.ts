/**
 * P4 RAG 纯函数单测：分块、分词、关键词打分、RRF 融合、防剧透过滤、分节渲染。
 * 运行：node --test packages/writer-domain/tests/rag.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRagCorpus, chunkChapterText, filterChunksBySpoiler, keywordScores,
  rrfFuse, renderRagSection, snippetOf, tokenizeForSearch,
  type RagChunk, type WriterEntity,
} from '../src/rag.ts'

function entity(kind: WriterEntity['kind'], id: string, content: string, frontmatter: Record<string, unknown> = {}): WriterEntity {
  return { kind, id, path: `${kind}/${id}.md`, frontmatter: frontmatter as WriterEntity['frontmatter'], content, hash: 'x' }
}

test('tokenizeForSearch：CJK bigram + 拉丁词 + 混排切分', () => {
  const tokens = tokenizeForSearch('elin的绿焰剑 Green Flame 2026')
  assert.ok(tokens.includes('elin'))
  assert.ok(tokens.includes('的绿'), '混排处 CJK run 成词')
  assert.ok(tokens.includes('绿焰'))
  assert.ok(tokens.includes('green'))
  assert.ok(tokens.includes('flame'))
  assert.ok(tokens.includes('2026'))
})

test('chunkChapterText：空白返回空；短文单片；长文带重叠切片且覆盖全文', () => {
  assert.deepEqual(chunkChapterText('   \n  ', 600, 80), [])
  assert.deepEqual(chunkChapterText('  一句话正文  ', 600, 80), ['一句话正文'])
  const long = '甲'.repeat(1500)
  const chunks = chunkChapterText(long, 600, 80)
  assert.ok(chunks.length >= 3)
  assert.equal(chunks[0].length, 600)
  // 步长 = 600-80，第二片应从 520 开始（重叠 80）
  assert.equal(chunks[1].startsWith('甲'), true)
  const joined = chunks.join('')
  assert.ok(joined.endsWith('甲'), '末尾内容被覆盖')
})

test('buildRagCorpus：摘要块 + 章节切片 + 条目块', () => {
  const chapters = [entity('chapter', '001', '雨夜里绿焰浮现', { number: 1, title: '开端' })]
  const chunks = buildRagCorpus({
    chapters,
    characters: [entity('character', 'elin', '持有绿焰剑的旅人')],
    plots: [entity('plot', 'green-flame', '绿焰只在雨夜显现', { status: 'planned' })],
    worldbuilding: [entity('worldbuilding', 'northland', '北方冻土设定')],
    summaries: { '001': '第一章摘要' },
  })
  const ids = chunks.map((c) => c.id)
  assert.ok(ids.includes('chapter/001#summary'))
  assert.ok(ids.includes('chapter/001#0'))
  assert.ok(ids.includes('character/elin'))
  assert.ok(ids.includes('plot/green-flame'))
  assert.ok(ids.includes('worldbuilding/northland'))
  const summary = chunks.find((c) => c.id === 'chapter/001#summary')!
  assert.equal(summary.chapterNumber, 1)
  const plot = chunks.find((c) => c.id === 'plot/green-flame')!
  assert.ok(plot.text.includes('状态：planned'))
})

test('keywordScores：命中查询排前，无关块零分不返回', () => {
  const chunks: RagChunk[] = [
    { id: 'a', refKind: 'worldbuilding', refId: 'a', text: '绿焰只在雨夜显现，焰色转蓝' },
    { id: 'b', refKind: 'worldbuilding', refId: 'b', text: '南方港口的贸易规则' },
  ]
  const ranked = keywordScores('绿焰 雨夜', chunks)
  assert.equal(ranked.length, 1)
  assert.equal(ranked[0].chunkId, 'a')
})

test('rrfFuse：双路一致的块排最前', () => {
  const fused = rrfFuse([['x', 'y', 'z'], ['y', 'x', 'w']])
  const entries = [...fused.entries()].sort((a, b) => b[1] - a[1])
  assert.equal(entries[0][0], 'x', 'x 两路均第 1/2 名')
  assert.equal(entries[1][0], 'y')
  assert.ok(!fused.has('w') || fused.get('w')! < fused.get('x')!)
})

test('filterChunksBySpoiler：未来章不可见；未回收晚置伏笔剔除；已回收保留；章号不可判定保守剔除', () => {
  const chapters = [entity('chapter', '001', '', { number: 1 }), entity('chapter', '002', '', { number: 2 })]
  const plots = [
    entity('plot', 'early', '', { status: 'planned' }),
    entity('plot', 'late', '', { status: 'planned', planned_chapter: '005' }),
    entity('plot', 'late-resolved', '', { status: 'resolved', planned_chapter: '005' }),
  ]
  const chunks: RagChunk[] = [
    { id: 'c1', refKind: 'chapter', refId: '001', text: 't', chapterNumber: 1 },
    { id: 'c2', refKind: 'chapter', refId: '002', text: 't', chapterNumber: 2 },
    { id: 'c2s', refKind: 'chapter', refId: '002', text: 't', chapterNumber: 2 },
    { id: 'c-dirty', refKind: 'chapter', refId: 'ch9', text: 't', chapterNumber: undefined },
    { id: 'p-early', refKind: 'plot', refId: 'early', text: 't' },
    { id: 'p-late', refKind: 'plot', refId: 'late', text: 't' },
    { id: 'p-resolved', refKind: 'plot', refId: 'late-resolved', text: 't' },
    { id: 'ch', refKind: 'character', refId: 'elin', text: 't' },
  ]
  const visible = filterChunksBySpoiler(chunks, { chapterNumber: 2, plots })
  const ids = visible.map((c) => c.id)
  assert.ok(ids.includes('c1'), '早章可见')
  assert.ok(!ids.includes('c2') && !ids.includes('c2s'), '未来章一律不可见（含摘要块）')
  assert.ok(!ids.includes('c-dirty'), '章号不可判定的章节块保守剔除（脏 frontmatter 不得绕过红线）')
  assert.ok(ids.includes('p-early'))
  assert.ok(!ids.includes('p-late'), '未回收且 planned_chapter 晚于本章的伏笔块剔除')
  assert.ok(ids.includes('p-resolved'), '已回收伏笔不构成剧透')
  assert.ok(ids.includes('ch'), '人物块不受章号约束')
})

test('renderRagSection / snippetOf：来源标注与码点安全截断', () => {
  const text = renderRagSection([
    { chunkId: 'chapter/001#0', refKind: 'chapter', refId: '001', title: '开端', snippet: '雨夜', score: 0.03, chapterNumber: 1 },
    { chunkId: 'character/elin', refKind: 'character', refId: 'elin', snippet: '旅人', score: 0.02 },
  ])
  assert.ok(text.includes('【chapter/001】第 1 章 开端：雨夜'))
  assert.ok(text.includes('【character/elin】旅人'))
  assert.equal(snippetOf('ab', 5), 'ab')
  assert.ok(snippetOf('😆'.repeat(10), 3).endsWith('…') && snippetOf('😆'.repeat(10), 3).startsWith('😆'))
})
