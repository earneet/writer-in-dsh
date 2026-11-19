import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import WriterStoreService from 'dsh-writer-store/src/index.ts'
import WriterEngineService from '../src/index.ts'

const selection = '选区第一句。\n选区第二句。'
const original = `章首  字距。\n\n${selection}\n\n章尾  字距。\n`

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
