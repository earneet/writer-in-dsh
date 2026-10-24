/**
 * 写作工具的富结果卡片（keyed slot tool.call.toolview，key=工具名）。
 *
 * v4：与宿主原生 ToolRow 同构——DisclosureRow 信封 + useDisclosure 开合 +
 * running 微光 + Tag 结论色摘要 + 懒挂载展开体；视觉全部走宿主基元与 --dsw-*
 * token（零字面颜色，亮暗主题自动跟随）。卡片从结果文本派生结构化视图；
 * 解析失败回退原文。
 *
 * props 为 ToolCallViewProps 的本地结构子集（phase 判别 + block 结果节点 +
 * useDisclosure 席位）——不 import ui-tool/ui-chat 内部类型（跨插件值/类型依赖
 * 仅限基线模块表）。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  DisclosureRow, Tag, TextShimmer,
  IconBranchOutlineRegular, IconClockOutlineRegular,
  IconDataOutlineRegular, IconDownloadOutlineRegular, IconEditOutlineRegular,
  IconInspectOutlineRegular, IconSearchOutlineRegular, IconShieldOutlineRegular,
  IconWarningTriangleOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { recordToolResult, type RecordParsers } from './bus.ts'
import { parseConsistency, parseForeshadow, parseReview, parseWriteChapter, parseWriterStats } from './parse.ts'

/** useDisclosure 的本地最小契约（宿主经 props 注入）。 */
interface Disclosure {
  readonly expanded: boolean
  readonly setExpanded: (open: boolean) => void
  readonly toggle: () => void
}

/** tool.call.toolview 的本地 props 契约（宿主实际传入字段的子集）。 */
export interface ToolViewPropsBase {
  toolName: string
  phase: 'preparing' | 'start' | 'result' | string
  /** 宿主工具调用 id（§1.5 公共 props；用于面板动态记录幂等去重）。 */
  callId?: string
  useDisclosure?: () => Disclosure
  block?: {
    call?: { name?: string; argsRaw?: string | null }
    argsRaw?: string | null
    content?: unknown
    isError?: boolean
    error?: { name?: string; code?: string; reason?: string }
  }
}

// —— 排版（只引用 token；颜色零字面）——
const muted: React.CSSProperties = { color: 'var(--dsw-alias-label-secondary)' }
const dim: React.CSSProperties = { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }
const detail: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0 8px 24px',
  fontSize: 12, lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)',
}
const fallbackPre: React.CSSProperties = {
  margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, lineHeight: 1.7,
  fontFamily: 'var(--dsw-font-markdown-code-font-family, monospace)',
  color: 'var(--dsw-alias-label-secondary)',
}
const statGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, margin: '2px 0 6px' }
const statCell: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 'var(--dsw-radius-sm)',
  background: 'var(--dsw-alias-bg-layer-2)',
}
const statValue: React.CSSProperties = { fontSize: 16, fontWeight: 700, color: 'var(--dsw-alias-label-primary)' }
const statLabel: React.CSSProperties = { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', marginTop: 2 }
const tagRowStyle: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }
const warnRowStyle: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', color: 'var(--dsw-alias-state-warn-label)' }

/** 结果文本归一化：兼容 string 与 ContentBlock[]（text 块取 .text，其余 JSON 序列化）。 */
function resultText(block: ToolViewPropsBase['block']): string {
  const content = block?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((b: unknown) => {
      if (typeof b === 'string') return b
      if (b !== null && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string') return (b as { text: string }).text
      return JSON.stringify(b)
    }).join('')
  }
  return ''
}

/** 结果首行（错误摘要与兜底标签用；空文本回退占位）。 */
function firstLine(text: string): string {
  return text.split('\n').find(line => line.trim().length > 0)?.trim() || '无输出'
}

/** 错误摘要：结构化错误（reason/name:code）优先，空 content 回退（宿主 ToolResultNode 契约）。 */
function errorSummary(block: ToolViewPropsBase['block'], content: string): string {
  const err = block?.error
  if (err !== undefined) {
    const head = typeof err.reason === 'string' && err.reason.length > 0 ? err.reason
      : [err.name, err.code].filter(v => typeof v === 'string' && v.length > 0).join(': ')
    if (head.length > 0) return head
  }
  return firstLine(content)
}

