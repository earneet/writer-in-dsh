/**
 * 引擎 P3 编排集成单测：真实 store（tmpdir）+ llm 桩（脚本化块流）。
 * 覆盖：inflight 去重、hash 锚定 up-to-date、按节重试合并（不清空已通过节）、
 * 重试耗尽 partial 标记、一致性检查分批 + 真正截断 + 时间锚倒序、recomputeDerived 四分支。
 * 运行：node --test packages/writer-engine/tests/p3-integration.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import WriterStoreService from 'dsh-writer-store'
import WriterEngineServiceImpl from '../src/index.ts'

/** 脚本化 llm 桩：按调用序返回预设文本；记录每次请求的 system/user 供断言。 */
class LlmStub {
  readonly requests: { system: string; user: string }[] = []
  private queue: string[] = []

  reply(...texts: string[]): void {
    this.queue.push(...texts)
  }

  get calls(): number {
    return this.requests.length
  }

  stream(options: { system: string; messages: { content: { text: string }[] }[] }): AsyncGenerator<StreamChunk> {
    this.requests.push({ system: options.system, user: options.messages[0]?.content[0]?.text ?? '' })
    const text = this.queue.shift() ?? ''
    return (async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()
  }
}

interface Setup { store: WriterStoreService; engine: WriterEngineServiceImpl; llm: LlmStub; root: string }

async function makeSetup(overrides?: Partial<ConstructorParameters<typeof WriterEngineServiceImpl>[1]>): Promise<Setup> {
  const root = await mkdtemp(join(tmpdir(), 'writer-engine-'))
  // @ts-expect-error 测试桩：真实 Context 由 loader 提供，此处仅需要服务实例与 emit 透传
  const ctx = new Context()
  const store = new WriterStoreService(ctx, { projectRoot: root })
  const llm = new LlmStub()
  const engine = new WriterEngineServiceImpl(ctx, {
    provider: 'stub', model: 'stub', maxOutputTokens: 1024, temperature: 0,
    contextBudgetChars: 24000, autoMaintenance: false, extractionRetries: 1,
    ...overrides,
  })
  Object.defineProperty(ctx, 'writer', { value: store, configurable: true })
  Object.defineProperty(ctx, 'llm', { value: llm, configurable: true })
  return { store, engine, llm, root }
}

async function seedChapter(setup: Setup, id: string, content: string, frontmatter?: Record<string, string | number>): Promise<void> {
  await setup.store.save('chapter', id, { content, frontmatter: { number: Number(id), ...frontmatter } })
}

async function seedRefs(setup: Setup): Promise<void> {
  await setup.store.save('character', 'elin', { content: '巡灯人。' })
  await setup.store.save('plot', 'green-flame', { content: '绿焰。', frontmatter: { status: 'planted' } })
}

test('maintenancePass：done 落派生 + pending.md；二次调用 hash 锚定 up-to-date', async () => {
  const setup = await makeSetup()
  try {
    await seedChapter(setup, '001', '艾琳巡灯。')
    await seedRefs(setup)
    setup.llm.reply(
      '艾琳夜里巡查第七盏灯。', // 调用①摘要
      JSON.stringify({ facts: [{ description: '绿焰偏斜' }], foreshadowEvents: [], characterStates: [{ character: 'elin', state: '疲惫' }] }),
    )
    const done = await setup.engine.maintenancePass('001')
    assert.equal(done.status, 'done')
    assert.equal(done.summary, '艾琳夜里巡查第七盏灯。')
    const derived = await setup.store.readDerived('maintenance', '001') as { sourceHash: string; summary: string }
    assert.equal(derived.summary, done.summary)
    const pending = await readFile(join(setup.root, 'pending.md'), 'utf8')
    assert.match(pending, /chapter\/001/)
    assert.match(pending, /人物状态建议.*timeline_update/)
    // hash 锚定：内容未变 → up-to-date，不再调模型
    const again = await setup.engine.maintenancePass('001')
    assert.equal(again.status, 'up-to-date')
    assert.equal(setup.llm.calls, 2, '锚定命中后零额外调用')
  } finally {
    await rm(setup.root, { recursive: true, force: true })
  }
})

test('maintenancePass：inflight 去重——并发触发共享同一次执行', async () => {
  const setup = await makeSetup()
  try {
    await seedChapter(setup, '001', '正文。')
    await seedRefs(setup)
    setup.llm.reply('摘要。', JSON.stringify({ facts: [], foreshadowEvents: [], characterStates: [] }))
    const [a, b] = await Promise.all([setup.engine.maintenancePass('001'), setup.engine.maintenancePass('001')])
    assert.equal(a.status, 'done')
    assert.equal(b.status, 'done')
    assert.equal(setup.llm.calls, 2, '并发去重：只有一次摘要 + 一次抽取')
  } finally {
    await rm(setup.root, { recursive: true, force: true })
  }
})

test('maintenancePass 按节重试：重试只回修正节，已通过节不被清空（H1 回归）', async () => {
  const setup = await makeSetup()
  try {
    await seedChapter(setup, '001', '正文。')
    await seedRefs(setup)
    setup.llm.reply(
      '摘要。',
      // 首轮：facts 通过、foreshadowEvents 引用不存在的伏笔
      JSON.stringify({ facts: [{ description: '既定事实' }], foreshadowEvents: [{ plot: 'ghost', action: 'planted' }], characterStates: [] }),
      // 重试：只回修正后的 foreshadowEvents 节（模型合理行为）
      JSON.stringify({ foreshadowEvents: [{ plot: 'green-flame', action: 'reinforcement' }] }),
    )
    const done = await setup.engine.maintenancePass('001')
    assert.equal(done.status, 'done')
    assert.deepEqual(done.extraction!.facts, [{ description: '既定事实' }], '已通过的 facts 节保留')
    assert.deepEqual(done.extraction!.foreshadowEvents, [{ plot: 'green-flame', action: 'reinforcement' }], '重试节被替换')
    assert.deepEqual(done.extraction!.characterStates, [], '未涉及的节维持默认空')
    assert.deepEqual(done.retriedSections, ['foreshadowEvents'])
    assert.notEqual(done.partial, true, '重试收敛后无 partial 标记')
  } finally {
    await rm(setup.root, { recursive: true, force: true })
  }
})

test('maintenancePass 重试耗尽：partial 标记 + 拒收原因入派生与 pending', async () => {
  const setup = await makeSetup()
  try {
    await seedChapter(setup, '001', '正文。')
    await seedRefs(setup)
    setup.llm.reply(
      '摘要。',
      JSON.stringify({ facts: [{ description: '好事实' }], foreshadowEvents: [{ plot: 'ghost', action: 'planted' }] }),
      JSON.stringify({ foreshadowEvents: [{ plot: 'ghost', action: 'planted' }] }), // 重试仍坏
    )
    const done = await setup.engine.maintenancePass('001')
    assert.equal(done.partial, true)
    assert.ok((done.rejected ?? []).some((r) => r.includes('plot/ghost')))
    assert.deepEqual(done.extraction!.facts, [{ description: '好事实' }], '通过节保留')
    assert.deepEqual(done.extraction!.foreshadowEvents, [], '拒收节为空')
    const derived = await setup.store.readDerived('maintenance', '001') as { partial?: boolean }
    assert.equal(derived.partial, true)
    const pending = await readFile(join(setup.root, 'pending.md'), 'utf8')
    assert.match(pending, /部分抽取条目因引用校验未通过被拒收/)
  } finally {
    await rm(setup.root, { recursive: true, force: true })
  }
})

test('consistencyCheck：分批 + 批内真正截断 + 时间锚倒序并入', async () => {
  const setup = await makeSetup({ contextBudgetChars: 2000 })
  try {
    await setup.store.save('principles', 'principles', { content: '准则。' })
    await seedChapter(setup, '001', '一'.repeat(2500), { time: '第 5 日' })
    await seedChapter(setup, '002', '二'.repeat(200), { time: '第 3 日' })
    const issueJson = JSON.stringify({ summary: '批内一致', issues: [{ dimension: '情节一致性', severity: 'low', refs: ['chapter/001'], description: 'x' }] })
    setup.llm.reply(issueJson, issueJson)
    const report = await setup.engine.consistencyCheck()
    assert.equal(report.batches.length, 2, '超预算分两批')
    // 每批 user 提示词正文不超过预算（2000 - 基准材料 ≈ batchBudget；截断落地）
    for (const req of setup.llm.requests) {
      assert.ok(req.user.length < 2600, `批次提示词长度 ${req.user.length} 在预算量级内`)
    }
    assert.equal(report.issues.filter((i) => i.dimension === '情节一致性').length, 2, '两批 issues 合并')
    const inversion = report.issues.find((i) => i.dimension === '时间线一致性')
    assert.notEqual(inversion, undefined, '时间锚倒序确定性检测并入')
    assert.match(inversion!.description, /001.*晚于.*002/s)
  } finally {
    await rm(setup.root, { recursive: true, force: true })
  }
})

test('consistencyCheck：新鲜派生摘要代正文（扩批容量）', async () => {
  const setup = await makeSetup({ contextBudgetChars: 2000 })
  try {
    await seedChapter(setup, '001', '一'.repeat(1500))
    await seedChapter(setup, '002', '二'.repeat(1500))
    // 两章派生摘要新鲜 → 摘要代替正文 → 单批
    await setup.store.writeDerived('maintenance', '001', { sourceHash: (await setup.store.get('chapter', '001'))!.hash, summary: '短摘要一', extraction: { facts: [], foreshadowEvents: [], characterStates: [] }, updatedAt: 't' })
    await setup.store.writeDerived('maintenance', '002', { sourceHash: (await setup.store.get('chapter', '002'))!.hash, summary: '短摘要二', extraction: { facts: [], foreshadowEvents: [], characterStates: [] }, updatedAt: 't' })
    setup.llm.reply(JSON.stringify({ summary: '', issues: [] }))
    const report = await setup.engine.consistencyCheck()
    assert.equal(report.batches.length, 1, '摘要使两章同批')
    assert.ok(setup.llm.requests[0].user.includes('短摘要一'))
  } finally {
    await rm(setup.root, { recursive: true, force: true })
  }
})

test('consistencyCheck：人物时间线倒序/非法 JSON 确定性并入人物一致性维度（P5）', async () => {
  const setup = await makeSetup()
  try {
    await seedChapter(setup, '001', '正文一。')
    await seedChapter(setup, '002', '正文二。')
    // elin 时间线章序倒序；kael timeline 非法 JSON
    await setup.store.save('character', 'elin', { content: 'x', frontmatter: { timeline: JSON.stringify([{ chapter: '004', state: 'a' }, { chapter: '002', state: 'b' }]) } })
    await setup.store.save('character', 'kael', { content: 'y', frontmatter: { timeline: '{oops' } })
    setup.llm.reply(JSON.stringify({ summary: '', issues: [] }), JSON.stringify({ summary: '', issues: [] }))
    const report = await setup.engine.consistencyCheck()
    const inversion = report.issues.find((i) => i.dimension === '人物一致性' && /时间线倒序/.test(i.description))
    assert.notEqual(inversion, undefined, '倒序确定性检测并入')
    assert.deepEqual(inversion!.refs, ['character/elin'])
    assert.match(inversion!.description, /004.*002/s)
    const malformed = report.issues.find((i) => i.dimension === '人物一致性' && /无法解析/.test(i.description))
    assert.notEqual(malformed, undefined, '非法 timeline 报告不静默')
    assert.equal(malformed!.severity, 'high')
    assert.deepEqual(malformed!.refs, ['character/kael'])
  } finally {
    await rm(setup.root, { recursive: true, force: true })
  }
})

test('drainMaintenance：排空在飞维护 pass（P7：headless 收尾排空语义）', async () => {
  const setup = await makeSetup()
  try {
    await seedChapter(setup, '001', '正文。')
    await seedRefs(setup)
    setup.llm.reply('摘要。', JSON.stringify({ facts: [], foreshadowEvents: [], characterStates: [] }))
    const inflight = setup.engine.maintenancePass('001')
    assert.equal(setup.engine.pendingMaintenanceCount(), 1, '执行中计 1 个在飞')
    await setup.engine.drainMaintenance()
    assert.equal((await inflight).status, 'done')
    assert.equal(setup.engine.pendingMaintenanceCount(), 0, '排空后归零')
    // 空排空立即返回；失败 pass 只吞错不抛（排空语义是等到不在飞）
    await setup.engine.drainMaintenance()
  } finally {
    await rm(setup.root, { recursive: true, force: true })
  }
})

test('recomputeDerived：no-chapter / up-to-date / mark（pending 作废提示）/ recompute', async () => {
  const setup = await makeSetup()
  try {
    await seedChapter(setup, '001', '正文。')
    await seedRefs(setup)
    // 001 无派生 → recompute 跑维护 pass
    setup.llm.reply('摘要。', JSON.stringify({ facts: [], foreshadowEvents: [], characterStates: [] }))
    const first = await setup.engine.recomputeDerived('001-002')
    assert.deepEqual(first.map((r) => r.status), ['recomputed', 'no-chapter'])
    // 新鲜 → up-to-date
    const second = await setup.engine.recomputeDerived('001')
    assert.equal(second[0].status, 'up-to-date')
    // mark → 删派生 + pending 作废提示
    const marked = await setup.engine.recomputeDerived('001', { mode: 'mark' })
    assert.equal(marked[0].status, 'marked')
    assert.equal(await setup.store.readDerived('maintenance', '001'), undefined)
    const pending = await readFile(join(setup.root, 'pending.md'), 'utf8')
    assert.match(pending, /recompute mark.*chapter\/001.*作废/s)
  } finally {
    await rm(setup.root, { recursive: true, force: true })
  }
})

test('maintenancePass TOCTOU：执行期间章节被改写 → 跳过旧版 pending 并自动补跑', async () => {
  const setup = await makeSetup()
  try {
    await seedChapter(setup, '001', '第一版。')
    await seedRefs(setup)
    setup.llm.reply(
      '旧摘要。',
      JSON.stringify({ facts: [], foreshadowEvents: [], characterStates: [] }),
      '新摘要。',
      JSON.stringify({ facts: [], foreshadowEvents: [], characterStates: [] }),
    )
    // 摘要调用完成后、抽取调用前改写章节（第一次 stream 请求已记录即第一次调用已发起）
    const originalStream = setup.llm.stream.bind(setup.llm)
    let calls = 0
    setup.llm.stream = (options: Parameters<typeof originalStream>[0]) => {
      calls += 1
      if (calls === 2) {
        // 摘要完成后、抽取完成前改写章节（fire-and-forget；引擎后续多处 await 让其先行落盘）
        void setup.store.get('chapter', '001').then((entity) =>
          setup.store.save('chapter', '001', { content: '第二版。' }, entity!.hash),
        )
      }
      return originalStream(options)
    }
    const result = await setup.engine.maintenancePass('001')
    // 补跑后派生锚定最新 hash
    const latest = await setup.store.get('chapter', '001')
    const derived = await setup.store.readDerived('maintenance', '001') as { sourceHash: string }
    assert.equal(derived.sourceHash, latest!.hash, '补跑覆盖为最新版本的派生')
    assert.equal(result.sourceHash, latest!.hash)
  } finally {
    await rm(setup.root, { recursive: true, force: true })
  }
})
