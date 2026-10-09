/**
 * 写作工具的富结果卡片（keyed slot tool.call.toolview，key=工具名）。
 * 卡片从 result 阶段的结果文本派生结构化视图并写入面板状态；解析失败回退原文。
 * props 为 ToolCallViewProps 的本地结构子集（phase 判别 + block 结果节点）——
 * 不 import ui-tool 内部类型（跨插件值/类型依赖仅限基线模块表）。
 */
import { useMemo } from 'react'
import { recordToolResult } from './state.ts'
import { parseConsistency, parseForeshadow, parseReview, parseWriteChapter, parseWriterStats } from './parse.ts'

/** tool.call.toolview 的本地 props 契约（宿主实际传入字段的子集）。 */
export interface ToolViewPropsBase {
  toolName: string
  phase: 'preparing' | 'start' | 'result' | string
  block?: {
    call?: { name?: string; argsRaw?: string | null }
    content?: string
    isError?: boolean
  }
}

const card: React.CSSProperties = { fontSize: 12, lineHeight: 1.7, wordBreak: 'break-all' }
const title: React.CSSProperties = { fontWeight: 600, marginBottom: 4 }
const warn: React.CSSProperties = { ...card, color: '#d29922' }
const severityColor = (severity: string): string | undefined =>
  severity === 'high' ? '#f85149' : severity === 'medium' ? '#d29922' : undefined

function onceRecorded(tool: string, content: string, kind: 'stats' | 'write' | 'review' | 'plain', label?: string): void {
  // 面板状态更新（模块级存储自带版本去抖；重复渲染重复记录由 unshift 上限截断，时间线容忍重复行）
  recordToolResult('', tool, content,
    kind === 'stats' ? { stats: parseWriterStats }
      : kind === 'write' ? { write: parseWriteChapter }
        : kind === 'review' ? { review: parseReview }
          : {}, label)
}

/** write_chapter 卡片：保存回执 + 补丁协议 + 丢句告警。 */
export function WriteChapterCard(props: ToolViewPropsBase) {
  const parsed = useMemo(
    () => props.phase === 'result' && props.block?.content !== undefined ? parseWriteChapter(props.block.content) : null,
    [props.phase, props.block],
  )
  if (props.phase !== 'result' || props.block === undefined) return <div style={card}>写作引擎执行中…</div>
  const content = props.block.content ?? ''
  if (props.block.isError === true) return <pre style={card}>{content}</pre>
  onceRecorded('write_chapter', content, 'write', parsed !== null ? `chapter/${parsed.chapterId}（${parsed.mode}）` : undefined)
  if (parsed === null) return <pre style={card}>{content}</pre>
  return (
    <div style={card}>
      <div style={title}>chapter/{parsed.chapterId} · {parsed.mode} · ≈{parsed.chars} 字</div>
      {parsed.patchesApplied + parsed.patchesSkipped > 0 && (
        <div style={parsed.patchesSkipped > 0 ? warn : card}>
          补丁协议：命中 {parsed.patchesApplied} 条{parsed.patchesSkipped > 0 ? `，⚠ 跳过 ${parsed.patchesSkipped} 条（锚点未唯一命中）` : ''}
        </div>
      )}
      {parsed.droppedSentences > 0 && <div style={warn}>⚠ 丢句守卫：{parsed.droppedSentences} 条原句未保留，请复核</div>}
      {parsed.note !== null && <div style={card}>{parsed.note}</div>}
    </div>
  )
}

/** review_chapter 卡片：建议列表（severity 着色）。 */
export function ReviewCard(props: ToolViewPropsBase) {
  const parsed = useMemo(
    () => props.phase === 'result' && props.block?.content !== undefined ? parseReview(props.block.content) : null,
    [props.phase, props.block],
  )
  if (props.phase !== 'result' || props.block === undefined) return <div style={card}>审稿中…</div>
  const content = props.block.content ?? ''
  if (props.block.isError === true) return <pre style={card}>{content}</pre>
  onceRecorded('review_chapter', content, 'review', parsed !== null ? (parsed.count > 0 ? `${parsed.count} 条建议` : '无建议') : undefined)
  if (parsed === null) return <pre style={card}>{content}</pre>
  return (
    <div style={card}>
      <div style={title}>审稿完成：{parsed.count > 0 ? `${parsed.count} 条建议` : '无结构化建议'}</div>
      {parsed.summary.length > 0 && <div style={{ ...card, opacity: 0.8, marginBottom: 4 }}>总评：{parsed.summary}</div>}
      {parsed.suggestions.map((s, i) => (
        <div key={i} style={{ ...card, marginBottom: 4 }}>
          <span style={{ color: severityColor(s.severity), fontWeight: 600 }}>[{s.severity}]</span>{' '}
          <span style={{ opacity: 0.8 }}>{s.dimension}：</span>{s.problem}
        </div>
      ))}
    </div>
  )
}

/** writer_stats 卡片：统计键值表。 */
export function StatsCard(props: ToolViewPropsBase) {
  const parsed = useMemo(
    () => props.phase === 'result' && props.block?.content !== undefined ? parseWriterStats(props.block.content) : null,
    [props.phase, props.block],
  )
  if (props.phase !== 'result' || props.block === undefined) return <div style={card}>统计中…</div>
  const content = props.block.content ?? ''
  if (props.block.isError === true) return <pre style={card}>{content}</pre>
  onceRecorded('writer_stats', content, 'stats', parsed !== null ? `${parsed.chapters} 章 / ${parsed.totalChars} 字` : undefined)
  if (parsed === null) return <pre style={card}>{content}</pre>
  return (
    <div style={card}>
      <div style={title}>全书概况</div>
      <div>章节：{parsed.chapters} 章 · 约 {parsed.totalChars} 字</div>
      {parsed.volumes.length > 0 && <div>卷：{parsed.volumes.map(v => `${v.name}×${v.count}`).join('、')}</div>}
      {parsed.foreshadow.length > 0 && <div>伏笔：{parsed.foreshadow.map(f => `${f.status}×${f.count}`).join('、')}</div>}
      <div>弧线覆盖：{parsed.arcCoverage}</div>
      <div>派生覆盖：{parsed.derivedCoverage}</div>
    </div>
  )
}

/** foreshadow_update / consistency_check 等轻量摘要卡片。 */
export function SummaryCard(props: ToolViewPropsBase) {
  if (props.phase !== 'result' || props.block === undefined) return <div style={card}>执行中…</div>
  const content = props.block.content ?? ''
  if (props.block.isError !== true) {
    if (props.toolName === 'foreshadow_update') {
      const parsed = parseForeshadow(content)
      onceRecorded('foreshadow_update', content, 'plain', parsed !== null ? `${parsed.id} → ${parsed.status}` : undefined)
    } else if (props.toolName === 'consistency_check') {
      const parsed = parseConsistency(content)
      onceRecorded('consistency_check', content, 'plain', parsed !== null ? `发现 ${parsed.issues} 条矛盾` : undefined)
    } else {
      onceRecorded(props.toolName, content, 'plain')
    }
  }
  return <pre style={card}>{content}</pre>
}
