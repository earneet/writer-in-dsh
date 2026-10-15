/**
 * 写作面板本体（注册进 main 槽 key=writer-panel；sidebar.panellist 提供入口）。
 *
 * v5：视觉全量走宿主基元与 --dsw-* token（零字面颜色，亮暗主题自动跟随）——
 * 38px 自绘头部（对齐原生面板 chrome 规格）+ SegmentedTabs 六页签 + Tag 状态色 +
 * TextShimmer 加载态；大纲页签（outline.md 分节折叠）、章节/伏笔/人物可折叠展开
 * （预览/正文小节/时间线/关系）、人物关系 SVG 环形图。信息层级：书名 hero（进度）
 * → 四格统计 → 卷分布 → 最近章节 → 伏笔状态 → 会话内动态叠加。数据流不变：
 * 冷启动经 workspaceFiles remote 扫描 novel/ 项目，会话内动态由富卡片回写。
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Button, DisclosureRow, SegmentedTabs, Tag, TextShimmer, Tooltip,
  IconChecklistOutlineRegular, IconEditOutlineMedium, IconInfoOutlineRegular,
  IconListPenOutlineRegular, IconRefreshOutlineRegular, IconUsersOutlineRegular,
  IconDataOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { activeSessionId, scanNovel } from './load.ts'
import { buildOverview, type CharacterRow, type NovelOverview, type RelationEntry } from './overview.ts'
import { readPanelState, subscribePanel, type WriterPanelState } from './state.ts'

type Tab = 'overview' | 'outline' | 'chapters' | 'plots' | 'characters' | 'pending'

// —— 布局基元（只引用 token；颜色零字面）——
const root: React.CSSProperties = {
  height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden',
  color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'var(--dsw-font-family)',
  fontSize: 'var(--dsh-content-font-size-secondary, 13px)',
  lineHeight: 1.6,
}
const header: React.CSSProperties = {
  height: 38, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '0 12px', borderBottom: '0.5px solid var(--dsw-alias-border-l3)',
}
const headerTitle: React.CSSProperties = { fontSize: 13, fontWeight: 600 }
const body: React.CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px 16px', scrollbarGutter: 'stable' }
const card: React.CSSProperties = {
  borderRadius: 'var(--dsw-radius-md)', padding: '10px 12px', marginBottom: 8,
  background: 'var(--dsw-alias-bg-layer-2)',
}
const sectionTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: 1, margin: '14px 2px 6px',
  color: 'var(--dsw-alias-label-tertiary)', textTransform: 'uppercase',
}
const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }
const rowMain: React.CSSProperties = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const rowAside: React.CSSProperties = { flexShrink: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 }
const dim: React.CSSProperties = { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: 1.7 }
const empty: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
  padding: '36px 16px', color: 'var(--dsw-alias-label-tertiary)', textAlign: 'center', fontSize: 12, lineHeight: 1.8,
}
const statGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 10 }
const statCell: React.CSSProperties = {
  textAlign: 'center', padding: '9px 4px', borderRadius: 'var(--dsw-radius-md)',
  background: 'var(--dsw-alias-bg-layer-2)',
}
const statValue: React.CSSProperties = { fontSize: 17, fontWeight: 700 }
const statLabel: React.CSSProperties = { fontSize: 10, color: 'var(--dsw-alias-label-tertiary)', marginTop: 2 }
const tagRowStyle: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }

const STATUS_TONES: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'outline'> = {
  resolved: 'success', done: 'success', active: 'success',
  planted: 'warning', draft: 'warning',
  abandoned: 'danger',
  planned: 'neutral',
}
const statusTone = (status: string): 'success' | 'warning' | 'danger' | 'neutral' | 'outline' =>
  STATUS_TONES[status.toLowerCase()] ?? 'outline'

/** 面板 props（main 槽 keyed 注册的拥有者数据；只用样式无关字段）。 */
export interface WriterPanelProps {
  sessionId?: string
}