/** severity → TagTone（审稿建议分级着色）。 */
function severityTone(severity: string): 'danger' | 'warning' | 'info' | 'neutral' {
  const s = severity.toLowerCase()
  if (s === 'high' || s === 'error') return 'danger'
  if (s === 'medium' || s === 'warn' || s === 'warning') return 'warning'
  if (s === 'low' || s === 'info') return 'info'
  return 'neutral'
}

/** 状态词 → TagTone（伏笔/章节状态着色；与面板 STATUS_TONES 同表）。 */
function statusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' | 'outline' {
  const map: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'outline'> = {
    resolved: 'success', done: 'success', active: 'success',
    planted: 'warning', draft: 'warning',
    abandoned: 'danger',
    planned: 'neutral',
  }
  return map[status.toLowerCase()] ?? 'outline'
}

/** start 阶段参数摘要（argsRaw JSON 宽容解析）。 */
function argsHint(argsRaw: string | null | undefined, keys: string[]): string {
  if (argsRaw === null || argsRaw === undefined || argsRaw.length === 0) return ''
  try {
    const args = JSON.parse(argsRaw) as Record<string, unknown>
    return keys.map(k => args[k]).filter(v => typeof v === 'string' && v.length > 0).join(' · ').slice(0, 60)
  } catch {
    return ''
  }
}

interface RowProps {
  icon: React.ReactNode
  title: string
  running: boolean
  isError?: boolean
  summary: React.ReactNode
  expandable: boolean
  useDisclosure?: () => Disclosure
  children?: React.ReactNode
}

/** 原生 ToolRow 同构信封：DisclosureRow + 宿主 useDisclosure（缺席时本地态兜底）。 */
/* 前提：useDisclosure prop 在同一挂载内恒定（宿主注入要么恒有要么恒无）——若在
 * undefined/函数间切换会改变 hook 调用计数触发 React 报错；宿主契约不产生此切换。 */
