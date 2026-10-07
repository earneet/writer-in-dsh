/**
 * 写作引擎提示词构建（纯函数，无 I/O；单测不依赖 cordis/llm）。
 * 上下文分节来自 dsh-writer-domain 的 assembleWritingContext。
 * @module dsh-writer-engine/prompts
 */
import {
  REVIEW_DIMENSIONS,
  type AssembledWritingContext, type ContextSection, type WriterEntity,
} from 'dsh-writer-domain'

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
export function buildRewriteSystemPrompt(): string {
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
export function buildRewriteUserPrompt(chapter: WriterEntity, instruction: string, selection?: string): string {
  const anchor = selection !== undefined && selection.trim().length > 0
    ? `\n\n## 改写范围\n只围绕以下选区前后改动（其余内容尽量走补丁协议保持原样）：\n${selection}`
    : ''
  return [
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
    '逐条给出建议；每条尽量引用原文片段（quote，逐字摘自正文、足够定位），无法精确定位时可省略 quote。',
    '只输出一个 JSON 对象（可被 JSON.parse），不要任何其他文字：',
    '{"summary":"总评（2-3 句）","suggestions":[{"dimension":"维度名","severity":"high|medium|low","quote":"原文片段（可选）","problem":"问题描述","suggestion":"修改建议","rewriteOption":"可选的改写后文本"}]}',
    '没有问题的维度不要编造建议；提供了 quote 但与正文不符的建议会被丢弃。',
  ].join('\n')
}

/** 审稿 user 提示词：准则 + 本章大纲 + 人物/伏笔摘要 + 章节正文。 */
export function buildReviewUserPrompt(
  chapter: WriterEntity,
  context: { principles?: string; chapterOutline?: string; charactersBrief?: string; plotsBrief?: string },
): string {
  const parts: string[] = []
  if (context.principles !== undefined) parts.push(`## 创作准则\n${context.principles}`)
  if (context.chapterOutline !== undefined) parts.push(`## 本章大纲\n${context.chapterOutline}`)
  if (context.charactersBrief !== undefined) parts.push(`## 人物设定摘要\n${context.charactersBrief}`)
  if (context.plotsBrief !== undefined) parts.push(`## 伏笔档案\n${context.plotsBrief}`)
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

/** 维护 pass 调用②的 user 提示词：可用实体清单 + 章节正文 + 可选的重试反馈（只重做被拒收的节）。 */
export function buildExtractionUserPrompt(
  chapter: WriterEntity,
  refs: { characters: readonly string[]; plots: readonly string[] },
  retryFeedback?: readonly string[],
  retrySections?: readonly ('facts' | 'foreshadowEvents' | 'characterStates')[],
): string {
  const parts = [
    '## 可用实体清单',
    `人物 id：${refs.characters.length > 0 ? refs.characters.join('、') : '（无）'}`,
    `伏笔 id：${refs.plots.length > 0 ? refs.plots.join('、') : '（无）'}`,
    `## 章节正文（第 ${String(chapter.frontmatter['number'] ?? chapter.id)} 章 ${chapter.id}）`,
    chapter.content,
  ]
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
    '以「基准材料」（创作准则/大纲/伏笔档案/关键事件）为准绳，审读本批章节，找出前后矛盾。',
    '只输出一个 JSON 对象（可被 JSON.parse），不要任何其他文字：',
    '{"summary":"本批总体评估（1-2 句）","issues":[{"dimension":"维度名","severity":"high|medium|low","refs":["涉及实体引用，如 chapter/003、plot/green-flame、character/elin"],"description":"矛盾描述（指明两侧冲突的内容）","evidence":"支撑判断的原文片段（可选）"}]}',
    'refs 必须只引用材料中出现的实体；条目的全部引用都不存在时该条目会被丢弃——请至少给出一个可定位实体引用。没有矛盾不要编造。',
  ].join('\n')
}

/** 一致性检查 user 提示词：基准材料 + 本批章节（摘要优先，无摘要用正文）。 */
export function buildConsistencyUserPrompt(
  baseline: { principles?: string; outline?: string; plotsBrief?: string; eventsBrief?: string },
  chapters: readonly { id: string; number: number; title?: string; body: string }[],
): string {
  const parts: string[] = []
  if (baseline.principles !== undefined) parts.push(`## 创作准则（基准）\n${baseline.principles}`)
  if (baseline.outline !== undefined) parts.push(`## 大纲（基准）\n${baseline.outline}`)
  if (baseline.plotsBrief !== undefined) parts.push(`## 伏笔档案（基准）\n${baseline.plotsBrief}`)
  if (baseline.eventsBrief !== undefined) parts.push(`## 关键事件（基准）\n${baseline.eventsBrief}`)
  const chapterBlocks = chapters.map((c) => `### 第 ${c.number} 章（chapter/${c.id}）${c.title !== undefined ? ` ${c.title}` : ''}\n${c.body}`)
  parts.push(`## 本批章节\n${chapterBlocks.join('\n\n')}`)
  parts.push('## 任务\n对照基准材料逐章审读，输出矛盾报告 JSON。')
  return parts.join('\n\n')
}
