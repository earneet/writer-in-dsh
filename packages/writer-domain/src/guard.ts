/**
 * P4 writer-guard 纯函数域库：工具业务错误分类、滚动窗口错误预算、纠偏提示文案。
 * Consumer（tools/post-execute 观测）只做编排；分类/预算/文案全部在此可独立单测。
 * 设计约束：不熔断（不 deny 工具调用）、不重复造宿主轮子（重试/超时归宿主），只注入纠偏提示。
 * @module dsh-writer-domain/guard
 */

/** 可分类业务错误类别（不可分类返回 undefined，不计入预算）。 */
export type BusinessErrorCategory =
  | 'optimistic-lock'
  | 'parse'
  | 'reference-reject'
  | 'illegal-transition'
  | 'not-found'
  | 'validation'

/**
 * 抛错失败（isError）的分类模式表：**行首锚定**与本仓 tools/engine/store/domain 的实际错误措辞
 * 前缀对齐（居中裸子串会误吞小说正文/正常输出中的普通词汇；措辞变更须同步此处）。
 */
const THROWN_PATTERNS: ReadonlyArray<readonly [BusinessErrorCategory, RegExp]> = [
  ['optimistic-lock', /^乐观锁失败|^实体已存在：/],
  ['parse', /^(审稿输出|维护 pass 抽取输出|一致性检查某批次输出|frontmatter 行)无法解析|^milestones JSON 解析失败|^(milestones|timeline) (必须是 JSON|JSON 解析失败)|^(milestones|timeline)\[|rewrite 全文输出疑似补丁 JSON/],
  ['reference-reject', /^引用不存在|^fact「.*」引用不存在的实体|^foreshadowEvent 引用不存在的伏笔|^characterState 引用不存在的人物/],
  ['illegal-transition', /^伏笔状态非法迁移/],
  ['not-found', /^(实体不存在|章节不存在|伏笔实体不存在|人物实体不存在)/],
  // 「未知X」家族含无空格变体（未知导出格式：/未知实体种类：）——\s? 兼容两种措辞
  ['validation', /^未知\s?(action|mode|实体种类|写作模式|导出格式)|milestone_type 非法|章节 id 必须为三位序号|章节区间(格式非法|倒序)|保存补丁为空|至少提供其一|content 与 frontmatter 至少提供|max_results 非法|(plant|resolve|milestone) 需要提供 chapter|rewrite 模式必须提供|派生数据 (kind|id) 非法|实体 id 非法|必须是 JSON|实体 .* 是单文件实体|^project 实体（writer\.yaml）为项目配置，只读不可写入|^timeline (章节锚非法|state 不能为空)|^现有 timeline 非法，拒绝追加|^character\/.+ 的 timeline 字段非法/],
]

/**
 * 软失败（工具返回错误文案字符串而非抛错）的**白名单前缀**表：仅匹配已知软失败开头
 * （writer-tools 的软失败固定以这些前缀开头）；成功输出的其余正文一律不分类。
 */
const SOFT_PATTERNS: ReadonlyArray<readonly [BusinessErrorCategory, RegExp]> = [
  ['not-found', /^(实体不存在|伏笔实体不存在|人物实体不存在)/],
  ['validation', /^project 实体（writer\.yaml）为项目配置，只可 read 不可 update/],
]

/** 类别 → 纠偏提示（注入给模型的行动指引，不熔断）。 */
const CATEGORY_HINTS: Readonly<Record<BusinessErrorCategory, string>> = {
  'optimistic-lock': '乐观锁冲突频发：每次写入前必须重新 writer_read 取回完整 hash，禁止复用旧 hash 或误填 "new"。',
  parse: '结构化输出解析失败频发：严格按工具说明输出规定 schema（JSON 对象），不要附加寒暄或截断。',
  'reference-reject': '引用拒收频发：引用的人物/伏笔/章节 id 必须先经 writer_read 确认存在，不要凭空捏造 id。',
  'illegal-transition': '状态机非法迁移频发：先 writer_read 确认当前状态，按 plant/resolve/abandon 合法迁移路径操作。',
  'not-found': '实体不存在频发：先用 writer_read 不带 id 列清单，再按清单中的实际 id 读取。',
  validation: '参数校验失败频发：逐项核对工具参数（mode/action/entity 的合法值、必填项）。',
}

/**
 * 分类一条业务错误消息；不可分类返回 undefined（观测层对 undefined 不计数）。
 * @param message - 工具失败消息（error.message 或软失败返回文本）。
 * @param mode - thrown=抛错失败（行首锚定全表）；soft=软失败返回文本（白名单前缀表，
 *   防止对成功输出的正文做居中匹配造成误报）。
 */
export function classifyBusinessError(message: string, mode: 'thrown' | 'soft' = 'thrown'): BusinessErrorCategory | undefined {
  const patterns = mode === 'soft' ? SOFT_PATTERNS : THROWN_PATTERNS
  for (const [category, pattern] of patterns) {
    if (pattern.test(message)) return category
  }
  return undefined
}

/** 滚动窗口统计（固定容量环形；attempt = 受观测工具的一次调用）。 */
export interface ErrorBudgetWindow {
  /** 最近 N 次尝试的失败类别（undefined 位置表示成功；null 表示不可分类失败）。 */
  readonly recent: (BusinessErrorCategory | undefined | null)[]
  readonly capacity: number
  /** 各类别累计失败数（窗口内）。 */
  readonly categoryCounts: Map<BusinessErrorCategory, number>
  failures: number
  attempts: number
}

/** 建窗。 */
export function createErrorBudgetWindow(capacity: number): ErrorBudgetWindow {
  if (!Number.isInteger(capacity) || capacity < 5) {
    throw new Error(`窗口容量非法：${capacity}（须为 ≥5 的整数）`)
  }
  return { recent: [], capacity, categoryCounts: new Map(), failures: 0, attempts: 0 }
}

/**
 * 记录一次尝试并维护滚动窗口。
 * @param failedCategory - 可分类失败类别；不可分类失败传 null；成功传 undefined。
 */
export function recordAttempt(window: ErrorBudgetWindow, failedCategory: BusinessErrorCategory | undefined | null): void {
  window.recent.push(failedCategory === undefined ? undefined : failedCategory)
  window.attempts++
  if (failedCategory !== undefined && failedCategory !== null) {
    window.failures++
    window.categoryCounts.set(failedCategory, (window.categoryCounts.get(failedCategory) ?? 0) + 1)
  } else if (failedCategory === null) {
    window.failures++
  }
  if (window.recent.length > window.capacity) {
    const evicted = window.recent.shift()
    if (evicted !== undefined) {
      window.failures--
      if (evicted !== null) {
        const count = window.categoryCounts.get(evicted) ?? 0
        if (count <= 1) window.categoryCounts.delete(evicted)
        else window.categoryCounts.set(evicted, count - 1)
      }
    }
  }
}

/** 当前窗口失败率（0-1）；窗口未填满前按已发生尝试数计。 */
export function failureRate(window: ErrorBudgetWindow): number {
  if (window.attempts === 0) return 0
  return window.failures / Math.min(window.attempts, window.capacity)
}

/**
 * 是否应注入纠偏提示：窗口预热满（attempts ≥ capacity，避免开局一次失败即告警）且失败率超预算。
 * @param budgetRate - 失败率预算（0-1，超预算才提示）。
 */
export function shouldInjectHint(window: ErrorBudgetWindow, budgetRate: number): boolean {
  if (window.attempts < window.capacity) return false
  return failureRate(window) > budgetRate
}

/** 窗口统计摘要（提示文案与测试共用）。 */
export function windowStats(window: ErrorBudgetWindow): { attempts: number; failures: number; rate: number; categories: string[] } {
  const categories = [...window.categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => `${category}×${count}`)
  return {
    attempts: Math.min(window.attempts, window.capacity),
    failures: window.failures,
    rate: failureRate(window),
    categories,
  }
}

/**
 * 构建纠偏提示文本（注入 additionalContexts 的正文）：统计 + 按失败最多的类别给行动指引。
 * @param currentCategory - 触发本次注入的失败类别（其指引排最前；缺省用窗口头名类别）。
 */
export function buildCorrectiveHint(window: ErrorBudgetWindow, currentCategory?: BusinessErrorCategory): string {
  const stats = windowStats(window)
  const top = currentCategory ?? [...window.categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const lines = [
    `[writer-guard] 工具业务失败率超预算：最近 ${stats.attempts} 次调用失败 ${stats.failures} 次（${(stats.rate * 100).toFixed(0)}%）${stats.categories.length > 0 ? `，构成：${stats.categories.join('、')}` : ''}。`,
  ]
  if (top !== undefined) lines.push(`纠偏指引：${CATEGORY_HINTS[top]}`)
  lines.push('请先复盘最近的失败结果，修正调用方式后再继续；本提示不阻止任何工具调用。')
  return lines.join('\n')
}
