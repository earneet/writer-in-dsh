/**
 * 写作面板本体（注册进 main 槽 key=writer-panel；sidebar.panellist 提供入口）。
 *
 * v3 信息面：五个页签（概况/章节/伏笔/人物/待办），冷启动经 workspaceFiles remote
 * 扫描 novel/ 项目（novel-writer「打开项目即拉存储」范式），卡片化视觉
 * （进度条 / 统计格 / 状态徽章）；会话内动态（富卡片回写）叠加在概况页。
 */
import { useCallback, useEffect, useState } from 'react'
import { activeSessionId, scanNovel } from './load.ts'
import { buildOverview, type NovelOverview } from './overview.ts'
import { readPanelState, subscribePanel, type WriterPanelState } from './state.ts'

type Tab = 'overview' | 'chapters' | 'plots' | 'characters' | 'pending'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: '概况' },
  { id: 'chapters', label: '章节' },
  { id: 'plots', label: '伏笔' },
  { id: 'characters', label: '人物' },
  { id: 'pending', label: '待办' },
]

// —— 视觉基元（内联自包含；色板跟随语义，不依赖宿主主题变量）——
const card: React.CSSProperties = {
  borderRadius: 8, padding: '10px 12px', marginBottom: 8,
  background: 'rgba(127,127,127,0.08)', border: '1px solid rgba(127,127,127,0.18)',
}
const sectionTitle: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 1, margin: '12px 0 6px', opacity: 0.55, textTransform: 'uppercase' }
const row: React.CSSProperties = { fontSize: 12, lineHeight: 1.8, display: 'flex', justifyContent: 'space-between', gap: 8 }
const rowMain: React.CSSProperties = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const rowAside: React.CSSProperties = { flexShrink: 0, opacity: 0.55, fontSize: 11 }
const dim: React.CSSProperties = { fontSize: 12, lineHeight: 1.7, opacity: 0.6 }
const empty: React.CSSProperties = { fontSize: 12, lineHeight: 1.8, opacity: 0.6, padding: '12px 0' }
const statGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 8 }
const statCell: React.CSSProperties = { ...card, marginBottom: 0, textAlign: 'center', padding: '8px 4px' }
const statValue: React.CSSProperties = { fontSize: 16, fontWeight: 700 }
const statLabel: React.CSSProperties = { fontSize: 10, opacity: 0.55, marginTop: 2 }
const tabStyle = (active: boolean): React.CSSProperties => ({
  fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: 'none',
  background: active ? 'rgba(127,127,127,0.22)' : 'transparent',
  color: 'inherit', fontWeight: active ? 700 : 400, opacity: active ? 1 : 0.65,
})
const refreshButton: React.CSSProperties = { fontSize: 11, padding: '2px 10px', borderRadius: 6, opacity: 0.7, cursor: 'pointer', border: '1px solid rgba(127,127,127,0.3)', background: 'transparent', color: 'inherit' }

const STATUS_COLORS: Record<string, string> = {
  planned: '#8b949e', planted: '#d29922', resolved: '#3fb950', abandoned: '#f85149',
  active: '#3fb950', draft: '#d29922', done: '#3fb950',
}

const badge = (status: string): React.CSSProperties => ({
  display: 'inline-block', fontSize: 10, padding: '1px 7px', borderRadius: 999,
  color: STATUS_COLORS[status] ?? '#8b949e', border: `1px solid ${STATUS_COLORS[status] ?? '#8b949e'}66`,
  background: `${STATUS_COLORS[status] ?? '#8b949e'}1a`, flexShrink: 0,
})

/** 面板 props（main 槽 keyed 注册的拥有者数据 + 框架席位；只用样式无关字段）。 */
export interface WriterPanelProps {
  sessionId?: string
}

function usePanelState(): WriterPanelState | undefined {
  const [snapshot, setSnapshot] = useState<WriterPanelState | undefined>(() => readPanelState(''))
  useEffect(() => {
    const sync = (): void => { setSnapshot(readPanelState('')) }
    sync()
    const timer = setInterval(sync, 800)
    return () => { clearInterval(timer); subscribePanel(sync)() }
  }, [])
  return snapshot
}

interface ColdState {
  loading: boolean
  overview: NovelOverview | null
  error: string | null
}

