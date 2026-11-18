import { lstat, mkdir, readdir, realpath, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { serializeEntity } from 'dsh-writer-domain'
import type { WorkspaceProjectState } from 'dsh-writer-core'

function samePath(a: string, b: string): boolean {
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

async function canonical(path: string): Promise<string> {
    try {
        return await realpath(path)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        const absolute = resolve(path)
        const parent = dirname(absolute)
        return parent === absolute ? absolute : join(await canonical(parent), basename(absolute))
    }
}

export async function inspectProject(workspaceRoot: string, projectRoot: string): Promise<WorkspaceProjectState> {
    const workspace = await realpath(workspaceRoot)
    const entries = await readdir(workspace, { withFileTypes: true })
    const names = entries.map(entry => entry.name).sort()
    const root = await canonical(projectRoot)
    const novel = await canonical(join(workspace, 'novel'))
    const state: WorkspaceProjectState = { status: 'blocked', workspaceRoot: workspace, projectRoot: root, scanRoot: samePath(root, workspace) ? '.' : 'novel', entries: names.slice(0, 12) }
    if (!samePath(root, novel) && !samePath(root, workspace)) {
        return { ...state, status: 'mismatch', message: '写作服务的项目目录与当前会话不一致。请打开对应工作目录，或将 writer-store 的 projectRoot 配置为当前目录的 novel/；使用默认配置可自动跟随会话。' }
    }
    const candidate = samePath(root, workspace) ? workspace : join(workspace, 'novel')
    let projectEntries: typeof entries = []
    try {
        const info = await lstat(candidate)
        if (info.isSymbolicLink() || !info.isDirectory()) return { ...state, message: '项目位置被文件或符号链接占用，请打开正确的小说工作目录。' }
        projectEntries = await readdir(candidate, { withFileTypes: true })
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (projectEntries.some(entry => entry.name === '.initializing')) return { ...state, message: '上次初始化未完成。请先检查 novel/ 中已创建的内容，保留需要的文件，再在空工作目录重新初始化。' }
    const files = new Set(projectEntries.filter(entry => entry.isFile()).map(entry => entry.name))
    const directories = new Set(projectEntries.filter(entry => entry.isDirectory()).map(entry => entry.name))
    const strong = ['project.md', 'principles.md', 'outline.md', 'ideas.md', 'events.md'].some(name => files.has(name))
    const weak = ['chapters', 'characters', 'plots', 'worldbuilding'].filter(name => directories.has(name)).length
    if (strong || weak >= (state.scanRoot === 'novel' ? 1 : 2)) return { ...state, status: 'ready' }
    if (names.length === 0 && state.scanRoot === 'novel') return { ...state, status: 'empty' }
    return { ...state, message: '当前工作目录非空，且没有可识别的小说项目。请新建一个空工作目录后使用写作模式，或打开已有 novel/ 的上一级工作目录。已有文件不会被修改。' }
}

export async function initializeProject(workspaceRoot: string, projectRoot: string, signal?: AbortSignal): Promise<WorkspaceProjectState> {
    const state = await inspectProject(workspaceRoot, projectRoot)
    if (state.status !== 'empty') throw new Error(state.message ?? '目录已有小说项目，不能重复初始化。')
    signal?.throwIfAborted()
    const root = join(state.workspaceRoot, 'novel')
    await mkdir(root)
    try {
        await writeFile(join(root, '.initializing'), '初始化进行中；未完成时请保留并检查已有文件。\n', { flag: 'wx' })
        const checkWorkspace = async () => {
            if ((await readdir(state.workspaceRoot)).some(name => name !== 'novel')) throw new Error('工作目录已变为非空，已停止初始化')
        }
        await checkWorkspace()
        for (const directory of ['chapters', 'characters', 'plots', 'worldbuilding', 'style', 'exports', '.writer']) {
            signal?.throwIfAborted()
            await mkdir(join(root, directory))
        }
        const now = new Date()
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        const document = (title: string, instruction: string) => `# ${title}\n\n> **任务来源**: 用户在写作面板点击“一键初始化”。\n> **任务内容**: 为新作品准备${title}的基础资料。\n> **参考文档**: 无（新建作品，尚未提供参考资料）。\n> **生成日期**: ${date}\n\n${instruction}\n`
        const documents: Record<string, string> = {
            'principles.md': document('创作准则', '请与助手讨论叙事视角、语言风格和创作边界，再补充本文件。'),
            'outline.md': document('大纲', '请先确定故事梗概与主要冲突，再规划章节。'),
            'events.md': document('重要事件', '在此记录已经确认、后续章节需要遵守的事实。'),
            'ideas.md': document('灵感', '在此保留你的原始想法，与助手讨论后再整理进大纲。'),
            'pending.md': document('待确认', '章节保存后的维护建议将在此追加，确认后再归档。'),
            'pending-archive.md': document('待确认历史归档', '已处理的建议保留在这里，作为创作记录。'),
            '.gitignore': '.writer/\nexports/\n',
            'project.md': serializeEntity({ title: '未命名作品' }, document('作品简介', '请先与助手确定书名、题材和故事方向，再完善作品信息。')),
        }
        for (const [name, content] of Object.entries(documents)) {
            signal?.throwIfAborted()
            await writeFile(join(root, name), content, { flag: 'wx' })
        }
        await checkWorkspace()
        await unlink(join(root, '.initializing'))
    } catch (error) {
        throw new Error(`初始化未完成：${error instanceof Error ? error.message : String(error)}。已创建的文件保留在 ${root}，请检查后在空目录重试。`)
    }
    return inspectProject(state.workspaceRoot, projectRoot)
}
