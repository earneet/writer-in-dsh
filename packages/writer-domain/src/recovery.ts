/**
 * P4 断更恢复快照渲染（纯函数）：从章节/派生摘要/事件/人物/伏笔派生一份 Markdown 快照，
 * 供长期停笔后的快速恢复（§1.4「断更恢复快照：从章节/事件派生项目快照 Markdown，时距取 git log 时间」）。
 * 时间来源由调用方（engine）经 git log 取得；纯渲染在此可独立单测。
 * @module dsh-writer-domain/recovery
 */
import type { WriterEntity } from './index.ts'

/** 快照渲染输入。 */
export interface RecoverySnapshotInput {
  chapters: readonly WriterEntity[]
  /** chapterId → 新鲜派生摘要（sourceHash 一致才传入；缺失时正文保头截断兜底）。 */
  summaries: Readonly<Record<string, string>>
  events?: WriterEntity
  characters: readonly WriterEntity[]
  plots: readonly WriterEntity[]
  /** chapterId → 最近一次 git 提交时间（ISO 文本；null = 无记录/非 git 仓库）。 */
  chapterTimes: Readonly<Record<string, string | null>>
  /** 兜底摘要截断字符数（默认 300）。 */
  fallbackSummaryChars?: number
  /** 生成时间（注入文档头；缺省由调用方传入当前时间）。 */
  generatedAt: string
}

/** 码点安全截断（与 index.ts truncateCodePoints 同语义；本地实现避免与 index.ts 循环依赖）。 */
function sliceCodePoints(text: string, max: number): string {
  if (text.length <= max) return text
  return `${Array.from(text).slice(0, max).join('')}`
}

function chapterNumber(entity: WriterEntity): number {
  const n = entity.frontmatter['number']
  return typeof n === 'number' ? n : Number(entity.id)
}

function timeAgoText(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return '时间未知（无 git 记录）'
  return iso
}

/**
 * 渲染恢复快照 Markdown：按章倒序（最近的在最前，断更恢复最关心最新状态），
 * 每章带时间锚 + 摘要；末尾附当前伏笔状态清单与人物清单。
 */
export function renderRecoverySnapshot(input: RecoverySnapshotInput): string {
  const fallbackChars = input.fallbackSummaryChars ?? 300
  const lines: string[] = [`# 断更恢复快照（生成于 ${input.generatedAt}）`, '']
  lines.push('> 派生文件：从章节/事件/伏笔实况生成，供人快速恢复上下文；删除后可重新生成。', '')
  const sorted = [...input.chapters].sort((a, b) => chapterNumber(b) - chapterNumber(a))
  if (sorted.length === 0) {
    lines.push('（暂无已写章节）')
  } else {
    lines.push('## 最近章节（倒序）', '')
    for (const chapter of sorted) {
      const title = typeof chapter.frontmatter['title'] === 'string' ? ` ${chapter.frontmatter['title']}` : ''
      lines.push(`### 第 ${chapterNumber(chapter)} 章 ${chapter.id}${title}（最后变更：${timeAgoText(input.chapterTimes[chapter.id])}）`)
      const summary = input.summaries[chapter.id]
      const body = summary !== undefined && summary.trim().length > 0
        ? summary.trim()
        : sliceCodePoints(chapter.content.replace(/\s+/g, ' ').trim(), fallbackChars)
      lines.push(body.length > 0 ? body : '（空章节）')
      lines.push('')
    }
  }
  if (input.plots.length > 0) {
    lines.push('## 伏笔现状', '')
    for (const plot of [...input.plots].sort((a, b) => a.id.localeCompare(b.id))) {
      const status = String(plot.frontmatter['status'] ?? 'planned')
      const hint = String(plot.frontmatter['planned_resolution_hint'] ?? '').trim()
      lines.push(`- ${plot.id}（${status}）${hint.length > 0 ? `——回收提示：${hint}` : ''}`)
    }
    lines.push('')
  }
  if (input.characters.length > 0) {
    lines.push('## 人物清单', '')
    for (const character of [...input.characters].sort((a, b) => a.id.localeCompare(b.id))) {
      lines.push(`- ${character.id}：${sliceCodePoints(character.content.replace(/\s+/g, ' ').trim(), 120)}`)
    }
    lines.push('')
  }
  if (input.events !== undefined && input.events.content.trim().length > 0) {
    lines.push('## 关键事件', '', input.events.content.trim(), '')
  }
  lines.push('## 恢复建议', '')
  lines.push('- 先读最近 2 章摘要与伏笔现状，再读创作准则与本章大纲后续写。')
  lines.push('- 断更期间如有外部改动，先跑 consistency_check 全书体检。')
  return `${lines.join('\n').trim()}\n`
}
