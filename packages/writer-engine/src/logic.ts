/**
 * 写作引擎纯决策逻辑（无 I/O、无 cordis/llm 运行时依赖；FinishReason 仅类型导入）。
 * 从服务实现抽出以供单测锁定 P2 核心行为（rewrite 决策树、模式分发、合并语义）。
 * @module dsh-writer-engine/logic
 */
import type { FinishReason } from '@deepseek-ai/dsh-llm'
import { parseFrontmatter, serializeEntity } from 'dsh-writer-domain'
import type {
  ChapterWriteRequest, Frontmatter, RewriteModelOutput, RewritePatch, RewritePatchResult, SectionValidation, WriterEntity,
} from 'dsh-writer-domain'

/** 章节实体 id 约定：三位序号。 */
export const CHAPTER_ID_RE = /^\d{3}$/

/**
 * 写作请求校验：三位序号 id；assist/rewrite 需章节已存在（新建只能 full）；rewrite 需非空 instruction。
 * @throws 请求不满足前置条件时抛错（业务错误，反馈调用方）。
 */
export function validateWriteRequest(request: ChapterWriteRequest, existing: WriterEntity | undefined): void {
  if (!CHAPTER_ID_RE.test(request.chapterId)) {
    throw new Error(`章节 id 必须为三位序号：${JSON.stringify(request.chapterId)}`)
  }
  if (request.selection !== undefined && request.mode !== 'rewrite') {
    rejectSelectionRewrite('selection 参数仅适用于 rewrite 模式')
  }
  if (request.mode !== 'full' && existing === undefined) {
    throw new Error(`章节不存在：chapter/${request.chapterId}（assist/rewrite 需已存在章节；新建请用 full 模式）`)
  }
  if (request.mode === 'rewrite' && (request.instruction === undefined || request.instruction.trim().length === 0)) {
    throw new Error('rewrite 模式必须提供 instruction（改写指令）')
  }
}

/**
 * full 模式 frontmatter 合并：已有章节保留原值（显式 title 覆盖），新建回填 number 与可选 title。
 */
export function mergeFullFrontmatter(existing: WriterEntity | undefined, chapterId: string, title?: string): Frontmatter {
  const frontmatter: Frontmatter = { ...(existing?.frontmatter ?? {}) }
  if (title !== undefined) frontmatter['title'] = title
  if (frontmatter['number'] === undefined) frontmatter['number'] = Number(chapterId)
  return frontmatter
}

/** assist 模式正文合并：去尾空白后空行衔接续写（空正文直接以续写起章）。 */
export function mergeAssistContent(existingContent: string, continuation: string): string {
  const base = existingContent.trimEnd()
  return base.length === 0 ? continuation : `${base}\n\n${continuation}`
}

/** rewrite 决策树的三个落点。 */
export type RewriteDecision =
  | { action: 'no-change' }
  | { action: 'save-patch'; patch: RewritePatchResult } // 补丁命中 ≥1：保存补丁结果
  | { action: 'fulltext' } // 全文路径（大改输出 / 补丁全不命中降级 / 模型直接给全文）

/**
 * rewrite 决策树（P2 验收核心）：
 * - 补丁协议且空补丁 → no-change（不落盘）；
 * - 补丁协议且命中 ≥1 → save-patch（部分命中时跳过项经 patchStats 告警）；
 * - 补丁协议且全不命中 → fulltext（降级一次全文改写）；
 * - 模型直接给全文 → fulltext。
 */
export function decideRewritePath(model: RewriteModelOutput, patch?: RewritePatchResult): RewriteDecision {
  if (model.kind === 'fulltext') return { action: 'fulltext' }
  if (model.patches.length === 0) return { action: 'no-change' }
  if (patch === undefined) throw new Error('decideRewritePath：补丁输出缺少应用结果')
  if (patch.applied > 0) return { action: 'save-patch', patch }
  return { action: 'fulltext' }
}

export function rejectSelectionRewrite(reason: string): never {
    throw new Error(`选区改稿未通过：${reason}，本次未保存。请从当前章稿重新选定可唯一定位的原文，或请作者明确要求整章改稿后再扩大范围。`)
}

export function locateRewriteSelection(content: string, selection: string): number {
    if (selection.trim().length === 0) rejectSelectionRewrite('选区必须包含非空正文')
    const start = content.indexOf(selection)
    if (start < 0) rejectSelectionRewrite('当前章稿中没有逐字匹配的选区')
    if (content.indexOf(selection, start + 1) >= 0) rejectSelectionRewrite('选区在当前章稿中匹配多处')
    return start
}

