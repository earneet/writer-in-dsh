/**
 * 写作引擎提示词构建（纯函数，无 I/O；单测不依赖 cordis/llm）。
 * 上下文分节来自 dsh-writer-domain 的 assembleWritingContext。
 * @module dsh-writer-engine/prompts
 */
import {
  REVIEW_DIMENSIONS,
  type AssembledWritingContext, type ContextSection, type WriterEntity,
} from 'dsh-writer-domain'
import type { ReviewContext } from './review.ts'

/** 把组装出的分节渲染为用户提示词正文（标题 + 内容块）。 */
export function renderSections(sections: readonly ContextSection[]): string {
  return sections.map((s) => `## ${s.title}\n${s.body}`).join('\n\n')
}

/** 章节写作 system 提示词（full/assist 共用；rewrite 另有补丁协议变体）。 */
export function buildWriteSystemPrompt(mode: 'full' | 'assist'): string {
  const common = [
    '你是一位中文长篇小说的章节写作执行者。严格依据「创作准则」的规则红线写作；',
    '「本章大纲」是本章的结构契约，必须逐条落实；「伏笔指令」中 🔴 为本章必须执行的红线项。',
    '只输出章节正文本身（Markdown），不要输出任何解释、标题、大纲复述或元信息。',
  ].join('')
  if (mode === 'full') {
    return `${common}整章模式：一次输出完整一章（约 1500-4000 字），起承转合完整。`
  }
  return `${common}续写模式：从现有正文结尾无缝续写 300-800 字，不重复已有内容，不改写已有句子。`
}

/** rewrite 模式 system 提示词：补丁协议优先（小改），大改输出全文。 */
export function buildRewriteSystemPrompt(hasSelection = false): string {
    if (hasSelection) {
        return [
            '你是一位中文长篇小说的改写执行者。根据改写指令在指定选区内修改，遵守「创作准则」。',
            '只输出一个 JSON 对象，形如 {"patches":[{"find":"选区原文片段","replace":"改后文本"}]}。',
            '所有 find 都必须逐字摘自改写前的选区，在选区内唯一且互不重叠。选区外正文只供参考。',
            '无法在选区内完成改写或无需改动时，输出 {"patches":[]}。禁止输出全文或解释。',
        ].join('\n')
    }
  return [
    '你是一位中文长篇小说的改写执行者。依据改写指令修改章节正文，遵守「创作准则」的红线。',
    '输出协议（二选一，严格遵守）：',
    '1. 局部精修（改动集中在少数几句、不挪动段落结构）：只输出一个 JSON 对象，形如 {"patches":[{"find":"原文中足够长的唯一片段","replace":"改后文本"}]}。',
    '   find 必须逐字摘自原文且在全文中唯一（空白差异允许）；未提及的内容会被零触碰保留。',
    '2. 大改（重写多段、调整结构）：直接输出改写后的整章正文全文（Markdown，无解释）。',
    '判断依据：若除目标句外其余原句都应原样保留，用协议 1；否则用协议 2。没有需要修改的内容时输出 {"patches":[]}。',
    '不要输出 JSON 与正文以外的任何内容。',
  ].join('\n')
}

/** 组装 user 提示词：full/assist 注入组装上下文；rewrite 注入整章原文 + 改写指令。 */
export function buildWriteUserPrompt(assembled: AssembledWritingContext, mode: 'full' | 'assist'): string {
  const tail = mode === 'full' ? '现在写出本章完整正文。' : '现在从正文结尾处续写。'
  return `${renderSections(assembled.sections)}\n\n${tail}`
}

/** rewrite user 提示词：现有正文全量 + 选区锚（可选）+ 改写指令。 */
export function buildRewriteUserPrompt(
    chapter: WriterEntity,
    instruction: string,
    selection?: string,
    context?: { principles?: string; styleReferences?: string },
): string {
  const anchor = selection !== undefined
    ? `\n\n## 改写范围（补丁只可锚定以下选区原文）\n${selection}`
    : ''
  return [
    ...(context?.principles !== undefined ? [`## 创作准则（全量）\n${context.principles}`] : []),
    ...(context?.styleReferences !== undefined ? [`## 风格示范（节选）\n${context.styleReferences}`] : []),
    `## 章节正文（第 ${String(chapter.frontmatter['number'] ?? chapter.id)} 章 ${chapter.id}）`,
    chapter.content,
    anchor,
    `\n## 改写指令\n${instruction}`,
  ].filter((s) => s.length > 0).join('\n')
}

