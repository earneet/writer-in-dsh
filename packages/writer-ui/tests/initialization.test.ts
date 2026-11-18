import test from 'node:test'
import assert from 'node:assert/strict'
import * as load from '../src/client/load.ts'

test('初始化调用当前会话的确定性命令并检查成功业务结果', async () => {
    const calls: unknown[] = []
    load.setBrowserContext({ remote: { commands: { execute: async (...args: unknown[]) => {
        calls.push(args.slice(0, 3))
        return { ok: true, value: { result: { kind: 'success', text: JSON.stringify({ status: 'ready', workspaceRoot: '/book', projectRoot: '/book/novel', scanRoot: 'novel', entries: ['novel'] }) } } }
    } } } } as never)
    try {
        assert.equal((await load.projectCommand('session-a', 'init', new AbortController().signal)).status, 'ready')
        assert.deepEqual(calls, [['session-a', '/writer-project-init', []]])
    } finally { load.setBrowserContext(null) }
})

test('命令缺席、权限拒绝、业务失败和坏回执均不能假报初始化成功', async () => {
    try {
        for (const result of [undefined, { ok: false, error: { message: '权限不足' } }, { ok: true }, { ok: true, value: { result: { kind: 'error', text: '目录非空' } } }, { ok: true, value: { result: { kind: 'success', text: '{}' } } }]) {
            load.setBrowserContext({ remote: { commands: { execute: async () => result } } } as never)
            await assert.rejects(load.projectCommand('session-b', 'init', new AbortController().signal))
        }
    } finally { load.setBrowserContext(null) }
})
