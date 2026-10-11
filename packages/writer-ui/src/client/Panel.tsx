/**
 * 写作面板本体（注册进 main 槽 key=writer-panel；sidebar.panellist 提供入口）。
 *
 * v2 数据面（对齐 novel-writer「打开项目即拉存储」范式）：
 * - 冷启动：面板挂载即经 workspaceFiles remote 扫描 novel/ 项目（章/情节/人物/待办），
 *   浏览器侧用 domain 纯函数聚合总览——无需先在本会话跑写作工具；
 * - 会话内动态：富卡片回写的最近写作/时间线（v1 通道保留，作为增量刷新）；
 * - 手动刷新 + 会话切换自动重拉（activeSessionId 变化触发）。
 */
import { useCallback, useEffect, useState } from 'react'
import { activeSessionId, scanNovel } from './load.ts'
import { buildOverview, type NovelOverview } from './overview.ts'
import { readPanelState, subscribePanel, type WriterPanelState } from './state.ts'

const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, margin: '14px 0 6px', opacity: 0.85 }
const row: React.CSSProperties = { fontSize: 12, lineHeight: 1.7, opacity: 0.9, wordBreak: 'break-all' }
const warn: React.CSSProperties = { ...row, color: '#d29922' }
const dim: React.CSSProperties = { ...row, opacity: 0.6 }
const empty: React.CSSProperties = { fontSize: 12, lineHeight: 1.8, opacity: 0.6, padding: '8px 0' }
const button: React.CSSProperties = { fontSize: 11, padding: '2px 8px', marginBottom: 4, opacity: 0.75, cursor: 'pointer' }

/** 面板 props（main 槽 keyed 注册的拥有者数据 + 框架席位；v1 只用样式无关字段）。 */
export interface WriterPanelProps {
  sessionId?: string
}

function usePanelState(): WriterPanelState | undefined {
  const [snapshot, setSnapshot] = useState<WriterPanelState | undefined>(() => readPanelState(''))
  useEffect(() => {
    const sync = (): void => { setSnapshot(readPanelState('')) }
    sync()
    const timer = setInterval(sync, 800)
    return () => { clearInterval(timer); void subscribePanel(sync)() }
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

const progressText = (overview: NovelOverview): string =>
  overview.progress !== null ? `${Math.round(overview.progress * 100)}%` : '—'

/** 写作面板：冷启动总览 + 最近写作 + 动态时间线。 */
export function WriterPanel(_props: WriterPanelProps) {
  const cold = useColdOverview()
  const live = usePanelState()
  const overview = cold.overview

  return (
    <div style={{ fontSize: 12, lineHeight: 1.6, padding: '0 4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 600 }}>{overview !== null ? overview.title : '写作面板'}</span>
        <button style={button} onClick={cold.refresh} title="重新扫描小说项目">
          {cold.loading ? '扫描中…' : '刷新'}
        </button>
      </div>

      {overview !== null && (
        <>
          <div style={sectionTitle}>全书概况</div>
          {overview.genre.length > 0 && <div style={dim}>{overview.genre}</div>}
          <div style={row}>
            章节：{overview.chapters} 章{overview.chapterTarget > 0 ? ` / 目标 ${overview.chapterTarget}` : ''} · 约 {overview.totalChars} 字
            {overview.targetWords > 0 ? `（${progressText(overview)}）` : ''}
          </div>
          {overview.volumes.length > 0 && <div style={row}>卷：{overview.volumes.map(v => `${v.name}×${v.count}`).join('、')}</div>}
          {overview.foreshadow.length > 0 && <div style={row}>伏笔：{overview.foreshadow.map(f => `${f.status}×${f.count}`).join('、')}</div>}
          <div style={row}>人物：{overview.characterCount} 个</div>
          {overview.recentChapters.length > 0 && (
            <>
              <div style={sectionTitle}>最近章节</div>
              {overview.recentChapters.map((ch, i) => (
                <div key={i} style={row}>
                  {ch.id}{ch.title.length > 0 ? ` ${ch.title}` : ''} · ≈{ch.chars} 字{ch.volume.length > 0 ? ` · ${ch.volume}` : ''}
                </div>
              ))}
            </>
          )}
          {overview.pendingLines.length > 0 && (
            <>
              <div style={sectionTitle}>待办（pending）</div>
              {overview.pendingLines.map((line, i) => <div key={i} style={dim}>· {line}</div>)}
            </>
          )}
        </>
      )}

      {overview === null && cold.error !== null && (
        <div style={empty}>
          项目扫描失败：{cold.error}
          <br />请确认当前会话工作区含 novel/（或直接位于小说项目目录）。
        </div>
      )}
      {overview === null && !cold.loading && cold.error === null && (
        <div style={empty}>正在定位小说项目…</div>
      )}

      {live !== undefined && live.writes.length > 0 && (
        <>
          <div style={sectionTitle}>最近写作（本会话）</div>
          {live.writes.slice(0, 6).map((write, i) => (
            <div key={i} style={write.droppedSentences > 0 || write.patchesSkipped > 0 ? warn : row}>
              chapter/{write.chapterId} · {write.mode} · ≈{write.chars} 字
              {write.patchesApplied + write.patchesSkipped > 0 ? ` · 补丁 ${write.patchesApplied}/${write.patchesApplied + write.patchesSkipped}` : ''}
              {write.droppedSentences > 0 ? ` · ⚠ 丢句 ${write.droppedSentences}` : ''}
            </div>
          ))}
        </>
      )}
      {live !== undefined && live.activities.length > 0 && (
        <>
          <div style={sectionTitle}>写作动态（本会话）</div>
          {live.activities.slice(0, 12).map((activity, i) => (
            <div key={i} style={row}>
              <span style={{ opacity: 0.55 }}>{activity.time}</span>{' '}
              <code style={{ fontSize: 11 }}>{activity.tool}</code>
              <div style={{ opacity: 0.8 }}>{activity.summary}</div>
            </div>
          ))}
        </>
      )}
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
