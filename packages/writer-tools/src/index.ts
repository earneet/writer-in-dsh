/**
 * Consumer：注册面向模型的写作工具。P1 = writer_read / writer_update（通用 entity 参数化工具）。
 * writer_update 强制 read-before-update：expectHash 必填，乐观锁在 store 层校验。
 * engine（writerEngine）为可选依赖经 ctx.get 获取，缺席时写作类工具返回未启用——P1 不装 engine。
 * 规划见 docs/implementation-plan.md §1.5；R-改进来源 docs/novel-writer-review.md §6.1-5。
 * @module dsh-writer-tools
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import {
  ENTITY_KINDS, parseMilestones, transitionForeshadow,
  type EntityKind, type ForeshadowMilestoneType, type Frontmatter,
} from 'dsh-writer-domain'
import { EngineService } from 'dsh-writer-core'
// 引入 dsh-writer-core 的模块副作用类型（ctx.writer 的 declaration merging 单包编译也可见）
import type {} from 'dsh-writer-core'

export const name = 'writer-tools'
export const inject = ['tools', 'writer']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'writer_read',
    description: `读取小说项目实体。entity 为实体种类（${ENTITY_KINDS.join(' / ')}）；省略 id 时列出该类实体的清单，提供 id 时返回完整正文与 frontmatter。`,
    parameters: {
      entity: { type: 'string', required: true, description: '实体种类' },
      id: { type: 'string', description: '实体 id（列表时可省略；chapter 为三位序号，其余为文件名去 .md）' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const kind = assertKind(args.entity)
      if (args.id === undefined || args.id === '') {
        const list = await ctx.writer.list(kind)
        if (list.length === 0) return `（${kind}）暂无实体`
        // hash 仅 8 位预览：更新前必须带 id 读取取完整 hash
        return list.map((e) => `- ${e.id} [${e.path}] hash=${e.hash.slice(0, 8)}…（短预览，更新前请读取完整 hash）`).join('\n')
      }
      const entity = await ctx.writer.get(kind, args.id)
      if (entity === undefined) return `实体不存在：${kind}/${args.id}（可先不带 id 列出清单）`
      return [
        `# ${kind}/${entity.id}`,
        `path: ${entity.path}  hash: ${entity.hash}`,
        Object.keys(entity.frontmatter).length > 0 ? `frontmatter: ${JSON.stringify(entity.frontmatter)}` : 'frontmatter: （无）',
        '',
        entity.content,
      ].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'writer_update',
    description: '写入小说项目实体（创建或修改，Markdown 原子落盘）。创建新实体时 expectHash 填 "new"；修改已存在实体必须先 writer_read 取回完整 hash 并填入 expectHash（read-before-update 乐观锁；hash 不符或误用 "new" 都会被拒绝）。',
    parameters: {
      entity: { type: 'string', required: true, description: `实体种类：${ENTITY_KINDS.join(' / ')}` },
      id: { type: 'string', required: true, description: '实体 id' },
      expectHash: { type: 'string', required: true, description: 'read 返回的完整 hash（新实体填 "new"）' },
      content: { type: 'string', description: '正文全文（Markdown，不含 frontmatter）' },
      frontmatter: { type: 'object', additionalProperties: true, description: 'frontmatter 键值对（可选；与现有值合并，值限标量）' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const kind = assertKind(args.entity)
      if (kind === 'project') return 'project 实体（writer.yaml）为项目配置，只可 read 不可 update。'
      if (args.content === undefined && args.frontmatter === undefined) {
        throw new Error('content 与 frontmatter 至少提供其一')
      }
      const frontmatter = sanitizeFrontmatter(args.frontmatter)
      const isNew = args.expectHash === 'new'
      if (!isNew) {
        const existing = await ctx.writer.get(kind, args.id)
        if (existing === undefined) return `实体不存在：${kind}/${args.id}。若要创建，expectHash 请填 "new"。`
      }
      const saved = await ctx.writer.save(
        kind,
        args.id,
        { content: args.content, frontmatter },
        isNew ? undefined : args.expectHash,
      )
      return `已保存 ${saved.kind}/${saved.id}（hash=${saved.hash}，path=${saved.path}）`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'write_chapter',
    description: '写作引擎：按准则+大纲生成/续写/改写一章并保存。mode=full（整章生成，可建新章，可传 title）/ assist（从现有正文结尾续写）/ rewrite（按 instruction 改写现有章节；引擎优先走补丁协议，小改零触碰未提及内容，大改回退全文并跑丢句守卫）。章节不存在时只能用 full。',
    parameters: {
      chapter: { type: 'string', required: true, description: '章节 id（三位序号，如 "002"）' },
      mode: { type: 'string', required: true, description: 'full / assist / rewrite' },
      instruction: { type: 'string', description: '写作/续写/改写指令（rewrite 必填；full/assist 可选补充要求）' },
      title: { type: 'string', description: 'full 创建新章时的标题' },
      selection: { type: 'string', description: 'rewrite 可选：选区原文片段（限制改写范围）' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec: ToolRunContext) {
      exec.signal.throwIfAborted()
      const engine = getEngine(ctx)
      if ('unavailable' in engine) return engine.unavailable
      const result = await engine.writeChapter({
        chapterId: args.chapter,
        mode: assertMode(args.mode),
        instruction: args.instruction,
        title: args.title,
        selection: args.selection,
        signal: exec.signal,
      })
      return renderWriteResult(result)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'review_chapter',
    description: '3+1 维 AI 审稿（情节一致性/人物一致性/设定一致性 + 文学质量）：结构化建议（quote 定位 + 修改建议 + 可选改写方案），只出报告不改稿。建议随后用 write_chapter rewrite 按建议改写。',
    parameters: {
      chapter: { type: 'string', required: true, description: '章节 id（三位序号）' },
      focus: { type: 'string', description: '审稿维度过滤（逗号分隔，如 "情节一致性,文学质量"；缺省全维度）' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec: ToolRunContext) {
      exec.signal.throwIfAborted()
      const engine = getEngine(ctx)
      if ('unavailable' in engine) return engine.unavailable
      const focus = args.focus?.split(/[,，、]/).map((s) => s.trim()).filter((s) => s.length > 0)
      const report = await engine.reviewChapter(args.chapter, focus, exec.signal)
      if (report.suggestions.length === 0) {
        return `审稿完成，无结构化建议。总评：${report.summary || '（无）'}`
      }
      const lines = [`审稿完成（${report.suggestions.length} 条建议）。总评：${report.summary || '（无）'}`, '']
      for (const [i, s] of report.suggestions.entries()) {
        lines.push(`${i + 1}. [${s.severity}] ${s.dimension}：${s.problem}`)
        if (s.quote !== undefined) lines.push(`   原文：${s.quote}`)
        lines.push(`   建议：${s.suggestion}`)
        if (s.rewriteOption !== undefined) lines.push(`   改写方案：${s.rewriteOption}`)
      }
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'foreshadow_update',
    description: '伏笔状态机工具：action=plant（planned→planted，需填 chapter）/ resolve（planted→resolved，需填 chapter）/ abandon（→abandoned）/ milestone（追加 reinforcement/partial_reveal/callback/red_herring 中间事件，不改状态）。修改前必须先 writer_read(entity="plot") 取回完整 hash 填 expectHash（伏笔实体是 plots/<id>.md）。',
    parameters: {
      id: { type: 'string', required: true, description: '伏笔实体 id（plots/<id>.md 的文件名去 .md）' },
      action: { type: 'string', required: true, description: 'plant / resolve / abandon / milestone' },
      expectHash: { type: 'string', required: true, description: 'writer_read 返回的完整 hash（read-before-update 乐观锁）' },
      chapter: { type: 'string', description: 'plant/resolve 落点章节（三位序号）；milestone 的章节锚（必填）' },
      milestone_type: { type: 'string', description: 'milestone 动作专用：reinforcement / partial_reveal / callback / red_herring' },
      milestone_note: { type: 'string', description: 'milestone 说明（可选）' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec: ToolRunContext) {
      exec.signal.throwIfAborted()
      const plot = await ctx.writer.get('plot', args.id)
      if (plot === undefined) return `伏笔实体不存在：plot/${args.id}（可先 writer_read(entity="plot") 列出清单）`
      const currentStatus = String(plot.frontmatter['status'] ?? 'planned') as import('dsh-writer-domain').ForeshadowStatus
      const frontmatter: Frontmatter = {}
      if (args.action === 'plant' || args.action === 'resolve') {
        if (args.chapter === undefined) throw new Error(`${args.action} 需要提供 chapter（三位序号，伏笔落点章节）`)
        const target = args.action === 'plant' ? 'planted' : 'resolved'
        frontmatter['status'] = transitionForeshadow(currentStatus, target)
        frontmatter[args.action === 'plant' ? 'planted_chapter' : 'resolved_chapter'] = args.chapter
      } else if (args.action === 'abandon') {
        frontmatter['status'] = transitionForeshadow(currentStatus, 'abandoned')
      } else if (args.action === 'milestone') {
        const type = assertMilestoneType(args.milestone_type)
        if (args.chapter === undefined) throw new Error('milestone 需要提供 chapter（事件发生章节）')
        const milestones = parseMilestones(plot.frontmatter['milestones'])
        milestones.push({ type, chapter: args.chapter, ...(args.milestone_note !== undefined ? { note: args.milestone_note } : {}) })
        frontmatter['milestones'] = JSON.stringify(milestones)
      } else {
        throw new Error(`未知 action：${args.action}（可选 plant / resolve / abandon / milestone）`)
      }
      const saved = await ctx.writer.save('plot', args.id, { frontmatter }, args.expectHash)
      return `已更新伏笔 ${saved.id}（status=${String(saved.frontmatter['status'] ?? currentStatus)}，hash=${saved.hash}）`
    },
  }))
}

function assertMode(raw: string): 'full' | 'assist' | 'rewrite' {
  if (raw === 'full' || raw === 'assist' || raw === 'rewrite') return raw
  throw new Error(`未知写作模式：${raw}（可选 full / assist / rewrite）`)
}

function assertMilestoneType(raw: string | undefined): ForeshadowMilestoneType {
  if (raw === 'reinforcement' || raw === 'partial_reveal' || raw === 'callback' || raw === 'red_herring') return raw
  throw new Error(`milestone_type 非法：${String(raw)}（可选 reinforcement / partial_reveal / callback / red_herring）`)
}

function assertKind(raw: string): EntityKind {
  if ((ENTITY_KINDS as readonly string[]).includes(raw)) return raw as EntityKind
  throw new Error(`未知实体种类：${raw}（可选：${ENTITY_KINDS.join(' / ')}）`)
}

/** 取可选的写作引擎；缺席时返回提示（写作类工具注册不依赖 engine 在场）。 */
function getEngine(ctx: Context): EngineService | { unavailable: string } {
  const engine = ctx.get('writerEngine')
  if (engine === undefined) {
    return { unavailable: '写作引擎未启用（profile 需安装 dsh-writer-engine 并配置 provider/model）' }
  }
  return engine
}

