import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceProjectState } from 'dsh-writer-core'
import { appendRequest, startupRequest } from './actions.ts'
import { useProject } from './useProject.ts'

type HeroSessionRow = { cwd?: string; projectionValues?: { agentPreset?: string } }

export function ProjectHero({ sessionId, useSessions }: {
    sessionId: string
    useSessions: <T>(select: (sessions: { byId: Record<string, HeroSessionRow | undefined> }) => T) => T
}) {
    const identity = useSessions(sessions => {
        const session = sessions.byId[sessionId]
        return JSON.stringify([sessionId, session?.cwd, session?.projectionValues?.agentPreset])
    })
    return <ProjectHeroAction key={identity} sessionId={sessionId} />
}

function ProjectHeroAction({ sessionId }: { sessionId: string }) {
    const { project, loading, initializing, didInitialize, error, initialize, refresh } = useProject(sessionId, false)
    const [draftResult, setDraftResult] = useState<ReturnType<typeof appendRequest>>()
    if (loading || (!project && !error)) return null
    if (project?.status === 'ready') return <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <span role="status" title="发送第一条消息后可从写作面板打开项目。">项目已就绪</span>
        {didInitialize && <Button size="sm" variant="primary" disabled={draftResult?.status === 'applied'} onClick={() => setDraftResult(appendRequest(sessionId, startupRequest, {}))}>和助手确定故事方向</Button>}
        {draftResult && <span role="status">{draftResult.message}</span>}
    </div>

    const retry = project?.status === 'incomplete'
    const canInitialize = project?.status === 'empty' || retry
    return <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {canInitialize && <Button size="sm" variant="primary" disabled={initializing} onClick={() => { void initialize() }}>
            {initializing ? '正在初始化…' : retry ? '重试初始化' : '一键初始化'}
        </Button>}
        {(project?.status !== 'empty' || error) && <details style={{ position: 'relative' }}>
            <summary style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>目录指引</summary>
            <div style={{
                position: 'absolute', insetInlineEnd: 0, zIndex: 2, boxSizing: 'border-box',
                width: 'min(20rem, calc(100vw - 32px))', padding: 12, overflowWrap: 'anywhere',
                border: '1px solid var(--dsw-alias-border-l3)', borderRadius: 8,
                background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)',
            }}>
                <p role={error ? 'alert' : undefined}>{error ?? project?.message}</p>
                <Button size="sm" disabled={initializing} onClick={refresh}>重新检查</Button>
            </div>
        </details>}
    </div>
}

export function ProjectWelcome({ project, loading, initializing, error, initialize, refresh }: {
    project: WorkspaceProjectState | null
    loading: boolean
    initializing: boolean
    error: string | null
    initialize: () => Promise<void>
    refresh: () => void
}) {
    const empty = project?.status === 'empty'
    const retry = project?.status === 'incomplete'
    const title = loading ? '正在检查工作目录…' : empty ? '从这里开始你的新作品' : retry ? '继续初始化小说项目' : project?.status === 'mismatch' ? '项目目录与当前会话不一致' : project?.status === 'blocked' ? '这个目录还不能作为小说项目打开' : '请先准备写作工作目录'
    return <main className="ws-welcome" aria-busy={loading || initializing}>
        <div className="ws-eyebrow">写作工作台 · 项目准备</div>
        <h1>{title}</h1>
        {!loading && <>
            <p className="ws-welcome-lead">{empty ? '当前目录可以创建新作品。初始化后，就可以与助手一起完善作品信息、创作准则和故事大纲。' : project?.message ?? error ?? '请选择一个工作目录，并在其中新建“写作模式”会话。'}</p>
            {project && <dl className="ws-welcome-paths"><dt>当前工作目录</dt><dd>{project.workspaceRoot}</dd><dt>小说项目位置</dt><dd>{project.projectRoot}</dd></dl>}
            {empty || retry ? <>
                {empty && <section className="ws-welcome-preview" aria-label="初始化将创建的内容"><h2>为你的作品准备好这些位置</h2><div><p><strong>作品与规划</strong><br />作品信息、创作准则、大纲、重要事件与灵感</p><p><strong>稿件与资料</strong><br />章节、人物、伏笔、世界观与文风参考目录</p><p><strong>后续整理</strong><br />待确认建议、历史归档、派生缓存与导出目录</p></div><p className="ws-muted">所有内容收在 novel/ 中，只生成基础填写指引。无需调用模型。</p></section>}
                <div className="ws-actions"><Button variant="primary" disabled={initializing} onClick={() => { void initialize() }}>{initializing ? '正在初始化…' : retry ? '重试初始化' : '一键初始化'}</Button><Button variant="outline" disabled={initializing} onClick={refresh}>重新检查</Button></div>
            </> : <>
                {!!project?.entries.length && <p className="ws-note">当前目录内容：{project.entries.join('、')}（最多列出 12 项）</p>}
                <ol className="ws-welcome-steps"><li>新作品：在宿主中新建或打开一个空工作目录，再新建“写作模式”会话。</li><li>已有作品：打开包含 novel/ 的上一级目录；平铺布局需让 projectRoot 指向实际项目。</li><li>目录或配置修正后，点击“重新检查”。</li></ol>
                <Button onClick={refresh}>重新检查</Button>
            </>}
        </>}
    </main>
}
