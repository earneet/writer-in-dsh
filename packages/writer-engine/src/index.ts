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
import { execFile } from 'node:child_process'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { BlockAssembler, createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import {
  applyRewritePatches, assembleWritingContext, detectDroppedSentences, detectTimeAnchorInversions, inspectTimelines,
  extractChapterOutline, filterSuggestionsByFocus, filterSuggestionsByQuotes, parseConsistencyBatchOutput,
  parseMaintenanceExtraction, parseRewriteModelOutput, parseReviewReport, planConsistencyBatches,
  renderRagSection, renderRecoverySnapshot, truncateBatchBodies, truncateCodePoints, validateExtractionSections,
  type ChapterWriteRequest, type ChapterWriteResult, type ConsistencyReport, type ExtractionSectionName,
  type MaintenanceDerived, type MaintenanceExtraction, type ReviewReport, type TruncatedBody, type WriterEntity,
} from 'dsh-writer-domain'
import {
  EngineService, type ConsistencyScope, type MaintenancePassResult,
  type RecoverySnapshotResult, type RecomputeDerivedResult,
} from 'dsh-writer-core'
import {
  assertFinish, assertRewriteFullTextPlausible, CHAPTER_ID_RE, decideRewritePath, mergeAssistContent,
  mergeFullFrontmatter, parseChapterRange, planSectionRetry, validateWriteRequest,
} from './logic.ts'
import {
  buildConsistencySystemPrompt, buildConsistencyUserPrompt, buildExtractionSystemPrompt,
  buildExtractionUserPrompt, buildReviewSystemPrompt, buildReviewUserPrompt, buildRewriteSystemPrompt,
  buildRewriteUserPrompt, buildSummarySystemPrompt, buildSummaryUserPrompt, buildWriteSystemPrompt,
  buildWriteUserPrompt,
} from './prompts.ts'

/** 插件配置：LLM 路由与生成参数（可调参数不硬编码，配置错误响亮失败）。 */
export interface Config {
  provider: string
  model: string
  maxOutputTokens: number
  temperature: number
  contextBudgetChars: number
  autoMaintenance: boolean
  extractionRetries: number
}

export const Config: Schema<Config> = Schema.object({
  provider: Schema.string().required().description('宿主 llm 缝的 provider 路由名'),
  model: Schema.string().required().description('模型 id'),
  maxOutputTokens: Schema.number().default(16384).min(1024).description('单次生成 maxTokens'),
  temperature: Schema.number().default(0.7).min(0).max(2).description('生成温度'),
  contextBudgetChars: Schema.number().default(24000).min(2000).description('上下文组装字符预算（principles 与本章大纲不裁剪）'),
  autoMaintenance: Schema.boolean().default(true).description('章节保存后异步自动触发维护 pass（同章 inflight 去重 + 完成 hash 锚定）'),
  extractionRetries: Schema.number().default(2).min(0).max(5).description('维护 pass 抽取分节校验拒收后的按节重试次数'),
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
  private readonly extractionRetries: number
  /** 同章维护 pass in-flight 去重（保存后自动触发与显式调用并发时共享同一次执行）。 */
  private readonly maintenanceInflight = new Map<string, Promise<MaintenancePassResult>>()

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.route = { provider: config.provider, model: config.model }
    this.genParams = {
      maxOutputTokens: config.maxOutputTokens,
      temperature: config.temperature,
      contextBudgetChars: config.contextBudgetChars,
    }
    this.extractionRetries = config.extractionRetries
    // 维护 pass（保存后异步）：章节落盘即触发；hash 锚定保证内容未变不重复调用
    if (config.autoMaintenance) {
      ctx.on('writer/entity-saved', (entity) => {
        if (entity.kind !== 'chapter') return
        void this.maintenancePass(entity.id).catch((err: unknown) => {
          this.loggerWarn(`维护 pass 自动触发失败（chapter/${entity.id}）：${String(err)}`)
        })
      })
    }
  }

  private loggerWarn(message: string): void {
    const logger = (this.ctx as { logger?: (name: string) => { warn: (msg: string) => void } }).logger?.('writer-engine')
    if (logger !== undefined) logger.warn(message)
    else console.warn(`[writer-engine] ${message}`)
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

  // —— 维护 pass（保存后异步，默认两次调用；inflight 去重 + 完成 hash 锚定）——

  async maintenancePass(chapterId: string, opts?: { force?: boolean; signal?: AbortSignal }, depth = 0): Promise<MaintenancePassResult> {
    if (!CHAPTER_ID_RE.test(chapterId)) throw new Error(`章节 id 必须为三位序号：${JSON.stringify(chapterId)}`)
    // 同章 inflight 去重：并发触发共享同一次执行（返回同一 Promise，不重复调用模型）。
    // force 请求不共享非 force 执行（否则 up-to-date 短路会吞掉强制语义）：先等 inflight 结束再单独跑。
    const inflight = this.maintenanceInflight.get(chapterId)
    if (inflight !== undefined && opts?.force !== true) return inflight
    if (inflight !== undefined) await inflight.catch(() => {})
    const run = this.doMaintenancePass(chapterId, opts).finally(() => {
      this.maintenanceInflight.delete(chapterId)
    })
    this.maintenanceInflight.set(chapterId, run)
    const result = await run
    // TOCTOU 兜底：执行期间章节又被改写（inflight 去重吞掉了新保存触发的 pass）→ 补跑一次（仅一层，防递归放大）
    if (depth < 1) {
      const [latest, derived] = await Promise.all([
        this.ctx.writer.get('chapter', chapterId),
        this.ctx.writer.readDerived('maintenance', chapterId) as Promise<MaintenanceDerived | undefined>,
      ])
      if (latest !== undefined && derived !== undefined && derived.sourceHash !== latest.hash) {
        return this.maintenancePass(chapterId, { force: true, signal: opts?.signal }, depth + 1)
      }
    }
    return result
  }

  private async doMaintenancePass(chapterId: string, opts?: { force?: boolean; signal?: AbortSignal }): Promise<MaintenancePassResult> {
    opts?.signal?.throwIfAborted()
    const chapter = await this.ctx.writer.get('chapter', chapterId)
    if (chapter === undefined) throw new Error(`章节不存在：chapter/${chapterId}`)
    const derived = await this.ctx.writer.readDerived('maintenance', chapterId) as MaintenanceDerived | undefined
    // 完成 hash 锚定：派生与当前章节内容一致即跳过（防重复触发读己之写）
    if (derived !== undefined && derived.sourceHash === chapter.hash && opts?.force !== true) {
      return { chapterId, status: 'up-to-date', sourceHash: derived.sourceHash }
    }
    const [characters, plots] = await Promise.all([
      this.ctx.writer.list('character'),
      this.ctx.writer.list('plot'),
    ])
    const refs = { chapters: [chapterId], characters: characters.map((c) => c.id), plots: plots.map((p) => p.id) }

    // 调用①：章节摘要（流畅文本）
    const summary = (await this.generate(
      buildSummarySystemPrompt(), buildSummaryUserPrompt(chapter), opts?.signal,
    )).trim()

    // 调用②：事实/伏笔/人物状态抽取（分节校验 + 按节重试）。
    // 重试只替换被拒收的节（模型可只回修正节），上一轮已通过的节原样保留——防「整轮覆盖清空已通过节」。
    const extraction: MaintenanceExtraction = { facts: [], foreshadowEvents: [], characterStates: [] }
    const retriedSections: string[] = []
    let rejected: string[] | undefined
    let feedback: string[] | undefined
    let retrySections: readonly ExtractionSectionName[] = ['facts', 'foreshadowEvents', 'characterStates']
    for (let attempt = 0; attempt <= this.extractionRetries; attempt++) {
      const raw = await this.generate(
        buildExtractionSystemPrompt(), buildExtractionUserPrompt(chapter, refs, feedback, retrySections), opts?.signal,
      )
      const parsed = parseMaintenanceExtraction(raw)
      if (parsed === undefined) {
        if (attempt === this.extractionRetries) {
          throw new Error(`维护 pass 抽取输出无法解析（已重试 ${this.extractionRetries} 次；输出前 200 字：${raw.slice(0, 200)}）`)
        }
        feedback = ['上次输出不是合法的 JSON 对象，请只输出规定 schema 的 JSON（可只含需修正的节）']
        continue
      }
      const validations = validateExtractionSections(parsed, refs)
      for (const section of retrySections) {
        if (section === 'facts') extraction.facts = validations.facts.entries
        else if (section === 'foreshadowEvents') extraction.foreshadowEvents = validations.foreshadowEvents.entries
        else extraction.characterStates = validations.characterStates.entries
      }
      const retry = planSectionRetry(validations)
      if (retry.sections.length === 0) {
        rejected = undefined
        break
      }
      if (attempt === this.extractionRetries) {
        // 重试预算耗尽：保留已通过条目，部分拒收显式标记（partial）并告警，不静默
        rejected = retry.feedback
        this.loggerWarn(`维护 pass 抽取部分拒收（chapter/${chapterId}）：${retry.feedback.join('；')}`)
        break
      }
      if (!retriedSections.includes(retry.sections.join('+'))) retriedSections.push(retry.sections.join('+'))
      feedback = retry.feedback
      retrySections = retry.sections
    }

    // 写回派生数据 + pending.md 待办清单（供人确认，不自动改伏笔/人物实体）。
    // TOCTOU 防护：落盘前重读章节——执行期间被改写则跳过 pending 追加（旧版本待办会误导确认），
    // 派生仍写入（锚定旧 hash，由 maintenancePass 的补跑覆盖）。
    const changedDuringRun = (await this.ctx.writer.get('chapter', chapterId))?.hash !== chapter.hash
    const record: MaintenanceDerived = {
      sourceHash: chapter.hash,
      summary,
      extraction,
      updatedAt: new Date().toISOString(),
      ...(rejected !== undefined ? { partial: true, rejected } : {}),
    }
    await this.ctx.writer.writeDerived('maintenance', chapterId, record)
    if (!changedDuringRun) {
      await this.ctx.writer.appendPending(renderPendingSection(chapterId, record))
    }
    const result: MaintenancePassResult = {
      chapterId,
      status: 'done',
      sourceHash: chapter.hash,
      summary,
      extraction,
      ...(retriedSections.length > 0 ? { retriedSections } : {}),
      ...(rejected !== undefined ? { partial: true, rejected } : {}),
      ...(changedDuringRun ? { superseded: true } : {}),
    }
    this.ctx.emit('writer/maintenance-pass', result)
    return result
  }

  // —— 一致性检查（全书、按预算分批、维度与 schema 对齐；报告预览不自动持久化）——

  async consistencyCheck(scope?: ConsistencyScope, signal?: AbortSignal): Promise<ConsistencyReport> {
    signal?.throwIfAborted()
    const [principles, outline, characters, plots, events, chapters, worldbuilding, styleRefs] = await Promise.all([
      this.ctx.writer.get('principles', 'principles'),
      this.ctx.writer.get('outline', 'outline'),
      this.ctx.writer.list('character'),
      this.ctx.writer.list('plot'),
      this.ctx.writer.get('event', 'event'),
      this.ctx.writer.list('chapter'),
      this.ctx.writer.list('worldbuilding'),
      this.ctx.writer.list('style'),
    ])
    const inScope = chapters.filter((c) => {
      if (scope?.from !== undefined && c.id < scope.from) return false
      if (scope?.to !== undefined && c.id > scope.to) return false
      return true
    })
    if (inScope.length === 0) throw new Error('范围内没有已写章节，无法执行一致性检查')
    // 基准材料：principles 全量 + 大纲（预算内截断保头）+ 伏笔/事件摘要（码点安全截断）
    const brief = (entities: readonly WriterEntity[], max: number): string =>
      entities.map((e) => `- ${e.id}（${String(e.frontmatter['status'] ?? '')}）：${truncateCodePoints(e.content.replace(/\s+/g, ' ').trim(), max)}`).join('\n')
    const baselineChars = Math.floor(this.genParams.contextBudgetChars / 2)
    const baseline = {
      principles: principles?.content,
      outline: outline?.content.slice(0, baselineChars),
      plotsBrief: plots.length > 0 ? brief(plots, 120) : undefined,
      eventsBrief: events?.content.slice(0, Math.floor(baselineChars / 2)),
    }
    const baselineUsed = Object.values(baseline).reduce((sum, s) => sum + (s?.length ?? 0), 0)
    const batchBudget = Math.max(1000, this.genParams.contextBudgetChars - baselineUsed)
    // 分批输入：派生摘要新鲜（sourceHash 锚定）则用摘要，否则用正文
    const inputs = await Promise.all(inScope.map(async (chapter) => {
      const derived = await this.ctx.writer.readDerived('maintenance', chapter.id) as MaintenanceDerived | undefined
      const fresh = derived !== undefined && derived.sourceHash === chapter.hash
      return { id: chapter.id, content: chapter.content, summary: fresh === true ? derived.summary : undefined }
    }))
    const batches = planConsistencyBatches(inputs, batchBudget)
    // 引用存在性集合：裸 id 与 kind/id 两种形态都认；基准材料与全部实体 kind 一并纳入
    const validRefs = new Set<string>(['principles', 'outline', 'event', 'event/event', 'worldbuilding'])
    for (const c of inScope) { validRefs.add(c.id); validRefs.add(`chapter/${c.id}`) }
    for (const c of characters) { validRefs.add(c.id); validRefs.add(`character/${c.id}`) }
    for (const p of plots) { validRefs.add(p.id); validRefs.add(`plot/${p.id}`) }
    for (const w of worldbuilding) { validRefs.add(w.id); validRefs.add(`worldbuilding/${w.id}`) }
    for (const s of styleRefs) { validRefs.add(s.id); validRefs.add(`style/${s.id}`) }
    const issues: ConsistencyReport['issues'] = []
    const summaries: string[] = []
    for (const batch of batches) {
      signal?.throwIfAborted()
      const batchChapters = batch.chapters.map((id) => {
        const chapter = inScope.find((c) => c.id === id)!
        const input = inputs.find((i) => i.id === id)!
        const title = typeof chapter.frontmatter['title'] === 'string' ? chapter.frontmatter['title'] : undefined
        const body = input.summary !== undefined && input.summary.length > 0 ? input.summary : chapter.content
        return { id, number: typeof chapter.frontmatter['number'] === 'number' ? chapter.frontmatter['number'] : Number(id), title, body }
      })
      // 分批截断落地：批次正文总量超预算时水fill 截断（truncated 标记与实际截断一致，不超发）
      const truncatedBodies: TruncatedBody[] = truncateBatchBodies(batchChapters.map((c) => c.body), batchBudget)
      const promptChapters = batchChapters.map((c, i) => ({ ...c, body: truncatedBodies[i].body }))
      const raw = await this.generate(
        buildConsistencySystemPrompt(), buildConsistencyUserPrompt(baseline, promptChapters), signal,
      )
      const parsed = parseConsistencyBatchOutput(raw, validRefs)
      if (parsed === undefined) throw new Error(`一致性检查某批次输出无法解析（章节 ${batch.chapters.join('、')}；输出前 200 字：${raw.slice(0, 200)}）`)
      issues.push(...parsed.issues)
      if (parsed.summary.length > 0) summaries.push(`【${batch.chapters[0]}-${batch.chapters[batch.chapters.length - 1]}】${parsed.summary}`)
    }
    // 确定性时间锚倒序检测（不调 LLM）
    for (const inversion of detectTimeInversions(inScope)) {
      issues.push({
        dimension: '时间线一致性',
        severity: 'medium',
        refs: [`chapter/${inversion.earlier.chapterId}`, `chapter/${inversion.later.chapterId}`],
        description: `时间锚倒序：chapter/${inversion.earlier.chapterId}（${inversion.earlier.raw}）晚于其后 chapter/${inversion.later.chapterId}（${inversion.later.raw}）`,
      })
    }
    // 确定性人物时间线体检（P5：轮次 8 限制⑥清偿——timeline 是人确认的权威数据，脏值/倒序必须暴露）。
    // 刻意不随 scope 过滤：timeline 是人物级全书数据（与章节区间无关），与 detectTimeInversions 的章节级 scope 语义不同。
    const timeline = inspectTimelines(characters)
    for (const inversion of timeline.inversions) {
      issues.push({
        dimension: '人物一致性',
        severity: 'medium',
        refs: [`character/${inversion.characterId}`],
        description: `人物状态时间线倒序：chapter/${inversion.earlier.chapter}（${inversion.earlier.state}）排在 chapter/${inversion.later.chapter}（${inversion.later.state}）之前——请核对手改的 timeline 字段并按章序整理`,
      })
    }
    for (const bad of timeline.malformed) {
      issues.push({
        dimension: '人物一致性',
        severity: 'high',
        refs: [`character/${bad.characterId}`],
        description: `人物状态时间线无法解析：${bad.reason}`,
      })
    }
    for (const bad of timeline.invalid) {
      issues.push({
        dimension: '人物一致性',
        severity: 'medium',
        refs: [`character/${bad.characterId}`],
        description: `人物状态时间线条目非法：${bad.errors.join('；')}`,
      })
    }
    return { issues, batches, summary: summaries.join('\n') }
  }

  // —— 改稿期派生重算（标记/重算下游派生物）——

  async recomputeDerived(range: string, opts?: { mode?: 'mark' | 'recompute'; signal?: AbortSignal }): Promise<RecomputeDerivedResult[]> {
    const mode = opts?.mode ?? 'recompute'
    const ids = parseChapterRange(range)
    const results: RecomputeDerivedResult[] = []
    for (const id of ids) {
      opts?.signal?.throwIfAborted()
      const chapter = await this.ctx.writer.get('chapter', id)
      if (chapter === undefined) {
        results.push({ chapterId: id, status: 'no-chapter' })
        continue
      }
      const derived = await this.ctx.writer.readDerived('maintenance', id) as MaintenanceDerived | undefined
      const fresh = derived !== undefined && derived.sourceHash === chapter.hash
      if (fresh && mode === 'recompute') {
        results.push({ chapterId: id, status: 'up-to-date' })
        continue
      }
      if (mode === 'mark') {
        await this.ctx.writer.deleteDerived('maintenance', id)
        // 旧待办作废提示：pending.md 中该章上次维护 pass 的建议基于旧版本，标记过期即作废
        await this.ctx.writer.appendPending(`## [recompute mark] chapter/${id} 派生已标记过期（${new Date().toISOString()}）——此前针对本章的维护 pass 待办作废，待重算后重新生成。`)
        results.push({ chapterId: id, status: 'marked' })
        continue
      }
      await this.maintenancePass(id, { force: true, signal: opts?.signal })
      results.push({ chapterId: id, status: 'recomputed' })
    }
    return results
  }

  // —— 断更恢复快照（§1.4 顺延项 P4 清偿）：章节/派生摘要/事件/伏笔 → Markdown 快照 ——

  async recoverySnapshot(range?: string): Promise<RecoverySnapshotResult> {
    const rangeIds = range === undefined ? undefined : new Set(parseChapterRange(range))
    const all = await this.ctx.writer.list('chapter')
    const chapters = rangeIds === undefined ? all : all.filter((c) => rangeIds.has(c.id))
    const [characters, plots, events] = await Promise.all([
      this.ctx.writer.list('character'),
      this.ctx.writer.list('plot'),
      this.ctx.writer.get('event', 'event'),
    ])
    // 新鲜派生摘要（sourceHash 锚定；过期摘要不用，正文截断兜底）
    const summaries: Record<string, string> = {}
    await Promise.all(chapters.map(async (chapter) => {
      const derived = await this.ctx.writer.readDerived('maintenance', chapter.id) as MaintenanceDerived | undefined
      if (derived !== undefined && derived.sourceHash === chapter.hash && derived.summary.trim().length > 0) {
        summaries[chapter.id] = derived.summary
      }
    }))
    // 时间锚取 git log 最后提交时间（非 git 仓库/无记录 → null，渲染层显示「时间未知」）
    const chapterTimes: Record<string, string | null> = {}
    await Promise.all(chapters.map(async (chapter) => {
      chapterTimes[chapter.id] = await lastCommitTime(this.ctx.writer.root, chapter.path)
    }))
    const markdown = renderRecoverySnapshot({
      chapters, summaries, characters, plots, events, chapterTimes,
      generatedAt: new Date().toISOString(),
    })
    const absPath = join(this.ctx.writer.root, '.writer', 'recovery-snapshot.md')
    await mkdir(join(absPath, '..'), { recursive: true })
    // 唯一 tmp 名 + 失败清理：并发快照不互踩固定 tmp；写 tmp 失败不遗留半写文件
    const tmpPath = `${absPath}.${process.pid}-${snapshotCounter++}.tmp`
    try {
      await writeFile(tmpPath, markdown, 'utf8')
    } catch (err) {
      await rm(tmpPath, { force: true }).catch(() => {})
      throw new Error(`恢复快照落盘失败：${String(err)}`)
    }
    try {
      await rename(tmpPath, absPath)
    } catch (err) {
      await rm(tmpPath, { force: true }).catch(() => {})
      throw new Error(`恢复快照落盘失败：${String(err)}`)
    }
    return { path: absPath, markdown, chapters: chapters.length }
  }

  // —— 维护 pass 排空（P7：headless 收尾前等待在飞 pass，缓解退出截断）——

  /** 当前在飞维护 pass 数（含自动触发；0 = 无在飞，drain 立即返回）。 */
  pendingMaintenanceCount(): number {
    return this.maintenanceInflight.size
  }

  /**
   * 排空在飞维护 pass。**快照语义**：等待调用瞬间的 inflight 快照；快照后新进的 pass、以及
   * maintenancePass TOCTOU 补跑（原 run settle 后才重新入表）不被本次等待——由下次 flush/
   * 保存触发覆盖（连续 flush 两次可收敛）。失败只吞错：排空语义是「等到不在飞」，不是「保证成功」。
   */
  async drainMaintenance(): Promise<void> {
    await Promise.allSettled([...this.maintenanceInflight.values()])
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
    const assembled = assembleWritingContext({
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
    return this.augmentByRag(assembled, request, outline)
  }

  /**
   * 检索增强注入（P4）：writerRag 在场时以「本章大纲 + 写作指令」为查询做混合检索，
   * 追加为最后一级可降级分节（预算 = 组装预算的 1/4 上限，防挤占必注分节）。
   * 防剧透由 rag 服务端按 chapterLimit 过滤（与组装器同红线：早章可见、未来章不可见）。
   * rag 缺席（不装包）或检索失败：静默降级为无增强分节（增强不是依赖，不阻断写作）。
   */
  private async augmentByRag(
    assembled: import('dsh-writer-domain').AssembledWritingContext,
    request: ChapterWriteRequest,
    outline: WriterEntity | undefined,
  ): Promise<import('dsh-writer-domain').AssembledWritingContext> {
    const rag = this.ctx.get('writerRag')
    if (rag === undefined) return assembled
    const chapterNumber = Number(request.chapterId)
    const chapterOutline = outline === undefined ? undefined : extractChapterOutline(outline.content, chapterNumber)
    const query = [chapterOutline ?? '', request.instruction ?? ''].filter((s) => s.trim().length > 0).join('\n').trim()
    if (query.length === 0) return assembled
    try {
      const hits = await rag.search(query, { chapterLimit: chapterNumber, maxResults: 5, signal: request.signal })
      if (hits.length === 0) return assembled
      const body = renderRagSection(hits)
      const cap = Math.max(200, Math.floor(this.genParams.contextBudgetChars / 4))
      const sections = [...assembled.sections, {
        title: '检索增强（RAG，已防剧透过滤）',
        body: truncateCodePoints(body, cap),
        truncated: Array.from(body).length > cap,
      }]
      const usageChars = sections.reduce((sum, s) => sum + s.title.length + s.body.length + 2, 0)
      return { sections, usageChars }
    } catch (err) {
      this.loggerWarn(`检索增强失败（降级为无 RAG 分节，写作继续）：${String(err)}`)
      return assembled
    }
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

// ---------------------------------------------------------------------------
// P3/P4 模块级纯辅助（模块私有，不导出）
// ---------------------------------------------------------------------------

const execFileAsync = promisify(execFile)

/** recoverySnapshot 并发 tmp 名序号（唯一 tmp 名防互踩）。 */
let snapshotCounter = 0

/** 章节文件最后 git 提交时间（ISO 文本）；非 git 仓库/无记录/文件未跟踪返回 null。 */
async function lastCommitTime(root: string, relPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['log', '-1', '--format=%cI', '--', relPath], { cwd: root })
    const trimmed = stdout.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

/** 从章节 frontmatter 的 time 锚做确定性倒序检测（不调 LLM）。 */
function detectTimeInversions(chapters: readonly WriterEntity[]): ReturnType<typeof detectTimeAnchorInversions> {
  const anchors = chapters
    .map((c) => ({ chapterId: c.id, raw: String(c.frontmatter['time'] ?? '') }))
    .filter((a) => a.raw.length > 0)
  return detectTimeAnchorInversions(anchors)
}

/** 维护 pass 产出的 pending.md 待办节（供人确认；不自动改伏笔/人物实体）。导出供单测锁定格式。 */
export function renderPendingSection(chapterId: string, record: MaintenanceDerived): string {
  const lines = [`## [维护 pass] chapter/${chapterId}（${record.updatedAt}）待人工确认`]
  lines.push(`- 摘要：${record.summary}`)
  for (const fact of record.extraction.facts) {
    lines.push(`- 事实：${fact.description}${fact.characters !== undefined ? `（人物：${fact.characters.join('、')}）` : ''}${fact.plots !== undefined ? `（伏笔：${fact.plots.join('、')}）` : ''}`)
  }
  for (const event of record.extraction.foreshadowEvents) {
    lines.push(`- 伏笔事件建议：plot/${event.plot} ${event.action}${event.note !== undefined ? `——${event.note}` : ''}（如属实请用 foreshadow_update 确认）`)
  }
  for (const state of record.extraction.characterStates) {
    lines.push(`- 人物状态建议：character/${state.character} 第 ${chapterId} 章末 → ${state.state}（如属实请用 timeline_update 确认写入人物时间线：id=${state.character} chapter=${chapterId} state=..., expectHash 取最新 writer_read）`)
  }
  if (record.partial === true) {
    lines.push('- ⚠ 部分抽取条目因引用校验未通过被拒收（重试预算耗尽）：')
    for (const reason of record.rejected ?? []) lines.push(`  - ${reason}`)
  }
  return lines.join('\n')
}