function usePanelState(): WriterPanelState | undefined {
  const [snapshot, setSnapshot] = useState<WriterPanelState | undefined>(() => readPanelState(''))
  useEffect(() => {
    const sync = (): void => { setSnapshot(readPanelState('')) }
    sync()
    const unsubscribe = subscribePanel(sync)
    const timer = setInterval(sync, 800)
    return () => { unsubscribe(); clearInterval(timer) }
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
      // 与刷新失败同口径：保留旧数据 + 提示条（避免会话切换瞬间清空面板）
      setState(prev => ({ loading: false, overview: prev.overview, error: '没有活跃会话，无法定位工作区' }))
      return
    }
    scanNovel(sessionId, controller.signal)
      .then(scan => {
        if (controller.signal.aborted) return
        setState({ loading: false, overview: buildOverview(scan), error: null })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        // 刷新失败保留已获数据（prev.overview），错误降级为提示条而不是清空面板
        setState(prev => ({ loading: false, overview: prev.overview, error: error instanceof Error ? error.message : String(error) }))
      })
    return () => { controller.abort() }
  }, [nonce])

  return { ...state, refresh }
}

function ProgressBar({ progress }: { progress: number | null }): React.ReactElement | null {
  if (progress === null) return null
  // progress=0 不渲染填充（旧实现 Math.max(…,1.5)% 会显示假进度）
  return (
    <div style={{
      height: 5, borderRadius: 'var(--dsw-radius-xs)',
      background: 'var(--dsw-alias-bg-layer-3)', overflow: 'hidden', marginTop: 8,
    }}>
      {progress > 0 && (
        <div style={{
          width: `${Math.min(progress * 100, 100)}%`, height: '100%',
          borderRadius: 'var(--dsw-radius-xs)',
          background: 'var(--dsw-alias-brand-primary)',
        }} />
      )}
    </div>
  )
}

