import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import WriterStoreService from 'dsh-writer-store/src/index.ts'
import WriterEngineService from '../src/index.ts'
import { apply as writerTools } from '../../writer-tools/src/index.ts'

const selection = '选区第一句。\n选区第二句。'
const original = `章首  字距。\n\n${selection}\n\n章尾  字距。\n`

test('作者命令与真实写作服务联动：拒绝扩大范围，整章须批准', async t => {
    const { chapter, store, engine, file, replies, requests, events } = await setup(t, original, false)
    const tools = new Map<string, { execute(args: Record<string, unknown>, exec: unknown): Promise<string> }>()
    const commands = new Map<string, { handler(input: unknown): Promise<{ kind: string; text: string }> }>()
    let approved = false
    let approvals = 0
    const ctx = {
        writer: store,
        tools: { register: (tool: { name: string; execute: never }) => tools.set(tool.name, tool) },
        commands: { register: (command: { name: string; handler: never }) => commands.set(command.name, command) },
        agents: { withInitiator: (_agent: unknown, action: () => unknown) => action() },
        inject: (_keys: string[], action: (ctx: unknown) => void) => action(ctx),
        get: (name: string) => name === 'writerEngine' ? engine : name === 'approval'
            ? { request: async () => { approvals++; return approved ? 'allowed-once' : 'rejected' } } : undefined,
        on: () => {},
    }
    writerTools(ctx as unknown as Context)
    const agent = { session: {} }
    const signal = new AbortController().signal
    let concluded = 0
    const exec = { agent, signal, name: 'write_chapter', concludeTurn: () => { concluded++ } }
    const register = (scope: string, hash = chapter.hash) => commands.get('writer-rewrite')!.handler({
        agent, signal, rawInput: JSON.stringify({ chapter: '001', scope, hash, selection }),
    })
    const write = tools.get('write_chapter')!
    const start = { chapter: '001', mode: 'rewrite', instruction: '改稿' }
    const initial = await readFile(file)
    await assert.rejects(write.execute(start, exec), /由作者/)
    assert.equal((await register('selection', 'a'.repeat(64))).kind, 'error')
    const local = await register('selection')
    assert.equal(local.kind, 'success')
    await assert.rejects(write.execute({ ...start, mode: 'assist' }, exec), /待执行/)
    await assert.rejects(write.execute({ ...start, request_id: local.text, chapter: '002' }, exec), /不符/)
    await assert.rejects(write.execute({ ...start, request_id: local.text }, { ...exec, agent: { session: {} } }), /不符/)
    await assert.rejects(tools.get('writer_update')!.execute({ entity: 'chapter', id: '001', content: '越界', expectHash: chapter.hash }, exec), /待执行/)
    replies.push(patches(['章尾  字距。', '越界。']))
    await assert.rejects(write.execute({ ...start, request_id: local.text, selection: '章尾  字距。' }, exec), /选区原文/)
    assert.deepEqual(await readFile(file), initial)
    assert.deepEqual(events, [])
    replies.push(patches(['选区第二句。', '改过的第二句。']))
    await write.execute({ ...start, request_id: local.text }, exec)
    assert.equal(await readFile(file, 'utf8'), original.replace('选区第二句。', '改过的第二句。'))
    assert.equal(concluded, 1)
    await assert.rejects(write.execute({ ...start, request_id: local.text }, exec), /已用完/)

    const current = (await store.get('chapter', '001'))!
    const whole = await register('chapter', current.hash)
    const before = await readFile(file)
    await assert.rejects(write.execute({ ...start, request_id: whole.text }, exec), /未获批准/)
    assert.deepEqual(await readFile(file), before)
    assert.equal(requests.length, 2)
    assert.equal(approvals, 1)
    await assert.rejects(write.execute({ ...start, request_id: whole.text }, exec), /已用完/)
    approved = true
    const approvedRequest = await register('chapter', current.hash)
    replies.push(patches(['章尾  字距。', '作者批准的新结尾。']))
    await write.execute({ ...start, request_id: approvedRequest.text }, exec)
    assert.match(await readFile(file, 'utf8'), /作者批准的新结尾。/)
    assert.equal(approvals, 2)
})