/** 冷启动扫描（会话切换自动重拉 + 手动刷新）。 */
function useColdOverview(): ColdState & { refresh: () => void } {
  const [state, setState] = useState<ColdState>({ loading: false, overview: null, error: null })
  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => { setNonce(n => n + 1) }, [])

  useEffect(() => {
    // 会话切换探测：活跃会话变化时重扫（2s 轮询，代价可忽略）
    let lastSession = activeSessionId()
    const timer = setInterval(() => {
      const current = activeSessionId()
      if (current !== lastSession) {
        lastSession = current
        setNonce(n => n + 1)
      }
    }, 2000)
    return () => { clearInterval(timer) }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setState(prev => ({ ...prev, loading: true }))
    const sessionId = activeSessionId()
    if (sessionId === null) {
      setState({ loading: false, overview: null, error: '没有活跃会话，无法定位工作区' })
      return
    }
    scanNovel(sessionId, controller.signal)
      .then(scan => setState({ loading: false, overview: buildOverview(scan), error: null }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ loading: false, overview: null, error: error instanceof Error ? error.message : String(error) })
      })
    return () => { controller.abort() }
  }, [nonce])

  return { ...state, refresh }
}

function ProgressBar({ progress }: { progress: number | null }): React.ReactElement | null {
  if (progress === null) return null
  return (
    <div style={{ height: 6, borderRadius: 3, background: 'rgba(127,127,127,0.18)', overflow: 'hidden', marginTop: 8 }}>
      <div style={{ width: `${Math.max(progress * 100, 1.5)}%`, height: '100%', borderRadius: 3, background: 'linear-gradient(90deg,#3fb95088,#3fb950)' }} />
    </div>
  )
}

function OverviewTab({ o, live }: { o: NovelOverview; live: WriterPanelState | undefined }): React.ReactElement {
  return (
    <>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <strong style={{ fontSize: 14 }}>《{o.title}》</strong>
          <span style={{ fontSize: 11, opacity: 0.6 }}>{o.progress !== null ? `${Math.round(o.progress * 100)}%` : ''}</span>
        </div>
        {o.genre.length > 0 && <div style={{ ...dim, marginTop: 2 }}>{o.genre}</div>}
        <ProgressBar progress={o.progress} />
        {o.targetWords > 0 && (
          <div style={{ ...dim, marginTop: 4, fontSize: 11 }}>{o.totalChars} / {o.targetWords} 字{o.chapterTarget > 0 ? ` · ${o.chapters}/${o.chapterTarget} 章` : ''}</div>
        )}
      </div>

      <div style={statGrid}>
        <div style={statCell}><div style={statValue}>{o.chapters}</div><div style={statLabel}>章节</div></div>
        <div style={statCell}><div style={statValue}>{o.characterRows.length}</div><div style={statLabel}>人物</div></div>
        <div style={statCell}><div style={statValue}>{o.plotRows.length}</div><div style={statLabel}>伏笔</div></div>
        <div style={statCell}><div style={statValue}>{o.worldbuildingCount}</div><div style={statLabel}>世界观</div></div>
      </div>

      {o.volumes.length > 0 && (
        <div style={card}>
          {o.volumes.map(v => (
            <div key={v.name} style={row}>
              <span style={rowMain}>{v.name}</span><span style={rowAside}>{v.count} 章</span>
            </div>
          ))}
        </div>
      )}

      {o.recentChapters.length > 0 && (
        <>
          <div style={sectionTitle}>最近章节</div>
          {o.recentChapters.map((ch, i) => (
            <div key={i} style={row}>
              <span style={rowMain}>{ch.id}　{ch.title}</span>
              <span style={rowAside}>{ch.volume.length > 0 ? `${ch.volume} · ` : ''}≈{ch.chars} 字</span>
            </div>
          ))}
        </>
      )}

      {o.foreshadow.length > 0 && (
        <>
          <div style={sectionTitle}>伏笔状态</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {o.foreshadow.map(f => <span key={f.status} style={badge(f.status)}>{f.status} ×{f.count}</span>)}
          </div>
        </>
      )}

      {live !== undefined && live.writes.length > 0 && (
        <>
          <div style={sectionTitle}>本会话写作</div>
          {live.writes.slice(0, 6).map((write, i) => (
            <div key={i} style={{ ...row, color: write.droppedSentences > 0 || write.patchesSkipped > 0 ? '#d29922' : undefined }}>
              <span style={rowMain}>chapter/{write.chapterId} · {write.mode}</span>
              <span style={rowAside}>≈{write.chars} 字{write.droppedSentences > 0 ? ` · ⚠丢句 ${write.droppedSentences}` : ''}</span>
            </div>
          ))}
        </>
      )}

      {live !== undefined && live.activities.length > 0 && (
        <>
          <div style={sectionTitle}>写作动态</div>
          {live.activities.slice(0, 8).map((activity, i) => (
            <div key={i} style={{ ...dim, fontSize: 11, display: 'flex', gap: 6 }}>
              <span style={{ opacity: 0.5, flexShrink: 0 }}>{activity.time}</span>
              <span style={rowMain}><code style={{ fontSize: 10 }}>{activity.tool}</code> {activity.summary}</span>
            </div>
          ))}
        </>
      )}
    </>
  )
}

