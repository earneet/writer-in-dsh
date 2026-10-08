/**
 * Consumer：注册面向模型的写作工具。P1 = writer_read / writer_update（通用 entity 参数化工具）。
 * writer_update 强制 read-before-update：expectHash 必填，乐观锁在 store 层校验。
 * engine（writerEngine）为可选依赖经 ctx.get 获取，缺席时写作类工具返回未启用——P1 不装 engine。
 * 规划见 docs/implementation-plan.md §1.5；R-改进来源 docs/novel-writer-review.md §6.1-5。
 * @module dsh-writer-tools
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type PreToolDecision, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  arcCoverageOf, appendTimelineEntry, ENTITY_KINDS, parseChapterRange, parseMilestones, parseTimeline,
  serializeTimeline, transitionForeshadow, validateTimeline,
  type EntityKind, type ForeshadowMilestoneType, type Frontmatter,
} from 'dsh-writer-domain'
import { EngineService, ExportService } from 'dsh-writer-core'
// 引入 dsh-writer-core 的模块副作用类型（ctx.writer 的 declaration merging 单包编译也可见）
import type {} from 'dsh-writer-core'

const execFileAsync = promisify(execFile)

export const name = 'writer-tools'
export const inject = ['tools', 'writer']

export function apply(ctx: Context): void {
  // export_book 默认走 ask 权限路径（R-改进：落点在 pre-execute 决策层而非 policy 旋钮；
  // 审批策略 never 时宿主会自动拒绝，allow 时放行——本插件不自带 PermissionManager）
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (exec.name === 'export_book') return { kind: 'ask', reason: '导出整本书并写入项目目录文件' }
    return next()
  })

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
      // timeline 是人确认的权威数据：写入 character.timeline 前过领域校验，坏值响亮拒绝（防脏值逃逸到弧线/一致性检查）
      if (kind === 'character' && frontmatter !== undefined && frontmatter['timeline'] !== undefined) {
        try {
          const errors = validateTimeline(parseTimeline(frontmatter['timeline']))
          if (errors.length > 0) throw new Error(errors.join('；'))
        } catch (err) {
          throw new Error(`character/${args.id} 的 timeline 字段非法：${String(err instanceof Error ? err.message : err)}（期望 [{"chapter":"三位序号","state":"非空"}] 数组，同章唯一、章序单调）`)
        }
      }
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

  ctx.tools.register(defineTool({
    name: 'consistency_check',
    description: '全书一致性检查：以创作准则/大纲/伏笔档案/关键事件为基准审读已写章节，输出结构化矛盾报告（只报告不自动改稿）。按上下文预算自动分批覆盖全部章节（无章数/字数硬截断）；scope 可选 "001-003" 限定章节区间，缺省全书。',
    parameters: {
      scope: { type: 'string', description: '章节区间（"002" 单章或 "001-003"；缺省全书已写章节）' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec: ToolRunContext) {
      exec.signal.throwIfAborted()
      const engine = getEngine(ctx)
      if ('unavailable' in engine) return engine.unavailable
      const scope = args.scope !== undefined ? parseScope(args.scope) : undefined
      const report = await engine.consistencyCheck(scope, exec.signal)
      const lines = [
        `一致性检查完成（${report.batches.length} 批：${report.batches.map((b) => `${b.chapters[0]}-${b.chapters[b.chapters.length - 1]}${b.truncated ? '（材料截断）' : ''}`).join('、')}），发现 ${report.issues.length} 条矛盾。`,
      ]
      if (report.summary.length > 0) lines.push('', `总评：${report.summary}`)
      for (const [i, issue] of report.issues.entries()) {
        lines.push(`${i + 1}. [${issue.severity}] ${issue.dimension}${issue.refs.length > 0 ? `（${issue.refs.join('、')}）` : ''}：${issue.description}`)
        if (issue.evidence !== undefined) lines.push(`   证据：${issue.evidence}`)
      }
      lines.push('', '报告为预览，未自动持久化；确认后用 writer_update / foreshadow_update 修订。')
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'recompute_derived',
    description: '改稿期派生重算：章节改稿后重算（mode=recompute，重跑维护 pass）或标记过期（mode=mark，仅删除过期派生不调模型）下游派生物（摘要/事实/伏笔事件/人物状态）。派生与当前章节 hash 一致的章节自动跳过（up-to-date）。',
    parameters: {
      chapter_range: { type: 'string', required: true, description: '章节 id 或区间（"002" 或 "001-003"）' },
      mode: { type: 'string', description: 'recompute（默认，重算）/ mark（仅标记过期）' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec: ToolRunContext) {
      exec.signal.throwIfAborted()
      const engine = getEngine(ctx)
      if ('unavailable' in engine) return engine.unavailable
      if (args.mode !== undefined && args.mode !== 'recompute' && args.mode !== 'mark') {
        throw new Error(`未知 mode：${args.mode}（可选 recompute / mark）`)
      }
      const mode = args.mode === 'mark' ? 'mark' : 'recompute'
      const results = await engine.recomputeDerived(args.chapter_range, { mode, signal: exec.signal })
      return [
        `派生重算完成（range=${args.chapter_range}，mode=${mode}）：`,
        ...results.map((r) => `- chapter/${r.chapterId}：${r.status}`),
      ].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'writer_stats',
    description: '写作统计：章节数/总字数/卷分布/伏笔状态分布/维护派生覆盖率/人物弧线覆盖（哪些人物已有结构化状态时间线及其最新章节锚）。',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute() {
      const [chapters, characters, plots, events] = await Promise.all([
        ctx.writer.list('chapter'),
        ctx.writer.list('character'),
        ctx.writer.list('plot'),
        ctx.writer.get('event', 'event'),
      ])
      if (chapters.length === 0) return '项目暂无已写章节。'
      const totalChars = chapters.reduce((sum, c) => sum + c.content.length, 0)
      // 覆盖率按新鲜度计：派生存在且 sourceHash 与当前章节 hash 一致才算覆盖（过期派生 = 待维护）
      const derivedEntries = await Promise.all(chapters.map(async (c) => {
        const derived = await ctx.writer.readDerived('maintenance', c.id) as { sourceHash?: string } | undefined
        return derived !== undefined && derived.sourceHash === c.hash
      }))
      const stale = chapters.filter((_, i) => !derivedEntries[i]).map((c) => c.id)
      const volumes = new Map<string, number>()
      for (const c of chapters) {
        const v = String(c.frontmatter['volume'] ?? '').trim()
        const name = v.length > 0 ? v : '正文'
        volumes.set(name, (volumes.get(name) ?? 0) + 1)
      }
      const status = new Map<string, number>()
      for (const p of plots) {
        const s = String(p.frontmatter['status'] ?? 'planned')
        status.set(s, (status.get(s) ?? 0) + 1)
      }
      // 人物弧线覆盖：character frontmatter 的 timeline 字段（人确认的权威数据）；非法 timeline 计为坏值不毒化统计
      const arc = arcCoverageOf(characters)
      const lines = [
        `章节：${chapters.length} 章，共约 ${totalChars} 字`,
        `卷分布：${[...volumes.entries()].map(([v, n]) => `${v}×${n}`).join('、')}`,
        `人物：${characters.length} 个`,
        `人物弧线覆盖：${arc.withTimeline}/${arc.characters}（timeline 共 ${arc.entries} 条${arc.broken.length > 0 ? `；⚠ 非法 timeline：${arc.broken.join('、')}` : ''}）`,
        ...(characters.length > 0 ? ['', '人物时间线一览：', ...arc.arcs.map((a) => {
          const label = a.lastChapter !== undefined
            ? `（至第 ${a.lastChapter} 章共 ${a.count} 条）`
            : a.count > 0 ? `（${a.count} 条，章锚均非法）` : '（无时间线）'
          return `- ${a.id}${label}${arc.broken.includes(a.id) ? '（⚠ 非法 timeline）' : ''}`
        })] : []),
        plots.length > 0 ? `伏笔：${[...status.entries()].map(([s, n]) => `${s}×${n}`).join('、')}` : '伏笔：无',
        events !== undefined ? '关键事件：已记录' : '关键事件：未记录',
        `维护派生覆盖：${chapters.length - stale.length}/${chapters.length}${stale.length > 0 ? `（待维护 pass：${stale.join('、')}）` : ''}`,
      ]
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'archive_point',
    description: '显式存档点：在小说项目目录执行 git add -A + git commit（默认任何写入路径都不自动提交，只有本工具显式存档）。message 缺省为 "archive point <时间戳>"。项目目录不是 git 仓库时返回错误指引。',
    parameters: {
      message: { type: 'string', description: '提交信息（缺省自动生成）' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec: ToolRunContext) {
      exec.signal.throwIfAborted()
      const root = ctx.writer.root
      const message = args.message !== undefined && args.message.trim().length > 0
        ? args.message.trim()
        : `archive point ${new Date().toISOString()}`
      try {
        await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root })
      } catch (err) {
        // git 未安装（ENOENT）与「不是 git 仓库」是两种排障路径，区分提示
        if ((err as { code?: string }).code === 'ENOENT') {
          return 'git 不可用（未安装或不在 PATH）。请安装 git 后再使用存档点。'
        }
        return `项目目录不是 git 仓库：${root}。请先在项目目录执行 git init 后再使用存档点。`
      }
      await execFileAsync('git', ['add', '-A'], { cwd: root })
      // 派生缓存与导出产物不入存档（.writer/derived 可弃、exports 含整本 epub 会让仓库快速膨胀）；
      // 未 gitignore 的项目由这里显式取消暂存，已 gitignore 的项目该命令是空操作
      await execFileAsync('git', ['reset', '--', '.writer', 'exports'], { cwd: root }).catch(() => {})
      // 无变更预检：git commit 在工作区干净时以非零退出且提示走 stdout——预检避免把正常空存档当错误
      const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: root })
      if (status.stdout.trim().length === 0) {
        return '没有可存档的变更（工作区干净）。'
      }
      try {
        const { stdout } = await execFileAsync('git', ['commit', '-m', message], { cwd: root })
        const hash = (await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root })).stdout.trim()
        return `已创建存档点 ${hash}：${firstLine(stdout).length > 0 ? firstLine(stdout) : message}`
      } catch (err) {
        // 并发场景下 add 后仍可能被外部清空；提示文本在 message/stdout/stderr 三处都可能出现
        const text = [String(err), stdTextOf(err), errTextOf(err)].join('\n')
        if (text.includes('nothing to commit') || text.includes('no changes added')) {
          return '没有可存档的变更（工作区干净）。'
        }
        throw err
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'timeline_update',
    description: '人物状态时间线工具：为 character 追加或覆盖某章章末的状态条目（服务端自动与现有 timeline 合并——同章覆盖、按章序插入，无需手工拼 JSON）。领域校验：chapter 三位序号、state 非空、章序单调、同章唯一，非法响亮拒绝。修改前必须先 writer_read(entity="character", id=...) 取回完整 hash 填 expectHash。',
    parameters: {
      id: { type: 'string', required: true, description: '人物实体 id（characters/<id>.md 的文件名去 .md）' },
      chapter: { type: 'string', required: true, description: '状态锚定章节（三位序号，如 "002"）' },
      state: { type: 'string', required: true, description: '该章章末的人物状态描述（非空）' },
      expectHash: { type: 'string', required: true, description: 'writer_read 返回的完整 hash（read-before-update 乐观锁）' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec: ToolRunContext) {
      exec.signal.throwIfAborted()
      const character = await ctx.writer.get('character', args.id)
      if (character === undefined) return `人物实体不存在：character/${args.id}（可先 writer_read(entity="character") 列出清单）`
      // 服务端合并：解析现有 timeline → appendTimelineEntry（同章覆盖/按章序插入，入参含整体校验防毒化）→ 序列化落盘
      const merged = appendTimelineEntry(parseTimeline(character.frontmatter['timeline']), { chapter: args.chapter, state: args.state })
      const saved = await ctx.writer.save('character', args.id, { frontmatter: { timeline: serializeTimeline(merged) } }, args.expectHash)
      return `已更新人物时间线 ${saved.id}（hash=${saved.hash}）：${merged.map((e) => `${e.chapter}→${e.state}`).join('；')}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'writer_search',
    description: '混合检索小说项目语料（章节原文切片/派生摘要/人物/伏笔/世界观条目）：关键词先行 + 语义档融合。写作时引擎会自动做防剧透过滤的检索增强注入；本工具供主动查证设定细节用。chapter_limit 填当前写作章号可启用防剧透过滤（只检索序号小于该值的章节内容）。需要 RAG 插件（dsh-writer-rag）启用。',
    parameters: {
      query: { type: 'string', required: true, description: '检索查询（自然语言或关键词，如 "绿焰显现的条件"）' },
      chapter_limit: { type: 'number', description: '当前写作章号（启用防剧透过滤：只检索序号小于该值的章节内容；缺省不过滤，适合查设定与全书事实）' },
      max_results: { type: 'number', description: '返回命中数上限（默认 5）' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec: ToolRunContext) {
      exec.signal.throwIfAborted()
      const rag = ctx.get('writerRag')
      if (rag === undefined) {
        return '检索插件未启用（profile 需安装 dsh-writer-rag；核心读写与写作不受影响）。'
      }
      if (args.max_results !== undefined && (!Number.isInteger(args.max_results) || args.max_results < 1 || args.max_results > 20)) {
        throw new Error(`max_results 非法：${args.max_results}（须为 1-20 的整数）`)
      }
      const hits = await rag.search(args.query, {
        ...(args.chapter_limit !== undefined ? { chapterLimit: args.chapter_limit } : {}),
        ...(args.max_results !== undefined ? { maxResults: args.max_results } : {}),
        signal: exec.signal,
      })
      if (hits.length === 0) return `无命中：${args.query}`
      return hits.map((hit, i) => {
        const origin = hit.chapterNumber !== undefined ? `第 ${hit.chapterNumber} 章 ` : ''
        return `${i + 1}. 【${hit.refKind}/${hit.refId}】${origin}${hit.title !== undefined ? `${hit.title}：` : ''}${hit.snippet}（score=${hit.score.toFixed(4)}）`
      }).join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'export_book',
    description: '导出全书：format=txt / html（浏览器打印为 PDF）/ epub；按卷组织，正文经 XSS/XML 转义。可选 volume 只导某一卷、include_outline/include_characters 附附录、output_path 指定输出路径（相对项目根，缺省 exports/book.<format>）。需要导出插件（dsh-writer-export）启用。该操作默认需要用户确认。',
    parameters: {
      format: { type: 'string', required: true, description: 'txt / html / epub' },
      volume: { type: 'string', description: '只导出该卷（卷名；缺省全书）' },
      include_outline: { type: 'boolean', description: '附大纲附录（默认否）' },
      include_characters: { type: 'boolean', description: '附人物小传附录（默认否）' },
      output_path: { type: 'string', description: '输出文件相对路径（缺省 exports/book.<format>）' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec: ToolRunContext) {
      exec.signal.throwIfAborted()
      const exporter: ExportService | undefined = ctx.get('writerExport')
      if (exporter === undefined) {
        return '导出插件未启用（profile 需安装 dsh-writer-export；核心读写不受影响）。'
      }
      const format = args.format === 'txt' || args.format === 'html' || args.format === 'epub' ? args.format : undefined
      if (format === undefined) throw new Error(`未知导出格式：${String(args.format)}（可选 txt / html / epub）`)
      const result = await exporter.exportBook({
        format,
        ...(args.volume !== undefined ? { volume: args.volume } : {}),
        ...(args.include_outline !== undefined ? { includeOutline: args.include_outline } : {}),
        ...(args.include_characters !== undefined ? { includeCharacters: args.include_characters } : {}),
        ...(args.output_path !== undefined ? { outputPath: args.output_path } : {}),
      })
      return `已导出 ${result.chapters} 章到 ${result.path}（${result.bytes} 字节）。`
    },
  }))
}

/** 章节区间 scope 解析（委托 domain parseChapterRange，单一实现）：取区间端点为 {from,to}。 */
function parseScope(raw: string): { from: string; to: string } {
  const ids = parseChapterRange(raw)
  return { from: ids[0], to: ids[ids.length - 1] }
}

/** git 输出首行（Windows CRLF 归一）。 */
function firstLine(text: string): string {
  return text.split('\r\n')[0].split('\n')[0]
}

/** execFile 错误对象的 stdout/stderr 提取（git 的「nothing to commit」提示走 stdout）。 */
function stdTextOf(err: unknown): string {
  return String((err as { stdout?: unknown }).stdout ?? '')
}

function errTextOf(err: unknown): string {
  return String((err as { stderr?: unknown }).stderr ?? '')
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