test('早章写作与审稿只收到当前可见的伏笔阶段', async t => {
    const { engine, store, replies, requests } = await setup(t, original, false)
    await store.save('chapter', '002', { content: '核对钥匙去向。', frontmatter: { number: 8 } })
    await store.save('chapter', '020', { content: '未来叙事内容。', frontmatter: { number: 1 } })
    await store.save('plot', 'key', {
        content: '档案首段泄密\n\n## 第 1 章\n箱底的钥匙\n\n## 第 8 章\n开启密室的钥匙',
        frontmatter: { status: 'resolved', planted_chapter: '001', resolved_chapter: '008' },
    })
    replies.push('事物还静静地躺在那儿。', '{"suggestions":[],"summary":"已核对。"}')
    await engine.writeChapter({ chapterId: '002', mode: 'assist' })
    const review = await engine.reviewChapter('002', ['情节一致性'])
    for (const { user } of requests) {
        assert.match(user, /箱底的钥匙/)
        assert.doesNotMatch(user, /开启密室的钥匙|档案首段泄密|未来叙事内容/)
    }
    assert.match(review.coverage?.join('\n') ?? '', /部分档案因章锚未纳入/)
})

const patches = (...items: readonly [string, string][]): string =>
    JSON.stringify({ patches: items.map(([find, replace]) => ({ find, replace })) })

async function setup(t: TestContext, content = original, autoMaintenance = true) {
    const root = await mkdtemp(join(tmpdir(), 'writer-selection-'))
    // @ts-expect-error 独立测试无需宿主加载器。
    const ctx = new Context()
    const store = new WriterStoreService(ctx, { projectRoot: root })
    const chapter = await store.save('chapter', '001', { content })
    const events: string[] = []
    const requests: { system: string; user: string }[] = []
    const replies: (string | (() => Promise<string>))[] = []
    Object.defineProperty(ctx, 'llm', { value: {
        async *stream(options: { system: string; messages: { content: { text?: string }[] }[] }): AsyncGenerator<StreamChunk> {
            requests.push({ system: options.system, user: options.messages[0].content.map(part => part.text ?? '').join('') })
            const reply = replies.shift() ?? '不应调用的模型输出。'
            const text = typeof reply === 'string' ? reply : await reply()
            yield { type: 'block-start', index: 0, blockType: 'text' }
            yield { type: 'text-delta', index: 0, text }
            yield { type: 'block-end', index: 0, block: { type: 'text', text } }
            yield { type: 'finish', reason: { kind: 'stop' } }
        },
    } })
    const engine = new WriterEngineService(ctx, {
        provider: 'stub', model: 'stub', maxOutputTokens: 1024, temperature: 0,
        contextBudgetChars: 4000, autoMaintenance, extractionRetries: 0,
    })
    for (const event of ['writer/entity-saved', 'writer/chapter-written', 'writer/maintenance-pass'] as const) {
        ctx.on(event, () => { events.push(event) })
    }
    t.after(async () => {
        try { await engine.drainMaintenance() }
        finally { await rm(root, { recursive: true, force: true }) }
    })
    return { chapter, store, engine, events, requests, replies, file: join(root, chapter.path) }
}

test('选区改稿按原始锚点应用多条补丁，区外逐字保留', async t => {
    const { chapter, engine, store, events, requests, replies, file } = await setup(t)
    replies.push(`\`\`\`json\n${patches(['选区第二句。', '第二句改稿。'], ['选区第一句。', '第一句改稿。'])}\n\`\`\``, '摘要。', '{"facts":[],"foreshadowEvents":[],"characterStates":[]}')
    const result = await engine.writeChapter({ chapterId: '001', mode: 'rewrite', instruction: '润色选中两句', selection })
    await engine.drainMaintenance()
    const expected = '章首  字距。\n\n第一句改稿。\n第二句改稿。\n\n章尾  字距。\n'
    assert.equal(result.chapter.content, expected)
    assert.equal(await readFile(file, 'utf8'), expected)
    assert.notEqual(result.chapter.hash, chapter.hash)
    assert.equal(result.patchStats?.applied, 2)
    assert.equal((await store.readMaintenance('001'))?.sourceHash, result.chapter.hash)
    assert.deepEqual(events, ['writer/entity-saved', 'writer/chapter-written', 'writer/maintenance-pass'])
    assert.match(requests[0].system, /选区[\s\S]*只输出.*JSON/)
    assert.match(requests[0].user, /章首  字距。/)
    assert.ok(requests[0].user.includes(selection))
})

const unsafeReplies = [
    ['区外补丁', patches(['选区第一句。', '合法修改。'], ['章尾  字距。', '越界修改。']), /选区原文/],
    ['全部失配', patches(['虚构锚点。', '失配改稿。']), /选区原文/],
    ['同组失配', patches(['选区第一句。', '合法修改。'], ['选区 第二句。', '失配改稿。']), /选区原文/],
    ['同组锚点重叠', patches([selection, '整段修改。'], ['选区第二句。', '局部修改。']), /重叠/],
    ['改后内容充当下一条锚点', patches(['选区第一句。', '生成锚点。'], ['生成锚点。', '二次修改。']), /选区原文/],
    ['模型返回全文', '模型改写后的整章。', /补丁协议/],
    ['全文混杂补丁', `模型改写后的整章。\n${patches(['选区第一句。', '合法修改。'])}`, /补丁协议/],
] as const