export function applySelectionRewrite(
    chapter: WriterEntity,
    selection: { text: string; start: number },
    patches: readonly RewritePatch[],
): RewritePatchResult {
    const spans = patches.map(({ find, replace }, index) => {
        const start = selection.text.indexOf(find)
        if (find.trim().length === 0 || start < 0 || selection.text.indexOf(find, start + 1) >= 0) {
            rejectSelectionRewrite(`第 ${index + 1} 条补丁在选区原文内无唯一的逐字匹配`)
        }
        return { start, end: start + find.length, replace }
    }).sort((a, b) => a.start - b.start)
    const prefix = chapter.content.slice(0, selection.start)
    const suffix = chapter.content.slice(selection.start + selection.text.length)
    const parts = [prefix]
    let cursor = 0
    for (const span of spans) {
        if (span.start < cursor) rejectSelectionRewrite('补丁锚点在选区内重叠')
        parts.push(selection.text.slice(cursor, span.start), span.replace)
        cursor = span.end
    }
    parts.push(selection.text.slice(cursor), suffix)
    const content = parts.join('')
    // 存储会规范化 Markdown；写入前确认不会暗中改动选区外的正文。
    let savedContent: string
    try {
        savedContent = parseFrontmatter(Buffer.from(serializeEntity(chapter.frontmatter, content)).toString()).content
    } catch {
        rejectSelectionRewrite('补丁结果无法按章稿 Markdown 格式保存')
    }
    const expected = suffix.length === 0 && !content.endsWith('\n') ? `${content}\n` : content
    if (savedContent !== expected) rejectSelectionRewrite('章稿存储格式无法原样保存补丁结果，可能改动选区外正文')
    return { content, applied: patches.length, skipped: [] }
}

/**
 * 全文改写落盘守卫：正常小说正文不会以 `{` 开头——若全文输出形如 JSON
 * （补丁协议输出被误判/被寒暄包裹后残余），拒绝落盘抛错，防止整章被垃圾文本覆盖。
 */
export function assertRewriteFullTextPlausible(text: string): void {
  if (text.trimStart().startsWith('{')) {
    throw new Error(`rewrite 全文输出疑似补丁 JSON（以 "{" 开头），拒绝落盘；输出前 120 字：${text.slice(0, 120)}`)
  }
}

/**
 * 模型 finish 状态 → 失败错误映射（stop 通过；error/aborted/max-tokens/tool-calls 各自抛错）。
 * @throws 非 stop 的终态抛带语义的错误。
 */
export function assertFinish(finish: FinishReason): void {
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    throw new Error(`模型调用失败（${finish.kind}）：${finish.failure.message}`)
  }
  if (finish.kind === 'max-tokens') {
    throw new Error('模型输出达到 maxOutputTokens 上限（可在 writer-engine 配置中调大）')
  }
  if (finish.kind === 'tool-calls') {
    throw new Error('写作引擎调用不携带工具，模型却请求了工具调用')
  }
  // 'stop' 为唯一成功终态；此处不穷尽 default：FinishReason 为封闭联合，未来新增 kind 会漏到成功分支，
  // 由 generate() 的空文本检查兜底告警。
}

// ---------------------------------------------------------------------------
// P3 维护 pass：分节校验后的重试规划（纯决策，单测锁定）
// ---------------------------------------------------------------------------

/**
 * 维护 pass 按节重试决策：任一节存在拒收条目 → 需要重试；
 * 返回需重试的节名 + 汇总的拒收原因（作为下次调用的反馈提示词）。
 */
export function planSectionRetry(validations: {
  facts: Pick<SectionValidation<unknown>, 'errors'>
  foreshadowEvents: Pick<SectionValidation<unknown>, 'errors'>
  characterStates: Pick<SectionValidation<unknown>, 'errors'>
}): { sections: ('facts' | 'foreshadowEvents' | 'characterStates')[]; feedback: string[] } {
  const sections: ('facts' | 'foreshadowEvents' | 'characterStates')[] = []
  const feedback: string[] = []
  for (const name of ['facts', 'foreshadowEvents', 'characterStates'] as const) {
    const errors = validations[name].errors
    if (errors.length > 0) {
      sections.push(name)
      feedback.push(...errors)
    }
  }
  return { sections, feedback }
}

export { parseChapterRange } from 'dsh-writer-domain'
