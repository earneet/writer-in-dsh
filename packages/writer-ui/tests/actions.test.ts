import test from 'node:test'
import assert from 'node:assert/strict'
import { appendRequest, setActionContext } from '../src/client/actions.ts'

function host(result = 'applied', phase = 'plain') {
    const calls: unknown[] = []
    const binding = { ctx: {} }
    setActionContext({ sessions: { binding: (id: string) => id === 'a' ? binding : undefined }, conversation: { input: {
        for: () => ({ state: { getSnapshot: () => ({ phase }) } }),
        requestDraftInitialization: (target: unknown, options: unknown) => { calls.push([target, options]); return result },
    } } } as never)
    const owner = { inputActions: { persistDraft: () => calls.push('persist') }, openView: (view: string) => calls.push(view) }
    return { calls, owner }
}

test('草稿：追加后持久化再切对话，不覆盖已有文字和引用', () => {
    const { calls, owner } = host()
    assert.equal(appendRequest('a', '修改 chapter/128', owner).status, 'applied')
    assert.deepEqual((calls[0] as unknown[])[1], { prompt: '修改 chapter/128', whenDraftExists: 'append' })
    assert.deepEqual(calls.slice(1), ['persist', 'chat'])
    setActionContext(null)
})

test('草稿：锁定、命令、过代或未追加时保留请求，不切会话', () => {
    for (const result of ['blocked', 'preserved']) {
        const { calls, owner } = host(result)
        assert.equal(appendRequest('a', '要求', owner).status, result)
        assert.equal(calls.length, 1)
    }
    const { calls, owner } = host('applied', 'claimed')
    assert.equal(appendRequest('a', '要求', owner).status, 'blocked')
    assert.equal(appendRequest('gone', '要求', owner).status, 'unavailable')
    assert.equal(calls.length, 0)
    setActionContext(null)
    assert.equal(appendRequest('a', '要求', owner).status, 'unavailable')
})

test('草稿：绑定异常返回可复制状态，追加后的导航异常不允许重复追加', () => {
    setActionContext({ sessions: { binding: () => { throw new Error('disposed') } } } as never)
    assert.equal(appendRequest('gone', '要求', {}).status, 'unavailable')
    const { calls, owner } = host()
    owner.inputActions.persistDraft = () => { throw new Error('storage') }
    assert.equal(appendRequest('a', '要求', owner).status, 'applied')
    assert.equal(calls.length, 1)
    setActionContext(null)
})