function ToolRow({ icon, title, running, isError = false, summary, expandable, useDisclosure, children }: RowProps) {
  const hostDisclosure = useDisclosure?.()
  const [localOpen, setLocalOpen] = useState(false)
  const open = hostDisclosure !== undefined ? hostDisclosure.expanded : localOpen
  const toggle = (): void => {
    if (hostDisclosure !== undefined) hostDisclosure.toggle()
    else setLocalOpen(v => !v)
  }
  return (
    <div data-tool="writer" data-state={running ? 'running' : isError ? 'error' : 'ok'}>
      <DisclosureRow
        icon={icon}
        title={title}
        running={running}
        open={open}
        expandable={expandable}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={toggle}
        collapsedContent={
          <span style={{ fontSize: 12, color: isError ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-tertiary)' }}>
            {summary}
          </span>
        }
      >
        {children}
      </DisclosureRow>
    </div>
  )
}

/** 运行中摘要（随行微光）。 */
function RunningSummary({ children }: { children: React.ReactNode }) {
  return <TextShimmer active>{children}</TextShimmer>
}

function parsersOf(kind: 'stats' | 'write' | 'review' | 'plain'): RecordParsers {
  if (kind === 'stats') return { stats: parseWriterStats }
  if (kind === 'write') return { write: parseWriteChapter }
  if (kind === 'review') return { review: parseReview }
  return {}
}

/**
 * 面板动态记录（M1b 正确性修复包①：记录移入 useEffect——渲染期副作用会在重渲染时
 * 重复 unshift 挤掉上限内真实历史；callId 幂等去重由总线承接，双调安全）。
 */
function useRecordResult(props: ToolViewPropsBase, content: string, kind: 'stats' | 'write' | 'review' | 'plain', label?: string): void {
  const { phase, toolName, callId } = props
  useEffect(() => {
    if (phase !== 'result') return
    // block 缺席的空结果不记动态行（避免空白行挤占时间线）
    if (content.length === 0 && label === undefined) return
    recordToolResult(toolName, content, parsersOf(kind), { callId, label })
  }, [phase, toolName, content, callId, kind, label])
}

/** 通用错误/兜底展开体。 */
function RawBody({ text }: { text: string }) {
  return <pre style={fallbackPre}>{text}</pre>
}

/** write_chapter 卡片：写作行（保存回执 + 补丁协议 + 丢句告警）。 */
export function WriteChapterCard(props: ToolViewPropsBase) {
  const content = props.phase === 'result' ? resultText(props.block) : ''
  const parsed = useMemo(
    () => props.phase === 'result' && content.length > 0 ? parseWriteChapter(content) : null,
    [props.phase, content],
  )
  const isError = props.block?.isError === true
  const label = isError ? errorSummary(props.block, content)
    : parsed !== null ? `chapter/${parsed.chapterId}（${parsed.mode}）` : undefined
  useRecordResult(props, content, 'write', label)
  if (props.phase === 'preparing') {
    return <ToolRow icon={<IconEditOutlineRegular />} title="正在写作…" running summary="准备写作素材" expandable={false} useDisclosure={props.useDisclosure} />
  }
  if (props.phase === 'start') {
    // start 阶段 argsRaw 在 block 顶层；result 阶段在 block.call 下（宿主契约差异）；工具参数键名是 chapter
    const hint = argsHint(props.block?.argsRaw ?? props.block?.call?.argsRaw, ['mode', 'chapter'])
    return <ToolRow icon={<IconEditOutlineRegular />} title="写作进行中" running expandable={false} useDisclosure={props.useDisclosure}
      summary={hint.length > 0 ? <RunningSummary>{hint}</RunningSummary> : '起草中'} />
  }
  if (props.block === undefined) return null
  if (isError) {
    return <ToolRow icon={<IconEditOutlineRegular />} title="写作失败" running={false} isError summary={label} expandable useDisclosure={props.useDisclosure}>
      <RawBody text={content} />
    </ToolRow>
  }
  if (parsed === null) {
    return <ToolRow icon={<IconEditOutlineRegular />} title="写作完成" running={false} summary={firstLine(content)} expandable useDisclosure={props.useDisclosure}>
      <RawBody text={content} />
    </ToolRow>
  }
  // 章号原样展示守卫（工具契约为三位序号，但非数字 id 不应显示「第 NaN 章」）
  const chapterLabel = /^\d+$/.test(parsed.chapterId) ? `第 ${Number(parsed.chapterId)} 章` : `chapter/${parsed.chapterId}`
  const title = parsed.chars > 0 ? `${chapterLabel} · 已保存` : `${chapterLabel} · 无需修改`
  return (
    <ToolRow
      icon={<IconEditOutlineRegular />}
      title={title}
      running={false}
      expandable
      useDisclosure={props.useDisclosure}
      summary={
        <span style={tagRowStyle}>
          <Tag tone="neutral">{parsed.mode}</Tag>
          {parsed.chars > 0 && <Tag tone="outline">≈{parsed.chars} 字</Tag>}
          {parsed.patchesSkipped > 0 && <Tag tone="warning">跳过补丁 {parsed.patchesSkipped}</Tag>}
          {parsed.droppedSentences > 0 && <Tag tone="danger">丢句 {parsed.droppedSentences}</Tag>}
          {parsed.repetitionStripped > 0 && <Tag tone="warning">剔复述 {parsed.repetitionStripped}</Tag>}
          {parsed.patchesSkipped === 0 && parsed.droppedSentences === 0 && parsed.patchesApplied > 0 && <Tag tone="success">补丁 {parsed.patchesApplied}</Tag>}
        </span>
      }
    >
      <div style={detail}>
        {parsed.note !== null && <div>{parsed.note}</div>}
        {parsed.patchesApplied + parsed.patchesSkipped > 0 && (
          <div>
            补丁协议：命中 {parsed.patchesApplied} 条
            {parsed.patchesSkipped > 0 ? `，⚠ 跳过 ${parsed.patchesSkipped} 条（锚点未唯一命中）` : ''}
          </div>
        )}
        {parsed.droppedSentences > 0 && (
          <div style={warnRowStyle}>
            <IconWarningTriangleOutlineMedium />
            <span>丢句守卫：{parsed.droppedSentences} 条原句未保留，请复核</span>
          </div>
        )}
        {parsed.repetitionStripped > 0 && (
          <div style={warnRowStyle}>
            <IconWarningTriangleOutlineMedium />
            <span>复述守卫：{parsed.repetitionStripped} 句与正文重复的连续句段被剔除后才落盘，其余为新增</span>
          </div>
        )}
      </div>
    </ToolRow>
  )
}

/** review_chapter 卡片：审稿行（总评 + 逐条建议，severity 分级 Tag；M1a 起捕获原文/建议/改写方案续行）。 */
export function ReviewCard(props: ToolViewPropsBase) {
  const content = props.phase === 'result' ? resultText(props.block) : ''
  const parsed = useMemo(
    () => props.phase === 'result' && content.length > 0 ? parseReview(content) : null,
    [props.phase, content],
  )
  const isError = props.block?.isError === true
  const label = isError ? errorSummary(props.block, content)
    : parsed !== null ? (parsed.count > 0 ? `${parsed.count} 条建议` : '无建议') : undefined
  useRecordResult(props, content, 'review', label)
  if (props.phase === 'preparing' || props.phase === 'start') {
    return <ToolRow icon={<IconInspectOutlineRegular />} title="审稿进行中" running summary="多维度审读章节" expandable={false} useDisclosure={props.useDisclosure} />
  }
  if (props.block === undefined) return null
  if (isError) {
    return <ToolRow icon={<IconInspectOutlineRegular />} title="审稿失败" running={false} isError summary={label} expandable useDisclosure={props.useDisclosure}>
      <RawBody text={content} />
    </ToolRow>
  }
  if (parsed === null) {
    return <ToolRow icon={<IconInspectOutlineRegular />} title="审稿完成" running={false} summary={firstLine(content)} expandable useDisclosure={props.useDisclosure}>
      <RawBody text={content} />
    </ToolRow>
  }
  const high = parsed.suggestions.filter(s => severityTone(s.severity) === 'danger').length
  const medium = parsed.suggestions.filter(s => severityTone(s.severity) === 'warning').length
  return (
    <ToolRow
      icon={<IconInspectOutlineRegular />}
      title={parsed.count > 0 ? `审稿完成 · ${parsed.count} 条建议` : '审稿完成 · 无建议'}
      running={false}
      expandable
      useDisclosure={props.useDisclosure}
      summary={
        <span style={tagRowStyle}>
          {parsed.count === 0 && <Tag tone="success">无结构化建议</Tag>}
          {high > 0 && <Tag tone="danger">高 {high}</Tag>}
          {medium > 0 && <Tag tone="warning">中 {medium}</Tag>}
          {parsed.count > 0 && <Tag tone="info">共 {parsed.count}</Tag>}
        </span>
      }
    >
      <div style={detail}>
        {parsed.summary.length > 0 && <div style={{ color: 'var(--dsw-alias-label-primary)' }}>总评：{parsed.summary}</div>}
        {parsed.suggestions.map((s, i) => (
          <div key={i}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <Tag tone={severityTone(s.severity)}>{s.severity}</Tag>
              <span><span style={muted}>{s.dimension}：</span>{s.problem}</span>
            </div>
            {s.quote !== null && (
              <div style={{ ...muted, paddingLeft: 8, borderLeft: '2px solid var(--dsw-alias-border-l3)' }}>原文：{s.quote}</div>
            )}
            {s.suggestion !== null && <div>建议：{s.suggestion}</div>}
            {s.rewriteOption !== null && <div>改写方案：{s.rewriteOption}</div>}
          </div>
        ))}
      </div>
    </ToolRow>
  )
}

/** writer_stats 卡片：全书统计行。 */
export function StatsCard(props: ToolViewPropsBase) {
  const content = props.phase === 'result' ? resultText(props.block) : ''
  const parsed = useMemo(
    () => props.phase === 'result' && content.length > 0 ? parseWriterStats(content) : null,
    [props.phase, content],
  )
  const isError = props.block?.isError === true
  const label = isError ? errorSummary(props.block, content)
    : parsed !== null ? `${parsed.chapters} 章 / ${parsed.totalChars} 字` : undefined
  useRecordResult(props, content, 'stats', label)
  if (props.phase !== 'result' || props.block === undefined) {
    return <ToolRow icon={<IconDataOutlineRegular />} title="统计进行中" running summary="汇总全书数据" expandable={false} useDisclosure={props.useDisclosure} />
  }
  if (isError) {
    return <ToolRow icon={<IconDataOutlineRegular />} title="统计失败" running={false} isError summary={label} expandable useDisclosure={props.useDisclosure}>
      <RawBody text={content} />
    </ToolRow>
  }
  if (parsed === null) {
    return <ToolRow icon={<IconDataOutlineRegular />} title="全书统计" running={false} summary={firstLine(content)} expandable useDisclosure={props.useDisclosure}>
      <RawBody text={content} />
    </ToolRow>
  }
  return (
    <ToolRow
      icon={<IconDataOutlineRegular />}
      title="全书统计"
      running={false}
      expandable
      useDisclosure={props.useDisclosure}
      summary={
        <span style={tagRowStyle}>
          <Tag tone="outline">{parsed.chapters} 章</Tag>
          <Tag tone="outline">≈{parsed.totalChars} 字</Tag>
          <Tag tone="neutral">{parsed.characters} 人物</Tag>
        </span>
      }
    >
      <div style={detail}>
        <div style={statGrid}>
          <div style={statCell}><div style={statValue}>{parsed.chapters}</div><div style={statLabel}>章节</div></div>
          <div style={statCell}><div style={statValue}>{parsed.totalChars}</div><div style={statLabel}>总字数（约）</div></div>
        </div>
        {parsed.volumes.length > 0 && (
          <div style={tagRowStyle}>
            <span style={dim}>卷：</span>
            {parsed.volumes.map(v => <Tag key={v.name} tone="neutral">{v.name} ×{v.count}</Tag>)}
          </div>
        )}
        {parsed.foreshadow.length > 0 && (
          <div style={tagRowStyle}>
            <span style={dim}>伏笔：</span>
            {parsed.foreshadow.map(f => <Tag key={f.status} tone={statusTone(f.status)}>{f.status} ×{f.count}</Tag>)}
          </div>
        )}
        <div>人物弧线覆盖：{parsed.arcCoverage}</div>
        <div>维护派生覆盖：{parsed.derivedCoverage}</div>
        {parsed.arcBroken.length > 0 && (
          <div style={warnRowStyle}>
            <IconWarningTriangleOutlineMedium />
            <span>非法 timeline：{parsed.arcBroken.join('、')}</span>
          </div>
        )}
        {parsed.staleChapters.length > 0 && (
          <div style={warnRowStyle}>
            <IconWarningTriangleOutlineMedium />
            <span>待维护 pass：{parsed.staleChapters.join('、')}</span>
          </div>
        )}
      </div>
    </ToolRow>
  )
}

/** start 阶段参数摘要的键名表（与 writer-tools 各工具 parameters 逐字对齐；多张同名折叠卡可区分是哪章/哪个 scope/query）。 */
const TOOL_ARG_KEYS: Record<string, string[]> = {
  review_chapter: ['chapter', 'focus'],
  consistency_check: ['scope'],
  writer_search: ['query'],
  timeline_update: ['id', 'chapter'],
  foreshadow_update: ['id', 'action', 'chapter'],
  export_book: ['format', 'volume'],
  archive_point: ['message'],
  pending_cleanup: ['chapter'],
  writer_update: ['entity', 'id'],
  writer_read: ['entity', 'id'],
}

/** 治理类工具的中文标题表（通用卡片 label；M1b 卡片覆盖补全——14 工具全部有卡片）。 */
export const TOOL_LABELS: Record<string, string> = {
  writer_read: '读取实体',
  writer_update: '更新实体',
  recompute_derived: '派生重算',
  archive_point: '存档点',
  pending_cleanup: '待办归档',
  maintenance_flush: '维护排空',
  writer_search: '素材检索',
  timeline_update: '时间线更新',
  foreshadow_update: '伏笔更新',
  consistency_check: '一致性检查',
  export_book: '导出',
}

export function SummaryCard(props: ToolViewPropsBase & { icon?: React.ReactNode; label?: string }) {
  const icon = props.icon ?? <IconDataOutlineRegular />
  const label = props.label ?? TOOL_LABELS[props.toolName] ?? props.toolName
  const content = props.phase === 'result' ? resultText(props.block) : ''
  const isError = props.block?.isError === true
  // 专项解析只做一次（recordLabel 与结论摘要共用；正则廉价但没必要每渲染两遍）
  const special = useMemo(() => {
    if (props.phase !== 'result' || content.length === 0) return null
    if (props.toolName === 'foreshadow_update') return { foreshadow: parseForeshadow(content) }
    if (props.toolName === 'consistency_check') return { consistency: parseConsistency(content) }
    return null
  }, [props.phase, props.toolName, content])
  const recordLabel = isError ? `${label}失败：${errorSummary(props.block, content)}`
    : special?.foreshadow !== undefined
      ? (special.foreshadow !== null
        ? (special.foreshadow.milestone !== null
          ? `${special.foreshadow.id} milestone ${special.foreshadow.milestone.type}@${special.foreshadow.milestone.chapter}`
          : `${special.foreshadow.id} → ${special.foreshadow.status}`)
        : undefined)
      : special?.consistency !== undefined
        ? (special.consistency !== null ? `发现 ${special.consistency.issues} 条矛盾` : undefined)
        : undefined
  // 失败也回写面板动态（与 WriteChapterCard 口径一致：失败痕迹不应从时间线消失）
  useRecordResult(props, content, 'plain', recordLabel)
  if (props.phase === 'preparing' || props.phase === 'start') {
    const hint = argsHint(props.block?.argsRaw ?? props.block?.call?.argsRaw, TOOL_ARG_KEYS[props.toolName] ?? [])
    // export_book 默认 ask 审批路径：等待期与真执行在 props 层不可区分——文案如实标注两种可能
    const waitingApproval = props.toolName === 'export_book'
    return <ToolRow icon={icon} title={`${label}…`} running expandable={false} useDisclosure={props.useDisclosure}
      summary={hint.length > 0
        ? <RunningSummary>{hint}{waitingApproval ? '（审批/执行中）' : ''}</RunningSummary>
        : waitingApproval ? '等待审批或执行中' : '执行中'} />
  }
  if (props.block === undefined) return null
  if (isError) {
    return <ToolRow icon={icon} title={`${label}失败`} running={false} isError summary={errorSummary(props.block, content)} expandable useDisclosure={props.useDisclosure}>
      <RawBody text={content} />
    </ToolRow>
  }
  // 结论性摘要：一致性检查/伏笔更新有专门解析，其余取首行
  let summary: React.ReactNode = firstLine(content)
  let title = label
  if (special?.consistency !== undefined && special.consistency !== null) {
    const parsed = special.consistency
    title = '一致性检查'
    summary = parsed.issues === 0
      ? <Tag tone="success">无矛盾</Tag>
      : <span style={tagRowStyle}><Tag tone="danger">{parsed.issues} 条矛盾</Tag><Tag tone="neutral">{parsed.batches}</Tag></span>
  } else if (special?.foreshadow !== undefined && special.foreshadow !== null) {
    const parsed = special.foreshadow
    title = `伏笔 ${parsed.id}`
    summary = parsed.milestone !== null
      ? <Tag tone="info">milestone {parsed.milestone.type} @ {parsed.milestone.chapter}</Tag>
      : <Tag tone={statusTone(parsed.status)}>{parsed.status}</Tag>
  }
  return (
    <ToolRow icon={icon} title={title} running={false} summary={summary} expandable={content.includes('\n')} useDisclosure={props.useDisclosure}>
      {content.includes('\n') ? <RawBody text={content} /> : null}
    </ToolRow>
  )
}

/** 导出便利封装（index.tsx 注册用）：语义图标 + 中文标题。 */
export function WriterSearchCard(props: ToolViewPropsBase): React.ReactElement {
  return <SummaryCard {...props} icon={<IconSearchOutlineRegular />} label="素材检索" />
}
export function TimelineUpdateCard(props: ToolViewPropsBase): React.ReactElement {
  return <SummaryCard {...props} icon={<IconClockOutlineRegular />} label="时间线更新" />
}
export function ForeshadowUpdateCard(props: ToolViewPropsBase): React.ReactElement {
  return <SummaryCard {...props} icon={<IconBranchOutlineRegular />} label="伏笔更新" />
}
export function ConsistencyCheckCard(props: ToolViewPropsBase): React.ReactElement {
  return <SummaryCard {...props} icon={<IconShieldOutlineRegular />} label="一致性检查" />
}
export function ExportBookCard(props: ToolViewPropsBase): React.ReactElement {
  return <SummaryCard {...props} icon={<IconDownloadOutlineRegular />} label="导出" />
}