/** 审稿 system 提示词：3+1 维 + 结构化 JSON 输出契约。 */
export function buildReviewSystemPrompt(focus?: readonly string[]): string {
  const dims = focus !== undefined && focus.length > 0 ? focus.join('、') : REVIEW_DIMENSIONS.join('、')
  return [
    `你是一位严谨的中文小说审稿人。只审以下维度：${dims}。`,
    '逐条给出建议；quote 逐字摘自本章正文，要足以定位问题。对一致性硬冲突，同时给出依据 evidence，ref 使用提供的来源编号，quote 逐字摘自该来源并包含冲突事实。',
    '只输出一个 JSON 对象（可被 JSON.parse），不要任何其他文字：',
    '{"summary":"总评（2-3 句）","suggestions":[{"dimension":"维度名","severity":"high|medium|low","quote":"本章原文片段（可选）","problem":"问题描述","suggestion":"修改建议","rewriteOption":"可选的改写后文本","evidence":{"ref":"来源编号","quote":"依据原文片段"}}]}',
    '依据缺失时省略 evidence，在建议中说明待核对的材料。总评只评价已提供材料；没有问题的维度不要编造建议。',
  ].join('\n')
}

export function buildReviewUserPrompt(chapter: WriterEntity, context: ReviewContext): string {
  const parts = [`## 审稿覆盖\n${context.coverage.map(item => `- ${item}`).join('\n')}`]
  for (const { label, sources } of context.materials) {
    if (sources.length > 0) parts.push(`## ${label}\n${sources.map(({ ref, text }) => `### ${ref}\n${text}`).join('\n\n')}`)
  }
  parts.push(`## 章节正文（第 ${String(chapter.frontmatter['number'] ?? chapter.id)} 章 ${chapter.id}）\n${chapter.content}`)
  return parts.join('\n\n')
}

// ---------------------------------------------------------------------------
// 维护 pass（P3）：①章节摘要 ②事实/伏笔/人物状态抽取（分节 JSON schema + 引用存在性校验 + 按节重试）
// ---------------------------------------------------------------------------

/** 维护 pass 调用①：章节摘要（流畅文本）。 */
export function buildSummarySystemPrompt(): string {
  return [
    '你是一位中文小说的章节摘要员。阅读章节正文，写出一段流畅的情节摘要（100-200 字）。',
    '摘要须覆盖：本章主要事件、出场人物、任何伏笔的设置/强化/回收动作、章末人物状态。',
    '只输出摘要正文本身，不要标题、列表或解释。',
  ].join('\n')
}

/** 维护 pass 调用①的 user 提示词。 */
export function buildSummaryUserPrompt(chapter: WriterEntity): string {
  return `## 章节正文（第 ${String(chapter.frontmatter['number'] ?? chapter.id)} 章 ${chapter.id}）\n${chapter.content}`
}

/**
 * 维护 pass 调用②：事实/伏笔/人物状态抽取（分节 JSON schema）。
 * 引用约束：characters/plots 引用必须逐字取自给定 id 清单（引用不存在会被拒收并重试该节）。
 */
export function buildExtractionSystemPrompt(): string {
  return [
    '你是一位中文小说的事实抽取员。从章节正文中抽取结构化信息，只输出一个 JSON 对象（可被 JSON.parse），不要任何其他文字：',
    '{',
    '  "facts": [{"description":"本章确立的事实（设定/世界规则/承诺/重要物件去向）","characters":["出场人物 id（可选）"],"plots":["相关伏笔 id（可选）"]}],',
    '  "foreshadowEvents": [{"plot":"伏笔 id","action":"planted|reinforcement|partial_reveal|callback|red_herring|resolved","note":"一句话说明（可选）"}],',
    '  "characterStates": [{"character":"人物 id","state":"本章结束时该人物的状态（处境/关系/能力变化）"}]',
    '}',
    '硬性约束：',
    '- characters / plots / plot / character 字段只能使用「可用实体清单」中给出的 id，禁止编造。',
    '- 伏笔动作词汇只能用列出的六个（与伏笔状态机/里程碑类型对齐）。',
    '- 本章没有某类信息时该节数组留空；不要编造。',
  ].join('\n')
}

/** 维护 pass 调用②的 user 提示词：可用实体清单 + 该章既有抽取记录（防重）+ 章节正文 + 可选的重试反馈（只重做被拒收的节）。 */
export function buildExtractionUserPrompt(
  chapter: WriterEntity,
  refs: { characters: readonly string[]; plots: readonly string[] },
  retryFeedback?: readonly string[],
  retrySections?: readonly ('facts' | 'foreshadowEvents' | 'characterStates')[],
  existing?: { facts: readonly string[]; foreshadowEvents: readonly string[] },
): string {
  const parts = [
    '## 可用实体清单',
    `人物 id：${refs.characters.length > 0 ? refs.characters.join('、') : '（无）'}`,
    `伏笔 id：${refs.plots.length > 0 ? refs.plots.join('、') : '（无）'}`,
  ]
  // 轮次 31（吸收上游 T2）：改稿链（full→rewrite 内容已变）重抽时注入改稿前的既有记录，
  // 防同内容建议重复产出（此前仅靠 UI 端跨 pass 去重兜底）
  if (existing !== undefined && (existing.facts.length > 0 || existing.foreshadowEvents.length > 0)) {
    const lines = [
      ...existing.facts.map((f) => `- fact：${f}`),
      ...existing.foreshadowEvents.map((e) => `- foreshadow：${e}`),
    ]
    parts.push(`## 该章改稿前的既有抽取记录（防重参考：仍成立的不要重复输出；已不成立的可直接忽略，不要输出「已失效」条目）\n${lines.join('\n')}`)
  }
  parts.push(
    `## 章节正文（第 ${String(chapter.frontmatter['number'] ?? chapter.id)} 章 ${chapter.id}）`,
    chapter.content,
  )
  if (retryFeedback !== undefined && retryFeedback.length > 0) {
    const sectionNote = retrySections !== undefined && retryFeedback.length > 0
      ? `本次只需重新输出以下节（JSON 对象可只含这些节，已通过的节无需重发）：${retrySections.join('、')}。`
      : ''
    parts.push(`## 上次输出被拒收的原因（请修正后重新输出）\n${retryFeedback.map((f) => `- ${f}`).join('\n')}\n${sectionNote}`)
  }
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// 一致性检查（P3）：按预算分批、维度与 schema 对齐（改进原项目 12 章/8000 字截断缺陷）
// ---------------------------------------------------------------------------

/** 一致性检查 system 提示词：四维 + 结构化 JSON 输出契约。 */
export function buildConsistencySystemPrompt(): string {
  return [
    `你是一位严谨的中文小说连续性审校员。只检查以下维度：${['情节一致性', '人物一致性', '设定一致性', '时间线一致性'].join('、')}。`,
    '以「基准材料」（创作准则/大纲/伏笔档案/关键事件/人物设定与状态时间线/世界观）为准绳，审读本批章节，找出前后矛盾，并检查世界观条目之间是否矛盾。',
    '人物状态按 timeline 的章节锚比较，不得用未来状态反推更早章节有错。没有章节时只检查基准条目之间的矛盾。',
    '只输出一个 JSON 对象（可被 JSON.parse），不要任何其他文字：',
    '{"summary":"本批总体评估（1-2 句）","issues":[{"dimension":"维度名","severity":"high|medium|low","refs":["涉及实体引用，如 chapter/003、plot/green-flame、character/elin"],"description":"矛盾描述（指明两侧冲突的内容）","evidence":"支撑判断的原文片段（可选）"}]}',
    'refs 必须只引用材料中出现的实体；条目的全部引用都不存在时该条目会被丢弃——请至少给出一个可定位实体引用。没有矛盾不要编造。',
  ].join('\n')
}

/** 一致性检查 user 提示词：基准材料 + 本批章节（摘要优先，无摘要用正文）。
 * `bodyTruncated` 提供时在章头如实标注截断口径（防「已审全文」错觉，对齐上游 BIZ-02）。 */
export function buildConsistencyUserPrompt(
  baseline: { principles?: string; outline?: string; plotsBrief?: string; eventsBrief?: string; charactersBrief?: string; worldbuildingBrief?: string; coverageNotice?: string },
  chapters: readonly { id: string; number: number; title?: string; body: string; bodySource?: 'summary' | 'content'; bodyTruncated?: { kept: number; total: number } }[],
): string {
  const parts: string[] = []
  if (baseline.principles !== undefined) parts.push(`## 创作准则（基准）\n${baseline.principles}`)
  if (baseline.outline !== undefined) parts.push(`## 大纲（基准）\n${baseline.outline}`)
  if (baseline.plotsBrief !== undefined) parts.push(`## 伏笔档案（基准）\n${baseline.plotsBrief}`)
  if (baseline.eventsBrief !== undefined) parts.push(`## 关键事件（基准）\n${baseline.eventsBrief}`)
    if (baseline.charactersBrief !== undefined) parts.push(`## 人物设定与权威状态时间线（基准）\n${baseline.charactersBrief}`)
    if (baseline.worldbuildingBrief !== undefined) parts.push(`## 世界观（基准）\n${baseline.worldbuildingBrief}`)
    if (baseline.coverageNotice !== undefined) parts.push(`## 检查覆盖\n${baseline.coverageNotice}`)
  const chapterBlocks = chapters.map((c) => {
    const head = `### 第 ${c.number} 章（chapter/${c.id}）${c.title !== undefined ? ` ${c.title}` : ''}`
    const note = c.bodyTruncated !== undefined
      ? `\n（注：本章仅截取前 ${c.bodyTruncated.kept} 字符，全章共 ${c.bodyTruncated.total} 字符，超出部分未提供——结论仅覆盖前段）`
      : ''
        const source = c.bodySource === 'summary' ? '\n（本章使用新鲜派生摘要，未提供正文；结论仅覆盖摘要保留的信息）' : ''
        return `${head}${source}${note}\n${c.body}`
  })
    parts.push(`## 本批章节\n${chapterBlocks.length > 0 ? chapterBlocks.join('\n\n') : '（无章节，本次检查世界观及基准条目间的一致性）'}`)
    parts.push('## 任务\n对照基准材料及其覆盖说明审读，输出矛盾报告 JSON。')
  return parts.join('\n\n')
}
