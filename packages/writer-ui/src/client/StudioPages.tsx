import { useState } from 'react'
import { Button, MarkdownText, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CharacterRow, ChapterRow, NovelOverview, OutlineTreeNode, SectionEntry } from './types.ts'
import type { WriterLiveState } from './bus.ts'

export type StudioPage = 'manuscript' | 'outline' | 'characters' | 'plots' | 'library' | 'pending' | 'overview'
export type PrepareRequest = (text: string) => void

const labels = { code: { copyLabel: '复制', copiedLabel: '已复制', toolbarLabels: { codeLabel: '代码', wrapLabel: '自动换行', unwrapLabel: '不换行' } }, footnotes: '脚注' } as const
export const sectionText = (sections: SectionEntry[] | null) => (sections ?? []).map(section => `## ${section.title}\n\n${section.body}`).join('\n\n')

export function Markdown({ text, prose = false }: { text: string; prose?: boolean }) {
    return <div className={prose ? 'ws-prose ws-markdown' : 'ws-markdown'}><MarkdownText text={text} labels={labels} /></div>
}

export function Heading({ title, hint, children }: { title: string; hint: string; children?: React.ReactNode }) {
    return <div className="ws-heading"><div><h2>{title}</h2><p>{hint}</p></div>{children}</div>
}

function Empty({ children }: { children: React.ReactNode }) {
    return <div className="ws-empty">{children}</div>
}

export function OutlinePage({ overview: o, ask, choose }: { overview: NovelOverview; ask: PrepareRequest; choose: (chapter: ChapterRow) => void }) {
    const [selected, setSelected] = useState('')
    const nodes: { key: string; node: OutlineTreeNode; depth: number }[] = []
    const walk = (items: OutlineTreeNode[], prefix = '', depth = 0) => items.forEach((node, index) => { const key = `${prefix}/${index}`; nodes.push({ key, node, depth }); walk(node.children, key, depth + 1) })
    walk(o.outlineTree)
    const current = nodes.find(item => item.key === selected) ?? nodes[0]
    return <div className="ws-page"><Heading title="故事的骨架" hint="大纲服务结构，稿件呈现正文"><Button onClick={() => ask('请先读取当前大纲与创作准则，讨论结构调整，并说明对已写章节的影响。先给方案，不直接修改。')}>讨论大纲调整</Button></Heading>
        {!o.outline ? <Empty>还没有大纲。<button type="button" className="ws-button ws-link" onClick={() => ask('请先读取 project/project 和 principles/principles，与我规划小说大纲。')}>准备规划要求 →</button></Empty> : <>
            {o.outline.synopsis && <div className="ws-note">{o.outline.synopsis}</div>}
            <div className="ws-split"><nav className="ws-entity-list" aria-label="大纲小节">{nodes.map(item => <button type="button" className="ws-button" key={item.key} aria-pressed={item.key === current?.key} style={{ paddingLeft: 12 + Math.min(item.depth, 4) * 10 }} onClick={() => setSelected(item.key)}><span>{item.node.title}</span>{item.node.kind === 'chapter' && <span className="ws-muted">{item.node.written ? '已有正文' : '未写'}</span>}</button>)}</nav>
                <article className="ws-detail">{current ? <><h2>{current.node.title}</h2><Markdown text={current.node.body} />{current.node.written ? <Button onClick={() => choose(current.node.written!)}>阅读本章正文</Button> : current.node.chapterNumber !== null && <Button onClick={() => ask(`请读取第 ${String(current.node.chapterNumber).padStart(3, '0')} 章大纲“${current.node.title}”、创作准则及前文，准备整章写作。遵守人物状态与伏笔计划，保存后先审稿，再核对章后维护建议。`)}>准备写作要求</Button>}</> : <Markdown text={sectionText(o.outline.sections)} />}</article>
            </div>
            {o.unanchoredChapters.length > 0 && <details className="ws-archive"><summary>已写但未匹配大纲 · {o.unanchoredChapters.length} 章</summary>{o.unanchoredChapters.map(chapter => <button type="button" className="ws-button" key={chapter.path} onClick={() => choose(chapter)}>{chapter.id} · {chapter.title}</button>)}</details>}
        </>}
    </div>
}

