/**
 * writer-rag 服务单测：关键词档检索、防剧透 chapterLimit、配置响亮失败、空查询。
 * 运行：node --test packages/writer-rag/tests/rag-service.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import WriterStoreService from 'dsh-writer-store/src/index.ts'
import WriterRagService from '../src/index.ts'

async function makeFixture(): Promise<{ rag: WriterRagService; store: WriterStoreService; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'writer-rag-'))
  // @ts-expect-error 测试桩：真实 Context 由 loader 提供
  const ctx = new Context()
  const store = new WriterStoreService(ctx, { projectRoot: root })
  await mkdir(join(root, 'chapters'), { recursive: true })
  await mkdir(join(root, 'characters'), { recursive: true })
  await mkdir(join(root, 'plots'), { recursive: true })
  await mkdir(join(root, 'worldbuilding'), { recursive: true })
  await writeFile(join(root, 'chapters/001.md'), `---\nnumber: 1\ntitle: "雨夜"\n---\n雨夜里，埃琳第一次看见绿焰浮现，焰色在雨幕中转蓝。`, 'utf8')
  await writeFile(join(root, 'chapters/002.md'), `---\nnumber: 2\ntitle: "港城"\n---\n第二章正文：南方港城的贸易风波。`, 'utf8')
  await writeFile(join(root, 'characters/elin.md'), `---\n---\n持有绿焰剑的旅人，左臂有旧伤。`, 'utf8')
  await writeFile(join(root, 'plots/green-flame.md'), `---\nstatus: "planned"\nplanned_chapter: "1"\n---\n绿焰只在雨夜显现，回收提示在终章。`, 'utf8')
  await writeFile(join(root, 'worldbuilding/flame.md'), `---\n---\n绿焰是北方冻土的古神残火。`, 'utf8')
  // 第一章新鲜派生摘要
  const ch1 = await store.get('chapter', '001')
  await store.writeDerived('maintenance', '001', { sourceHash: ch1!.hash, summary: '第一章：绿焰初现的雨夜。' })
  const rag = new WriterRagService(ctx, {
    embeddingBackend: 'none', llmProvider: '', llmModel: '', externalBaseUrl: '', externalModel: '',
    externalApiKeyEnv: 'WRITER_RAG_API_KEY', semanticCandidates: 15, chunkChars: 600, chunkOverlap: 80,
    snippetChars: 280, maxResults: 5,
  })
  return { rag, store, root }
}

test('关键词档检索：语义相关命中 + 派生摘要块参与 + 软失败查询', async () => {
  const { rag, root } = await makeFixture()
  try {
    const hits = await rag.search('绿焰 雨夜', { maxResults: 5 })
    assert.ok(hits.length > 0)
    assert.ok(hits.some((h) => h.refId === '001' || h.refId === 'green-flame' || h.refId === 'flame'), '绿焰相关块命中')
    assert.deepEqual(await rag.search('完全无关的查询词组'), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('防剧透：chapterLimit=1 时第 2 章块不可见', async () => {
  const { rag, root } = await makeFixture()
  try {
    const hits = await rag.search('港城 贸易', { chapterLimit: 1 })
    assert.ok(!hits.some((h) => h.refId === '002'), '未来章块被过滤')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('配置响亮失败：字段整体缺席（undefined）/ 大重叠 / 非法后端值', () => {
  // 每次新 Context：service 注册在 ctx 上，复用会先撞「已注册」错误
  const freshCtx = (): unknown => new Context()
  const base = { embeddingBackend: 'llm', externalApiKeyEnv: 'K', semanticCandidates: 15, chunkChars: 600, chunkOverlap: 80, snippetChars: 280, maxResults: 5 }
  // llm 档 llmProvider/llmModel 整体缺席（schemastery 缺省可选 string 解析为 undefined 而非 ''）
  assert.throws(() => new WriterRagService(freshCtx() as never, base as never), /llmProvider 与 llmModel/)
  const external = { embeddingBackend: 'external', llmProvider: 'p', llmModel: 'm', externalApiKeyEnv: 'K', semanticCandidates: 15, chunkChars: 600, chunkOverlap: 80, snippetChars: 280, maxResults: 5 }
  assert.throws(() => new WriterRagService(freshCtx() as never, external as never), /externalBaseUrl 与 externalModel/)
  // 切片重叠契约：overlap ≥ chunkChars/2 响亮失败（静默钳步长会造成语料倍数膨胀）
  const bigOverlap = { ...base, llmProvider: 'p', llmModel: 'm', chunkOverlap: 300 }
  assert.throws(() => new WriterRagService(freshCtx() as never, bigOverlap as never), /chunkOverlap/)
  assert.throws(() => new WriterRagService(freshCtx() as never, { embeddingBackend: 'vector' } as never), /embeddingBackend 非法/)
})

test('分词缓存：重复查询结果一致且缓存被填充；块内容变化后键失效重算', async () => {
  const { rag, store, root } = await makeFixture()
  try {
    const first = await rag.search('绿焰 雨夜', { maxResults: 5 })
    // 缓存键 = sha256(块id + 块文本)：首查后应已建立频次表条目
    const cacheSizeAfterFirst = (rag as unknown as { tokenCache: Map<string, unknown> }).tokenCache.size
    assert.ok(cacheSizeAfterFirst > 0, '首查后分词缓存被填充')
    const second = await rag.search('绿焰 雨夜', { maxResults: 5 })
    assert.deepEqual(
      second.map((h) => [h.chunkId, Number(h.score.toFixed(6))]),
      first.map((h) => [h.chunkId, Number(h.score.toFixed(6))]),
      '缓存命中路径与首算路径打分一致',
    )
    // 章节改写（内容 hash 变化）：新块文本键不命中旧缓存，检索反映新内容
    const ch1 = await store.get('chapter', '001')
    await store.save('chapter', '001', { content: '雨夜里，埃琳第一次看见绿焰浮现。新增的寒鸦桥段。' }, ch1!.hash)
    const third = await rag.search('寒鸦', { maxResults: 5 })
    assert.ok(third.some((h) => h.refId === '001'), '改写后新内容可检索（缓存按内容 hash 失效）')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