function EmptyState({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <div style={empty}>{icon}<div>{children}</div></div>
}

/** 折叠行 leading 图标（模块级稳定引用，不击穿 DisclosureRow 的 memo 浅比较；宿主 icon prop 必填）。 */
const rowIcon = <IconDataOutlineRegular />

/** 面板内可折叠行（本地开合；宿主 useDisclosure 席位仅工具卡片有，这里自管；悬停由宿主 previewChevron 呈现展开指示）。 */
function CollapsibleRow({ title, aside, children, defaultOpen = false }: {
  title: string
  aside?: React.ReactNode
  children?: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const toggle = useCallback((): void => { setOpen(v => !v) }, [])
  return (
    <div style={{ marginBottom: 6, borderRadius: 'var(--dsw-radius-md)', background: 'var(--dsw-alias-bg-layer-2)' }}>
      <DisclosureRow
        icon={rowIcon}
        title={title}
        open={open}
        expandable={children !== undefined}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={toggle}
        collapsedContent={aside}
      >
        {children !== undefined && <div style={{ padding: '2px 14px 10px 30px', fontSize: 12, lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)' }}>{children}</div>}
      </DisclosureRow>
    </div>
  )
}

/** 展开详情里的小节标题。 */
const subSectionTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: 1, margin: '8px 0 4px',
  color: 'var(--dsw-alias-label-tertiary)', textTransform: 'uppercase',
}
const previewStyle: React.CSSProperties = { color: 'var(--dsw-alias-label-secondary)' }

/** 人物关系 SVG 图（环形布局：节点=参与边的两端人物，边=名字能对上号的关系；颜色全 token）。 */
function RelationGraph({ rows }: { rows: CharacterRow[] }) {
  // 边 = 各人物 relations 中对方也是本列表人物的（双向关系按无向 key 合并去重，避免两条重叠线段）
  const nameSet = new Set<string>()
  for (const row of rows) nameSet.add(row.name)
  const edgeMap = new Map<string, { from: string; to: string; desc: string }>()
  for (const row of rows) {
    for (const rel of row.relations) {
      if (!nameSet.has(rel.name)) continue
      const key = [row.name, rel.name].sort().join('\u0000')
      if (!edgeMap.has(key)) edgeMap.set(key, { from: row.name, to: rel.name, desc: rel.desc })
    }
  }
  const edges = [...edgeMap.values()]
  // 节点 = 参与某条边的两端（全部关系都指向非人物文件者不成孤立节点）
  const nodeNames = new Set<string>()
  for (const edge of edges) { nodeNames.add(edge.from); nodeNames.add(edge.to) }
  const nodes = rows.filter(row => nodeNames.has(row.name))
  const unmatched = rows.reduce((sum, row) => sum + row.relations.filter(rel => !nameSet.has(rel.name)).length, 0)
  if (nodes.length === 0) return <div style={dim}>人物文件中没有可绘的关系数据（frontmatter relations 或正文「## 关系」小节）。</div>

  const size = 400
  const cx = size / 2
  const cy = size / 2
  const radius = size / 2 - 56
  const pos = new Map<string, { x: number; y: number }>()
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2
    pos.set(node.name, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) })
  })
  return (
    <div style={{ borderRadius: 'var(--dsw-radius-md)', background: 'var(--dsw-alias-bg-layer-2)', padding: 8 }}>
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="人物关系图" style={{ width: '100%', height: 'auto', display: 'block' }}>
        {edges.map((edge, i) => {
          const a = pos.get(edge.from)
          const b = pos.get(edge.to)
          if (a === undefined || b === undefined) return null
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--dsw-alias-border-l2)" strokeWidth={1}>
            <title>{`${edge.from} → ${edge.to}${edge.desc.length > 0 ? `：${edge.desc}` : ''}`}</title>
          </line>
        })}
        {nodes.map(node => {
          const p = pos.get(node.name)!
          const hero = node.role.includes('主角')
          return (
            <g key={node.id}>
              <circle cx={p.x} cy={p.y} r={hero ? 18 : 14} fill="var(--dsw-alias-bg-layer-3)"
                stroke={hero ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l4)'} strokeWidth={hero ? 2 : 1}>
                <title>{`${node.name}${node.role.length > 0 ? `（${node.role}）` : ''}`}</title>
              </circle>
              <text x={p.x} y={p.y + (p.y < cy ? -24 : 30)} textAnchor="middle" fontSize={11}
                fill="var(--dsw-alias-label-primary)">{node.name}</text>
            </g>
          )
        })}
      </svg>
      <div style={{ ...dim, fontSize: 11, textAlign: 'center', paddingBottom: 4 }}>
        共 {nodes.length} 人 · {edges.length} 条关系（悬停查看说明）{unmatched > 0 ? ` · 另有 ${unmatched} 条关系对方无人物档案未绘出` : ''}
      </div>
    </div>
  )
}

