import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { EngineService } from 'dsh-writer-core'
import { randomUUID } from 'node:crypto'

interface RewriteRequest {
    id: string
    chapter: string
    hash: string
    root: string
    selection?: string
    controller: AbortController
    busy: boolean
}

export function registerRewriteRequests(ctx: Context) {
    const requests = new WeakMap<Agent['session'], RewriteRequest>()
    const pending = (agent?: Agent) => agent === undefined ? undefined : requests.get(agent.session)

    ctx.inject?.(['commands', 'agents'], child => {
        child.commands.register({
            name: 'writer-rewrite',
            description: '登记作者的局部或整章改稿请求',
            recordInput: false,
            handler: ({ agent, rawInput, signal }) => child.agents.withInitiator(agent, async () => {
                try {
                    const input = JSON.parse(rawInput) as { chapter?: unknown; hash?: unknown; scope?: unknown; selection?: unknown }
                    if (!input || typeof input.chapter !== 'string' || !/^\d{3}$/.test(input.chapter)
                        || typeof input.hash !== 'string' || !/^[a-f0-9]{64}$/.test(input.hash)
                        || (input.scope !== 'selection' && input.scope !== 'chapter')) {
                        throw new Error('请从工作台登记章节、范围和完整章稿哈希。')
                    }
                    const chapter = await child.writer.get('chapter', input.chapter)
                    signal.throwIfAborted()
                    if (!chapter || chapter.hash !== input.hash) throw new Error('章稿版本已变化，请刷新稿件并重新选择。')
                    let selection: string | undefined
                    if (input.scope === 'selection') {
                        selection = typeof input.selection === 'string' ? input.selection.replace(/\r\n/g, '\n') : ''
                        const offset = chapter.content.indexOf(selection)
                        if (!selection.trim() || offset === -1 || chapter.content.indexOf(selection, offset + 1) !== -1) {
                            throw new Error('请从当前章稿选取非空且唯一的原文。')
                        }
                    }
                    const request = { id: randomUUID(), chapter: input.chapter, hash: input.hash, root: child.writer.root, selection, controller: new AbortController(), busy: false }
                    pending(agent)?.controller.abort()
                    requests.set(agent.session, request)
                    return { kind: 'success' as const, text: request.id }
                } catch (error) {
                    return { kind: 'error' as const, text: error instanceof Error ? error.message : String(error) }
                }
            }),
        })
        child.commands.register({
            name: 'writer-rewrite-cancel',
            description: '取消本会话待执行的改稿请求',
            handler: ({ agent }) => {
                pending(agent)?.controller.abort()
                requests.delete(agent.session)
                return { kind: 'success', text: '已取消待执行的改稿请求。' }
            },
        })
    })

    return {
        assertNoRequest(agent?: Agent) {
            if (pending(agent)) throw new Error('本会话有待执行的改稿请求，请使用该请求或由作者取消后再写入章节。')
        },
        async execute(engine: EngineService, chapter: string, id: string | undefined, instruction: string | undefined, exec: ToolRunContext) {
            const agent = exec.agent
            const request = pending(agent)
            if (!agent || !request || request.id !== id || request.chapter !== chapter || request.root !== ctx.writer.root) {
                throw new Error('改稿请求不存在、已用完或与当前章节不符。请由作者在工作台重新发起。')
            }
            if (!instruction?.trim()) throw new Error('请提供具体改稿要求。')
            if (request.busy) throw new Error('此改稿请求正在执行。')
            request.busy = true
            try {
                const signal = AbortSignal.any([exec.signal, request.controller.signal])
                if ((await ctx.writer.get('chapter', chapter))?.hash !== request.hash) {
                    throw new Error('章稿版本已变化，请刷新稿件并重新发起改稿。')
                }
                signal.throwIfAborted()
                if (request.selection === undefined) {
                    const approval = ctx.get('approval')
                    const outcome = await approval?.request({
                        agent, toolName: exec.name, callId: exec.callId, signal,
                        reason: `作者已发起第 ${chapter} 章的整章改稿。批准后，助手可改写并保存整章。`,
                    })
                    if (outcome !== 'allowed-once') {
                        if (pending(agent) === request) requests.delete(agent.session)
                        throw new Error('整章改稿未获批准，未保存。')
                    }
                }
                signal.throwIfAborted()
                const result = await engine.writeChapter({
                    chapterId: chapter, mode: 'rewrite', selection: request.selection,
                    expectedChapterHash: request.hash, instruction, signal,
                })
                if (pending(agent) === request) requests.delete(agent.session)
                return result
            } finally {
                request.busy = false
            }
        },
    }
}