function RelationMap({ person, people }: { person: CharacterRow; people: CharacterRow[] }) {
    const names = [...new Set([...person.relations, ...person.reverseRelations].map(edge => edge.name))]
    const matches = names.filter(name => people.some(row => row.name === name || row.id === name))
    if (matches.length > 11) return <p className="ws-muted">关联人物超过 11 位，使用下方关系列表查看完整网络。</p>
    if (!matches.length) return <p className="ws-muted">暂无可匹配档案的关系，原始关系仍保留在下方列表。</p>
    return <svg className="ws-graph" viewBox="0 0 420 300" role="img" aria-label={`${person.name}的人物关系图`}>
        {matches.map((name, index) => {
            const angle = index * Math.PI * 2 / matches.length
            const x = 210 + Math.cos(angle) * 140, y = 150 + Math.sin(angle) * 105
            return <g key={name}><line x1={210} y1={150} x2={x} y2={y} stroke="var(--writer-line)" /><circle cx={x} cy={y} r={8} fill="var(--writer-rail)" stroke="var(--writer-accent)" /><text x={x} y={y + 23} textAnchor="middle" fill="var(--writer-ink)" fontSize={12}>{name}</text></g>
        })}<circle cx={210} cy={150} r={12} fill="var(--writer-wash)" stroke="var(--writer-accent)" /><text x={210} y={178} textAnchor="middle" fill="var(--writer-ink)" fontSize={13}>{person.name}</text>
    </svg>
}

export function CharactersPage({ overview: o, ask, jump }: { overview: NovelOverview; ask: PrepareRequest; jump: (number: number) => void }) {
    const [query, setQuery] = useState('')
    const [selected, setSelected] = useState('')
    const [tab, setTab] = useState('profile')
    const rows = o.characterRows.filter(row => `${row.name} ${row.role}`.includes(query.trim()))
    const current = rows.find(row => row.id === selected) ?? rows[0]
    return <div className="ws-page"><Heading title="人物" hint="他们是谁，又在故事里变成了谁" />
        <label className="ws-field">查找人物<input className="ws-input" type="search" placeholder="姓名或角色" value={query} onChange={event => setQuery(event.target.value)} /></label>
        {!current ? <Empty>没有匹配的人物档案。</Empty> : <div className="ws-split"><nav className="ws-entity-list" aria-label="人物名册">{rows.map(row => <button type="button" className="ws-button" key={row.id} aria-pressed={row.id === current.id} onClick={() => setSelected(row.id)}><span>{row.name}</span><span className="ws-muted">{row.role || '人物档案'}</span></button>)}</nav><article className="ws-detail">
            <div className="ws-muted">{current.role}</div><h2>{current.name}</h2>
            <div className="ws-tabs" aria-label="人物详情">{[['profile', '档案'], ['relations', '关系'], ['timeline', '状态时间线']].map(([key, label]) => <button type="button" className="ws-button" key={key} aria-pressed={tab === key} onClick={() => setTab(key!)}>{label}</button>)}</div>
            {tab === 'profile' && <><Markdown text={sectionText(current.sections)} />{current.arc && <div className="ws-note"><h3>人物弧线</h3><p>{current.arc}</p></div>}</>}
            {tab === 'relations' && <><RelationMap person={current} people={o.characterRows} />{[['人物声明的关系', current.relations], ['他人指向的关系', current.reverseRelations]].map(([title, relations]) => <section key={String(title)}><h3>{String(title)}</h3>{(relations as CharacterRow['relations']).length === 0 ? <p className="ws-muted">暂无记录。</p> : (relations as CharacterRow['relations']).map((edge, index) => <div className="ws-suggestion" key={index}><button type="button" className="ws-button ws-link" disabled={!o.characterRows.some(person => person.name === edge.name || person.id === edge.name)} onClick={() => { setQuery(''); setSelected(o.characterRows.find(person => person.name === edge.name || person.id === edge.name)!.id) }}>{edge.name}</button><p>{edge.desc}</p>{!o.characterRows.some(person => person.name === edge.name || person.id === edge.name) && <span className="ws-muted">未匹配到人物档案，保留原始关系。</span>}</div>)}</section>)}</>}
            {tab === 'timeline' && <><p className="ws-muted">以下来自已确认的人物记录；维护建议仍在“待确认”中。</p><div className="ws-timeline">{current.timeline.slice().sort((a, b) => Number(a.chapter) - Number(b.chapter)).map((entry, index) => <div className="ws-timeline-item" key={index}><button type="button" className="ws-button ws-link" onClick={() => jump(Number(entry.chapter))}>第 {entry.chapter} 章 →</button><p>{entry.state}</p></div>)}</div>{current.timeline.length === 0 && <p className="ws-muted">还没有确认的状态时间线。</p>}</>}
            <div className="ws-reader-footer"><Button onClick={() => ask(`请先读取 character/${current.id}（${current.name}），结合当前人物记录讨论需要补充或调整的内容，先说明依据。`)}>讨论人物调整</Button></div>
        </article></div>}
    </div>
}