/** 写作类工具的格式化结果（长任务；engine 落盘与统计全部透传 exec.signal）。 */
function renderWriteResult(result: import('dsh-writer-domain').ChapterWriteResult): string {
  // 空补丁 = 模型判定无需修改：未落盘，不能宣称「已保存」
  if (result.mode === 'rewrite-patch' && result.patchStats !== undefined && result.patchStats.applied === 0 && result.patchStats.skipped === 0) {
    return `rewrite 判定无需修改，未落盘（chapter/${result.chapter.id} 保持原样，hash=${result.chapter.hash}）`
  }
  const lines = [
    `已完成 ${result.mode} 写作并保存 chapter/${result.chapter.id}（hash=${result.chapter.hash}，字数≈${result.chapter.content.length}）`,
  ]
  if (result.patchStats !== undefined) {
    lines.push(`补丁协议：命中 ${result.patchStats.applied} 条，跳过 ${result.patchStats.skipped} 条`)
    if (result.patchStats.skipped > 0) lines.push('  ⚠ 有补丁未命中（锚点不在原文或歧义命中），对应位置未被改动——请核对后决定是否重试')
    for (const reason of result.patchStats.skippedReasons) lines.push(`  - 跳过：${reason}`)
  }
  if (result.droppedSentences !== undefined && result.droppedSentences.length > 0) {
    lines.push(`⚠ 丢句守卫告警（共 ${result.droppedSentences.length} 条原句未保留${result.droppedSentences.length > 10 ? '，仅列前 10 条' : ''}，请人工复核是否为有意删除）：`)
    for (const sentence of result.droppedSentences.slice(0, 10)) lines.push(`  - ${sentence}`)
  }
  return lines.join('\n')
}

/** 模型提供的 frontmatter 值收敛到域库标量值域（数组/对象/null 以 JSON 文本保留，可无损回读）。 */
function sanitizeFrontmatter(raw: Record<string, unknown> | undefined): Frontmatter | undefined {
  if (raw === undefined) return undefined
  const out: Frontmatter = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value
    } else {
      out[key] = JSON.stringify(value)
    }
  }
  return out
}
