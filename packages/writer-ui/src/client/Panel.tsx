/**
 * 写作面板本体（注册进 main 槽 key=writer-panel；sidebar.panellist 提供入口）。
 * v1：读全局写作动态（富卡片记录），空态给出使用指引。
 */
import { useEffect, useState } from 'react'
import { readPanelState, subscribePanel, type WriterPanelState } from './state.ts'

const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, margin: '14px 0 6px', opacity: 0.85 }
const row: React.CSSProperties = { fontSize: 12, lineHeight: 1.7, opacity: 0.9, wordBreak: 'break-all' }
const warn: React.CSSProperties = { ...row, color: '#d29922' }
const empty: React.CSSProperties = { fontSize: 12, lineHeight: 1.8, opacity: 0.6, padding: '8px 0' }

/** 面板 props（main 槽 keyed 注册的拥有者数据 + 框架席位；v1 只用样式无关字段）。 */
export interface WriterPanelProps {
  sessionId?: string
}

function usePanelState(): WriterPanelState | undefined {
  const [snapshot, setSnapshot] = useState<WriterPanelState | undefined>(() => readPanelState(''))
  useEffect(() => {
    const sync = (): void => { setSnapshot(readPanelState('')) }
    sync()
    return subscribePanel(sync)
  }, [])
  return snapshot
}

/** 写作面板：统计快照 + 最近写作 + 动态时间线。 */
export function WriterPanel(_props: WriterPanelProps) {
  const state = usePanelState()
  if (state === undefined || (state.stats === null && state.activities.length === 0)) {
    return (
      <div style={empty}>
        写作面板（dsh-writer-ui）
        <br /><br />
        在「写作模式」会话中使用写作工具（write_chapter / writer_stats / foreshadow_update…）后，
        这里会显示章节字数、伏笔状态与写作动态。
      </div>
    )
  }
  const stats = state.stats
  return (
    <div style={{ fontSize: 12, lineHeight: 1.6 }}>
      {stats !== null && (
        <>
          <div style={sectionTitle}>全书概况</div>
          <div style={row}>章节：{stats.chapters} 章 · 约 {stats.totalChars} 字</div>
          {stats.volumes.length > 0 && <div style={row}>卷：{stats.volumes.map(v => `${v.name}×${v.count}`).join('、')}</div>}
          {stats.foreshadow.length > 0 && <div style={row}>伏笔：{stats.foreshadow.map(f => `${f.status}×${f.count}`).join('、')}</div>}
          <div style={row}>弧线覆盖：{stats.arcCoverage}</div>
          {stats.arcBroken.length > 0 && <div style={warn}>⚠ 非法 timeline：{stats.arcBroken.join('、')}</div>}
          {stats.staleChapters.length > 0 && <div style={warn}>待维护 pass：{stats.staleChapters.join('、')}</div>}
        </>
      )}
      {state.writes.length > 0 && (
        <>
          <div style={sectionTitle}>最近写作</div>
          {state.writes.slice(0, 6).map((write, i) => (
            <div key={i} style={write.droppedSentences > 0 || write.patchesSkipped > 0 ? warn : row}>
              chapter/{write.chapterId} · {write.mode} · ≈{write.chars} 字
              {write.patchesApplied + write.patchesSkipped > 0 ? ` · 补丁 ${write.patchesApplied}/${write.patchesApplied + write.patchesSkipped}` : ''}
              {write.droppedSentences > 0 ? ` · ⚠ 丢句 ${write.droppedSentences}` : ''}
            </div>
          ))}
        </>
      )}
      {state.activities.length > 0 && (
        <>
          <div style={sectionTitle}>写作动态</div>
          {state.activities.slice(0, 12).map((activity, i) => (
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