function OverviewTab({ o, live }: { o: NovelOverview; live: WriterPanelState | undefined }): React.ReactElement {
  return (
    <>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <strong style={{ fontSize: 15 }}>《{o.title}》</strong>
          {o.genre.length > 0 && <Tag tone="info">{o.genre}</Tag>}
        </div>
        <ProgressBar progress={o.progress} />
        <div style={{ ...dim, marginTop: 6, fontSize: 11 }}>
          {o.targetWords > 0
            ? <>{o.totalChars} / {o.targetWords} 字{o.chapterTarget > 0 ? ` · ${o.chapters}/${o.chapterTarget} 章` : ''}</>
            : `约 ${o.totalChars} 字`}
        </div>
      </div>

      <div style={statGrid}>
        <div style={statCell}><div style={statValue}>{o.chapters}</div><div style={statLabel}>章节</div></div>
        <div style={statCell}><div style={statValue}>{o.characterRows.length}</div><div style={statLabel}>人物</div></div>
        <div style={statCell}><div style={statValue}>{o.plotRows.length}</div><div style={statLabel}>伏笔</div></div>
        <div style={statCell}><div style={statValue}>{o.worldbuildingCount}</div><div style={statLabel}>世界观</div></div>
      </div>

      {o.volumes.length > 0 && (
        <>
          <div style={sectionTitle}>卷分布</div>
          <div style={{ ...card, padding: '6px 12px' }}>
            {o.volumes.map(v => (
              <div key={v.name} style={{ ...row, lineHeight: 2 }}>
                <span style={rowMain}>{v.name}</span><span style={rowAside}>{v.count} 章</span>
              </div>
            ))}
          </div>
        </>
      )}

      {o.recentChapters.length > 0 && (
        <>
          <div style={sectionTitle}>最近章节</div>
          <div style={{ ...card, padding: '6px 12px' }}>
            {o.recentChapters.map((ch, i) => (
              <div key={i} style={{ ...row, lineHeight: 2 }}>
                <span style={rowMain}>{ch.id}　{ch.title}</span>
                <span style={rowAside}>{ch.volume.length > 0 ? `${ch.volume} · ` : ''}≈{ch.chars} 字</span>
              </div>
            ))}
          </div>
        </>
      )}

      {o.foreshadow.length > 0 && (
        <>
          <div style={sectionTitle}>伏笔状态</div>
          <div style={{ ...tagRowStyle, marginBottom: 4, padding: '0 2px' }}>
            {o.foreshadow.map(f => <Tag key={f.status} tone={statusTone(f.status)}>{f.status} ×{f.count}</Tag>)}
          </div>
        </>
      )}

      {live !== undefined && live.writes.length > 0 && (
        <>
          <div style={sectionTitle}>本会话写作</div>
          <div style={{ ...card, padding: '6px 12px' }}>
            {live.writes.slice(0, 6).map((write, i) => {
              const warn = write.droppedSentences > 0 || write.patchesSkipped > 0
              return (
                <div key={i} style={{ ...row, lineHeight: 2, color: warn ? 'var(--dsw-alias-state-warn-label)' : undefined }}>
                  <span style={rowMain}>chapter/{write.chapterId} · {write.mode}</span>
                  {/* 告警行内 aside 覆盖为告警色（丢句计数必须在告警色里） */}
                  <span style={warn ? { ...rowAside, color: 'var(--dsw-alias-state-warn-label)' } : rowAside}>
                    ≈{write.chars} 字{write.droppedSentences > 0 ? ` · ⚠丢句 ${write.droppedSentences}` : ''}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}

      {live !== undefined && live.activities.length > 0 && (
        <>
          <div style={sectionTitle}>写作动态</div>
          <div style={{ ...card, padding: '6px 12px' }}>
            {live.activities.slice(0, 8).map((activity, i) => (
              <div key={i} style={{ ...dim, fontSize: 11, display: 'flex', gap: 6, lineHeight: 2 }}>
                <span style={{ color: 'var(--dsw-alias-label-tertiary)', flexShrink: 0 }}>{activity.time}</span>
                <span style={rowMain}><code style={{ fontSize: 10 }}>{activity.tool}</code> {activity.summary}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

/** 大纲页签：梗概卡 + 逐节可折叠展开（outline.md 的 ## 小节）。 */
function OutlineTab({ o }: { o: NovelOverview }): React.ReactElement {
  const outline = o.outline
  if (outline === null) {
    return <EmptyState icon={<IconListPenOutlineRegular />}>没有大纲（novel/outline.md 不存在或为空）。让助手规划大纲后会出现在这里。</EmptyState>
  }
  return (
    <>
      {outline.synopsis.length > 0 && (
        <div style={card}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
            {outline.volumes > 0 && <Tag tone="neutral">{outline.volumes} 卷</Tag>}
            {outline.chapterTarget > 0 && <Tag tone="outline">规划 {outline.chapterTarget} 章</Tag>}
            {o.chapters > 0 && outline.chapterTarget > 0 && (
              <Tag tone={o.chapters >= outline.chapterTarget ? 'success' : 'info'}>
                已写 {o.chapters}/{outline.chapterTarget}
              </Tag>
            )}
          </div>
          <div style={{ ...dim, fontSize: 12 }}>{outline.synopsis}</div>
        </div>
      )}
      {outline.sections.map((section, i) => (
        <CollapsibleRow key={i} title={section.title} defaultOpen={i === 0}
          aside={<span style={{ ...rowAside, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{section.body.slice(0, 60)}</span>}>
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 360, overflowY: 'auto' }}>{section.body}</div>
        </CollapsibleRow>
      ))}
    </>
  )
}

function ChaptersTab({ o }: { o: NovelOverview }): React.ReactElement {
  if (o.chapterRows.length === 0) {
    return <EmptyState icon={<IconInfoOutlineRegular />}>还没有章节。在「写作模式」会话里让助手写第一章（write_chapter）后，这里会出现章节列表。</EmptyState>
  }
  // 按卷分组（保持章序），卷头小标题 + 可折叠章行（展开看预览）
  const groups = new Map<string, typeof o.chapterRows>()
  for (const ch of o.chapterRows) {
    const volume = ch.volume.length > 0 ? ch.volume : '未分卷'
    const list = groups.get(volume) ?? []
    list.push(ch)
    groups.set(volume, list)
  }
  return (
    <>
      {[...groups.entries()].map(([volume, chapters]) => (
        <div key={volume}>
          {groups.size > 1 && <div style={sectionTitle}>{volume}</div>}
          {chapters.slice().reverse().map(ch => (
            <CollapsibleRow key={ch.id}
              title={`${ch.id}　${ch.title}`}
              aside={
                <span style={{ ...tagRowStyle, justifyContent: 'flex-end' }}>
                  <span style={rowAside}>≈{ch.chars} 字</span>
                  {ch.storyline.length > 0 && <Tag tone="outline">{ch.storyline}</Tag>}
                  {ch.status.length > 0 && <Tag tone={statusTone(ch.status)}>{ch.status}</Tag>}
                </span>
              }>
              <div style={previewStyle}>{ch.preview}</div>
            </CollapsibleRow>
          ))}
        </div>
      ))}
    </>
  )
}

function PlotsTab({ o }: { o: NovelOverview }): React.ReactElement {
  if (o.plotRows.length === 0) return <EmptyState icon={<IconDataOutlineRegular />}>还没有伏笔/情节文件（plots/）。写作后维护 pass 会从正文提取伏笔建议，确认后写入 plots/；也可直接让助手创建伏笔档案。</EmptyState>
  return (
    <>
      {o.plotRows.map(p => (
        <CollapsibleRow key={p.id}
          title={p.hint}
          aside={
            <span style={{ ...tagRowStyle, justifyContent: 'flex-end' }}>
              {p.plannedChapter.length > 0 && <Tag tone="neutral">计划 {p.plannedChapter}</Tag>}
              <Tag tone={statusTone(p.status)}>{p.status}</Tag>
            </span>
          }>
          <div style={previewStyle}>{p.preview}</div>
        </CollapsibleRow>
      ))}
    </>
  )
}

function CharactersTab({ o, mode, onModeChange }: { o: NovelOverview; mode: 'list' | 'graph'; onModeChange: (mode: 'list' | 'graph') => void }): React.ReactElement {
  if (o.characterRows.length === 0) return <EmptyState icon={<IconUsersOutlineRegular />}>还没有人物文件（characters/）。让助手创建人物卡（写背景/性格/关系/弧线），写作时会自动参考。</EmptyState>
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
        <Button variant="toolbar" size="sm" onClick={() => { onModeChange(mode === 'list' ? 'graph' : 'list') }}
          icon={<IconUsersOutlineRegular />}>
          {mode === 'list' ? '关系图' : '列表'}
        </Button>
      </div>
      {mode === 'graph' && <RelationGraph rows={o.characterRows} />}
      {mode === 'list' && o.characterRows.map(c => (
        <CollapsibleRow key={c.id}
          title={c.name}
          aside={
            <span style={{ ...tagRowStyle, justifyContent: 'flex-end' }}>
              {c.role.length > 0 && <Tag tone={c.role.includes('主角') ? 'solid' : 'outline'}>{c.role}</Tag>}
              {c.timelineCount > 0 && <span style={rowAside}>时间线 {c.timelineCount}</span>}
              {c.relationCount > 0 && <span style={rowAside}>关系 {c.relationCount}</span>}
            </span>
          }>
          <CharacterDetail row={c} />
        </CollapsibleRow>
      ))}
    </>
  )
}

/** 人物展开详情：正文小节（截断）+ 时间线条目 + 关系列表。 */
function CharacterDetail({ row }: { row: CharacterRow }) {
  return (
    <>
      {row.sections.map((section, i) => (
        <div key={i}>
          <div style={subSectionTitle}>{section.title}</div>
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflowY: 'auto' }}>{section.body}</div>
        </div>
      ))}
      {row.timeline.length > 0 && (
        <div>
          <div style={subSectionTitle}>时间线</div>
          {row.timeline.map((entry, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, padding: '3px 0', lineHeight: 1.6 }}>
              {entry.chapter.length > 0 && <Tag tone="outline">{entry.chapter}</Tag>}
              <span style={{ minWidth: 0 }}>{entry.state}</span>
            </div>
          ))}
        </div>
      )}
      {row.relations.length > 0 && (
        <div>
          <div style={subSectionTitle}>关系</div>
          {row.relations.map((rel: RelationEntry, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, padding: '3px 0', lineHeight: 1.6 }}>
              <Tag tone="neutral">{rel.name}</Tag>
              <span style={{ minWidth: 0 }}>{rel.desc}</span>
            </div>
          ))}
        </div>
      )}
      {row.sections.length === 0 && row.timeline.length === 0 && row.relations.length === 0 && (
        <div style={previewStyle}>（无正文小节/时间线/关系数据）</div>
      )}
    </>
  )
}

/** 待办页签展示上限（超出显示「还有 N」提示，不再静默截断）。 */
const PENDING_MAX_SECTIONS = 6
const PENDING_MAX_LINES_PER_SECTION = 15

function PendingTab({ o }: { o: NovelOverview }): React.ReactElement {
  if (o.pendingSections.length === 0) return <EmptyState icon={<IconChecklistOutlineRegular />}>没有待办（pending.md 为空或不存在）。写完一章后维护 pass 会把待确认的摘要/事实/伏笔建议写进这里。</EmptyState>
  const sections = o.pendingSections.slice(0, PENDING_MAX_SECTIONS)
  const hiddenSections = o.pendingSections.length - sections.length
  return (
    <>
      <div style={{ ...dim, fontSize: 11, margin: '2px 2px 8px' }}>
        共 {o.pendingLineTotal} 条待办（最新一次维护 pass 在最前；重复建议已合并，已完成项已过滤）
      </div>
      {sections.map((section, i) => {
        const lines = section.lines.slice(0, PENDING_MAX_LINES_PER_SECTION)
        const hidden = section.lines.length - lines.length
        return (
          <CollapsibleRow key={`${section.heading}-${i}`}
            title={section.heading}
            defaultOpen={i === 0}
            aside={<span style={rowAside}>{section.lines.length} 条</span>}>
            {lines.map((line, j) => (
              <div key={j} style={{ display: 'flex', gap: 8, padding: '3px 0', lineHeight: 1.7 }}>
                <span style={{ color: 'var(--dsw-alias-label-tertiary)', flexShrink: 0 }}>·</span>
                <span style={{ minWidth: 0 }}>{line}</span>
              </div>
            ))}
            {hidden > 0 && <div style={{ ...dim, fontSize: 11, paddingTop: 4 }}>还有 {hidden} 条未展开显示</div>}
          </CollapsibleRow>
        )
      })}
      {hiddenSections > 0 && <div style={{ ...dim, fontSize: 11, padding: '4px 2px' }}>还有 {hiddenSections} 次更早的维护 pass 未显示</div>}
    </>
  )
}

/** 写作面板：38px 头部 + 六页签（概况/大纲/章节/伏笔/人物/待办）。 */
export function WriterPanel(_props: WriterPanelProps) {
  const cold = useColdOverview()
  const live = usePanelState()
  const [tab, setTab] = useState<Tab>('overview')
  // 人物页 list/graph 模式提升到面板层（组件内 state 会随页签切换丢失）
  const [charactersMode, setCharactersMode] = useState<'list' | 'graph'>('list')
  const o = cold.overview

  return (
    <div style={root}>
      <div style={header}>
        <span style={headerTitle}>写作面板</span>
        {/* 加载中按钮 disabled 不派发 hover/focus，Tooltip 恰不可达——加载期不包 Tooltip（文案自明） */}
        {cold.loading ? (
          <Button variant="toolbar" size="sm" onClick={cold.refresh} disabled
            icon={<IconRefreshOutlineRegular />} aria-label="正在扫描小说项目">
            <TextShimmer active>扫描中</TextShimmer>
          </Button>
        ) : (
          <Tooltip label="重新扫描小说项目">
            <Button variant="toolbar" size="sm" onClick={cold.refresh}
              icon={<IconRefreshOutlineRegular />} aria-label="重新扫描小说项目">
              刷新
            </Button>
          </Tooltip>
        )}
      </div>
      <div style={{ flexShrink: 0, padding: '8px 12px 0' }}>
        <SegmentedTabs
          label="写作面板页签"
          value={tab}
          onChange={(v: string) => { setTab(v as Tab) }}
          items={[
            { value: 'overview', label: '概况', id: 'writer-tab-overview', panelId: 'writer-panel-overview' },
            { value: 'outline', label: '大纲', id: 'writer-tab-outline', panelId: 'writer-panel-outline' },
            { value: 'chapters', label: '章节', id: 'writer-tab-chapters', panelId: 'writer-panel-chapters' },
            { value: 'plots', label: '伏笔', id: 'writer-tab-plots', panelId: 'writer-panel-plots' },
            { value: 'characters', label: '人物', id: 'writer-tab-characters', panelId: 'writer-panel-characters' },
            { value: 'pending', label: '待办', id: 'writer-tab-pending', panelId: 'writer-panel-pending' },
          ]}
        />
      </div>
      <div style={body}>
        {cold.loading && o === null && (
          <div style={{ padding: '8px 2px' }}>
            <TextShimmer active>正在扫描小说项目…</TextShimmer>
          </div>
        )}
        {o !== null && (
          <div role="tabpanel" id={`writer-panel-${tab}`} aria-labelledby={`writer-tab-${tab}`}>
            {/* 刷新失败但保留旧数据时：错误降级为顶部提示条，不清空面板 */}
            {cold.error !== null && !cold.loading && (
              <div style={{ ...dim, fontSize: 11, color: 'var(--dsw-alias-state-warn-label)', padding: '2px 2px 8px' }}>
                上次刷新失败：{cold.error}（以下为最近一次成功扫描的数据）
              </div>
            )}
            {tab === 'overview' && <OverviewTab o={o} live={live} />}
            {tab === 'outline' && <OutlineTab o={o} />}
            {tab === 'chapters' && <ChaptersTab o={o} />}
            {tab === 'plots' && <PlotsTab o={o} />}
            {tab === 'characters' && <CharactersTab o={o} mode={charactersMode} onModeChange={setCharactersMode} />}
            {tab === 'pending' && <PendingTab o={o} />}
          </div>
        )}
        {o === null && !cold.loading && cold.error !== null && (
          <EmptyState icon={<IconInfoOutlineRegular />}>
            项目扫描失败：{cold.error}
            <br />请确认当前会话工作区含 novel/（或直接位于小说项目目录）。
          </EmptyState>
        )}
        {o === null && !cold.loading && cold.error === null && (
          <EmptyState icon={<IconInfoOutlineRegular />}>正在定位小说项目…</EmptyState>
        )}
      </div>
    </div>
  )
}

/** 侧边栏面板列表入口的图标（宿主基元「笔」形图标，与原生观感一致）。 */
export function WriterPanelIcon() {
  return <IconEditOutlineMedium size={16} />
}
