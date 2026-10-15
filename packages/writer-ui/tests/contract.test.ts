/**
 * 「工具渲染格式 ↔ parse.ts」契约测试（M1b 验收机制，镜像 guard 措辞契约做法）：
 * 直调 writer-tools 注册的 execute（mock 服务），把真实回执文本喂给 parse 函数——
 * writer-tools 回执文案漂移（正则逐字对齐被打破）即红，不再依赖手工 fixture。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../../writer-tools/src/index.ts'
import { parseConsistencyIssues, parseForeshadow, parseReview, parseWriteChapter, parseWriterStats } from '../src/client/parse.ts'

interface CapturedTool {
  name: string
  execute: (args: Record<string, unknown>, exec?: unknown) => Promise<string>
}

function makeCtx(writer: Record<string, unknown>, engine?: unknown): Map<string, CapturedTool> {
  const tools = new Map<string, CapturedTool>()
  const ctx = {
    on: () => () => {},
    get: (name: string) => (name === 'writerEngine' ? engine : undefined),
    writer,
    tools: { register: (tool: CapturedTool) => tools.set(tool.name, tool) },
  }
  apply(ctx as unknown as Context)
  return tools
}

const exec = { signal: new AbortController().signal } as never

test('契约：writer_stats 回执 ↔ parseWriterStats', async () => {
  const chapters = [
    { id: '001', content: 'x'.repeat(100), frontmatter: { volume: '第一卷' }, hash: 'h1' },
    { id: '002', content: 'y'.repeat(50), frontmatter: {}, hash: 'h2' },
  ]
  const tools = makeCtx({
    list: async (kind: string) => kind === 'chapter' ? chapters
      : kind === 'character' ? [{ id: 'elin', frontmatter: { timeline: '[{"chapter":"001","state":"a"}]' }, content: '' }]
        : kind === 'plot' ? [{ id: 'p1', frontmatter: { status: 'planted' }, content: '' }]
          : [],
    get: async (_k: string, id: string) => (id === 'event' ? { content: '事件' } : undefined),
    root: '.',
    readDerived: async (_kind: string, id: string) => (id === '001' ? { sourceHash: 'h1' } : { sourceHash: 'stale' }),
  })
  const out = await tools.get('writer_stats')!.execute({})
  const parsed = parseWriterStats(out)
  assert.notEqual(parsed, null)
  assert.equal(parsed!.chapters, 2)
  assert.equal(parsed!.totalChars, 150)
  assert.deepEqual(parsed!.volumes, [{ name: '第一卷', count: 1 }, { name: '正文', count: 1 }])
  assert.deepEqual(parsed!.foreshadow, [{ status: 'planted', count: 1 }])
  assert.deepEqual(parsed!.staleChapters, ['002'])
})

test('契约：write_chapter 回执 ↔ parseWriteChapter（含补丁与丢句续行）', async () => {
  const engine = {
    writeChapter: async () => ({
      chapter: { kind: 'chapter', id: '004', path: 'chapters/004.md', frontmatter: {}, content: 'z'.repeat(3200), hash: 'a'.repeat(64) },
      mode: 'full',
      patchStats: { applied: 3, skipped: 1, skippedReasons: ['not-found'] },
      droppedSentences: ['旧句一', '旧句二'],
    }),
  }
  const tools = makeCtx({ list: async () => [], get: async () => undefined, root: '.' }, engine)
  const out = await tools.get('write_chapter')!.execute({ chapter: '004', mode: 'full' }, exec)
  const parsed = parseWriteChapter(out)
  assert.notEqual(parsed, null)
  assert.equal(parsed!.chapterId, '004')
  assert.equal(parsed!.mode, 'full')
  assert.equal(parsed!.chars, 3200)
  assert.equal(parsed!.patchesApplied, 3)
  assert.equal(parsed!.patchesSkipped, 1)
  assert.equal(parsed!.droppedSentences, 2)
})

test('契约：review_chapter 回执 ↔ parseReview（quote/建议/改写方案缩进续行）', async () => {
  const engine = {
    reviewChapter: async () => ({
      suggestions: [
        { dimension: '情节一致性', severity: 'high', quote: '火焰无声地偏了偏', problem: '绿焰认主前后矛盾', suggestion: '改为呼应认主', rewriteOption: '改写文本' },
        { dimension: '文学质量', severity: 'low', problem: '对话略密集', suggestion: '穿插动作描写' },
      ],
      summary: '整体扎实。',
    }),
  }
  const tools = makeCtx({ list: async () => [], get: async () => undefined, root: '.' }, engine)
  const out = await tools.get('review_chapter')!.execute({ chapter: '003' }, exec)
  const parsed = parseReview(out)
  assert.notEqual(parsed, null)
  assert.equal(parsed!.count, 2)
  assert.equal(parsed!.summary, '整体扎实。')
  assert.equal(parsed!.suggestions[0]!.quote, '火焰无声地偏了偏')
  assert.equal(parsed!.suggestions[0]!.suggestion, '改为呼应认主')
  assert.equal(parsed!.suggestions[0]!.rewriteOption, '改写文本')
  assert.equal(parsed!.suggestions[1]!.quote, null)
})

test('契约：foreshadow_update 回执 ↔ parseForeshadow（status 推进与 milestone 两形态）', async () => {
  let plot = { kind: 'plot', id: 'mirror', frontmatter: { status: 'planned' }, content: '', hash: 'h' }
  const tools = makeCtx({
    list: async () => [],
    get: async (_k: string, id: string) => (id === 'mirror' ? plot : undefined),
    save: async (_k: string, _id: string, patch: { frontmatter: Record<string, unknown> }) => {
      plot = { ...plot, frontmatter: { ...plot.frontmatter, ...patch.frontmatter } }
      return plot
    },
    root: '.',
  })
  const fo = tools.get('foreshadow_update')!
  const planted = parseForeshadow(await fo.execute({ id: 'mirror', action: 'plant', chapter: '001', expectHash: 'h' }, exec))
  assert.notEqual(planted, null)
  assert.equal(planted!.status, 'planted')
  assert.equal(planted!.milestone, null)
  const milestone = parseForeshadow(await fo.execute({ id: 'mirror', action: 'milestone', chapter: '002', milestone_type: 'partial_reveal', expectHash: 'h' }, exec))
  assert.notEqual(milestone, null)
  assert.deepEqual(milestone!.milestone, { type: 'partial_reveal', chapter: '002' })
})

test('契约：consistency_check 回执 ↔ parseConsistencyIssues（refs/证据）', async () => {
  const engine = {
    consistencyCheck: async () => ({
      batches: [{ chapters: ['001', '002'], truncated: false }],
      issues: [
        { severity: 'high', dimension: '情节一致性', refs: ['chapter/001', 'chapter/002'], description: '绿焰设定矛盾', evidence: '第 1 章写蓝焰' },
        { severity: 'low', dimension: '设定一致性', refs: [], description: '地名前后不一' },
      ],
      summary: '两处需复核。',
    }),
  }
  const tools = makeCtx({ list: async () => [], get: async () => undefined, root: '.' }, engine)
  const out = await tools.get('consistency_check')!.execute({}, exec)
  const report = parseConsistencyIssues(out)
  assert.notEqual(report, null)
  assert.equal(report!.issues.length, 2)
  assert.deepEqual(report!.issues[0]!.refs, ['chapter/001', 'chapter/002'])
  assert.equal(report!.issues[0]!.evidence, '第 1 章写蓝焰')
  assert.equal(report!.issues[1]!.evidence, null)
})
