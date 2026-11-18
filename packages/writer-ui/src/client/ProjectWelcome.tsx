import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceProjectState } from 'dsh-writer-core'

export function ProjectWelcome({ project, loading, initializing, error, initialize, refresh }: {
    project: WorkspaceProjectState | null
    loading: boolean
    initializing: boolean
    error: string | null
    initialize: () => Promise<void>
    refresh: () => void
}) {
    const empty = project?.status === 'empty'
    const title = loading ? '正在检查工作目录…' : empty ? '从这里开始你的新作品' : project?.status === 'mismatch' ? '项目目录与当前会话不一致' : project?.status === 'blocked' ? '这个目录还不能作为小说项目打开' : '请先准备写作工作目录'
    return <main className="ws-welcome" aria-busy={loading || initializing}>
        <div className="ws-eyebrow">写作工作台 · 项目准备</div>
        <h1>{title}</h1>
        {!loading && <>
            <p className="ws-welcome-lead">{empty ? '当前工作目录为空。初始化后，就可以与助手一起完善作品信息、创作准则和故事大纲。' : project?.message ?? error ?? '请选择一个工作目录，并在其中新建“写作模式”会话。'}</p>
            {project && <dl className="ws-welcome-paths"><dt>当前工作目录</dt><dd>{project.workspaceRoot}</dd><dt>小说项目位置</dt><dd>{project.projectRoot}</dd></dl>}
            {empty ? <>
                <section className="ws-welcome-preview" aria-label="初始化将创建的内容"><h2>为你的作品准备好这些位置</h2><div><p><strong>作品与规划</strong><br />作品信息、创作准则、大纲、重要事件与灵感</p><p><strong>稿件与资料</strong><br />章节、人物、伏笔、世界观与文风参考目录</p><p><strong>后续整理</strong><br />待确认建议、历史归档、派生缓存与导出目录</p></div><p className="ws-muted">所有内容收在 novel/ 中，只生成基础填写指引。无需调用模型。</p></section>
                <div className="ws-actions"><Button variant="primary" disabled={initializing} onClick={() => { void initialize() }}>{initializing ? '正在初始化…' : '一键初始化'}</Button><Button variant="outline" disabled={initializing} onClick={refresh}>重新检查</Button></div>
            </> : <>
                {!!project?.entries.length && <p className="ws-note">当前目录内容：{project.entries.join('、')}（最多列出 12 项，隐藏文件也计入非空判断）</p>}
                <ol className="ws-welcome-steps"><li>新作品：在宿主中新建或打开一个空工作目录，再新建“写作模式”会话。</li><li>已有作品：打开包含 novel/ 的上一级目录；平铺布局需让 projectRoot 指向实际项目。</li><li>目录或配置修正后，点击“重新检查”。</li></ol>
                <Button onClick={refresh}>重新检查</Button>
            </>}
        </>}
    </main>
}
