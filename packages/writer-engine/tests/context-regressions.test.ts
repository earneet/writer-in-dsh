import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import WriterStoreService from 'dsh-writer-store/src/index.ts'
import WriterEngineService from '../src/index.ts'

class LlmStub {
    requests: { system: string; user: string }[] = []
    replies: string[] = []

    stream(options: { system: string; messages: { content: { text?: string }[] }[] }): AsyncGenerator<StreamChunk> {
        this.requests.push({ system: options.system, user: options.messages[0].content.map(part => part.text ?? '').join('') })
        const text = this.replies.shift() ?? JSON.stringify({ summary: '', issues: [] })
        return (async function* () {
            yield { type: 'block-start', index: 0, blockType: 'text' }
            yield { type: 'text-delta', index: 0, text }
            yield { type: 'block-end', index: 0, block: { type: 'text', text } }
            yield { type: 'finish', reason: { kind: 'stop' } }
        })()
    }
}

async function setup(contextBudgetChars = 4000) {
    const root = await mkdtemp(join(tmpdir(), 'writer-context-'))
    // @ts-expect-error 独立测试无需宿主加载器。
    const ctx = new Context()
    const store = new WriterStoreService(ctx, { projectRoot: root })
    const llm = new LlmStub()
    Object.defineProperty(ctx, 'llm', { value: llm })
    const engine = new WriterEngineService(ctx, {
        provider: 'stub', model: 'stub', maxOutputTokens: 1024, temperature: 0,
        contextBudgetChars, autoMaintenance: false, extractionRetries: 0,
    })
    return { root, ctx, store, llm, engine }
}