for (const mode of ['full', 'assist'] as const) {
    test(`${mode} 收到选区时在调用模型之前拒绝`, async t => {
        const { engine, file, requests, events } = await setup(t)
        await assert.rejects(engine.writeChapter({ chapterId: '001', mode, instruction: '局部润色', selection }), /selection.*仅适用于 rewrite/)
        assert.equal(await readFile(file, 'utf8'), original)
        assert.deepEqual(requests, [])
        assert.deepEqual(events, [])
    })
}

for (const [label, reply, reason] of unsafeReplies) {
    test(`选区改稿拒绝${label}，保留原稿且不触发维护`, async t => {
        const { chapter, engine, store, events, requests, replies, file } = await setup(t)
        replies.push(reply, '不应请求全文改写。')
        await assert.rejects(engine.writeChapter({ chapterId: '001', mode: 'rewrite', instruction: '局部润色', selection }), error => {
            assert.ok(error instanceof Error)
            assert.match(error.message, reason)
            assert.match(error.message, /未保存.*重新选定.*明确要求整章改稿/)
            return true
        })
        await engine.drainMaintenance()
        assert.equal(await readFile(file, 'utf8'), original)
        assert.equal((await store.get('chapter', '001'))?.hash, chapter.hash)
        assert.equal(await store.readMaintenance('001'), undefined)
        assert.deepEqual(events, [])
        assert.equal(requests.length, 1)
    })
}

for (const [label, content, invalidSelection, reason] of [
    ['空选区', original, '', /非空/],
    ['纯空白选区', original, '  ', /非空/],
    ['非逐字选区', original, '章首字距。', /逐字匹配/],
    ['重复选区', '重复句。重复句。\n', '重复句。', /多处/],
    ['重叠重复选区', '甲甲甲\n', '甲甲', /多处/],
] as const) {
    test(`选区改稿在调用模型前拒绝${label}`, async t => {
        const { engine, events, requests, file } = await setup(t, content)
        await assert.rejects(engine.writeChapter({ chapterId: '001', mode: 'rewrite', instruction: '润色选区', selection: invalidSelection }), reason)
        assert.equal(await readFile(file, 'utf8'), content)
        assert.deepEqual(events, [])
        assert.equal(requests.length, 0)
    })
}

test('选区改稿拒绝会在选区外补末尾换行的保存', async t => {
    const { engine, events, replies, file } = await setup(t)
    const withoutTrailingNewline = original.slice(0, -1)
    await writeFile(file, withoutTrailingNewline, 'utf8')
    replies.push(patches(['选区第一句。', '第一句改稿。']))
    await assert.rejects(engine.writeChapter({ chapterId: '001', mode: 'rewrite', instruction: '润色选区', selection }), /选区外.*未保存/)
    assert.equal(await readFile(file, 'utf8'), withoutTrailingNewline)
    assert.deepEqual(events, [])
})

test('选区延伸到文件末尾时允许 Markdown 的末尾换行留在选区内', async t => {
    const { engine, replies, file } = await setup(t, '选区外前文。\n选区末句。\n', false)
    replies.push(patches(['选区末句。\n', '改后的末句。']))
    await engine.writeChapter({ chapterId: '001', mode: 'rewrite', instruction: '润色尾句', selection: '选区末句。\n' })
    assert.equal(await readFile(file, 'utf8'), '选区外前文。\n改后的末句。\n')
})

test('选区改稿仍使用模型调用前取得的章稿哈希', async t => {
    const { chapter, engine, store, events, replies, file } = await setup(t, original, false)
    const concurrent = original.replace('章尾', '作者刚修订的章尾')
    replies.push(async () => {
        await store.save('chapter', '001', { content: concurrent }, chapter.hash)
        return patches(['选区第一句。', '第一句改稿。'])
    })
    await assert.rejects(engine.writeChapter({ chapterId: '001', mode: 'rewrite', instruction: '润色选区', selection }), /乐观锁失败/)
    assert.equal(await readFile(file, 'utf8'), concurrent)
    assert.deepEqual(events, ['writer/entity-saved'])
})

test('未提供选区时仍可明确发起整章改稿', async t => {
    const { engine, replies, requests, file } = await setup(t, original, false)
    replies.push('模型判断需要改写全文。', '整章改稿。')
    const result = await engine.writeChapter({ chapterId: '001', mode: 'rewrite', instruction: '调整全章结构' })
    assert.equal(result.mode, 'rewrite-full')
    assert.equal(await readFile(file, 'utf8'), '整章改稿。\n')
    assert.equal(requests.length, 2)
})
