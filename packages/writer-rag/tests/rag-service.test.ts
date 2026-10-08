/**
 * writer-rag 服务单测：关键词档检索、防剧透 chapterLimit、配置响亮失败、空查询。
 * 运行：node --test packages/writer-rag/tests/rag-service.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
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

test('external 档代码路径（P7）：本地 OpenAI 兼容 stub——检索走 embeddings、向量缓存、无 key 响亮失败', async () => {
  // 独立 fixture：external 服务须与 store 共享同一 ctx（ctx.writer 注入）
  const root = await mkdtemp(join(tmpdir(), 'writer-rag-ext-'))
  // @ts-expect-error 测试桩：真实 Context 由 loader 提供
  const ctx = new Context()
  const store = new WriterStoreService(ctx, { projectRoot: root })
  try {
    await mkdir(join(root, 'chapters'), { recursive: true })
    await mkdir(join(root, 'characters'), { recursive: true })
    await mkdir(join(root, 'plots'), { recursive: true })
    await mkdir(join(root, 'worldbuilding'), { recursive: true })
    await writeFile(join(root, 'chapters/001.md'), '---\nnumber: 1\ntitle: "雨夜"\n---\n雨夜里，埃琳第一次看见绿焰浮现。', 'utf8')
    await writeFile(join(root, 'chapters/002.md'), '---\nnumber: 2\ntitle: "港城"\n---\n第二章正文：南方港城的贸易风波。', 'utf8')
    await writeFile(join(root, 'characters/elin.md'), '---\n---\n持有绿焰剑的旅人。', 'utf8')
    // 确定性 embedding stub：文本含「绿焰」→ [1,0]，含「港城」→ [0,1]，其余 → [1,1]；
    // 记录请求数供缓存断言（Authorization 头必须携带测试 key）
    let embedRequests = 0
    let authorizedRequests = 0
    const server: Server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk })
      req.on('end', () => {
        embedRequests++
        if (req.headers['authorization'] === 'Bearer test-key') authorizedRequests++
        const input = (JSON.parse(body) as { input: string }).input
        const embedding = input.includes('绿焰') ? [1, 0] : input.includes('港城') ? [0, 1] : [1, 1]
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ data: [{ embedding }] }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    // fetch 的 keep-alive 连接会撑住事件循环：unref 让测试进程可正常退出
    server.unref()
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const externalRag = new WriterRagService(ctx, {
      embeddingBackend: 'external', llmProvider: '', llmModel: '',
      externalBaseUrl: baseUrl, externalModel: 'stub-embed', externalApiKeyEnv: 'WRITER_RAG_TEST_KEY',
      semanticCandidates: 15, chunkChars: 600, chunkOverlap: 80, snippetChars: 280, maxResults: 5,
    })
    process.env['WRITER_RAG_TEST_KEY'] = 'test-key'
    // ① 检索走 embeddings：查询与候选都过端点，语义路参与 RRF 融合
    const first = await externalRag.search('绿焰', { maxResults: 5 })
    assert.ok(first.length > 0)
    assert.ok(embedRequests > 1, `查询 + 候选块均请求端点（${embedRequests} 次）`)
    assert.equal(authorizedRequests, embedRequests, '每个请求都携带 Bearer key')
    const firstCount = embedRequests
    // ② 向量缓存：同查询 + 未变语料二次检索零额外端点请求
    await externalRag.search('绿焰', { maxResults: 5 })
    assert.equal(embedRequests, firstCount, '缓存命中（查询与候选向量均复用）')
    // ③ 章节改写后新文本键失效 → 端点被再次请求（查询固定「绿焰」：查询向量已缓存，
    // 新增请求只能来自改写后 002 新文本的候选键——真正锁语料失效而非查询缓存）
    const ch2 = await store.get('chapter', '002')
    await store.save('chapter', '002', { content: '第二章改写：港城风波加剧，绿焰再现。' }, ch2!.hash)
    await externalRag.search('绿焰', { maxResults: 5 })
    assert.ok(embedRequests > firstCount, '改写后新块文本重嵌入')
    // ④ 无 key 响亮失败（不静默降级）
    delete process.env['WRITER_RAG_TEST_KEY']
    await assert.rejects(externalRag.search('绿焰'), /环境变量 WRITER_RAG_TEST_KEY 未设置/)
  } finally {
    delete process.env['WRITER_RAG_TEST_KEY']
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
    const cache = (rag as unknown as { tokenCache: Map<string, Map<string, number>> }).tokenCache
    assert.ok(cache.size > 0, '首查后分词缓存被填充')
    // 身份断言：二查命中路径必须复用同一 Map 实例（重算会产出新对象，此断言即区分缓存命中与重算）
    const snapshotOfFirstQuery = new Map(cache)
    const second = await rag.search('绿焰 雨夜', { maxResults: 5 })
    let reused = 0
    for (const [key, counts] of snapshotOfFirstQuery) {
      if (cache.get(key) === counts) reused++
    }
    assert.ok(reused > 0, `二查复用了首查的频次表实例（reused=${reused}）`)
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
