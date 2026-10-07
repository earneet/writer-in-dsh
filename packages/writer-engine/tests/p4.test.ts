/**
 * P4 engine 断更恢复快照集成测试（recoverySnapshot 不调 LLM；真实 store + git 仓库）。
 * 运行：node --test packages/writer-engine/tests/p4.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { RagService } from 'dsh-writer-core'
import type { RagHit } from 'dsh-writer-domain'
import WriterStoreService from 'dsh-writer-store/src/index.ts'
import WriterEngineServiceImpl from '../src/index.ts'

const execFileAsync = promisify(execFile)

/** 桩 RAG 服务（真实 cordis 服务注册，验证 engine 的 ctx.get 消费路径与分节注入）。 */
class StubRagService extends RagService {
  static override inject = []
  lastQuery = ''
  lastChapterLimit: number | undefined
  constructor(ctx: Context) {
    super(ctx)
  }
  override async search(query: string, opts?: { chapterLimit?: number }): Promise<RagHit[]> {
    this.lastQuery = query
    this.lastChapterLimit = opts?.chapterLimit
    return [{ chunkId: 'worldbuilding/flame', refKind: 'worldbuilding', refId: 'flame', snippet: '绿焰是北方冻土的古神残火。', score: 0.05 }]
  }
}

test('augmentByRag：rag 在场注入「检索增强」分节；缺席静默降级', async () => {
  const root = await mkdtemp(join(tmpdir(), 'writer-ragaug-'))
  try {
    // @ts-expect-error 测试桩：真实 Context 由 loader 提供
    const ctx = new Context()
    const store = new WriterStoreService(ctx, { projectRoot: root })
    const engine = new WriterEngineServiceImpl(ctx, {
      provider: 'test', model: 'test', maxOutputTokens: 1, temperature: 0,
      contextBudgetChars: 8000, autoMaintenance: false, extractionRetries: 0,
    })
    await store.save('outline', 'outline', { content: '### 第 3 章 试炼\n艾琳查验绿焰。' })
    const assembled = { sections: [], usageChars: 0 }
    // augmentByRag 为私有编排步骤，测试经实例访问验证注入形状（等价真实 assemble 调用路径）
    const none = await (engine as unknown as { augmentByRag(a: unknown, r: unknown, o: unknown): Promise<typeof assembled> })
      .augmentByRag(assembled, { chapterId: '003', mode: 'full', instruction: '写绿焰查验' }, undefined)
    assert.equal(none.sections.length, 0, 'rag 缺席（未注册服务）静默降级')

    const stub = new StubRagService(ctx)
    const augmented = await (engine as unknown as { augmentByRag(a: unknown, r: unknown, o: unknown): Promise<typeof assembled> })
      .augmentByRag(assembled, { chapterId: '003', mode: 'full', instruction: '写绿焰查验' }, { kind: 'outline', id: 'outline', path: 'outline.md', hash: 'h', frontmatter: {}, content: '### 第 3 章 试炼\n艾琳查验绿焰。' })
    assert.equal(augmented.sections.length, 1)
    assert.equal(augmented.sections[0].title, '检索增强（RAG，已防剧透过滤）')
    assert.ok(augmented.sections[0].body.includes('绿焰是北方冻土的古神残火'))
    assert.ok(stub.lastQuery.includes('艾琳查验绿焰'), '查询含大纲小节与指令')
    assert.ok(stub.lastQuery.includes('写绿焰查验'))
    assert.equal(stub.lastChapterLimit, 3, 'chapterLimit=当前章号（防剧透服务端过滤）')
    assert.ok(augmented.usageChars > 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('recoverySnapshot：真实落盘 + git 时间锚 + 新鲜摘要优先（range 过滤）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'writer-recovery-'))
  try {
    // @ts-expect-error 测试桩：真实 Context 由 loader 提供
    const ctx = new Context()
    const store = new WriterStoreService(ctx, { projectRoot: root })
    const engine = new WriterEngineServiceImpl(ctx, {
      provider: 'test', model: 'test', maxOutputTokens: 1, temperature: 0,
      contextBudgetChars: 2000, autoMaintenance: false, extractionRetries: 0,
    })
    const c1 = await store.save('chapter', '001', { content: '第一章：绿焰初现的雨夜。', frontmatter: { number: 1, title: '雨夜' } })
    const c2 = await store.save('chapter', '002', { content: '第二章：残页与旧号。', frontmatter: { number: 2, title: '残页' } })
    await store.save('character', 'elin', { content: '守灯人' })
    await store.save('plot', 'green-flame', { content: '绿焰', frontmatter: { status: 'planted' } })
    // 仅第一章有新鲜摘要（第二章派生过期）
    await store.writeDerived('maintenance', '001', { sourceHash: c1.hash, summary: '第一章新鲜摘要' })
    await store.writeDerived('maintenance', '002', { sourceHash: 'stale', summary: '过期摘要不应出现' })
    // git 仓库 + 章节提交（时间锚来源）
    await execFileAsync('git', ['init', '-q'], { cwd: root })
    await execFileAsync('git', ['add', '-A'], { cwd: root })
    await execFileAsync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: root })

    const result = await engine.recoverySnapshot()
    assert.equal(result.chapters, 2)
    assert.ok(result.path.endsWith(join('.writer', 'recovery-snapshot.md')))
    const onDisk = await readFile(join(root, '.writer', 'recovery-snapshot.md'), 'utf8')
    assert.equal(onDisk, result.markdown, '落盘内容与返回一致')
    assert.ok(result.markdown.indexOf('第 2 章') < result.markdown.indexOf('第 1 章'), '倒序')
    assert.ok(result.markdown.includes('第一章新鲜摘要'), '新鲜摘要优先')
    assert.ok(!result.markdown.includes('过期摘要不应出现'), '过期派生摘要不采用')
    assert.ok(result.markdown.includes('残页与旧号'), '无新鲜摘要章正文兜底')
    assert.ok(/\d{4}-\d{2}-\d{2}T/.test(result.markdown), 'git 时间锚注入')

    // range 过滤：只取第一章
    const single = await engine.recoverySnapshot('001')
    assert.equal(single.chapters, 1)
    assert.ok(single.markdown.includes('雨夜'))
    assert.ok(!single.markdown.includes('残页与旧号'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
