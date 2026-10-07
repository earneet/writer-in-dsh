/**
 * writer-guard 编排单测：post-execute 监听的观测/委托/提示折入（纯 cordis 桩驱动，不拉宿主）。
 * 运行：node --test packages/writer-guard/tests/guard.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { PostToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { apply, type Config } from '../src/index.ts'

type PostListener = (exec: ToolExecution, result: Readonly<{ isError: boolean; error: { message: string }; content: unknown[] }>, next: () => Promise<PostToolDecision>) => Promise<PostToolDecision>

function makeListener(config?: Partial<Config>): { listen: PostListener } {
  let listener: PostListener | undefined
  const fakeCtx = {
    on: (_event: string, fn: PostListener): void => {
      listener = fn
    },
  }
  apply(fakeCtx as never, {
    windowSize: 5, failureBudget: 0.3, hintInterval: 1,
    watchedTools: ['writer_update', 'writer_read'],
    ...config,
  })
  if (listener === undefined) throw new Error('监听未注册')
  return { listen: listener }
}

/** 稳定 agent 桩：同一会话内 agent 身份不变（per-agent 分窗的计数前提）。 */
const AGENT = {}

function exec(name: string): ToolExecution {
  return { name, arguments: {}, callId: 'c', agent: AGENT } as never as ToolExecution
}

function failure(message: string): { isError: true; error: { message: string }; content: unknown[] } {
  return { isError: true, error: { message }, content: [] }
}

function success(text: string): { isError: false; error?: undefined; content: unknown[] } {
  return { isError: false, error: undefined, content: [{ type: 'text', text }] }
}

async function hintOf(decision: PostToolDecision): Promise<string | undefined> {
  const contexts = (decision as { additionalContexts?: { content: ({ type: string; text?: string })[] }[] }).additionalContexts
  const textBlock = contexts?.[0]?.content.find((b) => b.type === 'text')
  return textBlock?.text
}

const accept: PostToolDecision = { kind: 'accept' }
const next = async (): Promise<PostToolDecision> => accept

test('编排：未超预算不注入；超预算后注入纠偏提示且不改变下游决策 kind', async () => {
  const { listen } = makeListener()
  // 5 次失败（窗口预热满且 rate=1 > 0.3）：第 5 次起注入
  let decision = await listen(exec('writer_update'), failure('乐观锁失败：磁盘版本已变化'), next)
  assert.equal(await hintOf(decision), undefined, '窗口未满不提示')
  for (let i = 0; i < 3; i++) {
    decision = await listen(exec('writer_update'), failure('实体不存在：chapter/009'), next)
  }
  decision = await listen(exec('writer_update'), failure('乐观锁失败：磁盘版本已变化'), next)
  const hint = await hintOf(decision)
  assert.ok(hint !== undefined && hint.includes('[writer-guard]'), '超预算注入提示')
  assert.ok(hint!.includes('乐观锁'), '当前失败类别指引优先')
  assert.equal(decision.kind, 'accept', '不改变下游决策（不熔断）')
})

test('编排：软失败文本同样计数与提示（仅白名单前缀）', async () => {
  const { listen } = makeListener()
  for (let i = 0; i < 5; i++) {
    await listen(exec('writer_read'), success('实体不存在：chapter/009（可先不带 id 列出清单）'), next)
  }
  const decision = await listen(exec('writer_read'), success('实体不存在：plot/ghost'), next)
  const hint = await hintOf(decision)
  assert.ok(hint !== undefined, '软失败计入预算并触发提示')
})

test('编排：成功输出的正文含业务关键词不误计（防预算污染）', async () => {
  const { listen } = makeListener()
  for (let i = 0; i < 8; i++) {
    await listen(exec('writer_read'), success('已保存 chapter/002\n他研究了那套状态机与旧 schema 文档。'), next)
  }
  const decision = await listen(exec('writer_read'), success('已保存 chapter/003（正文提及解析失败剧情）'), next)
  assert.equal(await hintOf(decision), undefined, '成功正文不产生分类计数')
})

test('编排：无 agent 的直接调用不计数', async () => {
  const { listen } = makeListener()
  const noAgent = { name: 'writer_update', arguments: {}, callId: 'c' } as never as ToolExecution
  for (let i = 0; i < 10; i++) {
    await listen(noAgent, failure('乐观锁失败'), next)
  }
  const decision = await listen(noAgent, failure('乐观锁失败'), next)
  assert.equal(await hintOf(decision), undefined)
})

test('编排：hintInterval 节流——超预算期间不逐次注入', async () => {
  const { listen } = makeListener({ hintInterval: 3 })
  const decisions: (string | undefined)[] = []
  for (let i = 0; i < 8; i++) {
    const decision = await listen(exec('writer_update'), failure('乐观锁失败：磁盘版本已变化'), next)
    decisions.push(await hintOf(decision))
  }
  const injected = decisions.filter((h) => h !== undefined).length
  // 第 5 次注入（窗口满）；此后间隔 ≥3 次才可再注入（第 8 次满足 8-5=3）
  assert.deepEqual(decisions.map((h) => h !== undefined), [false, false, false, false, true, false, false, true])
  assert.ok(injected === 2)
})

test('编排：不受观测工具透明（不计数）', async () => {
  const { listen } = makeListener()
  for (let i = 0; i < 10; i++) {
    await listen(exec('bash'), failure('乐观锁失败'), next)
  }
  const decision = await listen(exec('bash'), failure('乐观锁失败'), next)
  assert.equal(await hintOf(decision), undefined)
})

test('编排：下游 block 决策保留 feedback 并携带提示', async () => {
  const { listen } = makeListener()
  for (let i = 0; i < 5; i++) {
    await listen(exec('writer_update'), failure('乐观锁失败：磁盘版本已变化'), next)
  }
  const blockNext = async (): Promise<PostToolDecision> => ({ kind: 'block', feedback: [] as never })
  const decision = await listen(exec('writer_update'), failure('乐观锁失败'), blockNext)
  assert.equal(decision.kind, 'block')
  assert.ok((await hintOf(decision)) !== undefined, 'block 变体同样携带提示')
})

test('编排：配置失败率预算响亮失败', () => {
  assert.throws(() => makeListener({ failureBudget: 1.5 }), /failureBudget 非法/)
})
