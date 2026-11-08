/**
 * 写作面板本体（注册进 main 槽 key=writer-panel；sidebar.panellist 提供入口）。
 *
 * v8（信息架构重设计，对齐参考项目 novel-writer 的 UI 概念）：数据链路（bus 数据总线 /
 * sessions 订阅 / workspaceFiles 增量刷新）不变，呈现层结构性升级——①大纲页签改
 * **卷→幕→章树形视图**（outline.md 小节标题分型：含「卷」= 卷、含「幕」= 幕、章号锚
 * = 章；章节叶经章号索引联动实际章节的已写状态/字数；已写未入大纲的章节单独回填区；
 * 无大纲时回退按卷分组清单）——原独立「章节」页签并入；②新增**灵感箱**页签（ideas.md
 * 碎片卡片）与**设定**页签（创作准则 principles.md / 世界观 worldbuilding/ 全文卡片 /
 * 重要事件 events.md / 风格示范 style/）；③伏笔展开详情升级为**生命周期步进轨**（计划
 * →种植→中间事件→回收，里程碑四型中文化）；④人物详情增「被指向」反向关系区。
 * v8 的 token 修复与视觉层级（卡片描边/Hero 侧条/图标统计格/分段占比条/章号 chip/
 * 头像圆/时间线步进轨/复选框行标）全部保留；颜色仍全 token 零字面。v9：①大纲与章节
 * **双页签并存**（v8 曾并入为错——大纲=情节结构树，章节=已写正文阅读面，用途不同）：
 * 章节页展开读正文全文（ChapterRow 携 content；面板无写盘通道，修改走对话、落盘自动
 * 刷新）；②概况统计格可点击跳转（悬停高亮 + 键盘可达）。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  Button, DisclosureRow, MarkdownText, SegmentedTabs, Tag, TextShimmer, Tooltip,
  IconArchiveOutlineRegular, IconBranchOutlineRegular, IconChecklistOutlineRegular,
  IconClockOutlineRegular, IconDataOutlineRegular, IconEditOutlineMedium,
  IconFolderOpenOutlineRegular, IconGaugeOutlineMedium, IconGlobeOutlineRegular,
  IconGoalOutlineRegular, IconInfoOutlineRegular, IconListPenOutlineRegular,
  IconRefreshOutlineRegular, IconShieldOutlineRegular, IconSparkleRegular,
  IconThinkOutlineRegular, IconUsersOutlineRegular, IconWarningTriangleOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { activeSessionId, scanNovel, subscribeSessions, watchProject } from './load.ts'
import { publishScan, publishWatchState, readBus, subscribeBus, type WriterBusSnapshot } from './bus.ts'
import type { CharacterRow, NovelOverview, OutlineTreeNode, PlotRow, RelationEntry } from './types.ts'

type Tab = 'overview' | 'outline' | 'chapters' | 'plots' | 'characters' | 'ideas' | 'settings' | 'pending'

// —— 布局基元（只引用现行主题 token；颜色零字面）——
const root: React.CSSProperties = {
  height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden',
  color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'var(--dsw-font-family)',
  fontSize: 'var(--dsh-content-font-size-secondary, 13px)',
  lineHeight: 1.6,
}
const header: React.CSSProperties = {
  height: 38, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '0 12px', borderBottom: '1px solid var(--dsw-alias-border-l2)',
}
const headerTitle: React.CSSProperties = { fontSize: 13, fontWeight: 600, letterSpacing: 0.3 }
const body: React.CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px 16px', scrollbarGutter: 'stable' }
/** 一级卡片：raised surface + 细描边（v7 视觉层级基座）。 */
const card: React.CSSProperties = {
  borderRadius: 'var(--dsw-radius-md)', padding: '10px 12px', marginBottom: 8,
  background: 'var(--dsw-alias-bg-layer-1)',
  border: '1px solid var(--dsw-alias-border-l1)',
}
const sectionTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: 1, margin: '16px 2px 6px',
  color: 'var(--dsw-alias-label-secondary)', textTransform: 'uppercase',
  display: 'flex', alignItems: 'center', gap: 5,
}
const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }
const rowMain: React.CSSProperties = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const rowAside: React.CSSProperties = { flexShrink: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: 11 }
const dim: React.CSSProperties = { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: 1.7 }
const empty: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
  padding: '36px 16px', color: 'var(--dsw-alias-label-secondary)', textAlign: 'center', fontSize: 12, lineHeight: 1.8,
}
const tagRowStyle: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }
const warnText: React.CSSProperties = { color: 'var(--dsw-alias-state-warn-primary)' }

/** 状态 → 状态点色 token（6px 圆点，与 Tag 语义色一致）。 */
const STATUS_DOT: Record<string, string> = {
  resolved: 'var(--dsw-alias-state-success-primary)',
  done: 'var(--dsw-alias-state-success-primary)',
  active: 'var(--dsw-alias-state-success-primary)',
  planted: 'var(--dsw-alias-state-warn-primary)',
  draft: 'var(--dsw-alias-state-warn-primary)',
  abandoned: 'var(--dsw-alias-state-error-primary)',
}
const statusDotColor = (status: string): string => STATUS_DOT[status.toLowerCase()] ?? 'var(--dsw-alias-border-l2)'

/** 状态小圆点（行内语义指示；与 Tag 同现时作 leading 视觉锚）。 */
function StatusDot({ status }: { status: string }): React.ReactElement {
  return <span aria-hidden style={{
    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
    display: 'inline-block', background: statusDotColor(status),
  }} />
}

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

/** 订阅数据总线（版本化快照；引用判等依赖 readBus 的缓存稳定性）。 */
function useWriterBus(): WriterBusSnapshot {
  return useSyncExternalStore(subscribeBus, readBus, readBus)
}

/** 扫描 UI 态（loading/error 本地；数据本体在总线）。 */
interface ScanUiState {
  loading: boolean
  error: string | null
  progress: { done: number; total: number } | null
}

/** 已成功扫描的会话定位（watch 接线用；值不变时保持引用防 effect 重启）。 */
interface ScanTarget {
  session: string
  dir: string
}

/**
 * 项目扫描 + 增量订阅编排：nonce 驱动扫描（发布总线）；会话切换经 sessions observable
 * （不可用回退 2s 轮询）；扫描成功后接管 changes 增量刷新（去抖 600ms 重扫；
 * watch 不支持/断流时降级手动刷新并标记）。
 */
