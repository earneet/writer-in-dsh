import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { AgentRegistry, type Agent } from '@deepseek-ai/dsh-agent'
import { CommandRuntime } from '@deepseek-ai/dsh-commands'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { createScope } from '@deepseek-ai/dsh-scope'
import WriterStore from '../src/index.ts'

export async function commandHarness() {
    const ctx = new Context()
    new SessionProjectionRegistry(ctx)
    const agents = new AgentRegistry(ctx)
    await agents[Service.init]()
    const sessions = new SessionStore(ctx)
    const commands = new CommandRuntime(ctx)
    const key = {}
    const suite = createScope(ctx, key)
    const store = new WriterStore(suite.ctx, {})
    await suite.ctx.fiber.await()
    const root = await mkdtemp(join(tmpdir(), 'writer-command-'))
    const scopes: ReturnType<typeof createScope>[] = []
    const detachers: (() => void)[] = []
    return {
        agents, commands, store, root,
        async createAgent(id: string, inside = true) {
            const cwd = join(root, id)
            await mkdir(cwd)
            const session = sessions.create(SessionId(id), { meta: { cwd } })
            const agent = { id: session.id, session } as Agent
            const scope = createScope(ctx, agent, inside ? { parent: key } : undefined)
            scopes.push(scope)
            Object.assign(agent, { ctx: scope.ctx })
            detachers.push(agents.enter(agent, undefined))
            return agent
        },
        async dispose() {
            for (const detach of detachers.reverse()) detach()
            for (const scope of scopes.reverse()) await scope.dispose()
            await suite.dispose()
            await ctx.fiber.dispose()
            await rm(root, { recursive: true, force: true })
        },
    }
}
