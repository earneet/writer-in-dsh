/**
 * 一致性检查的纯函数：按预算分批、结构化矛盾报告解析与引用校验、时间锚倒序检测。
 * R-改进来源：原项目一致性检查 12 章/8000 字硬截断且维度与契约不符（w10 审计）——
 * 改为按预算参数化分批、检查维度与输出 schema 显式对齐。规划见 docs/implementation-plan.md §1.4。
 * @module dsh-writer-domain/consistency
 */

/** 一致性检查维度（与审稿 3+1 的前三维对齐 + 时间线维度）。 */
export const CONSISTENCY_DIMENSIONS = ['情节一致性', '人物一致性', '设定一致性', '时间线一致性'] as const
export type ConsistencyDimension = (typeof CONSISTENCY_DIMENSIONS)[number]

/** 一条结构化矛盾（预览不自动持久化）。refs 引用实体（chapter/001、plot/x、character/y 等）。 */
export interface ConsistencyIssue {
  dimension: string
  severity: 'high' | 'medium' | 'low'
  refs: string[]
  description: string
  evidence?: string
}

/** 一致性检查报告：矛盾列表 + 各批次覆盖情况 + 总评。 */
export interface ConsistencyReport {
  issues: ConsistencyIssue[]
  /** 每个批次的章节 id 与是否发生材料截断（截断意味着该批结论覆盖不全，供人工评估）。 */
  batches: { chapters: string[]; truncated: boolean }[]
  summary: string
}

/** 分批输入：章节 id + 可用正文 + 可选派生摘要（有新鲜摘要时以摘要代正文，扩大单批容量）。 */
export interface ConsistencyChapterInput {
  id: string
  content: string
  summary?: string
}

/** 预算内贪心分批：顺序装填章节，装满即开新批；单章超预算独占一批并截断（truncated 标记）。
 * 不做任何固定章数/字数截断——预算是参数，覆盖全书是硬要求。 */
export function planConsistencyBatches(
  chapters: readonly ConsistencyChapterInput[],
  budgetChars: number,
): ConsistencyReport['batches'] {
  if (budgetChars <= 0) throw new Error(`一致性检查预算必须为正数：${budgetChars}`)
  const batches: ConsistencyReport['batches'] = []
  let current: string[] = []
  let currentChars = 0
  let currentTruncated = false
  const flush = (): void => {
    if (current.length === 0) return
    batches.push({ chapters: current, truncated: currentTruncated })
    current = []
    currentChars = 0
    currentTruncated = false
  }
  for (const chapter of chapters) {
    // 有摘要用摘要（扩大单批容量），否则用正文
    const body = chapter.summary !== undefined && chapter.summary.trim().length > 0 ? chapter.summary.trim() : chapter.content
    let used = body.length
    let truncated = false
    if (used > budgetChars) {
      used = budgetChars
      truncated = true
    }
    if (current.length > 0 && currentChars + used > budgetChars) flush()
    if (current.length === 0) {
      // 空批首章：独占一批（超预算则截断标记）
      current = [chapter.id]
      currentChars = used
      currentTruncated = truncated
    } else {
      current.push(chapter.id)
      currentChars += used
      currentTruncated = currentTruncated || truncated
    }
  }
  flush()
  return batches
}

/** 模型单批输出的解析与引用校验：提取 JSON、收敛条目；refs 引用不存在的实体视为幻觉丢弃并计数。 */
export function parseConsistencyBatchOutput(
  raw: string,
  validRefs: ReadonlySet<string>,
): { issues: ConsistencyIssue[]; summary: string; dropped: number } | undefined {
  let text = raw.trim()
  const fenced = text.match(/```[a-zA-Z]*\s*\n([\s\S]*?)\n?```/)
  if (fenced !== null) text = fenced[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const { issues, summary } = parsed as Record<string, unknown>
  if (!Array.isArray(issues)) return undefined
  const out: ConsistencyIssue[] = []
  let dropped = 0
  for (const entry of issues) {
    if (typeof entry !== 'object' || entry === null) continue
    const issue = entry as Record<string, unknown>
    if (typeof issue.dimension !== 'string' || typeof issue.description !== 'string') continue
    const refs = Array.isArray(issue.refs) ? issue.refs.filter((r): r is string => typeof r === 'string') : []
    // 引用存在性校验：全部 refs 都不存在于实体集 = 幻觉引用，丢弃
    if (refs.length > 0 && !refs.some((r) => validRefs.has(r))) {
      dropped++
      continue
    }
    const severity = issue.severity === 'high' || issue.severity === 'low' ? issue.severity : 'medium'
    out.push({
      dimension: issue.dimension,
      severity,
      refs,
      description: issue.description,
      ...(typeof issue.evidence === 'string' && issue.evidence.length > 0 ? { evidence: issue.evidence } : {}),
    })
  }
  return { issues: out, summary: typeof summary === 'string' ? summary : '', dropped }
}

/**
 * 时间锚倒序检测（结构化比较的轻量落地）：章节 frontmatter 的 time 锚
 * （「第 N 日[N夜]」或纯数字形态）在全书范围内应单调不减；倒序即时间线矛盾。
 * 无法解析的锚跳过（自由文本时间不强行比较）。
 */
export interface TimeAnchorObserved {
  chapterId: string
  /** 原始 time 锚文本（frontmatter `time` 字段）。 */
  raw: string
}

/** 「第 N 日」/「第 N 天」形态解析出的结构化锚；不匹配返回 undefined。 */
export function parseDayAnchor(raw: string): number | undefined {
  const m = raw.match(/第\s*(\d+)\s*[日天]/)
  return m === null ? undefined : Number(m[1])
}

/** 返回倒序锚对（chapterId + 两侧日序），供一致性报告的「时间线一致性」维度。 */
export function detectTimeAnchorInversions(anchors: readonly TimeAnchorObserved[]): {
  earlier: TimeAnchorObserved & { day: number }
  later: TimeAnchorObserved & { day: number }
}[] {
  const parsed = anchors
    .map((a) => ({ ...a, day: parseDayAnchor(a.raw) }))
    .filter((a): a is TimeAnchorObserved & { day: number } => a.day !== undefined)
  const inversions: { earlier: TimeAnchorObserved & { day: number }; later: TimeAnchorObserved & { day: number } }[] = []
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].day < parsed[i - 1].day) {
      inversions.push({ earlier: parsed[i - 1], later: parsed[i] })
    }
  }
  return inversions
}