function ChaptersTab({ o }: { o: NovelOverview }): React.ReactElement {
  if (o.chapterRows.length === 0) return <div style={empty}>还没有章节。在「写作模式」会话里让助手写第一章（write_chapter）后，这里会出现章节列表。</div>
  return (
    <>
      {o.chapterRows.slice().reverse().map(ch => (
        <div key={ch.id} style={card}>
          <div style={row}>
            <span style={{ ...rowMain, fontWeight: 600 }}>{ch.id}　{ch.title}</span>
            <span style={rowAside}>≈{ch.chars} 字</span>
          </div>
          <div style={{ ...dim, fontSize: 11, marginTop: 2, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ch.volume.length > 0 && <span>{ch.volume}</span>}
            {ch.storyline.length > 0 && <span>线：{ch.storyline}</span>}
            {ch.status.length > 0 && <span style={badge(ch.status)}>{ch.status}</span>}
          </div>
        </div>
      ))}
    </>
  )
}

function PlotsTab({ o }: { o: NovelOverview }): React.ReactElement {
  if (o.plotRows.length === 0) return <div style={empty}>还没有伏笔/情节文件（plots/）。</div>
  return (
    <>
      {o.plotRows.map(p => (
        <div key={p.id} style={card}>
          <div style={row}>
            <span style={rowMain}>{p.hint}</span>
            <span style={badge(p.status)}>{p.status}</span>
          </div>
          {p.plannedChapter.length > 0 && <div style={{ ...dim, fontSize: 11, marginTop: 2 }}>计划章：{p.plannedChapter}</div>}
        </div>
      ))}
    </>
  )
}

function CharactersTab({ o }: { o: NovelOverview }): React.ReactElement {
  if (o.characterRows.length === 0) return <div style={empty}>还没有人物文件（characters/）。</div>
  return (
    <>
      {o.characterRows.map(c => (
        <div key={c.id} style={card}>
          <div style={row}>
            <span style={{ ...rowMain, fontWeight: 600 }}>{c.name}</span>
            <span style={rowAside}>
              {c.timelineCount > 0 ? `时间线 ${c.timelineCount}` : ''}{c.relationCount > 0 ? ` · 关系 ${c.relationCount}` : ''}
            </span>
          </div>
          {(c.role.length > 0 || c.arc.length > 0) && (
            <div style={{ ...dim, fontSize: 11, marginTop: 2 }}>
              {c.role.length > 0 && <span>{c.role}</span>}
              {c.arc.length > 0 && <span> · 弧线 {c.arc}</span>}
            </div>
          )}
        </div>
      ))}
    </>
  )
}

function PendingTab({ o }: { o: NovelOverview }): React.ReactElement {
  if (o.pendingLines.length === 0) return <div style={empty}>没有待办（pending.md 为空或不存在）。</div>
  return (
    <>
      {o.pendingLines.map((line, i) => (
        <div key={i} style={{ ...dim, padding: '5px 0', borderBottom: '1px dashed rgba(127,127,127,0.15)' }}>· {line}</div>
      ))}
    </>
  )
}

/** 写作面板：五页签（概况/章节/伏笔/人物/待办）。 */
export function WriterPanel(_props: WriterPanelProps) {
  const cold = useColdOverview()
  const live = usePanelState()
  const [tab, setTab] = useState<Tab>('overview')
  const o = cold.overview

  return (
    <div style={{ fontSize: 12, lineHeight: 1.6, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px' }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>写作面板</span>
        <button style={refreshButton} onClick={cold.refresh} title="重新扫描小说项目">
          {cold.loading ? '扫描中…' : '↻ 刷新'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid rgba(127,127,127,0.2)', marginBottom: 8, paddingTop: 4 }}>
        {TABS.map(t => (
          <button key={t.id} style={tabStyle(tab === t.id)} onClick={() => { setTab(t.id) }}>{t.label}</button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
        {o !== null && tab === 'overview' && <OverviewTab o={o} live={live} />}
        {o !== null && tab === 'chapters' && <ChaptersTab o={o} />}
        {o !== null && tab === 'plots' && <PlotsTab o={o} />}
        {o !== null && tab === 'characters' && <CharactersTab o={o} />}
        {o !== null && tab === 'pending' && <PendingTab o={o} />}
        {o === null && cold.error !== null && (
          <div style={empty}>
            项目扫描失败：{cold.error}
            <br />请确认当前会话工作区含 novel/（或直接位于小说项目目录）。
          </div>
        )}
        {o === null && !cold.loading && cold.error === null && <div style={empty}>正在定位小说项目…</div>}
      </div>
    </div>
  )
}

/** 侧边栏面板列表入口的图标（简笔「笔」形 SVG，自包含无外部图标依赖）。 */
export function WriterPanelIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M11.5 2.5l2 2L6 12l-2.7.7L4 10l7.5-7.5z" fill="currentColor" />
    </svg>
  )
}