const milestoneNames: Record<string, string> = { reinforcement: '强化', partial_reveal: '半揭示', callback: '回调', red_herring: '红鲱鱼' }
const statusNames: Record<string, string> = { planned: '计划中', planted: '已埋设', resolved: '已回收', abandoned: '已放弃' }

export function PlotsPage({ overview: o, chapter, ask, jump }: { overview: NovelOverview; chapter: ChapterRow | null; ask: PrepareRequest; jump: (number: number) => void }) {
    const [filter, setFilter] = useState('all')
    const [selected, setSelected] = useState('')
    const match = (row: NovelOverview['plotRows'][number], key: string) => key === 'all' || key === 'plant' && row.status === 'planned' && chapter?.number !== null && Number(row.plannedChapter) === chapter?.number || key === 'resolve' && row.status === 'planted' && chapter?.number !== null && Number(row.resolveChapter) === chapter?.number || key === 'overdue' && row.overdue || key === 'closed' && ['resolved', 'abandoned'].includes(row.status)
    const rows = o.plotRows.filter(row => match(row, filter))
    const current = rows.find(row => row.id === selected) ?? rows[0]
    return <div className="ws-page"><Heading title="伏笔" hint={`本章参照：${chapter ? chapter.id : '尚未选章'} · 全书逾期参照：${o.currentChapter ?? '无章节'}`} />
        <div className="ws-tabs" aria-label="伏笔筛选">{[['all', '全部'], ['plant', '本章待埋'], ['resolve', '本章待收'], ['overdue', '全书逾期'], ['closed', '已收束']].map(([key, label]) => <button type="button" className="ws-button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key!)}>{label} {o.plotRows.filter(row => match(row, key!)).length}</button>)}</div>
        {!current ? <Empty>此范围没有伏笔记录。</Empty> : <div className="ws-split"><nav className="ws-entity-list" aria-label="伏笔列表">{rows.map(row => <button type="button" className="ws-button" key={row.id} aria-pressed={row.id === current.id} onClick={() => setSelected(row.id)}><span>{row.hint}</span><span className="ws-muted">{statusNames[row.status] ?? row.status}{row.overdue ? ' · 计划已逾期' : ''}</span></button>)}</nav><article className="ws-detail"><Tag tone={current.overdue ? 'warning' : 'neutral'}>{statusNames[current.status] ?? current.status}</Tag><h2>{current.hint}</h2><p className="ws-muted">计划埋设：{current.plannedChapter || '未设计划'} · 计划回收：{current.resolveChapter || '未设计划'}</p><Markdown text={current.content} /><h3>生命周期</h3><div className="ws-timeline">{[{ chapter: current.plannedChapter, note: '计划埋设' }, { chapter: current.plantedChapter, note: '实际埋设' }, ...current.milestones.map(item => ({ chapter: item.chapter, note: `${milestoneNames[item.type] ?? item.type}${item.note ? `：${item.note}` : ''}` })), { chapter: current.resolvedChapter, note: '实际回收' }].filter(item => item.chapter).map((item, index) => <div className="ws-timeline-item" key={index}><button type="button" className="ws-button ws-link" onClick={() => jump(Number(item.chapter))}>第 {item.chapter} 章 →</button><p>{item.note}</p></div>)}</div><div className="ws-reader-footer"><Button onClick={() => ask(`请先读取 plot/${current.id}（${current.hint}）与相关正文。当前状态 ${current.status}，计划埋设章 ${current.plannedChapter || '未设置'}，计划回收章 ${current.resolveChapter || '未设置'}，本次参照章 ${chapter?.id ?? '待确认'}。请核对实际埋设或回收情况，先说明依据和推进建议，再按确认结果处理。`)}>讨论推进这条伏笔</Button></div></article></div>}
    </div>
}

export function LibraryPage({ overview: o, ask }: { overview: NovelOverview; ask: PrepareRequest }) {
    const [selected, setSelected] = useState('')
    const [query, setQuery] = useState('')
    const sources = [
        ...(o.principles === null ? [] : [{ key: 'principles/principles', title: '创作准则', group: '基调与红线', body: sectionText(o.principles) }]),
        ...o.worldRows.map(row => ({ key: `worldbuilding/${row.id}`, title: row.title, group: '世界观', body: sectionText(row.sections) })),
        ...(o.events === null ? [] : [{ key: 'event/event', title: '重要事件', group: '权威事实', body: sectionText(o.events) }]),
        ...o.styleRows.map(row => ({ key: `style/${row.id}`, title: row.id, group: '风格示范', body: sectionText(row.sections) })),
        ...(o.ideas === null ? [] : [{ key: 'idea/idea', title: '灵感原文', group: '保留作者表达', body: sectionText(o.ideas) }]),
    ].filter(row => `${row.title}\n${row.body}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    const current = sources.find(row => row.key === selected) ?? sources[0]
    return <div className="ws-page"><Heading title="创作资料" hint="查阅原始依据，让修改有迹可循" /><label className="ws-field">在已加载资料中查找<input className="ws-input" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="标题或原文关键词" /></label>
        {o.worldbuildingTruncated > 0 && <p className="ws-muted">另有 {o.worldbuildingTruncated} 条世界观未加载，可让助手检索或读取。</p>}
        <div className="ws-actions"><Button onClick={() => ask(`请使用 writer_search 检索小说资料，查询：${query.trim() || '请先与我确定查询内容'}。如使用章范围或语义降级，请说明。`)}>让助手检索</Button></div>
        {!current ? <Empty>没有匹配资料。</Empty> : <div className="ws-split" style={{ marginTop: 20 }}><nav className="ws-entity-list" aria-label="资料列表">{sources.map(row => <button type="button" className="ws-button" key={row.key} aria-pressed={row.key === current.key} onClick={() => setSelected(row.key)}><span>{row.title}</span><span className="ws-muted">{row.group}</span></button>)}</nav><article className="ws-detail"><Tag tone="neutral">{current.group}</Tag><h2>{current.title}</h2><Markdown text={current.body} /><div className="ws-reader-footer"><Button onClick={() => ask(`请先读取 ${current.key}，与我讨论补充或调整。${current.key === 'idea/idea' ? '保留作者灵感原文，不覆盖用户最初表达。' : '先给出需要修改的依据与建议。'}`)}>讨论这份资料</Button></div></article></div>}
    </div>
}

export function PendingPage({ overview: o, ask }: { overview: NovelOverview; ask: PrepareRequest }) {
    const [selected, setSelected] = useState(0)
    const current = o.pendingSections[Math.min(selected, o.pendingSections.length - 1)]
    const chapter = current ? /chapter\/(\d{3})\b/.exec(current.heading)?.[1] : undefined
    return <div className="ws-page"><Heading title="待确认" hint="建议还不是事实，核对后再写进故事"><span className="ws-muted">{o.pendingLineTotal} 条待确认建议</span></Heading>
        {!current ? <Empty>没有待确认建议。写完或改稿后的维护建议会出现在这里。</Empty> : <div className="ws-split"><nav className="ws-entity-list" aria-label="维护建议分节">{o.pendingSections.map((section, index) => <button type="button" className="ws-button" key={`${section.heading}-${index}`} aria-pressed={index === Math.min(selected, o.pendingSections.length - 1)} onClick={() => setSelected(index)}><span>{section.heading}</span><span className="ws-muted">{section.lines.length} 条建议</span></button>)}</nav><article className="ws-detail"><h2>{current.heading}</h2><p className="ws-muted">逐条处理只准备对话要求；确认后的结果以原始文件为准。</p>{current.lines.map((line, index) => <div className="ws-suggestion" key={index}><p>{line}</p><Button onClick={() => ask(`请先读取 pending.md 中“${current.heading}”这一节及相关原始实体，核对以下建议原文：\n\n${line}\n\n${chapter ? `来源章节 chapter/${chapter}。` : '请先确认建议所属章节，不能猜测。'}请说明依据，按确认结果更新人物状态、伏笔或其他权威记录。不要归档其他尚未处理的建议。`)}>让助手处理本条</Button></div>)}<div className="ws-reader-footer"><Button disabled={!chapter} onClick={() => ask(`请读取 pending.md 中 chapter/${chapter} 的全部待办节，核对该章建议是否已落实，说明待归档范围。处理妥当后再通过 pending_cleanup 归档 chapter/${chapter} 的全部建议，保留归档原文。`)}>归档本章建议</Button>{!chapter && <p className="ws-muted">未识别到有效章号，请先在对话中核对该节来源。</p>}</div></article></div>}
        <details className="ws-archive"><summary>历史归档 · {o.archiveSources.length > 0 ? o.archiveSources.length + ' 份文件' : o.pendingArchive.length + ' 节'}（可展开原文）</summary>{o.archiveSources.length > 0 ? o.archiveSources.map(source => <section className="ws-suggestion" key={source.path}><h3>{source.path}</h3><Markdown text={source.text} /><details><summary>原始 Markdown</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{source.text}</pre></details></section>) : o.pendingArchive.length === 0 ? <p className="ws-muted">暂无历史归档。</p> : o.pendingArchive.map((section, index) => <section className="ws-suggestion" key={index}><h3>{section.heading}</h3>{section.lines.map((line, lineIndex) => <p key={lineIndex}>{line}</p>)}</section>)}</details>
    </div>
}

export function OverviewPage({ overview: o, live, ask, navigate, choose }: { overview: NovelOverview; live: WriterLiveState; ask: PrepareRequest; navigate: (page: StudioPage) => void; choose: (chapter: ChapterRow) => void }) {
    const [format, setFormat] = useState('epub')
    const [range, setRange] = useState('')
    return <div className="ws-page"><Heading title={o.title} hint={o.genre || '小说项目'} /><div className="ws-stats">{[[o.chapters, '已写章节', 'manuscript'], [o.characterRows.length, '人物档案', 'characters'], [o.plotRows.length, '伏笔记录', 'plots'], [o.pendingLineTotal, '待确认建议', 'pending']].map(([value, label, page]) => <button type="button" className="ws-button ws-stat" key={String(label)} onClick={() => navigate(page as StudioPage)}><strong>{value}</strong><span className="ws-muted">{label}</span></button>)}</div>
        <p className="ws-muted">正文约 {o.totalChars.toLocaleString()} 字{o.targetWords > 0 ? ` / 目标 ${o.targetWords.toLocaleString()} 字` : ''}{o.chapterTarget > 0 ? ` · 计划 ${o.chapterTarget} 章` : ''}</p>
        {o.progress !== null && <div className="ws-progress" role="progressbar" aria-label="全书目标进度" aria-valuenow={Math.round(Math.min(o.progress, 1) * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.max(0, Math.min(o.progress, 1) * 100)}%` }} /></div>}
        <div className="ws-note"><h3>{o.nextStep.title}</h3><p className="ws-muted">{o.nextStep.hint}</p><div className="ws-actions" style={{ marginTop: 12 }}>{o.chapterRows.length > 0 && <Button onClick={() => choose(o.chapterRows[o.chapterRows.length - 1]!)}>阅读最近章节</Button>}<Button onClick={() => navigate('pending')}>查看待确认</Button></div></div>
        <div className="ws-actions"><Tag tone={o.riskSummary.red > 0 ? 'warning' : 'neutral'}>回收逾期 {o.riskSummary.red}</Tag><Tag tone="neutral">待维护 {o.staleChapters.length}</Tag><Button onClick={() => ask('请对已写章节、创作准则、人物状态及世界观进行一致性检查，列出依据，如实说明覆盖范围和失败批次。')}>全书一致性检查</Button></div>
        <h3 style={{ marginTop: 28 }}>卷分布</h3><div className="ws-actions">{o.volumes.map((volume, index) => <span className="ws-muted" key={index}>{volume.name || '正文'} · {volume.count} 章</span>)}</div>
        {live.lastReview && <section className="ws-archive"><h3>本会话最近审稿</h3><p>{live.lastReview.summary}</p>{live.lastReview.suggestions.map((suggestion, index) => <article key={index} className="ws-suggestion"><Tag tone={suggestion.severity === 'high' ? 'warning' : 'neutral'}>{suggestion.severity}</Tag><p>{suggestion.dimension} · {suggestion.problem}</p>{suggestion.quote && <blockquote>{suggestion.quote}</blockquote>}{suggestion.suggestion && <p>建议：{suggestion.suggestion}</p>}{suggestion.rewriteOption && <p>改写方案：{suggestion.rewriteOption}</p>}<Button onClick={() => ask(`请先确认本次审稿对应的原始章节，再核对该条建议。问题：${suggestion.problem}\n引用：${suggestion.quote ?? '未提供'}\n建议：${suggestion.suggestion ?? '未提供'}\n改写方案：${suggestion.rewriteOption ?? '未提供'}\n请先给出修改范围，保留无关段落。`)}>准备处理要求</Button></article>)}</section>}
        <details className="ws-archive"><summary>项目操作与导出</summary><div className="ws-actions" style={{ marginTop: 16 }}><Button onClick={() => ask('请使用 archive_point 为当前小说创建显式存档点，只包含本小说内容。')}>创建存档点</Button><Button onClick={() => ask('请检查当前小说待维护的章节，按需 recompute_derived 更新摘要与关联建议，不改写权威人物时间线。')}>更新章节摘要</Button><Button onClick={() => ask('请执行 maintenance_flush，等待本会话在飞的章后整理完成并说明结果。')}>等待章后整理</Button><Button onClick={() => ask('请使用 writer_stats 获取小说当前统计与维护覆盖情况。')}>详细统计</Button></div><label className="ws-field">导出格式<select className="ws-input" value={format} onChange={event => setFormat(event.target.value)}><option value="epub">EPUB</option><option value="txt">TXT</option><option value="html">HTML</option></select></label><label className="ws-field">章节范围（留空为全书）<input className="ws-input" placeholder="例如 001-025" value={range} onChange={event => setRange(event.target.value)} /></label><Button onClick={() => ask(`请准备导出当前小说为 ${format}，章节范围：${range.trim() || '全书'}。先说明范围与附录选项，再按宿主审批执行 export_book，给出产物路径与告警。`)}>准备导出要求</Button></details>
        <details className="ws-archive"><summary>本会话写作动态 · {live.activities.length}</summary>{live.activities.map((activity, index) => <p className="ws-muted" key={index}>{activity.time} · {activity.summary}</p>)}{live.writes.map((write, index) => <p className="ws-muted" key={index}>chapter/{write.chapterId} · {write.mode} · 约 {write.chars} 字{write.droppedSentences ? ` · 丢句告警 ${write.droppedSentences}` : ''}{write.repetitionStripped ? ` · 剔除复述 ${write.repetitionStripped} 句` : ''}</p>)}</details>
    </div>
}
