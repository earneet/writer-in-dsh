/**
 * Consumer：写作工具业务错误预算（P4，tools/post-execute 观测）。
 * 按滚动窗口统计受观测写作工具的可分类业务失败率（乐观锁冲突/解析失败/引用拒收/非法迁移/
 * 实体不存在/参数校验），超预算时向该次工具决策附加纠偏提示（additionalContexts）。
 * 设计约束：不熔断（绝不 deny/block 工具调用）、不重复造宿主轮子（重试/超时/权限归宿主）；
 * 范式参照宿主 repeat-tool-reminder（post-execute 计数 → 委托 → 把提示折进下游决策）。
 * 可独立禁用：不装本包即无观测；分类/预算/文案纯函数在 dsh-writer-domain guard.ts。
 * @module dsh-writer-guard
 */
import { type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { createUserMessage, type ContextFormed } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import {
  buildCorrectiveHint, classifyBusinessError, createErrorBudgetWindow, recordAttempt,
  shouldInjectHint, type BusinessErrorCategory, type ErrorBudgetWindow,
} from 'dsh-writer-domain'

// 注入上下文的来源标签（load-bearing：无标签上下文会在派生历史里渲染成用户提问）
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'writer-guard': { kind: 'writer-guard' } & ContextFormed
  }
}

const HINT_SOURCE: { kind: 'writer-guard' } = { kind: 'writer-guard' }

/** 插件配置。 */
export interface Config {
  /** 滚动窗口容量（次尝试；预热满才评估预算，避免开局一次失败即告警）。 */
  windowSize: number
  /** 失败率预算（0-1，超预算才注入纠偏提示）。 */
  failureBudget: number
  /** 提示节流：超预算期间至少间隔 N 次受观测调用才再次注入（防上下文刷屏）。 */
  hintInterval: number
  /** 受观测工具名（裸名清单；缺省全部写作工具）。 */
  watchedTools: string[]
}

export const Config: Schema<Config> = Schema.object({
  windowSize: Schema.number().default(20).min(5).description('滚动窗口容量（次工具调用）'),
  failureBudget: Schema.number().default(0.3).min(0).max(1).description('业务失败率预算（0-1，超预算注入纠偏提示）'),
  hintInterval: Schema.number().default(3).min(1).description('纠偏提示最小注入间隔（次受观测调用）'),
  watchedTools: Schema.array(Schema.string()).default([
    'writer_read', 'writer_update', 'write_chapter', 'review_chapter', 'foreshadow_update',
    'consistency_check', 'recompute_derived', 'writer_stats', 'archive_point', 'timeline_update',
    'pending_cleanup', 'maintenance_flush', 'export_book', 'writer_search',
  ]).description('受观测的写作工具名清单（全部 14 个写作工具）'),
})

export const name = 'writer-guard'
export const inject = ['tools']

export function apply(ctx: Context, config: Config): void {
  const watched = new Set(config.watchedTools)
  if (config.failureBudget < 0 || config.failureBudget > 1) {
    throw new Error(`failureBudget 非法：${config.failureBudget}（0-1）`)
  }
  // 按 agent 分窗（多 agent/subagent 互不污染预算；范式参照宿主 repeat-tool-reminder 的 per-Agent 链）
  const windows = new WeakMap<object, ErrorBudgetWindow>()
  /** 上次注入提示时的尝试序号（节流：hintInterval 内不重复注入）。 */
  const lastHintAttempt = new WeakMap<object, number>()
  const windowOf = (agent: object): ErrorBudgetWindow => {
    let window = windows.get(agent)
    if (window === undefined) {
      window = createErrorBudgetWindow(config.windowSize)
      windows.set(agent, window)
    }
    return window
  }

  /**
   * 观测一次调用并返回应注入的纠偏提示（无可分类失败或未超预算返回 undefined）。
   * 软失败（工具返回错误文案字符串而非抛错）只认白名单前缀（domain SOFT_PATTERNS），
   * 防止对成功输出的正文做居中匹配误报。
   */
  function observe(exec: ToolExecution, result: Readonly<ToolExecutionResult>): { hint: string; category: BusinessErrorCategory } | undefined {
    // 直接 ctx.tools.execute() 调用无模型可提醒，不计数（与 repeat-tool-reminder 同门控）
    if (exec.agent === undefined) return undefined
    if (!watched.has(exec.name)) return undefined
    const agent = exec.agent as object
    const window = windowOf(agent)
    const category = result.isError
      ? classifyBusinessError(result.error.message, 'thrown')
      : (() => {
        const text = textOf(result.content)
        return text === undefined ? undefined : classifyBusinessError(text, 'soft')
      })()
    recordAttempt(window, category ?? (result.isError ? null : undefined))
    if (category === undefined) return undefined
    if (!shouldInjectHint(window, config.failureBudget)) return undefined
    // 节流：距上次注入不足 hintInterval 次调用则本次不注入
    const last = lastHintAttempt.get(agent)
    if (last !== undefined && window.attempts - last < config.hintInterval) return undefined
    lastHintAttempt.set(agent, window.attempts)
    return { hint: buildCorrectiveHint(window, category), category }
  }

  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const observation = observe(exec, result)
    // 先委托：后续监听者仍可替换/阻止；提示折进下游决策（block 变体也携带，参照 repeat-tool-reminder）
    const downstream = await next()
    if (observation === undefined) return downstream
    const reminder = createUserMessage({
      content: [{ type: 'text', text: observation.hint }],
      source: { ...HINT_SOURCE, form: 'notice', summary: `业务错误预算超支（${observation.category}）` },
    })
    if (downstream.kind === 'block') {
      return { kind: 'block', feedback: downstream.feedback, additionalContexts: [reminder, ...downstream.additionalContexts ?? []] }
    }
    return { ...downstream, additionalContexts: [reminder, ...downstream.additionalContexts ?? []] }
  })
}

/** 从内容块提取首个文本（软失败文案分类用；无文本块返回 undefined）。 */
function textOf(content: readonly unknown[] | undefined): string | undefined {
  for (const block of content ?? []) {
    if (typeof block === 'object' && block !== null && (block as Record<string, unknown>)['type'] === 'text') {
      const text = (block as Record<string, unknown>)['text']
      if (typeof text === 'string') return text
    }
  }
  return undefined
}
