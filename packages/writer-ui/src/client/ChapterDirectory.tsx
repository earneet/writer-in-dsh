import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ChapterRow } from './types.ts'
import { chapterGroups, directoryPage } from './navigation.ts'

export function Dialog({ title, close, children, wide = false }: { title: string; close: () => void; children: ReactNode; wide?: boolean }) {
    const ref = useRef<HTMLElement>(null)
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null
        const initial = ref.current?.querySelector<HTMLElement>('input:not(:disabled), textarea') ?? ref.current?.querySelector<HTMLElement>('button')
        initial?.focus()
        return () => { if (previous?.isConnected) previous.focus() }
    }, [])
    return <div className="ws-overlay" onClick={event => { if (event.target === event.currentTarget) close() }}>
        <section ref={ref} className={`ws-dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onKeyDown={event => {
            if (event.key === 'Escape') { event.stopPropagation(); close() }
            if (event.key !== 'Tab') return
            const elements = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea,select:not(:disabled),a[href]') ?? [])]
            const first = elements[0], last = elements[elements.length - 1]
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }}>
            <div className="ws-dialog-head"><h2>{title}</h2><button className="ws-button" type="button" onClick={close} aria-label={`关闭${title}`}>关闭</button></div>
            {children}
        </section>
    </div>
}

export function ChapterDirectory({ chapters, current, choose, close }: { chapters: ChapterRow[]; current: string; choose: (chapter: ChapterRow) => void; close: () => void }) {
    const groups = chapterGroups(chapters)
    const located = groups.find(group => group.chapters.some(row => row.path === current)) ?? groups[0]
    const [group, setGroup] = useState(located?.id ?? '')
    const [query, setQuery] = useState('')
    const [page, setPage] = useState(Math.floor(Math.max(0, located?.chapters.findIndex(row => row.path === current) ?? 0) / 8))
    const result = directoryPage(chapters, group, query, page)
    return <Dialog title="章节目录" close={close}>
        <p className="ws-muted">{chapters.length} 章 · {groups.length} 个卷或分组</p>
        <label className="ws-field">全书查找：章号或标题<input className="ws-input" type="search" placeholder="例如 128、夜航" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && result.total === 1) { event.preventDefault(); choose(result.items[0]!); close() } }} /></label>
        <div className="ws-actions"><select className="ws-input" aria-label="按卷或分组浏览" style={{ flex: 1 }} disabled={!!query.trim()} value={group} onChange={event => { setGroup(event.target.value); setPage(0) }}>{groups.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select><button type="button" className="ws-button ws-outline" onClick={() => { setQuery(''); setGroup(located?.id ?? ''); setPage(Math.floor(Math.max(0, located?.chapters.findIndex(row => row.path === current) ?? 0) / 8)) }}>定位当前章</button></div>
        <div className="ws-directory-list" aria-label="章节列表">{result.items.map(row => <button type="button" className="ws-button" key={row.path} aria-pressed={row.path === current} onClick={() => { choose(row); close() }}><span className="ws-number">{row.number === null ? row.id : String(row.number).padStart(3, '0')}</span><span>{row.title}</span></button>)}{result.total === 0 && <p className="ws-muted">没有匹配章节，试试其他章号或标题。</p>}</div>
        <div className="ws-dialog-footer"><span className="ws-muted" aria-live="polite">{query.trim() ? '全书匹配' : '本组'} {result.total} 章 · {result.page + 1}/{result.pages} 页</span><div className="ws-actions"><button type="button" className="ws-button ws-outline" disabled={result.page === 0} onClick={() => setPage(result.page - 1)}>上一页</button><button type="button" className="ws-button ws-outline" disabled={result.page >= result.pages - 1} onClick={() => setPage(result.page + 1)}>下一页</button></div></div>
    </Dialog>
}
