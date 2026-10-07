/**
 * Provider：Markdown SoT 存储，发布 `ctx.writer`。
 * 写路径 = 原子写（temp+rename）落盘 → 派生索引更新；索引是纯缓存（.writer/index/，可删除后 rebuildIndex 全量重建）。
 * 乐观锁：save 带 expectHash 时与磁盘当前 hash 比对，不符抛错（read-before-update 防护）。
 * 规划见 docs/implementation-plan.md §1.3；R-改进来源 docs/novel-writer-review.md §6.2-1/§6.2-2。
 * @module dsh-writer-store
 */
import { type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join, dirname, posix } from 'node:path'
import {
  contentHash, parseFrontmatter, serializeEntity,
  type EntityKind, type Frontmatter, type WriterEntity,
} from 'dsh-writer-domain'
import { WriterService, type EntityPatch } from 'dsh-writer-core'

/** 插件配置。projectRoot 为小说项目根目录（含 principles.md/outline.md/chapters/ 等）。 */
export interface Config {
  projectRoot: string
}

export const Config: Schema<Config> = Schema.object({
  projectRoot: Schema.string().required().description('小说项目根目录的绝对路径'),
})

/** 实体扫描表：kind → 目录/文件约定与 id 派生。 */
const KIND_LAYOUT: Readonly<Record<EntityKind, { dir: string } | { file: string }>> = {
  project: { file: 'writer.yaml' },
  principles: { file: 'principles.md' },
  outline: { file: 'outline.md' },
  chapter: { dir: 'chapters' },
  character: { dir: 'characters' },
  plot: { dir: 'plots' },
  event: { file: 'events.md' },
  idea: { file: 'ideas.md' },
  style: { dir: 'style' },
}

/**
 * Markdown SoT 存储服务。default-export 类插件（服务包惯例）；
 * 就绪后 `inject: ['writer']` 的消费方（tools/engine）才加载。
 */
export default class WriterStoreService extends WriterService {
  static inject = []
  static Config = Config

  private readonly projectRoot: string
  /** 派生索引：内存态，save 时增量更新；缺失时由 ensureIndex 全量重建。 */
  private index: Map<EntityKind, Map<string, WriterEntity>> | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.projectRoot = config.projectRoot
  }

  async list(kind: EntityKind): Promise<readonly WriterEntity[]> {
    await this.ensureIndex()
    return [...(this.index!.get(kind)?.values() ?? [])].sort((a, b) => a.id.localeCompare(b.id))
  }

  async get(kind: EntityKind, id: string): Promise<WriterEntity | undefined> {
    await this.ensureIndex()
    return this.index!.get(kind)?.get(id)
  }

  async save(kind: EntityKind, id: string, patch: EntityPatch, expectHash?: string): Promise<WriterEntity> {
    const existing = await this.readFromDisk(kind, id)
    if (expectHash !== undefined) {
      if (existing === undefined) throw new Error(`乐观锁失败：实体不存在（${kind}/${id}），请先 read 再 create`)
      if (existing.hash !== expectHash) throw new Error(`乐观锁失败：磁盘版本已变化（${kind}/${id}），请重新 read`)
    }
    if (patch.frontmatter === undefined && patch.content === undefined) {
      throw new Error('保存补丁为空：frontmatter 与 content 至少提供其一')
    }
    const frontmatter: Frontmatter = { ...(existing?.frontmatter ?? {}), ...(patch.frontmatter ?? {}) }
    const content = patch.content ?? existing?.content ?? ''
    const text = serializeEntity(frontmatter, content)
    const absPath = this.absPathOf(kind, id)
    // 原子写：temp + rename（半写文件是索引可重建的隐性破坏者）
    await mkdir(dirname(absPath), { recursive: true })
    const tmpPath = `${absPath}.tmp`
    await writeFile(tmpPath, text, 'utf8')
    await rename(tmpPath, absPath)
    const entity: WriterEntity = { kind, id, path: this.relPathOf(kind, id), frontmatter, content, hash: contentHash(frontmatter, content) }
    await this.ensureIndex()
    this.index!.get(kind)!.set(id, entity)
    this.ctx.emit('writer/entity-saved', entity)
    return entity
  }

  async rebuildIndex(): Promise<void> {
    const next = new Map<EntityKind, Map<string, WriterEntity>>()
    for (const kind of Object.keys(KIND_LAYOUT) as EntityKind[]) {
      next.set(kind, new Map())
      for (const entity of await this.scanKind(kind)) {
        next.get(kind)!.set(entity.id, entity)
      }
    }
    this.index = next
  }

  private async ensureIndex(): Promise<void> {
    if (this.index === undefined) await this.rebuildIndex()
  }

  /** 扫描某 kind 的全部实体文件（索引重建的单一实现）。 */
  private async scanKind(kind: EntityKind): Promise<WriterEntity[]> {
    const layout = KIND_LAYOUT[kind]
    if ('file' in layout) {
      const abs = join(this.projectRoot, layout.file)
      const entity = await this.readRaw(kind, layout.file, abs)
      return entity === undefined ? [] : [entity]
    }
    const dirAbs = join(this.projectRoot, layout.dir)
    let names: string[]
    try {
      names = await readdir(dirAbs)
    } catch {
      return [] // 目录不存在视为空（懒创建）
    }
    const entities: WriterEntity[] = []
    for (const name of names.sort()) {
      if (!name.endsWith('.md')) continue
      const entity = await this.readRaw(kind, posix.join(layout.dir, name), join(dirAbs, name))
      if (entity !== undefined) entities.push(entity)
    }
    return entities
  }

  private async readFromDisk(kind: EntityKind, id: string): Promise<WriterEntity | undefined> {
    return this.readRaw(kind, this.relPathOf(kind, id), this.absPathOf(kind, id))
  }

  private async readRaw(kind: EntityKind, relPath: string, absPath: string): Promise<WriterEntity | undefined> {
    let raw: string
    try {
      raw = await readFile(absPath, 'utf8')
    } catch {
      return undefined
    }
    const { frontmatter, content } = parseFrontmatter(raw)
    const id = this.idOf(kind, relPath)
    return { kind, id, path: relPath.split('\\').join('/'), frontmatter, content, hash: contentHash(frontmatter, content) }
  }

  /** 相对路径 ↔ 实体 id 的双向派生。 */
  private relPathOf(kind: EntityKind, id: string): string {
    const layout = KIND_LAYOUT[kind]
    if ('file' in layout) return layout.file
    return posix.join(layout.dir, `${id}.md`)
  }

  private absPathOf(kind: EntityKind, id: string): string {
    return join(this.projectRoot, this.relPathOf(kind, id))
  }

  private idOf(kind: EntityKind, relPath: string): string {
    if ('file' in KIND_LAYOUT[kind]) return kind
    return relPath.split('/').pop()!.replace(/\.md$/, '')
  }
}