function useProjectScan(): ScanUiState & { refresh: () => void; bus: WriterBusSnapshot } {
  const bus = useWriterBus()
  const [ui, setUi] = useState<ScanUiState>({ loading: false, error: null, progress: null })
  const [nonce, setNonce] = useState(0)
  const [target, setTarget] = useState<ScanTarget | null>(null)
  // watch 断流重连纪元（ended 后 bump 重启 watch effect；重试计数按 target 归零——
  // epoch 重启不清零，否则「≤3 次退避」永不生效）
  const [watchEpoch, setWatchEpoch] = useState(0)
  const watchRetries = useRef(0)
  const retryAnchor = useRef<ScanTarget | null>(null)
  const refresh = useCallback(() => { setNonce(n => n + 1) }, [])

  // 会话切换探测：sessions.list.subscribe（替换 2s 轮询；observable 缺席回退轮询）。
  // 只在**活跃会话变化**时动作：作废旧 watch target（防旧会话残跑打断新会话扫描）+ 重扫。
  useEffect(() => {
    let last = activeSessionId()
    const onSessionChange = (): void => {
      const current = activeSessionId()
      if (current === last) return
      last = current
      setTarget(null)
      setNonce(n => n + 1)
    }
    const { dispose, supported } = subscribeSessions(onSessionChange)
    if (supported) return dispose
    const timer = setInterval(onSessionChange, 2000)
    return () => { clearInterval(timer) }
  }, [])

  // 扫描（会话缺席/失败保留旧数据 + 提示条；成功发布总线）
  useEffect(() => {
    const controller = new AbortController()
    setUi(prev => ({ ...prev, loading: true, progress: null }))
    const sessionId = activeSessionId()
    if (sessionId === null) {
      setUi(prev => ({ ...prev, loading: false, error: '没有活跃会话，无法定位工作区' }))
      return
    }
    scanNovel(sessionId, controller.signal, (done, total) => {
      if (!controller.signal.aborted) setUi(prev => ({ ...prev, progress: { done, total } }))
    })
      .then(scan => {
        if (controller.signal.aborted) return
        publishScan(scan)
        const dir = scan.root === '.' ? '' : scan.root
        setTarget(prev => prev !== null && prev.session === sessionId && prev.dir === dir ? prev : { session: sessionId, dir })
        setUi({ loading: false, error: null, progress: null })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setUi(prev => ({ ...prev, loading: false, error: error instanceof Error ? error.message : String(error) }))
      })
    return () => { controller.abort() }
  }, [nonce])

  // changes 增量订阅（target/epoch 变化才重启；ready 标记接管；unsupported 降级手动刷新；
  // 曾就绪的断流（ended）按 1s/2s/4s 退避重连 ≤3 次——计数只在 target 变化时归零，
  // 重试耗尽或未就绪即结束 → 降级手动刷新。启动时 watched 置回未决，防旧会话值残留）
  useEffect(() => {
    // target 作废（会话切换/未定位）：watched 置回未决，防旧会话 watched=true 残留继承
    if (target === null) {
      publishWatchState(null)
      return
    }
    if (retryAnchor.current !== target) {
      retryAnchor.current = target
      watchRetries.current = 0
    }
    publishWatchState(null)
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    let backoff: ReturnType<typeof setTimeout> | null = null
    let disposed = false
    let gotReady = false
    void watchProject(target.session, target.dir, controller.signal, () => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        if (!disposed && !controller.signal.aborted) setNonce(n => n + 1)
      }, 600)
    }, () => {
      gotReady = true
      if (disposed) return
      publishWatchState(true)
      // 退避重连后的 ready 补扫一次：断流→重连窗口内（≤7s）的文件变更事件已永久
      // 丢失，仅靠后续 change 帧无法覆盖——重扫兜底防漏（首次连接不补：扫描刚完成）
      if (watchRetries.current > 0) setNonce(n => n + 1)
    }).then(outcome => {
      if (disposed) return
      if (outcome === 'ended' && gotReady && watchRetries.current < 3) {
        watchRetries.current++
        const delay = 1000 * 2 ** (watchRetries.current - 1)
        backoff = setTimeout(() => {
          if (!disposed) setWatchEpoch(e => e + 1)
        }, delay)
        return
      }
      // unsupported（fs 无 watch / 服务缺席）与重试耗尽/未就绪即结束 → 降级手动刷新
      publishWatchState(false)
    })
    return () => {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      if (backoff !== null) clearTimeout(backoff)
      controller.abort()
    }
  }, [target, watchEpoch])

  return { ...ui, refresh, bus }
}

