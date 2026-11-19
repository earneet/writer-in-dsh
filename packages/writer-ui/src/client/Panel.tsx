import { useEffect, useRef, useState } from 'react'
import {
    Button, Tag, TextShimmer,
    IconEditOutlineRegular, IconListPenOutlineRegular, IconUsersOutlineRegular,
    IconBranchOutlineRegular, IconFolderOpenOutlineRegular,
    IconChecklistOutlineRegular, IconDataOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChapterRow } from './types.ts'
import { useProject } from './useProject.ts'
import { ProjectWelcome } from './ProjectWelcome.tsx'
import { appendRequest, startupRequest, type ActionOwner } from './actions.ts'
import { adjacentChapter } from './navigation.ts'
import { ChapterDirectory, Dialog } from './ChapterDirectory.tsx'
import { studioStyles } from './studio-style.ts'
import { CharactersPage, LibraryPage, Markdown, OutlinePage, OverviewPage, PendingPage, PlotsPage, sectionText, type StudioPage } from './StudioPages.tsx'

export interface WriterPanelProps extends ActionOwner {
    sessionId?: string
}

interface ViewMemory {
    page: StudioPage
    chapter: string
    scroll: Record<string, number>
}

const memories = new Map<string, ViewMemory>()
const pages: { id: StudioPage; label: string; icon: React.ReactNode }[] = [
    { id: 'manuscript', label: '稿件', icon: <IconEditOutlineRegular /> },
    { id: 'outline', label: '大纲', icon: <IconListPenOutlineRegular /> },
    { id: 'characters', label: '人物', icon: <IconUsersOutlineRegular /> },
    { id: 'plots', label: '伏笔', icon: <IconBranchOutlineRegular /> },
    { id: 'library', label: '资料', icon: <IconFolderOpenOutlineRegular /> },
    { id: 'pending', label: '待确认', icon: <IconChecklistOutlineRegular /> },
    { id: 'overview', label: '全书概况', icon: <IconDataOutlineRegular /> },
]