for (const length of ['short', 'long', 'empty'] as const) {
    test(`assist 实际请求包含本章续写起点：${length}`, async () => {
        const { root, store, llm, engine } = await setup()
        try {
            const content = length === 'empty' ? '' : `${length === 'long' ? '前段'.repeat(4000) : '本章开头。'}本章真实结尾🧭。`
            await store.save('chapter', '001', { content: '前一章内容。' })
            await store.save('chapter', '002', { content })
            await store.save('chapter', '003', { content: '未来章不可见标记。' })
            llm.replies.push('新的叙事继续展开。')
            const result = await engine.writeChapter({ chapterId: '002', mode: 'assist' })
            const request = llm.requests[0].user
            assert.match(request, /本章已有正文/)
            if (length === 'empty') assert.match(request, /尚无正文/)
            else assert.ok(request.includes('本章真实结尾🧭。'))
            if (length === 'short') assert.ok(request.includes(content))
            if (length === 'long') assert.ok(request.length < 4000)
            assert.ok(!request.includes('未来章不可见标记'))
            assert.equal(result.chapter.content.trim(), content.length === 0 ? '新的叙事继续展开。' : `${content}\n\n新的叙事继续展开。`)
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })
}

for (const mode of ['full', 'assist'] as const) {
    test(`${mode} 实际请求按章过滤事件而非仅裁剪全文`, async () => {
        const { root, store, llm, engine } = await setup()
        try {
            await store.save('chapter', '003', { content: '本章开头。' })
            await store.save('event', 'event', { content: '全局已确认规则。\n## 第001章\n历史事实。\n## 第003章\n本章事实。\n## 第020章\n终局秘密不应进入。\n### 后续影响\n未来秘密不应进入。' })
            llm.replies.push('新的故事继续展开。')
            await engine.writeChapter({ chapterId: '003', mode })
            const request = llm.requests[0].user
            assert.match(request, /全局已确认规则|历史事实/)
            assert.match(request, /本章事实/)
            assert.doesNotMatch(request, /终局秘密|未来秘密/)
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })
}

for (const fallback of [false, true]) {
    test(`rewrite 补丁及回退均包含完整准则和有界风格：回退=${fallback}`, async () => {
        const { root, store, llm, engine } = await setup()
        try {
            const principles = `准则开始${'必须第三人称。'.repeat(150)}准则末尾红线`
            await store.save('principles', 'principles', { content: principles })
            await store.save('style', 'example', { content: `风格样本标记${'绵长的节奏。'.repeat(3000)}风格末尾不应进入` })
            await store.save('chapter', '001', { content: '原始章节。' })
            llm.replies.push(JSON.stringify({ patches: [{ find: fallback ? '不存在的锚点' : '原始章节。', replace: '修改章节。' }] }))
            if (fallback) llm.replies.push('修改章节。')
            await engine.writeChapter({ chapterId: '001', mode: 'rewrite', instruction: '增加紧张感' })
            assert.equal(llm.requests.length, fallback ? 2 : 1)
            for (const request of llm.requests) {
                assert.ok(request.user.includes(principles))
                assert.ok(request.user.includes('风格样本标记'))
                assert.ok(!request.user.includes('风格末尾不应进入'))
                assert.ok(request.user.length < principles.length + 1800)
            }
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })
}

test('一致性实际输入包含世界观、人物正文及权威 timeline，保留实体引用', async () => {
    const { root, store, llm, engine } = await setup()
    try {
        await store.save('chapter', '001', { content: '主角死而复活并看清光线。' })
        await store.save('worldbuilding', 'rules', { content: '世界规则禁止复活标记' })
        await store.save('character', 'hero', { content: '人物生来失明标记', frontmatter: { timeline: '[{"chapter":"001","state":"左腿受伤标记"}]' } })
        llm.replies.push(JSON.stringify({ summary: '有冲突', issues: [
            { dimension: '设定一致性', severity: 'high', refs: ['worldbuilding/rules', 'chapter/001'], description: '复活冲突' },
            { dimension: '人物一致性', severity: 'high', refs: ['character/hero', 'chapter/001'], description: '视力与状态冲突' },
        ] }))
        const report = await engine.consistencyCheck()
        const request = llm.requests[0].user
        for (const text of ['世界规则禁止复活标记', '人物生来失明标记', '左腿受伤标记', 'character/hero', 'worldbuilding/rules']) assert.ok(request.includes(text), text)
        assert.equal(report.issues.length, 2)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

for (const scope of [undefined, {}]) {
    test(`没有章节时仍可检查世界观条目间矛盾：scope=${JSON.stringify(scope)}`, async () => {
        const { root, store, llm, engine } = await setup()
        try {
            await store.save('worldbuilding', 'first', { content: '魔法不能复活。' })
            await store.save('worldbuilding', 'second', { content: '复活魔法随处可见。' })
            llm.replies.push(JSON.stringify({ summary: '规则矛盾', issues: [{ dimension: '设定一致性', severity: 'high', refs: ['worldbuilding/first', 'worldbuilding/second'], description: '复活规则不一致' }] }))
            const report = await engine.consistencyCheck(scope)
            assert.ok(llm.requests[0].user.includes('魔法不能复活'))
            assert.ok(llm.requests[0].user.includes('复活魔法随处可见'))
            assert.equal(report.issues.length, 1)
            assert.deepEqual(report.batches[0].chapters, [])
            await assert.rejects(() => engine.consistencyCheck({ from: '001', to: '002' }), /范围内没有已写章节/)
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })
}

test('一致性报告披露摘要代正文和基准材料裁剪', async () => {
    const { root, store, llm, engine } = await setup(2000)
    try {
        const chapter = await store.save('chapter', '001', { content: '完整章节内容。' })
        await store.writeMaintenance('001', { sourceHash: chapter.hash, summary: '新鲜摘要。', extraction: { facts: [], foreshadowEvents: [], characterStates: [] }, updatedAt: 'now' })
        await store.save('worldbuilding', 'long', { content: '很长的世界规则'.repeat(1000) })
        const report = await engine.consistencyCheck()
        assert.match(llm.requests[0].user, /摘要.*未提供正文/)
        assert.match(llm.requests[0].user, /基准.*截断|基准.*裁剪/)
        assert.match(report.summary, /摘要/)
        assert.match(report.summary, /基准.*截断|基准.*裁剪/)
        assert.ok(llm.requests[0].user.length < 2500)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('真实引擎领域事件绑定 writerEngine 服务域', async () => {
    const { root, ctx, store, llm } = await setup()
    try {
        const a = ctx.isolate('writerEngine')
        const b = ctx.isolate('writerEngine')
        const config = { provider: 'stub', model: 'stub', maxOutputTokens: 1024, temperature: 0, contextBudgetChars: 4000, autoMaintenance: false, extractionRetries: 0 }
        const engineA = new WriterEngineService(a, config)
        new WriterEngineService(b, config)
        const seen: string[] = []
        for (const event of ['writer/chapter-written', 'writer/maintenance-pass'] as const) {
            a.on(event, () => { seen.push(`A:${event}`) })
            b.on(event, () => { seen.push(`B:${event}`) })
        }
        llm.replies.push('章节正文。', '章节摘要。', '{"facts":[],"foreshadowEvents":[],"characterStates":[]}')
        await engineA.writeChapter({ chapterId: '001', mode: 'full' })
        await engineA.maintenancePass('001')
        assert.deepEqual(seen, ['A:writer/chapter-written', 'A:writer/maintenance-pass'])
        assert.ok(await store.get('chapter', '001'))
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
