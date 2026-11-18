import { modules as hostModules } from 'writer-host-runtime'

const React = hostModules.react
const jsxRuntime = hostModules['react/jsx-runtime']
const ReactDOM = hostModules['react-dom']
const { createRoot } = hostModules['react-dom/client']
const primitives = hostModules['@deepseek-ai/dsh-client-ui-primitives']

const files: Record<string, string> = {
    'novel/project.md': '---\ntitle: "长夜有歌"\ngenre: "架空都市"\ntarget_words: 500000\n---\n项目简介',
    'novel/outline.md': '---\nsynopsis: "一个歌手，把梦里的旋律唱给一个陌生的时代。"\n---\n# 大纲\n\n## 第一卷\n\n## 第 128 章\n\n深夜录音，保留梦境的碎片。\n\n## 第 151 章\n\n尚未写作的计划。',
    'novel/principles.md': '# 创作准则\n\n## 基调\n\n温润主调，冷感点缀。梦是被动的，醒来只留下碎片。',
    'novel/characters/su.md': '---\nname: "苏眠"\nrole: "主角"\ntimeline: "[{\\"chapter\\":\\"128\\",\\"state\\":\\"尝试留下梦中的旋律\\"}]"\n---\n# 苏眠\n\n## 背景\n\n31 岁，云澜市歌手。\n\n## 关系\n\n- **陈默**：熟悉的录音师。',
    'novel/characters/chen.md': '---\nname: "陈默"\nrole: "录音师"\n---\n# 陈默\n\n## 背景\n\n愿意为歌手留一盏灯。\n\n## 关系\n\n- **苏眠**：长期合作的歌手。',
    'novel/plots/ship.md': '---\nhint: "梦里的那艘船"\nstatus: "planted"\nplanned_chapter: "001"\nplanted_chapter: "128"\nresolve_chapter: "149"\n---\n# 梦里的船\n\n留下意象，暂不解释来源。',
    'novel/worldbuilding/industry.md': '---\nname: "行业生态"\n---\n# 行业生态\n\n## 录音棚\n\n小场地和录音棚构成苏眠熟悉的世界。',
    'novel/ideas.md': '# 灵感\n\n## 一首借来的歌\n\n如果歌是别人用一生换来的，掌声属于谁？',
    'novel/events.md': '# 重要事件\n\n## 排期\n\n明晚的演出提前。',
    'novel/style/quiet.md': '# 风格\n\n## 安静的动作\n\n他把耳机放回原处，没有关灯。',
    'novel/pending.md': '# 待办\n\n## chapter/128（2026-11-17）\n\n' + Array.from({ length: 20 }, (_, i) => `- 建议 ${i + 1}：核对苏眠的章末状态。`).join('\n'),
    'novel/pending-archive.md': '# 归档\n\n## chapter/001\n\n人工说明不可丢失。\n- [x] 已确认状态\n- 重复建议\n\n## chapter/002\n\n- 重复建议\n',
}
for (let number = 1; number <= 150; number++) {
    if (number === 127) continue
    const id = String(number).padStart(3, '0')
    files[`novel/chapters/${id}.md`] = `---\nnumber: ${number}\ntitle: "${number === 128 ? '夜航之前' : `章节 ${id}`}"\nvolume: "第 ${Math.ceil(number / 25)} 卷"\n---\n\n凌晨两点，录音棚的灯还亮着。\n\n苏眠把耳机摘下来，放在调音台边。玻璃另一侧，空着的麦克风静静立着，像一个等了太久也没有开口的人。\n\n他又梦见了那艘船。\n\n梦里的风很大，有人站在甲板上唱歌。他已经记不起那个人的脸，只剩下最后一个音，像雨落在舷窗上。`
}
const directories = new Map<string, Map<string, string>>()
for (const path of Object.keys(files)) {
    const parts = path.split('/')
    for (let index = 0; index < parts.length; index++) {
        const parent = parts.slice(0, index).join('/')
        if (!directories.has(parent)) directories.set(parent, new Map())
        directories.get(parent)!.set(parts[index]!, index === parts.length - 1 ? 'file' : 'directory')
    }
}
const drafts: Record<string, string> = { a: '已有草稿与引用', b: '另一个会话的草稿' }
const referenceChips = { a: ['existing-reference'], b: [] }
const phases = { a: 'plain', b: 'plain' }
const calls: unknown[] = []
const statusFailures = new Set<string>()
const bindings = { a: { ctx: { id: 'a' } }, b: { ctx: { id: 'b' } } }
const ctx = {
    effect: (fn: () => void) => fn(),
    slots: { inject: (_name: string, fn: () => void) => fn(), register: (options: { id?: string }, component: React.ComponentType) => { if (options.id === 'writer-panel') Panel = component; return () => {} } },
    sessions: { binding: (id: 'a' | 'b') => bindings[id], list: { getSnapshot: () => ({ byId: {} }) } },
    remote: { commands: { execute: async (sessionId: string, line: string) => {
        if (!sessionId.startsWith('init-')) return { ok: true }
        if (statusFailures.has(sessionId)) return { ok: false, error: { message: '状态检查失败：连接已断开' } }
        calls.push(['command', sessionId, line])
        return post('/project-command', { sessionId, line })
    } }, workspaceFiles: {
        list: async (id: string, path: string) => id.startsWith('init-') ? post('/project-list', { sessionId: id, path }) : directories.has(path) ? { ok: true, value: { path, entries: [...directories.get(path)!].map(([name, type]) => ({ name, type })) } } : { ok: false },
        read: async (id: string, path: string, range: { offset?: number }) => {
            if (id.startsWith('init-')) return post('/project-read', { sessionId: id, path, offset: range.offset })
            let text = files[path]
            if (id === 'b' && path === 'novel/project.md') text = '---\ntitle: "第二本小说"\n---\n'
            if (text === undefined) return { ok: false }
            const lines = text.split('\n').slice((range.offset ?? 1) - 1)
            return { ok: true, value: { text: lines.join('\n'), lines: lines.length, eof: true } }
        },
        changes: async function* (_id: string, _path: string, signal: AbortSignal) { yield { kind: 'ready' }; await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }) }) },
    } },
    conversation: { input: {
        for: (actx: { id: 'a' | 'b' }) => ({ state: { getSnapshot: () => ({ phase: phases[actx.id] }) } }),
        requestDraftInitialization: (binding: { ctx: { id: 'a' | 'b' } }, options: { prompt: string; whenDraftExists: string }) => { calls.push(['append', binding.ctx.id, options]); drafts[binding.ctx.id] += '\n\n' + options.prompt; return 'applied' },
    } },
}
let Panel: React.ComponentType<any>
let hostShell: any
let shellProps: any
let currentView = 'writer-panel'
const shellMode = new URLSearchParams(location.search).has('shell')
let client: { apply(ctx: unknown): void }
let currentSession = new URLSearchParams(location.search).has('init') ? 'init-empty' : 'a'
drafts[currentSession] ??= '初始化前已有草稿'
async function post(path: string, args: unknown) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) }).then(response => response.json())
}
const root = createRoot(document.getElementById('root')!)
function render() {
    root.render(shellMode ? React.createElement(NativeShell) : React.createElement(Panel, { sessionId: currentSession, inputActions: { persistDraft: () => calls.push(['persist', currentSession]) }, openView: (view: string) => calls.push(['view', currentSession, view]) }))
}
function NativeSessionView() {
    return shellProps.renderSlot('conversation.session')
}
function NativeShell() {
    const session = { id: currentSession, blank: false }
    const owner = {
        sessionId: currentSession,
        inputActions: { persistDraft: () => calls.push(['persist', currentSession]) },
        openView: (view: string) => { calls.push(['view', currentSession, view]); currentView = view; render() },
    }
    const props: any = {
        ...owner, variant: 'main', phase: 'active', hero: false,
        useSession: (select: any) => select(session),
        useSessions: (select: any) => select({ byId: { [currentSession]: { cwd: '/novel' } } }),
        useSessionStatus: (select: any) => select(new Map()),
        useWorkspaces: (select: any) => select({ phase: 'ready', items: [{ workspaceId: 'w', title: '小说', sessionIds: [currentSession] }] }),
        useInput: (select: any) => select({ phase: 'plain', draft: drafts[currentSession] }),
        useComposerBlock: (select: any) => select(undefined),
        useFactorySlot: (name: string, fallback: any) => name === 'views' ? NativeSessionView : fallback,
        useConversation: (select: any) => select({}),
        useConversationViews: (select: any) => select([{ id: 'chat', label: '对话' }, { id: 'writer-panel', label: '写作面板' }]),
        useInspectCall: (select: any) => select(undefined),
        useStore: (select: any) => select({ view: currentView, viewRequest: null }),
        actions: { setDraft: () => {}, completeViewRequest: () => {} },
        bindDraftPersistence: () => () => {},
        selectWorkspace: async () => {},
        t: (key: string) => key,
    }
    props.renderSlot = (name: string, slotOwner: any = {}, options: any = {}) => {
        let child = null
        if (name === 'conversation.session') child = React.createElement(hostShell.DefaultConversationViews, props)
        if (name === 'conversation.view') child = options.only === 'writer-panel' ? React.createElement(Panel, { ...owner, ...slotOwner }) : React.createElement('div', { 'data-chat-view': '' }, '宿主对话内容')
        if (name === 'conversation.input.dock') child = React.createElement('div', { 'data-native-todos': '' }, '宿主任务列表')
        if (name === 'conversation.composer.bar') child = React.createElement('textarea', { 'data-native-input': '', value: drafts[currentSession], onChange: (event: any) => { drafts[currentSession] = event.target.value; render() } })
        if (name === 'conversation.hero.frame') child = options.children
        return React.createElement('div', { 'data-slot': name, style: { display: 'contents' } }, child)
    }
    props.renderSlotChain = (_name: string, _owner: any, options: any) => React.createElement('div', { 'data-slot': 'conversation.composer', style: { display: 'contents' } }, options.fallback)
    shellProps = props
    return React.createElement('div', { className: hostShell.css.root, 'data-phase': 'active' }, React.createElement('div', { style: { display: 'flex', gap: 12, padding: 8 } }, ...['chat', 'writer-panel'].map(view => React.createElement('button', { key: view, type: 'button', 'data-shell-view': view, onClick: () => { currentView = view; render() } }, view === 'chat' ? '对话' : '写作面板'))), React.createElement(hostShell.ConversationContent, props))
}
const modules: Record<string, unknown> = { ...hostModules, react: React, 'react/jsx-runtime': jsxRuntime, 'react-dom': ReactDOM, 'react-dom/client': { createRoot }, '@deepseek-ai/dsh-client-ui-primitives': primitives }
;(window as any).__ModuleLoader__ = { load: (module: { factory(require: (name: string) => unknown): typeof client }) => { const exported = module.factory(name => { if (!(name in modules)) throw new Error(`missing module ${name}`); return modules[name] }); if ((module as any).id === '@deepseek-ai/dsh-client-ui-conversation') { hostShell = (exported as any).__writerShellFixture } else { client = exported; client.apply(ctx); render() } } }
;(window as any).writerFixture = { drafts, calls, referenceChips, phases, failStatus(sessionId: string) { statusFailures.add(sessionId) }, switchSession(id: string) { currentSession = id; drafts[id] ??= '初始化前已有草稿'; render() }, addFile(sessionId: string) { return post('/project-add-file', { sessionId }) }, readFile(sessionId: string, path: string) { return post('/project-read', { sessionId, path }) } }
const script = document.createElement('script')
script.src = shellMode ? '/conversation-fixture.js' : '/writer.js'
script.onload = () => { if (shellMode) { const writer = document.createElement('script'); writer.src = '/writer.js'; document.head.append(writer) } }
document.head.append(script)
