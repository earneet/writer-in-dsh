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
