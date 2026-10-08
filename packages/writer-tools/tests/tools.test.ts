/**
 * writer-tools 工具单测（P7：测试面补强——轮次 10 限制④清偿）。
 * 覆盖：writer_read 清单/单体/不存在、writer_stats 分支、foreshadow_update 四动作、
 * engine/export/rag 缺席降级、archive_point 非 git 分支、pending_cleanup 归档、maintenance_flush。
 * 运行：node --test packages/writer-tools/tests/tools.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'

interface CapturedTool {
  name: string
  description: string
  parameters: Record<string, { required?: boolean }>
  execute: (args: Record<string, unknown>, exec?: unknown) => Promise<string>
}

interface WriterStub {
  list: (kind: string) => Promise<unknown[]>
  get: (kind: string, id: string) => Promise<unknown>
  save: (kind: string, id: string, patch: unknown, expectHash?: string) => Promise<unknown>
  root: string
  archivePending?: (mutator: (text: string) => { next: string; extracted: string }) => Promise<string>
  appendPendingArchive?: (section: string) => Promise<void>
}

function makeCtx(writer: WriterStub, engine?: unknown): { tools: Map<string, CapturedTool> } {
  const tools = new Map<string, CapturedTool>()
  const ctx = {
    on: () => () => {},
    get: (name: string) => (name === 'writerEngine' ? engine : undefined),
    writer,
    tools: { register: (tool: CapturedTool) => tools.set(tool.name, tool) },
  }
  apply(ctx as unknown as Context)
  return { tools }
}

const exec = { signal: new AbortController().signal } as never

test('writer_read：清单（hash 8 位预览）/ 单体（含 frontmatter）/ 不存在软失败 / 未知 kind 抛错', async () => {
  const entity = {
    kind: 'character', id: 'elin', path: 'characters/elin.md',
    frontmatter: { name: '艾琳' }, content: '守灯人。', hash: 'a'.repeat(64),
  }
  const { tools } = makeCtx({
    list: async () => [entity],
    get: async (_k, id) => (id === 'elin' ? entity : undefined),
    save: async () => { throw new Error('不应到达') },
    root: '.',
  })
  const read = tools.get('writer_read')!
  const listing = await read.execute({ entity: 'character' })
  assert.match(listing, /- elin \[characters\/elin\.md\] hash=aaaaaaaa…/)
  assert.match(listing, /更新前请读取完整 hash/)
  const single = await read.execute({ entity: 'character', id: 'elin' })
  assert.match(single, /# character\/elin/)
  assert.match(single, new RegExp('a'.repeat(64)))
  assert.match(single, /守灯人。/)
  assert.match(await read.execute({ entity: 'character', id: 'ghost' }), /实体不存在/)
  await assert.rejects(read.execute({ entity: 'nosuch' }), /未知实体种类/)
})

test('writer_stats：章节/卷/伏笔/弧线/派生覆盖各分支', async () => {
  const chapters = [
    { id: '001', content: 'x'.repeat(100), frontmatter: { volume: '第一卷' }, hash: 'h1' },
    { id: '002', content: 'y'.repeat(50), frontmatter: {}, hash: 'h2' },
  ]
  const { tools } = makeCtx({
    list: async (kind) => kind === 'chapter' ? chapters
      : kind === 'character' ? [
        { id: 'elin', frontmatter: { timeline: '[{"chapter":"001","state":"a"}]' }, content: '' },
        { id: 'bad', frontmatter: { timeline: '{oops' }, content: '' },
      ]
      : kind === 'plot' ? [{ id: 'p1', frontmatter: { status: 'planted' }, content: '' }]
      : [],
    get: async (_k, id) => (id === 'event' ? { content: '事件' } : undefined),
    save: async () => { throw new Error('不应到达') },
    root: '.',
    // 派生新鲜度桩：001 新鲜（sourceHash 匹配）、002 过期
    readDerived: async (_kind: string, id: string) => (id === '001' ? { sourceHash: 'h1' } : { sourceHash: 'stale' }),
  } as unknown as WriterStub)
  const stats = tools.get('writer_stats')!
  const out = await stats.execute({})
  assert.match(out, /章节：2 章，共约 150 字/)
  assert.match(out, /卷分布：第一卷×1、正文×1/)
  assert.match(out, /伏笔：planted×1/)
  assert.match(out, /人物弧线覆盖：1\/2/)
  assert.match(out, /⚠.*非法 timeline：bad/)
  assert.match(out, /维护派生覆盖：1\/2（待维护 pass：002）/)
})

test('foreshadow_update：plant/resolve/abandon/milestone 状态机与校验', async () => {
  const states = new Map<string, { status?: string; milestones?: string }>([['gf', { status: 'planned' }]])
  const saved: { frontmatter: Record<string, unknown> }[] = []
  const { tools } = makeCtx({
    list: async () => [],
    get: async (_k, id) => (id === 'gf'
      ? { kind: 'plot', id, frontmatter: states.get(id) ?? {}, content: '', hash: 'h' }
      : undefined),
    save: async (_k, id, patch) => {
      saved.push(patch as { frontmatter: Record<string, unknown> })
      Object.assign(states.get(id)!, (patch as { frontmatter: Record<string, unknown> }).frontmatter)
      return { kind: 'plot', id, hash: 'h2', frontmatter: states.get(id) ?? {} }
    },
    root: '.',
  })
  const fo = tools.get('foreshadow_update')!
  assert.match(await fo.execute({ id: 'ghost', action: 'plant', chapter: '001', expectHash: 'h' }, exec), /伏笔实体不存在/)
  await assert.rejects(fo.execute({ id: 'gf', action: 'plant', expectHash: 'h' }, exec), /plant 需要提供 chapter/)
  await assert.rejects(fo.execute({ id: 'gf', action: 'milestone', milestone_type: 'reinforcement', expectHash: 'h' }, exec), /milestone 需要提供 chapter/)
  await assert.rejects(fo.execute({ id: 'gf', action: 'explode', expectHash: 'h' }, exec), /未知 action/)
  await assert.rejects(fo.execute({ id: 'gf', action: 'milestone', chapter: '001', milestone_type: 'boom', expectHash: 'h' }, exec), /milestone_type 非法/)
  assert.match(await fo.execute({ id: 'gf', action: 'plant', chapter: '001', expectHash: 'h' }, exec), /已更新伏笔 gf（status=planted/)
  assert.match(await fo.execute({ id: 'gf', action: 'milestone', chapter: '002', milestone_type: 'partial_reveal', milestone_note: '半揭', expectHash: 'h' }, exec), /已更新伏笔 gf/)
  // planned→resolved 非法迁移响亮失败（须先 planted——此处已 planted 可 resolve）
  assert.match(await fo.execute({ id: 'gf', action: 'resolve', chapter: '003', expectHash: 'h' }, exec), /status=resolved/)
  // resolved 终态再迁移拒绝
  await assert.rejects(fo.execute({ id: 'gf', action: 'abandon', expectHash: 'h' }, exec), /非法迁移/)
  assert.match(String(saved[1].frontmatter['milestones']), /partial_reveal/)
})

test('引擎缺席降级：write/review/consistency/recompute/maintenance_flush 返回未启用', async () => {
  const { tools } = makeCtx({
    list: async () => [], get: async () => undefined, save: async () => { throw new Error('不应到达') }, root: '.',
  })
  for (const [name, args] of [
    ['write_chapter', { chapter: '001', mode: 'full' }],
    ['review_chapter', { chapter: '001' }],
    ['consistency_check', {}],
    ['recompute_derived', { chapter_range: '001' }],
    ['maintenance_flush', {}],
  ] as const) {
    const out = await tools.get(name)!.execute({ ...args }, exec)
    assert.match(out, /写作引擎未启用/, `${name} 降级`)
  }
})

test('export/rag 缺席降级：export_book / writer_search 返回未启用', async () => {
  const { tools } = makeCtx({
    list: async () => [], get: async () => undefined, save: async () => { throw new Error('不应到达') }, root: '.',
  })
  assert.match(await tools.get('export_book')!.execute({ format: 'txt' }, exec), /导出插件未启用/)
  assert.match(await tools.get('writer_search')!.execute({ query: 'x' }, exec), /检索插件未启用/)
})

test('archive_point：非 git 目录返回指引（不抛错）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'writer-tools-'))
  try {
    const { tools } = makeCtx({ list: async () => [], get: async () => undefined, save: async () => { throw new Error('不应到达') }, root })
    const out = await tools.get('archive_point')!.execute({}, exec)
    // 两种排障文案都合法：本机无 git 或目录非 git 仓库
    assert.ok(/git 不可用|不是 git 仓库/.test(out), `实际输出：${out}`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pending_cleanup：按章归档 + 无待办幂等 + 脏章锚拒绝', async () => {
  let pendingText = '## [维护 pass] chapter/001（t）待人工确认\n- 建议 A\n\n## [维护 pass] chapter/002（t）待人工确认\n- 建议 B\n'
  const archived: string[] = []
  const { tools } = makeCtx({
    list: async () => [], get: async () => undefined, save: async () => { throw new Error('不应到达') }, root: '.',
    archivePending: async (mutator: (text: string) => { next: string; extracted: string }) => {
      const { next, extracted } = mutator(pendingText)
      pendingText = next
      if (extracted.length > 0) archived.push(extracted)
      return extracted
    },
    appendPendingArchive: async (section) => { archived.push(section) },
  })
  const cleanup = tools.get('pending_cleanup')!
  await assert.rejects(cleanup.execute({ chapter: '1' }, exec), /三位序号/)
  const out = await cleanup.execute({ chapter: '001' }, exec)
  assert.match(out, /已归档 chapter\/001/)
  assert.match(pendingText, /chapter\/002/)
  assert.doesNotMatch(pendingText, /chapter\/001/)
  assert.equal(archived.length, 1)
  assert.match(archived[0], /已归档\] chapter\/001/)
  assert.match(await cleanup.execute({ chapter: '001' }, exec), /没有待办节，无需归档/)
})

test('maintenance_flush：经 drain 排空并报告数量；引擎不在场已在降级用例覆盖', async () => {
  let drained = 0
  const engine = {
    pendingMaintenanceCount: () => 2,
    drainMaintenance: async () => { drained++ },
  }
  const { tools } = makeCtx({
    list: async () => [], get: async () => undefined, save: async () => { throw new Error('不应到达') }, root: '.',
  }, engine)
  const out = await tools.get('maintenance_flush')!.execute({}, exec)
  assert.match(out, /已排空 2 个在飞维护 pass/)
  assert.equal(drained, 1)
})

test('example-project 冒烟：writer_stats 三分支用真实 store 跑通（broken/empty/有 timeline）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'writer-tools-real-'))
  try {
    const { default: WriterStoreService } = await import('dsh-writer-store/src/index.ts')
    const { Context } = await import('@deepseek-ai/cordis')
    // @ts-expect-error 测试桩
    const ctx = new Context()
    const store = new WriterStoreService(ctx, { projectRoot: root })
    await mkdir(join(root, 'chapters'), { recursive: true })
    await mkdir(join(root, 'characters'), { recursive: true })
    await writeFile(join(root, 'chapters/001.md'), '---\nnumber: 1\n---\n正文。', 'utf8')
    await writeFile(join(root, 'characters/a.md'), '---\ntimeline: \'[{"chapter":"001","state":"ok"}]\'\n---\nA', 'utf8')
    await writeFile(join(root, 'characters/b.md'), '---\n---\nB', 'utf8')
    await writeFile(join(root, 'characters/c.md'), '---\ntimeline: \'{bad\'\n---\nC', 'utf8')
    const { tools } = makeCtx(store as unknown as WriterStub)
    const out = await tools.get('writer_stats')!.execute({})
    assert.match(out, /人物弧线覆盖：1\/3/)
    assert.match(out, /⚠.*非法 timeline：c/)
    assert.match(out, /- a（至第 001 章共 1 条）/)
    assert.match(out, /- c（timeline 无法解析，请修复 frontmatter）/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
