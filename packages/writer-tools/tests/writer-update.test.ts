/**
 * writer-tools 工具单测（P5）：writer_update 对 character.timeline 的写入校验（响亮拒绝坏值）。
 * 以桩 Context 捕获 defineTool 注册的工具定义，直接调用 execute。
 * 运行：node --test packages/writer-tools/tests/writer-update.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'

interface CapturedTool {
  name: string
  execute: (args: Record<string, unknown>) => Promise<string>
}

function makeCtx(writer: unknown): { tools: Map<string, CapturedTool> } {
  const tools = new Map<string, CapturedTool>()
  const ctx = {
    on: () => () => {},
    get: () => undefined,
    writer,
    tools: { register: (tool: CapturedTool) => tools.set(tool.name, tool) },
  }
  apply(ctx as unknown as Context)
  return { tools }
}

const baseArgs = { entity: 'character', id: 'elin', expectHash: 'h1' }

test('writer_update：character.timeline 合法数组通过并落盘（数组被 JSON 化）', async () => {
  const saved: unknown[] = []
  const { tools } = makeCtx({
    get: async () => ({ kind: 'character', id: 'elin', frontmatter: {}, content: '', hash: 'h1' }),
    save: async (kind: string, id: string, patch: { frontmatter?: Record<string, unknown> }) => {
      saved.push(patch.frontmatter)
      return { kind, id, hash: 'h2', path: 'characters/elin.md' }
    },
  })
  const result = await tools.get('writer_update')!.execute({
    ...baseArgs,
    frontmatter: { timeline: [{ chapter: '001', state: '雨夜初见绿焰' }] },
  })
  assert.match(result, /已保存 character\/elin/)
  assert.equal(typeof saved[0] === 'object' && (saved[0] as Record<string, unknown>)['timeline'], '[{"chapter":"001","state":"雨夜初见绿焰"}]')
})

test('writer_update：非法 JSON timeline 响亮拒绝且不落盘', async () => {
  let saveCalled = false
  const { tools } = makeCtx({
    get: async () => ({ kind: 'character', id: 'elin', frontmatter: {}, content: '', hash: 'h1' }),
    save: async () => { saveCalled = true; throw new Error('不应到达') },
  })
  await assert.rejects(
    tools.get('writer_update')!.execute({ ...baseArgs, frontmatter: { timeline: '{oops' } }),
    /timeline 字段非法.*JSON 解析失败/,
  )
  assert.equal(saveCalled, false)
})

test('writer_update：JSON 合法但条目违反领域校验（同章重复/倒序/脏锚/空 state）响亮拒绝', async () => {
  const { tools } = makeCtx({
    get: async () => ({ kind: 'character', id: 'elin', frontmatter: {}, content: '', hash: 'h1' }),
    save: async () => { throw new Error('不应到达') },
  })
  const bad: Record<string, string>[] = [
    { timeline: '[{"chapter":"002","state":"a"},{"chapter":"002","state":"b"}]' }, // 同章重复
    { timeline: '[{"chapter":"003","state":"a"},{"chapter":"001","state":"b"}]' }, // 倒序
    { timeline: '[{"chapter":"2","state":"a"}]' }, // 脏章锚
    { timeline: '[{"chapter":"002","state":"   "}]' }, // 空 state
  ]
  for (const frontmatter of bad) {
    await assert.rejects(
      tools.get('writer_update')!.execute({ ...baseArgs, frontmatter }),
      /timeline 字段非法/,
    )
  }
})

test('writer_update：非 character 实体携带 timeline 字段不做 timeline 校验（其他 kind 的同名键不拦截）', async () => {
  const { tools } = makeCtx({
    get: async () => ({ kind: 'worldbuilding', id: 'flame', frontmatter: {}, content: '', hash: 'h1' }),
    save: async (kind: string, id: string) => ({ kind, id, hash: 'h2', path: 'worldbuilding/flame.md' }),
  })
  const result = await tools.get('writer_update')!.execute({
    entity: 'worldbuilding', id: 'flame', expectHash: 'h1', frontmatter: { timeline: '任意自由文本' },
  })
  assert.match(result, /已保存 worldbuilding\/flame/)
})

test('timeline_update：追加条目走服务端合并（同章覆盖、按章序插入），不要求手工拼 JSON', async () => {
  const savedPatches: { frontmatter?: Record<string, unknown> }[] = []
  // 模拟磁盘现状：save 后 get 返回最新落盘 timeline（乐观锁 read-before-update 语义）
  let current = '[{"chapter":"001","state":"初见"}]'
  const { tools } = makeCtx({
    get: async () => ({ kind: 'character', id: 'elin', frontmatter: { timeline: current }, content: '', hash: 'h1' }),
    save: async (_kind: string, _id: string, patch: { frontmatter?: Record<string, unknown> }) => {
      savedPatches.push(patch)
      current = String(patch.frontmatter?.['timeline'])
      return { kind: 'character', id: 'elin', hash: 'h2', path: 'characters/elin.md' }
    },
  })
  const tool = tools.get('timeline_update')!
  const exec = { signal: new AbortController().signal } as never
  const mid = await tool.execute({ id: 'elin', chapter: '003', state: '受伤', expectHash: 'h1' }, exec)
  assert.match(mid, /已更新人物时间线 elin.*001→初见；003→受伤/)
  const overwrite = await tool.execute({ id: 'elin', chapter: '001', state: '初见绿焰', expectHash: 'h2' }, exec)
  assert.match(overwrite, /001→初见绿焰；003→受伤/, '同章覆盖且其余条目不动')
  assert.deepEqual(
    savedPatches.map((p) => p.frontmatter?.['timeline']),
    ['[{"chapter":"001","state":"初见"},{"chapter":"003","state":"受伤"}]', '[{"chapter":"001","state":"初见绿焰"},{"chapter":"003","state":"受伤"}]'],
  )
})

test('timeline_update：人物不存在软失败；脏章锚/空 state 响亮拒绝且不落盘', async () => {
  let saveCalled = false
  const { tools } = makeCtx({
    get: async (kind: unknown, id: unknown) => (id === 'ghost' ? undefined : { kind, id, frontmatter: {}, content: '', hash: 'h1' }),
    save: async () => { saveCalled = true; throw new Error('不应到达') },
  })
  const tool = tools.get('timeline_update')!
  const exec = { signal: new AbortController().signal } as never
  assert.match(await tool.execute({ id: 'ghost', chapter: '001', state: 'x', expectHash: 'h' }, exec), /人物实体不存在/)
  await assert.rejects(tool.execute({ id: 'elin', chapter: '2', state: 'x', expectHash: 'h1' }, exec), /章节锚非法/)
  await assert.rejects(tool.execute({ id: 'elin', chapter: '002', state: '  ', expectHash: 'h1' }, exec), /state 不能为空/)
  assert.equal(saveCalled, false)
})

test('timeline_update：现有 timeline 自身非法时拒绝追加（不毒化）', async () => {
  const { tools } = makeCtx({
    get: async (kind: unknown, id: string) => ({ kind, id, frontmatter: { timeline: '[{"chapter":"003","state":"a"},{"chapter":"001","state":"b"}]' }, content: '', hash: 'h1' }),
    save: async () => { throw new Error('不应到达') },
  })
  await assert.rejects(
    tools.get('timeline_update')!.execute({ id: 'elin', chapter: '002', state: 'x', expectHash: 'h1' }, { signal: new AbortController().signal } as never),
    /拒绝追加/,
  )
})