function Workspace(props: WriterPanelProps) {
    const sessionId = props.sessionId ?? ''
    const { bus, loading, error, progress, refresh, project, initializing, initialize } = useProject(sessionId)
    const [page, setPage] = useState<StudioPage>(memories.get(sessionId)?.page ?? 'manuscript')
    const [selected, setSelected] = useState(memories.get(sessionId)?.chapter ?? '')
    const scroll = useRef(memories.get(sessionId)?.scroll ?? {})
    const [directory, setDirectory] = useState(false)
    const [context, setContext] = useState(false)
    const [request, setRequest] = useState<string | null>(null)
    const [message, setMessage] = useState('')
    const reader = useRef<HTMLElement>(null)
    const overview = bus.scan?.overview ?? null
    const chapters = overview?.chapterRows ?? []
    const current = chapters.find(row => row.path === selected) ?? chapters[chapters.length - 1] ?? null
    const graph = bus.scan?.graph
    const previous = current ? adjacentChapter(chapters, current.path, -1) : null
    const next = current ? adjacentChapter(chapters, current.path, 1) : null
    const writable = current !== null && /^\d{3}$/.test(current.id) && current.path === `chapters/${current.id}.md`
    const outline = current?.number !== null && current?.number !== undefined ? graph?.indexes.outlineByChapterNumber.get(current.number) : undefined
    const linkedPlots = current?.number !== null && current?.number !== undefined ? overview?.plotRows.filter(row => [row.plannedChapter, row.resolveChapter, row.plantedChapter, row.resolvedChapter].some(anchor => !!anchor && Number(anchor) === current.number)) ?? [] : []

    useEffect(() => {
        if (current && !selected) setSelected(current.path)
    }, [current?.path, selected])
    useEffect(() => {
        memories.set(sessionId, { page, chapter: current?.path ?? selected, scroll: scroll.current })
        if (memories.size > 30) memories.delete(memories.keys().next().value!)
    }, [sessionId, page, current?.path, selected])
    useEffect(() => {
        if (reader.current && current && page === 'manuscript') reader.current.scrollTop = scroll.current[current.path] ?? 0
    }, [page, current?.path])

    function choose(chapter: ChapterRow) {
        setSelected(chapter.path)
        setPage('manuscript')
        setMessage('')
    }
    function jump(number: number) {
        const chapter = chapters.find(row => row.number === number)
        if (chapter) choose(chapter)
        else setMessage(`第 ${number} 章暂无正文，原始章锚已保留。`)
    }
    function ask(text: string) { setMessage(''); setRequest(text) }
    function chapterRequest(mode: 'assist' | 'review' | 'rewrite') {
        if (!current) return
        const intent = mode === 'assist' ? '续写本章（assist），承接现有结尾，不复述已写内容' : mode === 'review' ? '审阅本章，从情节、人物、设定与阅读体验提出带原文引用和改法的建议，先不要修改' : '按我的要求修改本章，优先局部补丁，保留无关段落'
        ask(`请先读取 chapter/${current.id}《${current.title}》、本章大纲和创作准则，再${intent}。${mode === 'rewrite' ? '\n\n我的修改要求：\n' : ''}${mode === 'review' ? '' : '\n保存后先审稿，再核对章后维护建议。'}`)
    }

    return <div className="writer-studio" data-conversation-composer-overlay="">
        <style>{studioStyles}</style>
        <header className="ws-top"><span className="ws-book">{overview?.title ?? '写作工作台'}</span><span className="ws-muted">/ 写作工作台</span><div className="ws-top-status">{loading ? <TextShimmer active>读取中 {progress}</TextShimmer> : <span>{bus.scan?.watched === true ? '文件监听已连接' : '可手动刷新'}</span>}<Button variant="toolbar" size="sm" disabled={loading} onClick={refresh} aria-label="刷新小说项目">刷新</Button></div></header>
        {error && <div className="ws-alert" role="alert">{error}{overview ? '（保留本项目上次成功读取的内容）' : ''}</div>}
        {bus.scan && (bus.scan.failedFiles.length > 0 || bus.scan.warnings.length > 0) && <details className="ws-alert"><summary>读取或资料提示 · {bus.scan.failedFiles.length + bus.scan.warnings.length} 项</summary>{bus.scan.failedFiles.map(path => <p key={path}>读取失败：{path}</p>)}{bus.scan.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}
        {!overview ? <ProjectWelcome project={project} loading={loading} initializing={initializing} error={error} initialize={initialize} refresh={refresh} /> : <div className="ws-layout">
            <aside className="ws-nav"><nav className="ws-nav-list" aria-label="写作工作台导航">{pages.map(item => <button type="button" className="ws-button" key={item.id} aria-pressed={page === item.id} onClick={() => { setPage(item.id); setContext(false) }} aria-controls={`writer-view-${item.id}`}>{item.icon}{item.label}{item.id === 'pending' && !!overview?.pendingLineTotal && <span className="ws-count">{overview.pendingLineTotal}</span>}{item.id === 'plots' && !!overview?.riskSummary.red && <span className="ws-count">{overview.riskSummary.red}</span>}</button>)}</nav><div className="ws-nav-note">{overview ? `${overview.chapters} 章 · 正文约 ${overview.totalChars.toLocaleString()} 字` : '为长篇创作留出空间'}<br />章节目录在稿件顶部按需打开。</div></aside>
            <main className="ws-main">
                    <section className="ws-view" hidden={page !== 'manuscript'} id="writer-view-manuscript" aria-label="稿件">
                        <div className="ws-toolbar"><div className="ws-actions"><button type="button" className="ws-button ws-outline" disabled={!chapters.length} aria-expanded={directory} onClick={() => setDirectory(true)}>章节目录 · {current?.id ?? '—'} / {chapters.length}</button><Tag tone="neutral">阅读</Tag></div><div className="ws-actions"><button type="button" className="ws-button ws-context-toggle" aria-expanded={context} onClick={() => setContext(value => !value)}>本章资料</button><Button disabled={!writable} onClick={() => chapterRequest('review')}>审阅本章</Button><Button disabled={!writable} onClick={() => chapterRequest('assist')}>续写本章</Button></div></div>
                        {!current ? <div className="ws-empty"><p>{overview.nextStep.hint}</p><div className="ws-actions" style={{ justifyContent: 'center', marginTop: 16 }}><Button onClick={() => setPage('outline')}>查看大纲</Button>{overview.nextStep.kind === 'outline' ? <Button onClick={() => ask(startupRequest)}>和助手确定故事方向</Button> : <Button onClick={() => ask('请先读取 project/project、大纲与创作准则，核对第一章计划，再准备章节写作。完成后先审稿，并说明需要确认的章后维护建议。')}>准备第一章要求</Button>}</div></div> : <div className="ws-reader-grid"><article ref={reader} className="ws-reader" onScroll={event => { scroll.current[current.path] = event.currentTarget.scrollTop }}><div className="ws-eyebrow">CHAPTER {current.number === null ? current.id : String(current.number).padStart(3, '0')}</div><h1 className="ws-chapter-title">{current.title}</h1><div className="ws-meta"><span>{current.volume || '正文'}</span><span>约 {current.chars.toLocaleString()} 字</span>{current.status && <span>{current.status}</span>}{current.storyline && <span>{current.storyline}</span>}</div>{!writable && <div className="ws-note ws-muted">此章节路径目前仅支持面板阅读，写作工具只支持 chapters/三位章号.md。请先在对话中核对文件布局。</div>}<Markdown text={current.content} prose /><div className="ws-reader-footer"><div className="ws-actions"><button type="button" className="ws-button" disabled={!previous} onClick={() => previous && choose(previous)}>← 上一章</button><button type="button" className="ws-button" disabled={!next} onClick={() => next && choose(next)}>下一章 →</button></div><Button disabled={!writable} onClick={() => chapterRequest('rewrite')}>提出修改</Button></div></article><aside className={`ws-context${context ? ' is-open' : ''}`} aria-label="本章资料"><button type="button" className="ws-button ws-context-toggle" onClick={() => setContext(false)}>关闭资料</button><section className="ws-context-section"><h3>本章大纲</h3>{outline ? <Markdown text={outline.body} /> : <p>没有匹配本章的大纲小节。</p>}<button type="button" className="ws-button" onClick={() => setPage('outline')}>查看大纲 →</button></section><section className="ws-context-section"><h3>关联伏笔 · {linkedPlots.length}</h3>{linkedPlots.map(plot => <p key={plot.id}>{plot.hint} · {plot.status === 'planned' ? '计划埋设' : '留意回收或推进'}</p>)}<button type="button" className="ws-button" onClick={() => setPage('plots')}>查看伏笔 →</button></section><section className="ws-context-section"><h3>创作准则</h3>{overview.principles ? <Markdown text={sectionText(overview.principles)} /> : <p>尚未找到创作准则。</p>}<button type="button" className="ws-button" onClick={() => setPage('library')}>查阅全部资料 →</button></section><section className="ws-context-section"><h3>章后建议</h3><p>全书有 {overview.pendingLineTotal} 条建议待核对。</p><button type="button" className="ws-button" onClick={() => setPage('pending')}>查看待确认 →</button><button type="button" className="ws-button" onClick={() => setPage('characters')}>查阅人物 →</button></section></aside></div>}
                    </section>
                    <section className="ws-view" hidden={page !== 'outline'} id="writer-view-outline" aria-label="大纲"><OutlinePage overview={overview} ask={ask} choose={choose} /></section>
                    <section className="ws-view" hidden={page !== 'characters'} id="writer-view-characters" aria-label="人物"><CharactersPage overview={overview} ask={ask} jump={jump} /></section>
                    <section className="ws-view" hidden={page !== 'plots'} id="writer-view-plots" aria-label="伏笔"><PlotsPage overview={overview} chapter={current} ask={ask} jump={jump} /></section>
                    <section className="ws-view" hidden={page !== 'library'} id="writer-view-library" aria-label="资料"><LibraryPage overview={overview} ask={ask} /></section>
                    <section className="ws-view" hidden={page !== 'pending'} id="writer-view-pending" aria-label="待确认"><PendingPage overview={overview} ask={ask} /></section>
                    <section className="ws-view" hidden={page !== 'overview'} id="writer-view-overview" aria-label="全书概况"><OverviewPage overview={overview} live={bus.live} ask={ask} navigate={setPage} choose={choose} /></section>
            </main>
        </div>}
        {message && <div className="ws-alert" role="status">{message}</div>}
        {directory && <ChapterDirectory chapters={chapters} current={current?.path ?? ''} choose={choose} close={() => setDirectory(false)} />}
        {request !== null && <Dialog title="交给助手的要求" close={() => setRequest(null)} wide><p className="ws-muted">追加到当前会话草稿，保留已有文字与引用，再由你发送。</p><label className="ws-field">可以补充要求<textarea className="ws-input ws-request-text" value={request} onChange={event => setRequest(event.target.value)} /></label><div className="ws-dialog-footer"><button type="button" className="ws-button ws-outline" onClick={() => { void navigator.clipboard?.writeText(request).then(() => setMessage('要求已复制。')).catch(() => setMessage('复制不可用，请手动选择上方文字复制。')) }}>复制要求</button><Button disabled={!request.trim()} onClick={() => { const result = appendRequest(sessionId, request, props); setMessage(result.message); if (result.status === 'applied') setRequest(null) }}>添加到对话草稿</Button></div>{message && <p role="status" className="ws-muted" style={{ marginTop: 12 }}>{message}</p>}</Dialog>}
    </div>
}

export function WriterPanel(props: WriterPanelProps) {
    return <Workspace key={props.sessionId ?? ''} {...props} />
}