/** 细进度条（v7：6px 圆角轨道 + 品牌色填充；右侧可带文字说明）。 */
function ProgressBar({ progress, height = 6 }: { progress: number | null; height?: number }): React.ReactElement | null {
  if (progress === null) return null
  // progress=0 不渲染填充（旧实现 Math.max(…,1.5)% 会显示假进度）
  return (
    <div style={{
      height, borderRadius: 'var(--dsw-radius-xs)',
      background: 'var(--dsw-alias-bg-layer-2)', overflow: 'hidden', marginTop: 8,
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
function CollapsibleRow({ title, leading, aside, children, defaultOpen = false }: {
  title: string
  leading?: React.ReactNode
  aside?: React.ReactNode
  children?: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const toggle = useCallback((): void => { setOpen(v => !v) }, [])
  return (
    <div style={{
      marginBottom: 6, borderRadius: 'var(--dsw-radius-md)',
      background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)',
    }}>
      <DisclosureRow
        icon={leading ?? rowIcon}
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
  color: 'var(--dsw-alias-label-secondary)', textTransform: 'uppercase',
}
const previewStyle: React.CSSProperties = { color: 'var(--dsw-alias-label-secondary)' }

/**
 * Markdown 渲染的本地化 chrome（**模块级常量，引用必须稳定**——labels 引用变化会
 * 丢弃 MarkdownText 的渲染缓存；M3 全面接管正文渲染时收编为 locale 资源）。
 * 提前落地自 M3：大纲/人物正文小节先走 MarkdownText（GFM 表格/子标题正确渲染），
 * 折叠摘要（章节/伏笔 preview）仍为纯文本。
 */
const markdownLabels = {
  code: {
    copyLabel: '复制',
    copiedLabel: '已复制',
    toolbarLabels: { codeLabel: '代码', wrapLabel: '自动换行', unwrapLabel: '不换行' },
  },
  footnotes: '脚注',
} as const

/** 正文小节渲染容器（限高滚动；Markdown 内容走 MarkdownText）。 */
function MarkdownBody({ text, maxHeight }: { text: string; maxHeight: number }): React.ReactElement {
  return (
    <div style={{ maxHeight, overflowY: 'auto', fontSize: 12, lineHeight: 1.7 }}>
      <MarkdownText text={text} labels={markdownLabels} />
    </div>
  )
}

/** 章号方块 chip（等宽三位序号的视觉锚；正文行内统一观感）。 */
function ChapterChip({ id }: { id: string }): React.ReactElement {
  return (
    <span style={{
      flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 26, height: 18, padding: '0 4px', borderRadius: 'var(--dsw-radius-xs)',
      border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)',
      fontSize: 10, fontWeight: 600, letterSpacing: 0.5, color: 'var(--dsw-alias-label-secondary)',
      fontVariantNumeric: 'tabular-nums',
    }}>{id}</span>
  )
}

/** 人物首字头像（主角品牌色描边，其余细描边）。 */
function Avatar({ name, hero }: { name: string; hero: boolean }): React.ReactElement {
  return (
    <span aria-hidden style={{
      flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--dsw-alias-bg-layer-2)',
      border: hero ? '1.5px solid var(--dsw-alias-brand-primary)' : '1px solid var(--dsw-alias-border-l2)',
      color: hero ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
      fontSize: 12, fontWeight: 600,
    }}>{name.slice(0, 1)}</span>
  )
}

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
    <div style={{
      borderRadius: 'var(--dsw-radius-md)', background: 'var(--dsw-alias-bg-layer-1)',
      border: '1px solid var(--dsw-alias-border-l1)', padding: 8,
    }}>
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
              <circle cx={p.x} cy={p.y} r={hero ? 18 : 14} fill="var(--dsw-alias-bg-layer-2)"
                stroke={hero ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'} strokeWidth={hero ? 2 : 1}>
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

/** 统计格（v7：图标 + 大数值 + 小标签，raised 卡；v9：可点击跳转对应页签——悬停高亮描边）。 */
function StatCell({ icon, value, label, onClick }: {
  icon: React.ReactNode
  value: number
  label: string
  onClick?: () => void
}): React.ReactElement {
  const [hover, setHover] = useState(false)
  const clickable = onClick !== undefined
  const props = clickable
    ? {
      role: 'button', tabIndex: 0, 'aria-label': `查看${label}`,
      onClick, onMouseEnter: () => { setHover(true) }, onMouseLeave: () => { setHover(false) },
      onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } },
      style: {
        cursor: 'pointer',
        borderColor: hover ? 'var(--dsw-alias-border-l2)' : 'var(--dsw-alias-border-l1)',
      } as React.CSSProperties,
    }
    : {}
  return (
    <div {...props} style={{
      textAlign: 'center', padding: '10px 4px 8px', borderRadius: 'var(--dsw-radius-md)',
      background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      ...(props.style ?? {}),
    }}>
      <span style={{ color: hover && clickable ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)', display: 'inline-flex' }}>{icon}</span>
      <span style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      <span style={{ fontSize: 10, color: 'var(--dsw-alias-label-secondary)' }}>{label}{clickable ? ' →' : ''}</span>
    </div>
  )
}

const statGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 10 }

/** 卷分布分段占比条（v7：单卷退化为一根品牌色实条；交替 brand / 描边色区分相邻段）。 */
function VolumeBar({ volumes, total }: { volumes: { name: string; count: number }[]; total: number }): React.ReactElement {
  const segments = volumes.map((v, i) => ({
    ...v,
    pct: total > 0 ? v.count / total : 0,
    // 相邻段交替取色，避免同色连段糊成一体；非品牌段用层级色确保低对比不抢焦点
    color: i % 2 === 0 ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)',
  }))
  return (
    <div style={{ ...card, padding: 10 }}>
      <div style={{ display: 'flex', height: 8, borderRadius: 'var(--dsw-radius-xs)', overflow: 'hidden', gap: 1, background: 'var(--dsw-alias-bg-layer-2)' }}>
        {segments.map(s => <div key={s.name} style={{ width: `${s.pct * 100}%`, background: s.color }} />)}
      </div>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {segments.map(s => (
          <div key={s.name} style={{ ...row, lineHeight: 1.9 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
              <span style={rowMain}>{s.name}</span>
            </span>
            <span style={{ ...rowAside, fontVariantNumeric: 'tabular-nums' }}>
              {s.count} 章{s.pct > 0 ? ` · ${Math.round(s.pct * 100)}%` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 概况页：品牌侧条 Hero（书名 + 进度 + 字数）→ 下一步行动 → 健康度 → 统计（点击跳转）→ 卷分布 → 最近章节 → 伏笔状态 → 会话动态。 */
function OverviewTab({ o, live, watched, onNavigate }: { o: NovelOverview; live: WriterBusSnapshot['live']; watched: boolean | null; onNavigate: (tab: Tab) => void }): React.ReactElement {
  const { red, yellow, gray } = o.riskSummary
  const healthy = red === 0 && yellow === 0 && o.staleChapters.length === 0
  const pct = o.progress !== null ? Math.round(Math.min(o.progress * 100, 100)) : null
  return (
    <>
      {/* Hero：品牌色侧条 + 书名/类型 + 进度条 + 字数进度 */}
      <div style={{ ...card, borderLeft: '3px solid var(--dsw-alias-brand-primary)', padding: '12px 12px 10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <strong style={{ fontSize: 16, letterSpacing: 0.3 }}>《{o.title}》</strong>
          {o.genre.length > 0 && <Tag tone="info">{o.genre}</Tag>}
        </div>
        <ProgressBar progress={o.progress} />
        <div style={{ ...dim, marginTop: 6, fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>
            {o.targetWords > 0
              ? <>{o.totalChars} / {o.targetWords} 字{o.chapterTarget > 0 ? ` · ${o.chapters}/${o.chapterTarget} 章` : ''}</>
              : `约 ${o.totalChars} 字`}
          </span>
          {pct !== null && <span style={{ color: 'var(--dsw-alias-brand-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>}
        </div>
      </div>

      {/* 情境卡（当前项目状态下最有价值的下一步动作） */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--dsw-alias-brand-primary)', display: 'inline-flex' }}><IconGoalOutlineRegular /></span>
          <strong>下一步：{o.nextStep.title}</strong>
        </div>
        <div style={{ ...dim, fontSize: 12, marginTop: 4 }}>{o.nextStep.hint}</div>
      </div>

      {/* 健康度徽章行（伏笔三色 + 待维护；全绿给正面反馈） */}
      <div style={{ ...tagRowStyle, marginBottom: 8, padding: '0 2px' }}>
        {healthy && <Tag tone="success">健康</Tag>}
        {red > 0 && <Tag tone="danger">伏笔超期 {red}</Tag>}
        {yellow > 0 && <Tag tone="warning">活跃伏笔 {yellow}</Tag>}
        {gray > 0 && <Tag tone="neutral">未种植 {gray}</Tag>}
        {o.staleChapters.length > 0 && <Tag tone="warning">待维护 {o.staleChapters.length} 章</Tag>}
      </div>

      {/* 部分失败与增量订阅降级提示（如实呈现，不静默） */}
      {o.failedFiles.length > 0 && (
        <div style={{ ...dim, fontSize: 11, ...warnText, padding: '0 2px 6px', display: 'flex', gap: 6 }}>
          <IconWarningTriangleOutlineMedium />
          <span>{o.failedFiles.length} 个文件读取失败（{o.failedFiles.slice(0, 3).join('、')}{o.failedFiles.length > 3 ? ' 等' : ''}）</span>
        </div>
      )}
      {watched === false && (
        <div style={{ ...dim, fontSize: 11, padding: '0 2px 6px' }}>
          目录增量订阅不可用或已断开——文件变更后请用「刷新」手动更新。
        </div>
      )}

      <div style={statGrid}>
        <StatCell icon={<IconListPenOutlineRegular />} value={o.chapters} label="章节" onClick={() => { onNavigate('chapters') }} />
        <StatCell icon={<IconUsersOutlineRegular />} value={o.characterRows.length} label="人物" onClick={() => { onNavigate('characters') }} />
        <StatCell icon={<IconDataOutlineRegular />} value={o.plotRows.length} label="伏笔" onClick={() => { onNavigate('plots') }} />
        <StatCell icon={<IconGlobeOutlineRegular />} value={o.worldbuildingCount} label="世界观" onClick={() => { onNavigate('settings') }} />
      </div>

      {o.volumes.length > 0 && (
        <>
          <div style={sectionTitle}><IconGaugeOutlineMedium />卷分布</div>
          <VolumeBar volumes={o.volumes} total={o.chapters} />
        </>
      )}

      {o.recentChapters.length > 0 && (
        <>
          <div style={sectionTitle}><IconListPenOutlineRegular />最近章节</div>
          <div style={{ ...card, padding: '6px 12px' }}>
            {o.recentChapters.map((ch, i) => (
              <div key={i} style={{ ...row, lineHeight: 2.1 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  <ChapterChip id={ch.id} />
                  <span style={rowMain}>{ch.title}</span>
                </span>
                <span style={rowAside}>{ch.volume.length > 0 ? `${ch.volume} · ` : ''}≈{ch.chars} 字</span>
              </div>
            ))}
          </div>
        </>
      )}

      {o.foreshadow.length > 0 && (
        <>
          <div style={sectionTitle}><IconDataOutlineRegular />伏笔状态</div>
          <div style={{ ...tagRowStyle, marginBottom: 4, padding: '0 2px' }}>
            {o.foreshadow.map(f => (
              <span key={f.status} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <StatusDot status={f.status} />
                <Tag tone={statusTone(f.status)}>{f.status} ×{f.count}</Tag>
              </span>
            ))}
          </div>
        </>
      )}

      {live.writes.length > 0 && (
        <>
          <div style={sectionTitle}><IconListPenOutlineRegular />本会话写作</div>
          <div style={{ ...card, padding: '6px 12px' }}>
            {live.writes.slice(0, 6).map((write, i) => {
              const warn = write.droppedSentences > 0 || write.patchesSkipped > 0 || write.repetitionStripped > 0
              return (
                <div key={i} style={{ ...row, lineHeight: 2.1, color: warn ? 'var(--dsw-alias-state-warn-primary)' : undefined }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    <ChapterChip id={write.chapterId} />
                    <span style={rowMain}>{write.mode}</span>
                  </span>
                  {/* 告警行内 aside 覆盖为告警色（丢句/复述计数必须在告警色里） */}
                  <span style={warn ? { ...rowAside, color: 'var(--dsw-alias-state-warn-primary)' } : rowAside}>
                    ≈{write.chars} 字{write.droppedSentences > 0 ? ` · ⚠丢句 ${write.droppedSentences}` : ''}{write.repetitionStripped > 0 ? ` · ⚠剔复述 ${write.repetitionStripped}` : ''}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}

      {live.activities.length > 0 && (
        <>
          <div style={sectionTitle}><IconClockOutlineRegular />写作动态</div>
          <div style={{ ...card, padding: '6px 12px' }}>
            {live.activities.slice(0, 8).map((activity, i) => (
              <div key={i} style={{ ...dim, fontSize: 11, display: 'flex', gap: 6, lineHeight: 2 }}>
                <span style={{ color: 'var(--dsw-alias-label-secondary)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{activity.time}</span>
                <span style={rowMain}><code style={{ fontSize: 10 }}>{activity.tool}</code> {activity.summary}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

/** 大纲树节点 leading 图标（按层级语义：卷=文件夹 / 幕=分支 / 备注=列表；章用章号 chip）。 */
function outlineLeading(node: OutlineTreeNode): React.ReactNode {
  if (node.kind === 'volume') return <IconFolderOpenOutlineRegular />
  if (node.kind === 'act') return <IconBranchOutlineRegular />
  if (node.kind === 'note') return <IconListPenOutlineRegular />
  return <ChapterChip id={String(node.chapterNumber ?? '').padStart(3, '0')} />
}

/** 大纲树章节叶的行尾状态：已写（字数 + 状态点）/ 未写（灰 Tag）。 */
function outlineChapterAside(node: OutlineTreeNode): React.ReactNode {
  if (node.written === null) return <Tag tone="neutral">未写</Tag>
  return (
    <span style={{ ...tagRowStyle, justifyContent: 'flex-end' }}>
      <span style={{ ...rowAside, fontVariantNumeric: 'tabular-nums' }}>≈{node.written.chars} 字</span>
      {node.written.status.length > 0 && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <StatusDot status={node.written.status} />
          <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-secondary)' }}>{node.written.status}</span>
        </span>
      )}
    </span>
  )
}

/** 递归渲染大纲树（卷→幕→章；子层缩进 14px；容器默认折叠、首容器展开）。 */
function OutlineTreeLevel({ nodes, depth }: { nodes: OutlineTreeNode[]; depth: number }): React.ReactElement {
  return (
    <>
      {nodes.map((node, i) => {
        const hasChildren = node.children.length > 0
        const title = node.kind === 'chapter'
          ? node.written !== null && node.written.title.length > 0 ? node.written.title : node.title
          : node.title
        return (
          <div key={`${node.kind}-${node.title}-${i}`} style={depth > 0 ? { marginLeft: 14 } : undefined}>
            <CollapsibleRow
              leading={outlineLeading(node)}
              title={title}
              defaultOpen={depth === 0 && i === 0 && hasChildren}
              aside={node.kind === 'chapter' ? outlineChapterAside(node)
                : hasChildren ? <span style={rowAside}>{node.children.length} 项</span> : undefined}>
              {node.body.length > 0 && <MarkdownBody text={node.body} maxHeight={280} />}
              {hasChildren && (
                <div style={{ marginTop: node.body.length > 0 ? 8 : 0 }}>
                  <OutlineTreeLevel nodes={node.children} depth={depth + 1} />
                </div>
              )}
            </CollapsibleRow>
          </div>
        )
      })}
    </>
  )
}

/** 大纲页签：梗概卡 + 卷→幕→章情节结构树（章节叶联动写作状态）+ 已写未入大纲回填区。 */
function OutlineTab({ o }: { o: NovelOverview }): React.ReactElement {
  const outline = o.outline
  if (outline === null) {
    return <EmptyState icon={<IconListPenOutlineRegular />}>没有大纲（novel/outline.md 不存在或为空）。让助手规划大纲后会出现在这里——已写章节见「章节」页签。</EmptyState>
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
      <OutlineTreeLevel nodes={o.outlineTree} depth={0} />
      {o.unanchoredChapters.length > 0 && (
        <>
          <div style={sectionTitle}><IconWarningTriangleOutlineMedium />已写未入大纲</div>
          {o.unanchoredChapters.map(ch => (
            <CollapsibleRow key={ch.id} leading={<ChapterChip id={ch.id} />} title={ch.title}
              aside={
                <span style={{ ...tagRowStyle, justifyContent: 'flex-end' }}>
                  <span style={{ ...rowAside, fontVariantNumeric: 'tabular-nums' }}>≈{ch.chars} 字</span>
                  {ch.status.length > 0 && <Tag tone={statusTone(ch.status)}>{ch.status}</Tag>}
                </span>
              }>
              <div style={previewStyle}>{ch.preview}</div>
            </CollapsibleRow>
          ))}
          <div style={{ ...dim, fontSize: 11, padding: '2px 2px 6px' }}>
            这些章节有正文但没有对应的大纲章锚——让助手把它们补进 outline.md，树形视图才完整。
          </div>
        </>
      )}
    </>
  )
}

/** 伏笔中间事件类型 → 中文标签（与 domain ForeshadowMilestone 四型对齐）。 */
const MILESTONE_LABELS: Record<PlotRow['milestones'][number]['type'], string> = {
  reinforcement: '强化',
  partial_reveal: '半揭示',
  callback: '回调',
  red_herring: '红鲱鱼',
}

/** 伏笔生命周期步进轨（展开态）：计划 → 种植 → 中间事件 → 回收；缺失锚的段直接省略（如实呈现已有数据）。 */
function PlotLifecycle({ row }: { row: PlotRow }): React.ReactElement {
  const steps: Array<{ label: string; chapter: string; note?: string }> = []
  // plannedChapter 投影带 planted 回退（行尾 Tag 用）：与 plantedChapter 同值时是回退产物，步进轨跳过防「计划+种植」重复
  if (row.plannedChapter.length > 0 && row.plannedChapter !== row.plantedChapter) steps.push({ label: '计划', chapter: row.plannedChapter })
  if (row.plantedChapter.length > 0) steps.push({ label: '种植', chapter: row.plantedChapter })
  for (const m of row.milestones) steps.push({ label: MILESTONE_LABELS[m.type] ?? m.type, chapter: m.chapter, note: m.note })
  if (row.resolvedChapter.length > 0) steps.push({ label: '回收', chapter: row.resolvedChapter })
  if (steps.length === 0) return <></>
  return (
    <div style={{ position: 'relative', margin: '4px 0 2px 3px', paddingLeft: 14, borderLeft: '1.5px solid var(--dsw-alias-border-l2)' }}>
      {steps.map((step, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, padding: '3px 0', lineHeight: 1.6, position: 'relative', alignItems: 'baseline' }}>
          <span aria-hidden style={{
            position: 'absolute', left: -18.5, top: 9, width: 7, height: 7, borderRadius: '50%',
            background: 'var(--dsw-alias-bg-layer-1)', border: '1.5px solid var(--dsw-alias-border-l2)',
          }} />
          {step.chapter.length > 0 && <ChapterChip id={step.chapter} />}
          <span style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 11 }}>{step.label}</strong>
            {step.note !== undefined && step.note.length > 0 ? `　${step.note}` : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

/** 章节页签（阅读面）：按卷分组的已写章节，展开读正文全文（Markdown 渲染，限高滚动）。
 * 边界留痕：第三方客户端插件对宿主 workspaceFiles 只有读面（list/read），面板内直接编辑
 * 不具备落盘通道——修改走对话（writer_update / 补丁改写），落盘后增量订阅自动刷新本页。 */
function ChaptersTab({ o }: { o: NovelOverview }): React.ReactElement {
  if (o.chapterRows.length === 0) {
    return <EmptyState icon={<IconInfoOutlineRegular />}>还没有章节。在「写作模式」会话里让助手写第一章（write_chapter）后，这里会出现章节列表。</EmptyState>
  }
  const groups = new Map<string, typeof o.chapterRows>()
  for (const ch of o.chapterRows) {
    const volume = ch.volume.length > 0 ? ch.volume : '正文'
    const list = groups.get(volume) ?? []
    list.push(ch)
    groups.set(volume, list)
  }
  return (
    <>
      <div style={{ ...dim, fontSize: 11, margin: '2px 2px 8px' }}>
        共 {o.chapterRows.length} 章 · {o.totalChars} 字；点击展开阅读正文。要修改内容，在对话里让助手改（本面板无写盘通道，改动落盘后自动刷新）。
      </div>
      {[...groups.entries()].map(([volume, chapters]) => (
        <div key={volume}>
          {groups.size > 1 && (
            <div style={{ ...sectionTitle, marginTop: 8 }}>
              <IconGaugeOutlineMedium />{volume}
              <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{chapters.length} 章</span>
            </div>
          )}
          {chapters.slice().reverse().map((ch, i) => (
            <CollapsibleRow key={ch.id}
              leading={<ChapterChip id={ch.id} />}
              title={ch.title}
              defaultOpen={i === 0}
              aside={
                <span style={{ ...tagRowStyle, justifyContent: 'flex-end' }}>
                  <span style={{ ...rowAside, fontVariantNumeric: 'tabular-nums' }}>≈{ch.chars} 字</span>
                  {ch.storyline.length > 0 && <Tag tone="outline">{ch.storyline}</Tag>}
                  {ch.status.length > 0 && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <StatusDot status={ch.status} />
                      <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-secondary)' }}>{ch.status}</span>
                    </span>
                  )}
                </span>
              }>
              <MarkdownBody text={ch.content} maxHeight={560} />
            </CollapsibleRow>
          ))}
        </div>
      ))}
    </>
  )
}

/** 伏笔页签（决策面）：三色汇总 + 风险分桶（超期>活跃>未种植>已收束）+ 逾期 Tag + 状态点。 */
function PlotsTab({ o }: { o: NovelOverview }): React.ReactElement {
  if (o.plotRows.length === 0) return <EmptyState icon={<IconDataOutlineRegular />}>还没有伏笔/情节文件（plots/）。写作后维护 pass 会从正文提取伏笔建议，确认后写入 plots/；也可直接让助手创建伏笔档案。</EmptyState>
  const { red, yellow, gray } = o.riskSummary
  // 分桶（桶内保持既有风险排序：due 近的在前）
  const buckets = new Map<string, { label: string; dotColor: string; rows: typeof o.plotRows }>([
    ['overdue', { label: '超期未回收', dotColor: 'var(--dsw-alias-state-error-primary)', rows: [] }],
    ['active', { label: '活跃 / 停滞', dotColor: 'var(--dsw-alias-state-warn-primary)', rows: [] }],
    ['planned', { label: '未种植', dotColor: 'var(--dsw-alias-border-l2)', rows: [] }],
    ['resolved', { label: '已收束', dotColor: 'var(--dsw-alias-state-success-primary)', rows: [] }],
  ])
  for (const p of o.plotRows) {
    if (p.overdue) buckets.get('overdue')!.rows.push(p)
    else if (p.status === 'planned' || p.status === 'draft') buckets.get('planned')!.rows.push(p)
    else if (p.status === 'resolved' || p.status === 'done' || p.status === 'abandoned') buckets.get('resolved')!.rows.push(p)
    else buckets.get('active')!.rows.push(p)
  }
  return (
    <>
      <div style={{ ...tagRowStyle, marginBottom: 8, padding: '0 2px' }}>
        {red > 0 && <Tag tone="danger">超期未回收 {red}</Tag>}
        {yellow > 0 && <Tag tone="warning">停滞/活跃 {yellow}</Tag>}
        {gray > 0 && <Tag tone="neutral">未种植 {gray}</Tag>}
        {red + yellow + gray === 0 && <Tag tone="success">全部伏笔已收束</Tag>}
      </div>
      {[...buckets.values()].filter(b => b.rows.length > 0).map(bucket => (
        <div key={bucket.label}>
          <div style={sectionTitle}>
            <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: bucket.dotColor, flexShrink: 0 }} />
            {bucket.label}
            <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{bucket.rows.length}</span>
          </div>
          {bucket.rows.map(p => (
            <CollapsibleRow key={p.id}
              leading={p.overdue ? <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--dsw-alias-state-error-primary)' }} /> : undefined}
              title={p.hint}
              aside={
                <span style={{ ...tagRowStyle, justifyContent: 'flex-end' }}>
                  {p.overdue && p.dueDelta !== null && <Tag tone="danger">逾期 {Math.abs(p.dueDelta)} 章</Tag>}
                  {p.plannedChapter.length > 0 && <Tag tone="neutral">计划 {p.plannedChapter}</Tag>}
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <StatusDot status={p.status} />
                    <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-secondary)' }}>{p.status}</span>
                  </span>
                </span>
              }>
              {/* 生命周期步进轨：计划 → 种植 → 中间事件（强化/半揭示/回调/红鲱鱼）→ 回收 */}
              <PlotLifecycle row={p} />
              <div style={{ ...previewStyle, marginTop: 6 }}>{p.preview}</div>
            </CollapsibleRow>
          ))}
        </div>
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
          leading={<Avatar name={c.name} hero={c.role.includes('主角')} />}
          title={c.name}
          defaultOpen={c.role.includes('主角')}
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

/** 人物展开详情：正文小节（截断）+ 时间线竖向步进轨 + 关系列表。 */
function CharacterDetail({ row }: { row: CharacterRow }) {
  return (
    <>
      {row.sections.map((section, i) => (
        <div key={i}>
          <div style={subSectionTitle}>{section.title}</div>
          <MarkdownBody text={section.body} maxHeight={200} />
        </div>
      ))}
      {row.timeline.length > 0 && (
        <div>
          <div style={subSectionTitle}>时间线</div>
          {/* 竖向步进轨：左侧 1.5px 轨线，条目圆点压轨；章号 chip + 状态文本 */}
          <div style={{ position: 'relative', margin: '4px 0 2px 3px', paddingLeft: 14, borderLeft: '1.5px solid var(--dsw-alias-border-l2)' }}>
            {row.timeline.map((entry, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, padding: '4px 0', lineHeight: 1.6, position: 'relative' }}>
                <span aria-hidden style={{
                  position: 'absolute', left: -18.5, top: 11, width: 7, height: 7, borderRadius: '50%',
                  background: 'var(--dsw-alias-bg-layer-1)', border: '1.5px solid var(--dsw-alias-border-l2)',
                }} />
                {entry.chapter.length > 0 && <ChapterChip id={entry.chapter} />}
                <span style={{ minWidth: 0 }}>{entry.state}</span>
              </div>
            ))}
          </div>
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
      {row.reverseRelations.length > 0 && (
        <div>
          <div style={subSectionTitle}>被指向（他人档案声明）</div>
          {row.reverseRelations.map((rel: RelationEntry, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, padding: '3px 0', lineHeight: 1.6 }}>
              <Tag tone="outline">{rel.name}</Tag>
              <span style={{ minWidth: 0 }}>{rel.desc}</span>
            </div>
          ))}
        </div>
      )}
      {row.sections.length === 0 && row.timeline.length === 0 && row.relations.length === 0 && row.reverseRelations.length === 0 && (
        <div style={previewStyle}>（无正文小节/时间线/关系数据）</div>
      )}
    </>
  )
}

/** 灵感箱页签（ideas.md 碎片卡：标题 + 正文小节；只读呈现面——与参考项目的差异如实披露）。 */
function IdeasTab({ o }: { o: NovelOverview }): React.ReactElement {
  if (o.ideas === null || o.ideas.length === 0) {
    return <EmptyState icon={<IconThinkOutlineRegular />}>
      灵感箱还是空的。在对话里随手记下你的构思——爽点、关键剧情、伏笔种子——让助手写进
      ideas.md（每条一个 `## 标题` 小节），会以碎片卡片出现在这里。
    </EmptyState>
  }
  return (
    <>
      <div style={{ ...dim, fontSize: 11, margin: '2px 2px 8px' }}>
        共 {o.ideas.length} 条灵感碎片（只读呈现；想要整理成情节/伏笔时在对话里让助手处理）
      </div>
      {o.ideas.map((idea, i) => (
        <div key={i} style={{ ...card, padding: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: idea.body.length > 0 ? 4 : 0 }}>
            <span style={{ color: 'var(--dsw-alias-brand-primary)', display: 'inline-flex' }}><IconSparkleRegular /></span>
            <strong style={{ fontSize: 12 }}>{idea.title}</strong>
          </div>
          {idea.body.length > 0 && <MarkdownBody text={idea.body} maxHeight={200} />}
        </div>
      ))}
    </>
  )
}

/** 设定页签：创作准则（项目宪法）+ 世界观 + 重要事件 + 风格示范。 */
function SettingsTab({ o }: { o: NovelOverview }): React.ReactElement {
  const nothing = o.principles === null && o.worldRows.length === 0 && o.events === null && o.styleRows.length === 0
  if (nothing) {
    return <EmptyState icon={<IconShieldOutlineRegular />}>
      还没有设定文件。让助手生成创作准则（principles.md）、世界观档案（worldbuilding/）、
      重要事件（events.md）或风格示范（style/），都会汇集在这里。
    </EmptyState>
  }
  return (
    <>
      {o.principles !== null && o.principles.length > 0 && (
        <>
          <div style={sectionTitle}><IconShieldOutlineRegular />创作准则<span style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>写作时全量注入的红线与基调</span></div>
          {o.principles.map((section, i) => (
            <CollapsibleRow key={i} title={section.title} defaultOpen={i === 0}
              leading={<span style={{ color: 'var(--dsw-alias-label-secondary)', display: 'inline-flex' }}><IconShieldOutlineRegular /></span>}
              aside={<span style={{ ...rowAside, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{section.body.slice(0, 50)}</span>}>
              <MarkdownBody text={section.body} maxHeight={320} />
            </CollapsibleRow>
          ))}
        </>
      )}
      {o.worldRows.length > 0 && (
        <>
          <div style={sectionTitle}><IconGlobeOutlineRegular />世界观<span style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{o.worldRows.length} 条</span></div>
          {o.worldRows.map(w => (
            <CollapsibleRow key={w.id} title={w.title}
              leading={<span style={{ color: 'var(--dsw-alias-label-secondary)', display: 'inline-flex' }}><IconGlobeOutlineRegular /></span>}
              aside={w.sections.length > 1 ? <span style={rowAside}>{w.sections.length} 节</span> : undefined}>
              {w.sections.length === 0
                ? <div style={previewStyle}>（无正文小节）</div>
                : w.sections.length === 1
                  ? <MarkdownBody text={w.sections[0]!.body} maxHeight={320} />
                  : w.sections.map((section, i) => (
                    <div key={i}>
                      <div style={subSectionTitle}>{section.title}</div>
                      <MarkdownBody text={section.body} maxHeight={200} />
                    </div>
                  ))}
            </CollapsibleRow>
          ))}
          {o.worldbuildingTruncated > 0 && (
            <div style={{ ...dim, fontSize: 11, padding: '2px 2px 6px' }}>
              另有 {o.worldbuildingTruncated} 条世界观条目超过读取上限未加载（面板上限保护；可在对话里用 writer_read 查看）。
            </div>
          )}
        </>
      )}
      {o.events !== null && o.events.length > 0 && (
        <>
          <div style={sectionTitle}><IconClockOutlineRegular />重要事件<span style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>全书事件视角的权威记录</span></div>
          {o.events.map((section, i) => (
            <CollapsibleRow key={i} title={section.title}
              leading={<span style={{ color: 'var(--dsw-alias-label-secondary)', display: 'inline-flex' }}><IconClockOutlineRegular /></span>}
              aside={<span style={{ ...rowAside, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{section.body.slice(0, 50)}</span>}>
              <MarkdownBody text={section.body} maxHeight={280} />
            </CollapsibleRow>
          ))}
        </>
      )}
      {o.styleRows.length > 0 && (
        <>
          <div style={sectionTitle}><IconSparkleRegular />风格示范<span style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>语感腔调 few-shot</span></div>
          {o.styleRows.map(s => (
            <CollapsibleRow key={s.id} title={s.id}
              leading={<span style={{ color: 'var(--dsw-alias-label-secondary)', display: 'inline-flex' }}><IconSparkleRegular /></span>}>
              {s.sections.length === 0
                ? <div style={previewStyle}>（无正文小节）</div>
                : s.sections.map((section, i) => (
                  <div key={i}>
                    <div style={subSectionTitle}>{section.title}</div>
                    <MarkdownBody text={section.body} maxHeight={200} />
                  </div>
                ))}
            </CollapsibleRow>
          ))}
        </>
      )}
    </>
  )
}

/** 待办行标（复选框观感：空心圆角方框，未勾选语义）。 */
const pendingMarker: React.CSSProperties = {
  width: 10, height: 10, borderRadius: 3, flexShrink: 0, marginTop: 6,
  border: '1.5px solid var(--dsw-alias-border-l2)',
}

/** 待办页签展示上限（超出显示「还有 N」提示，不再静默截断）。 */
const PENDING_MAX_SECTIONS = 6
const PENDING_MAX_LINES_PER_SECTION = 15

function PendingTab({ o }: { o: NovelOverview }): React.ReactElement {
  if (o.pendingSections.length === 0 && o.pendingArchive.length === 0) return <EmptyState icon={<IconChecklistOutlineRegular />}>没有待办（pending.md 为空或不存在）。写完一章后维护 pass 会把待确认的摘要/事实/伏笔建议写进这里。</EmptyState>
  const sections = o.pendingSections.slice(0, PENDING_MAX_SECTIONS)
  const hiddenSections = o.pendingSections.length - sections.length
  const archiveLines = o.pendingArchive.reduce((sum, s) => sum + s.lines.length, 0)
  return (
    <>
      {o.pendingSections.length > 0 && (
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
                    <span aria-hidden style={pendingMarker} />
                    <span style={{ minWidth: 0 }}>{line}</span>
                  </div>
                ))}
                {hidden > 0 && <div style={{ ...dim, fontSize: 11, paddingTop: 4 }}>还有 {hidden} 条未展开显示</div>}
              </CollapsibleRow>
            )
          })}
          {hiddenSections > 0 && <div style={{ ...dim, fontSize: 11, padding: '4px 2px' }}>还有 {hiddenSections} 次更早的维护 pass 未显示</div>}
        </>
      )}
      {/* 归档区（pending_cleanup 移档后的追溯入口；默认折叠） */}
      {o.pendingArchive.length > 0 && (
        <CollapsibleRow title={`已归档（${o.pendingArchive.length} 次）`}
          leading={<span style={{ color: 'var(--dsw-alias-label-secondary)', display: 'inline-flex' }}><IconArchiveOutlineRegular /></span>}
          aside={<span style={rowAside}>{archiveLines} 条</span>}>
          {o.pendingArchive.slice(0, PENDING_MAX_SECTIONS).map((section, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, padding: '2px 0', lineHeight: 1.7 }}>
              <span aria-hidden style={pendingMarker} />
              <span style={rowMain}>{section.heading}</span>
              <span style={rowAside}>{section.lines.length} 条</span>
            </div>
          ))}
          {o.pendingArchive.length > PENDING_MAX_SECTIONS && (
            <div style={{ ...dim, fontSize: 11, paddingTop: 4 }}>还有 {o.pendingArchive.length - PENDING_MAX_SECTIONS} 次更早的归档未显示</div>
          )}
        </CollapsibleRow>
      )}
    </>
  )
}

/** 写作面板：38px 头部 + 六页签（概况/大纲/章节/伏笔/人物/待办）。 */
export function WriterPanel(_props: WriterPanelProps) {
  const { loading, error, progress, refresh, bus } = useProjectScan()
  const [tab, setTab] = useState<Tab>('overview')
  // 人物页 list/graph 模式提升到面板层（组件内 state 会随页签切换丢失）
  const [charactersMode, setCharactersMode] = useState<'list' | 'graph'>('list')
  const o = bus.scan?.overview ?? null
  const watched = bus.scan?.watched ?? null

  // 页签角标（红伏笔数 / 灵感条数 / 待办行数；零值不占位）
  const plotsLabel = o !== null && o.riskSummary.red > 0 ? `伏笔 ·${o.riskSummary.red}` : '伏笔'
  const ideasLabel = o !== null && o.ideas !== null && o.ideas.length > 0 ? `灵感 ·${o.ideas.length}` : '灵感'
  const pendingLabel = o !== null && o.pendingLineTotal > 0 ? `待办 ·${o.pendingLineTotal}` : '待办'

  return (
    <div style={root}>
      <div style={header}>
        <span style={headerTitle}>写作面板</span>
        {/* 加载中按钮 disabled 不派发 hover/focus，Tooltip 恰不可达——加载期不包 Tooltip（文案自明）；扫描进度随按钮呈现 */}
        {loading ? (
          <Button variant="toolbar" size="sm" onClick={refresh} disabled
            icon={<IconRefreshOutlineRegular />} aria-label="正在扫描小说项目">
            <TextShimmer active>{progress !== null ? `扫描 ${progress.done}/${progress.total}` : '扫描中'}</TextShimmer>
          </Button>
        ) : (
          <Tooltip label="重新扫描小说项目">
            <Button variant="toolbar" size="sm" onClick={refresh}
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
            { value: 'plots', label: plotsLabel, id: 'writer-tab-plots', panelId: 'writer-panel-plots' },
            { value: 'characters', label: '人物', id: 'writer-tab-characters', panelId: 'writer-panel-characters' },
            { value: 'ideas', label: ideasLabel, id: 'writer-tab-ideas', panelId: 'writer-panel-ideas' },
            { value: 'settings', label: '设定', id: 'writer-tab-settings', panelId: 'writer-panel-settings' },
            { value: 'pending', label: pendingLabel, id: 'writer-tab-pending', panelId: 'writer-panel-pending' },
          ]}
        />
      </div>
      <div style={body}>
        {loading && o === null && (
          <div style={{ padding: '8px 2px' }}>
            <TextShimmer active>{progress !== null ? `正在扫描小说项目… ${progress.done}/${progress.total}` : '正在扫描小说项目…'}</TextShimmer>
          </div>
        )}
        {o !== null && (
          <div role="tabpanel" id={`writer-panel-${tab}`} aria-labelledby={`writer-tab-${tab}`}>
            {/* 刷新失败但保留旧数据时：错误降级为顶部提示条，不清空面板 */}
            {error !== null && !loading && (
              <div style={{ ...dim, fontSize: 11, color: 'var(--dsw-alias-state-warn-primary)', padding: '2px 2px 8px', display: 'flex', gap: 6 }}>
                <IconWarningTriangleOutlineMedium />
                <span>上次刷新失败：{error}（以下为最近一次成功扫描的数据）</span>
              </div>
            )}
            {tab === 'overview' && <OverviewTab o={o} live={bus.live} watched={watched} onNavigate={setTab} />}
            {tab === 'outline' && <OutlineTab o={o} />}
            {tab === 'chapters' && <ChaptersTab o={o} />}
            {tab === 'plots' && <PlotsTab o={o} />}
            {tab === 'characters' && <CharactersTab o={o} mode={charactersMode} onModeChange={setCharactersMode} />}
            {tab === 'ideas' && <IdeasTab o={o} />}
            {tab === 'settings' && <SettingsTab o={o} />}
            {tab === 'pending' && <PendingTab o={o} />}
          </div>
        )}
        {o === null && !loading && error !== null && (
          <EmptyState icon={<IconInfoOutlineRegular />}>
            项目扫描失败：{error}
            <br />请确认当前会话工作区含 novel/（或直接位于小说项目目录）。
          </EmptyState>
        )}
        {o === null && !loading && error === null && (
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
