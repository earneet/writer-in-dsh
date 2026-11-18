import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import { commandHarness } from './command-harness.ts'

test('真实宿主命令限定写作域并为初始化与工具读写绑定同一会话目录', async t => {
    const harness = await commandHarness()
    t.after(() => harness.dispose())
    const a = await harness.createAgent('a')
    const b = await harness.createAgent('b')
    const outside = await harness.createAgent('outside', false)
    assert.ok(harness.commands.list(a).some(command => command.name === 'writer-project-init'))
    assert.ok(!harness.commands.list(outside).some(command => command.name === 'writer-project-init'))
    const signal = new AbortController().signal
    assert.equal(await harness.commands.execute(outside, '/writer-project-init', [], signal), undefined)
    const init = await harness.commands.execute(a, '/writer-project-init', [], signal)
    assert.equal(init?.result.kind, 'success')
    const stateB = await harness.commands.execute(b, '/writer-project-status', [], signal)
    assert.equal(stateB?.result.kind, 'success')
    assert.equal(JSON.parse(stateB!.result.text!).status, 'empty')
    assert.deepEqual(await readdir(b.session.header.cwd!), [])
    const project = await harness.agents.withInitiator(a, () => harness.store.get('project', 'project'))
    assert.equal(project?.frontmatter.title, '未命名作品')
    assert.equal(harness.agents.currentInitiator(), undefined)
    const rejected = await harness.commands.execute(b, '/writer-project-init ignored', [], signal)
    assert.equal(rejected?.result.kind, 'error')
    assert.deepEqual(await readdir(b.session.header.cwd!), [])
})
