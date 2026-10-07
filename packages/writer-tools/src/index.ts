/**
 * Consumer：注册面向模型的写作工具。P1 = writer_read / writer_update（通用 entity 参数化工具）。
 * writer_update 强制 read-before-update：expectHash 必填，乐观锁在 store 层校验。
 * engine（writerEngine）为可选依赖经 ctx.get 获取，缺席时写作类工具返回未启用——P1 不装 engine。
 * 规划见 docs/implementation-plan.md §1.5；R-改进来源 docs/novel-writer-review.md §6.1-5。
 * @module dsh-writer-tools
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ENTITY_KINDS, type EntityKind, type Frontmatter } from 'dsh-writer-domain'

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
        return list.map((e) => `- ${e.id} [${e.path}] hash=${e.hash.slice(0, 8)}`).join('\n')
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
    description: '写入小说项目实体（创建或修改，Markdown 落盘）。必须先 writer_read 获取当前 hash 并填入 expectHash（read-before-update 防护；创建新实体时 expectHash 填 "new"）。',
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
}

function assertKind(raw: string): EntityKind {
  if ((ENTITY_KINDS as readonly string[]).includes(raw)) return raw as EntityKind
  throw new Error(`未知实体种类：${raw}（可选：${ENTITY_KINDS.join(' / ')}）`)
}

/** 模型提供的 frontmatter 值收敛到域库标量值域（丢弃数组/对象/null 并提示）。 */
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
