/**
 * Provider：写作引擎，发布 `ctx.writerEngine`。
 * 章节写作三模式（full 整章 / assist 续写 / rewrite 补丁协议优先、大改回退全文）+ 3+1 维审稿。
 * 全部 LLM 经宿主 `ctx.llm` 缝调用（R-改进：插件内直连 SDK 会使 watchdog/abort 论证失效）；
 * 章节保存走 `ctx.writer` store（乐观锁），落盘成功后 emit writer/chapter-written。
 * 规划见 docs/implementation-plan.md §1.4；rewrite 补丁协议/丢句守卫在 dsh-writer-domain。
 * @module dsh-writer-engine
 */
import { type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { BlockAssembler, createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import {
  applyRewritePatches, assembleWritingContext, detectDroppedSentences, extractChapterOutline,
  filterSuggestionsByFocus, filterSuggestionsByQuotes, parseRewriteModelOutput, parseReviewReport,
  type ChapterWriteRequest, type ChapterWriteResult, type ReviewReport, type WriterEntity,
} from 'dsh-writer-domain'
import { EngineService } from 'dsh-writer-core'
import {
  assertFinish, assertRewriteFullTextPlausible, decideRewritePath, mergeAssistContent, mergeFullFrontmatter,
  validateWriteRequest,
} from './logic.ts'
import {
  buildReviewSystemPrompt, buildReviewUserPrompt, buildRewriteSystemPrompt, buildRewriteUserPrompt,
  buildWriteSystemPrompt, buildWriteUserPrompt,
} from './prompts.ts'

/** 插件配置：LLM 路由与生成参数（可调参数不硬编码，配置错误响亮失败）。 */
export interface Config {
  provider: string
  model: string
  maxOutputTokens: number
  temperature: number
  contextBudgetChars: number
}

export const Config: Schema<Config> = Schema.object({
  provider: Schema.string().required().description('宿主 llm 缝的 provider 路由名'),
  model: Schema.string().required().description('模型 id'),
  maxOutputTokens: Schema.number().default(16384).min(1024).description('单次生成 maxTokens'),
  temperature: Schema.number().default(0.7).min(0).max(2).description('生成温度'),
  contextBudgetChars: Schema.number().default(24000).min(2000).description('上下文组装字符预算（principles 与本章大纲不裁剪）'),
})

/**
 * 写作引擎服务。default-export 类插件（服务包惯例）；就绪后
 * `ctx.get('writerEngine')` 的消费方（tools）才可用。
 */
export default class WriterEngineServiceImpl extends EngineService {
  static inject = ['writer', 'llm']
  static Config = Config

  private readonly route: { provider: string; model: string }
  private readonly genParams: { maxOutputTokens: number; temperature: number; contextBudgetChars: number }

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.route = { provider: config.provider, model: config.model }
    this.genParams = {
      maxOutputTokens: config.maxOutputTokens,
      temperature: config.temperature,
      contextBudgetChars: config.contextBudgetChars,
    }
  }

  async writeChapter(request: ChapterWriteRequest): Promise<ChapterWriteResult> {
    request.signal?.throwIfAborted()
    const chapter = await this.ctx.writer.get('chapter', request.chapterId)
    validateWriteRequest(request, chapter)
    if (request.mode === 'full') return this.writeFull(request, chapter)
    if (request.mode === 'assist') return this.writeAssist(request, chapter!)
    return this.writeRewrite(request, chapter!)
  }

  async reviewChapter(chapterId: string, focus?: readonly string[], signal?: AbortSignal): Promise<ReviewReport> {
    signal?.throwIfAborted()
    if (!/^\d{3}$/.test(chapterId)) throw new Error(`章节 id 必须为三位序号：${JSON.stringify(chapterId)}`)
    const chapter = await this.ctx.writer.get('chapter', chapterId)
    if (chapter === undefined) throw new Error(`章节不存在：chapter/${chapterId}`)
    const [principles, outline, characters, plots] = await Promise.all([
      this.ctx.writer.get('principles', 'principles'),
      this.ctx.writer.get('outline', 'outline'),
      this.ctx.writer.list('character'),
      this.ctx.writer.list('plot'),
    ])
    const chapterNumber = typeof chapter.frontmatter['number'] === 'number' ? chapter.frontmatter['number'] : Number(chapterId)
    const brief = (entities: readonly WriterEntity[], max: number): string =>
      entities.map((e) => `- ${e.id}：${e.content.replace(/\s+/g, ' ').trim().slice(0, max)}`).join('\n')
    const user = buildReviewUserPrompt(chapter, {
      principles: principles?.content,
      chapterOutline: outline === undefined ? undefined : extractChapterOutline(outline.content, chapterNumber),
      charactersBrief: characters.length > 0 ? brief(characters, 100) : undefined,
      plotsBrief: plots.length > 0 ? brief(plots, 120) : undefined,
    })
    const raw = await this.generate(buildReviewSystemPrompt(focus), user, signal)
    const parsed = parseReviewReport(raw)
    if (parsed === undefined) {
      throw new Error(`审稿输出无法解析为结构化报告（模型返回前 200 字：${raw.slice(0, 200)}）`)
    }
    // quote 幻觉过滤（提示词承诺的丢弃语义在此落地）+ focus 维度过滤
    return filterSuggestionsByFocus(filterSuggestionsByQuotes(parsed, chapter.content), focus)
  }

  // —— full：整章生成，一次调用，创建或整体替换 ——

  private async writeFull(request: ChapterWriteRequest, existing: WriterEntity | undefined): Promise<ChapterWriteResult> {
    const assembled = await this.assemble(request, existing)
    const system = buildWriteSystemPrompt('full')
    const user = buildWriteUserPrompt(assembled, 'full')
    const content = await this.generate(system, user, request.signal)
    const frontmatter = mergeFullFrontmatter(existing, request.chapterId, request.title)
    const chapter = await this.ctx.writer.save(
      'chapter', request.chapterId,
      { content, frontmatter },
      existing?.hash,
    )
    const result: ChapterWriteResult = { chapter, mode: 'full' }
    this.ctx.emit('writer/chapter-written', result)
    return result
  }

  // —— assist：轻上下文续写，追加到现有正文尾部 ——

  private async writeAssist(request: ChapterWriteRequest, chapter: WriterEntity): Promise<ChapterWriteResult> {
    const assembled = await this.assemble(request, chapter)
    const system = buildWriteSystemPrompt('assist')
    const user = buildWriteUserPrompt(assembled, 'assist')
    const continuation = await this.generate(system, user, request.signal)
    const merged = mergeAssistContent(chapter.content, continuation.trim())
    const saved = await this.ctx.writer.save(
      'chapter', request.chapterId, { content: merged }, chapter.hash,
    )
    const result: ChapterWriteResult = { chapter: saved, mode: 'assist' }
    this.ctx.emit('writer/chapter-written', result)
    return result
  }

  // —— rewrite：补丁协议优先；决策树见 logic.decideRewritePath；全文路径跑丢句守卫 + JSON 形守卫 ——

  private async writeRewrite(request: ChapterWriteRequest, chapter: WriterEntity): Promise<ChapterWriteResult> {
    const system = buildRewriteSystemPrompt()
    const user = buildRewriteUserPrompt(chapter, request.instruction ?? '', request.selection)
    const raw = await this.generate(system, user, request.signal)
    const parsed = parseRewriteModelOutput(raw)
    const applied = parsed.kind === 'patches' && parsed.patches.length > 0
      ? applyRewritePatches(chapter.content, parsed.patches)
      : undefined
    const decision = decideRewritePath(parsed, applied)
    if (decision.action === 'no-change') {
      // 空补丁 = 模型判定无需修改：不落盘、不 emit，原实体原样返回
      return { chapter, mode: 'rewrite-patch', patchStats: { applied: 0, skipped: 0, skippedReasons: ['模型返回空补丁（判定无需修改）'] } }
    }
    if (decision.action === 'save-patch') {
      const saved = await this.ctx.writer.save(
        'chapter', request.chapterId, { content: decision.patch.content }, chapter.hash,
      )
      const result: ChapterWriteResult = {
        chapter: saved,
        mode: 'rewrite-patch',
        patchStats: {
          applied: decision.patch.applied,
          skipped: decision.patch.skipped.length,
          skippedReasons: decision.patch.skipped.map((s) => `${s.reason}: ${s.find.slice(0, 50)}`),
        },
      }
      this.ctx.emit('writer/chapter-written', result)
      return result
    }
    return this.rewriteFullText(request, chapter)
  }

  /** 全文改写路径（大改输出 / 补丁降级共用）：JSON 形守卫 + 替换全文 + 丢句守卫告警。 */
  private async rewriteFullText(request: ChapterWriteRequest, chapter: WriterEntity): Promise<ChapterWriteResult> {
    const system = [
      buildRewriteSystemPrompt(),
      '本次为大改：忽略补丁协议，直接输出改写后的整章正文全文。',
    ].join('\n')
    const user = buildRewriteUserPrompt(chapter, request.instruction ?? '', request.selection)
    const rewritten = await this.generate(system, user, request.signal)
    assertRewriteFullTextPlausible(rewritten)
    const guard = detectDroppedSentences(chapter.content, rewritten)
    const saved = await this.ctx.writer.save(
      'chapter', request.chapterId, { content: rewritten }, chapter.hash,
    )
    const result: ChapterWriteResult = {
      chapter: saved,
      mode: 'rewrite-full',
      ...(guard.dropped.length > 0 ? { droppedSentences: guard.dropped } : {}),
    }
    this.ctx.emit('writer/chapter-written', result)
    return result
  }

  // —— 上下文组装（委托 domain 组装器；assist 用精简预算）——

  private async assemble(request: ChapterWriteRequest, chapter: WriterEntity | undefined) {
    const [principles, outline, chapters, characters, plots, events, styleRefs] = await Promise.all([
      this.ctx.writer.get('principles', 'principles'),
      this.ctx.writer.get('outline', 'outline'),
      this.ctx.writer.list('chapter'),
      this.ctx.writer.list('character'),
      this.ctx.writer.list('plot'),
      this.ctx.writer.get('event', 'event'),
      this.ctx.writer.list('style'),
    ])
    return assembleWritingContext({
      chapterNumber: Number(request.chapterId),
      principles,
      outline,
      chapters,
      characters,
      plots,
      events,
      styleRefs,
      budgetChars: request.mode === 'assist' ? Math.floor(this.genParams.contextBudgetChars / 2) : this.genParams.contextBudgetChars,
      instruction: request.instruction,
    })
  }

  // —— 宿主 llm 缝的单次生成（流式组装；观测 signal）——

  private async generate(system: string, user: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const options: GenerateOptions = {
      provider: this.route.provider,
      model: this.route.model,
      system,
      temperature: this.genParams.temperature,
      maxTokens: this.genParams.maxOutputTokens,
      messages: [createUserMessage({ content: [{ type: 'text', text: user }], source: { kind: 'user' } })],
      signal,
    }
    const assembler = new BlockAssembler()
    for await (const chunk of this.ctx.llm.stream(options)) {
      signal?.throwIfAborted()
      assembler.push(chunk)
    }
    signal?.throwIfAborted()
    // finish → 失败映射（stop 放行为唯一成功终态）
    assertFinish(assembler.finish)
    const text = assembler.blocks()
      .filter((block): block is Extract<(typeof block), { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('')
    if (text.trim().length === 0) throw new Error('模型未返回任何文本')
    return text.trim()
  }
}
