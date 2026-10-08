/**
 * Provider：Markdown SoT 存储，发布 `ctx.writer`。
 * 写路径 = 原子写（temp+rename）落盘 → 派生索引更新；索引是纯缓存（.writer/index/，可删除后 rebuildIndex 全量重建）。
 * 乐观锁：save 带 expectHash 时与磁盘当前 hash 比对，不符抛错（read-before-update 防护）。
 * 规划见 docs/implementation-plan.md §1.3；R-改进来源 docs/novel-writer-review.md §6.2-1/§6.2-2。
 * @module dsh-writer-store
 */
import { type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, dirname, posix, relative, sep } from 'node:path'
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
  worldbuilding: { dir: 'worldbuilding' },
}

/** 单文件实体（整文件即一个实体）的 kind 集合。 */
const FILE_KINDS = new Set<EntityKind>(['project', 'principles', 'outline', 'event', 'idea'])
/** Windows 保留设备名（大小写不敏感），作实体 id 会引发诡异文件系统行为。 */
const WINDOWS_RESERVED = new Set(['con', 'prn', 'aux', 'nul', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'])

/** 绝对路径 → 项目根相对的 POSIX 展示路径（错误消息用）。 */
function relativePathOf(root: string, absPath: string): string {
  return relative(root, absPath).split(sep).join('/')
}

/**
 * 实体 id 安全校验：拒绝路径分隔符、`..`、Windows 非法字符与保留名（防 path traversal）。
 * 单文件实体的 id 由 kind 派生，不接受外部指定。
 */
function assertSafeId(kind: EntityKind, id: string): void {
  if (FILE_KINDS.has(kind)) {
    if (id !== kind) throw new Error(`实体 ${kind} 是单文件实体，id 必须为 "${kind}"`)
    return
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id) || WINDOWS_RESERVED.has(id.toLowerCase())) {
    throw new Error(`实体 id 非法：${JSON.stringify(id)}（仅允许字母/数字/下划线/连字符，1-64 字符，不得为 Windows 保留名）`)
  }
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
    // 直读磁盘（被动新鲜度：外部编辑器修改后立即可见；内存索引仅服务 list 清单）
    assertSafeId(kind, id)
    return this.readFromDisk(kind, id)
  }

  async save(kind: EntityKind, id: string, patch: EntityPatch, expectHash?: string): Promise<WriterEntity> {
    // (kind,id) promise 链串行化：同键并发 save 排队执行，关闭读-改-写窗口的 TOCTOU
    // （上一环失败不阻断后续排队，仅传递落点）
    const key = `${kind}/${id}`
    const prev = this.saveChains.get(key) ?? Promise.resolve()
    const run = prev.then(() => this.saveLocked(kind, id, patch, expectHash), () => this.saveLocked(kind, id, patch, expectHash))
    const tail = run.then(() => undefined, () => undefined)
    this.saveChains.set(key, tail)
    void tail.then(() => {
      if (this.saveChains.get(key) === tail) this.saveChains.delete(key)
    })
    return run
  }

  /** 并发 save 串行化链：key = `${kind}/${id}`；链条空时清理防泄漏。 */
  private saveChains = new Map<string, Promise<void>>()

  /** 串行化保护下的实际保存（read→校验→原子写→索引→emit 的临界区）。 */
  private async saveLocked(kind: EntityKind, id: string, patch: EntityPatch, expectHash?: string): Promise<WriterEntity> {
    // project（writer.yaml）是项目配置而非创作实体，store 层即只读（tools/engine 任何路径都不可覆盖）
    if (kind === 'project') throw new Error('project 实体（writer.yaml）为项目配置，只读不可写入')
    assertSafeId(kind, id)
    const existing = await this.readFromDisk(kind, id)
    if (expectHash === undefined) {
      // 显式 create 语义：不带乐观锁的 save 仅允许创建，已存在即抛错（防 "new" 误填静默覆盖）
      if (existing !== undefined) throw new Error(`实体已存在：${kind}/${id}。更新必须先 read 并提供 expectHash`)
    } else if (existing === undefined) {
      throw new Error(`乐观锁失败：实体不存在（${kind}/${id}），创建请省略 expectHash`)
    } else if (existing.hash !== expectHash) {
      throw new Error(`乐观锁失败：磁盘版本已变化（${kind}/${id}），请重新 read`)
    }
    if (patch.frontmatter === undefined && patch.content === undefined) {
      throw new Error('保存补丁为空：frontmatter 与 content 至少提供其一')
    }
    const frontmatter: Frontmatter = { ...(existing?.frontmatter ?? {}), ...(patch.frontmatter ?? {}) }
    const content = patch.content ?? existing?.content ?? ''
    const text = serializeEntity(frontmatter, content)
    // hash 以「落盘文本回解」的规范化结果为准（serializeEntity 补尾换行等规范化计入指纹，保证读写一致）
    const normalized = parseFrontmatter(text)
    const absPath = this.absPathOf(kind, id)
    // 原子写：temp + rename（半写文件是索引可重建的隐性破坏者）；rename 失败清理 tmp 并抛友好错误
    await mkdir(dirname(absPath), { recursive: true })
    const tmpPath = `${absPath}.tmp`
    await writeFile(tmpPath, text, 'utf8')
    try {
      await rename(tmpPath, absPath)
    } catch (err) {
      await rm(tmpPath, { force: true }).catch(() => {})
      throw new Error(`落盘失败（目标文件可能被外部程序占用）：${this.relPathOf(kind, id)}：${String(err)}`)
    }
    const entity: WriterEntity = {
      kind,
      id,
      path: this.relPathOf(kind, id),
      frontmatter: normalized.frontmatter,
      content: normalized.content,
      hash: contentHash(normalized.frontmatter, normalized.content),
    }
    await this.ensureIndex()
    this.index!.get(kind)!.set(id, entity)
    // 解析快照缓存同步锚定新落盘文件（save 更新索引后缓存必须一致：
    // 同刻 mtime + 同尺寸的改写在 stat 锚下不可区分，落盘方主动刷新是唯一可靠锚）
    const writtenInfo = await stat(absPath)
    this.parseCache.set(absPath, {
      mtimeMs: writtenInfo.mtimeMs, size: writtenInfo.size,
      ctimeMs: writtenInfo.ctimeMs, ino: Number(writtenInfo.ino), entity,
    })
    this.ctx.emit('writer/entity-saved', entity)
    return entity
  }

  /** 全量重建派生索引（公开入口与内部缺省触发共享同一次 in-flight 重建，防并发互踩）。 */
  rebuildIndex(): Promise<void> {
    this.indexPromise ??= this.doRebuildIndex().finally(() => {
      this.indexPromise = undefined
    })
    return this.indexPromise
  }

  get root(): string {
    return this.projectRoot
  }

  async readDerived(kind: string, id: string): Promise<unknown | undefined> {
    const abs = this.derivedPath(kind, id)
    let raw: string
    try {
      raw = await readFile(abs, 'utf8')
    } catch {
      return undefined
    }
    try {
      return JSON.parse(raw) as unknown
    } catch (err) {
      // 派生缓存是纯缓存：坏文件按缺失处理（删除后维护 pass 重建），不阻塞读取方
      this.warnSkipped(relativePathOf(this.projectRoot, abs), err)
      return undefined
    }
  }

  async writeDerived(kind: string, id: string, value: unknown): Promise<void> {
    const abs = this.derivedPath(kind, id)
    await mkdir(dirname(abs), { recursive: true })
    const tmpPath = `${abs}.tmp`
    await writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8')
    try {
      await rename(tmpPath, abs)
    } catch (err) {
      await rm(tmpPath, { force: true }).catch(() => {})
      throw new Error(`派生数据落盘失败：${relativePathOf(this.projectRoot, abs)}：${String(err)}`)
    }
  }

  async deleteDerived(kind: string, id: string): Promise<void> {
    await rm(this.derivedPath(kind, id), { force: true })
  }

  async listDerived(kind: string): Promise<string[]> {
    const dirAbs = join(this.projectRoot, '.writer', 'derived', kind)
    let names: string[]
    try {
      names = await readdir(dirAbs)
    } catch {
      return []
    }
    return names.filter((n) => n.endsWith('.json')).map((n) => n.replace(/\.json$/, '')).sort()
  }

  async appendPending(section: string): Promise<void> {
    // 读-改-写跨并发维护 pass 必须串行（与 save 同款固定 key promise 链），否则 last-writer-wins 丢段
    const key = 'pending.md'
    const prev = this.saveChains.get(key) ?? Promise.resolve()
    const run = prev.then(() => this.appendPendingLocked(section), () => this.appendPendingLocked(section))
    const tail = run.then(() => undefined, () => undefined)
    this.saveChains.set(key, tail)
    void tail.then(() => {
      if (this.saveChains.get(key) === tail) this.saveChains.delete(key)
    })
    return run
  }

  /** 串行化保护下的实际追加（读 → 拼接 → 原子写）。 */
  private async appendPendingLocked(section: string): Promise<void> {
    const abs = join(this.projectRoot, 'pending.md')
    let existing = ''
    try {
      existing = await readFile(abs, 'utf8')
    } catch {
      // 首次创建
    }
    const next = `${existing}${existing.endsWith('\n') || existing.length === 0 ? '' : '\n'}${section.trim()}\n`
    const tmpPath = `${abs}.tmp`
    await writeFile(tmpPath, next, 'utf8')
    try {
      await rename(tmpPath, abs)
    } catch (err) {
      await rm(tmpPath, { force: true }).catch(() => {})
      throw new Error(`pending.md 追加失败：${String(err)}`)
    }
  }

  /** 锁定区内变更 pending.md：mutator 与 appendPending 共用同一条串行化链，读-改-写不与追加互踩。 */
  async mutatePending<T>(mutator: (text: string) => { next: string; extracted: T }): Promise<T> {
    const key = 'pending.md'
    const prev = this.saveChains.get(key) ?? Promise.resolve()
    const run = prev.then(() => this.mutatePendingLocked(mutator), () => this.mutatePendingLocked(mutator))
    const tail = run.then(() => undefined, () => undefined)
    this.saveChains.set(key, tail)
    void tail.then(() => {
      if (this.saveChains.get(key) === tail) this.saveChains.delete(key)
    })
    return run
  }

  private async mutatePendingLocked<T>(mutator: (text: string) => { next: string; extracted: T }): Promise<T> {
    const abs = join(this.projectRoot, 'pending.md')
    let existing = ''
    try {
      existing = await readFile(abs, 'utf8')
    } catch {
      // 文件不存在按空文本处理（归档空清单是合法操作）
    }
    const { next, extracted } = mutator(existing)
    const tmpPath = `${abs}.tmp`
    await writeFile(tmpPath, next, 'utf8')
    try {
      await rename(tmpPath, abs)
    } catch (err) {
      await rm(tmpPath, { force: true }).catch(() => {})
      throw new Error(`pending.md 变更失败：${String(err)}`)
    }
    return extracted
  }

  /** 归档追加：.writer/pending-archive.md（只增不删；独立串行化链防并发互踩）。 */
  async appendPendingArchive(section: string): Promise<void> {
    const key = 'pending-archive.md'
    const prev = this.saveChains.get(key) ?? Promise.resolve()
    const run = prev.then(() => this.appendFileAtomic(join(this.projectRoot, '.writer', 'pending-archive.md'), section), () => this.appendFileAtomic(join(this.projectRoot, '.writer', 'pending-archive.md'), section))
    const tail = run.then(() => undefined, () => undefined)
    this.saveChains.set(key, tail)
    void tail.then(() => {
      if (this.saveChains.get(key) === tail) this.saveChains.delete(key)
    })
    return run
  }

  /** 通用原子追加（建父目录；跨调用方串行由调用方的链保证）。 */
  private async appendFileAtomic(abs: string, section: string): Promise<void> {
    await mkdir(dirname(abs), { recursive: true })
    let existing = ''
    try {
      existing = await readFile(abs, 'utf8')
    } catch {
      // 首次创建
    }
    const next = `${existing}${existing.endsWith('\n') || existing.length === 0 ? '' : '\n'}${section.trim()}\n`
    const tmpPath = `${abs}.tmp`
    await writeFile(tmpPath, next, 'utf8')
    try {
      await rename(tmpPath, abs)
    } catch (err) {
      await rm(tmpPath, { force: true }).catch(() => {})
      throw new Error(`归档追加失败：${String(err)}`)
    }
  }

  /** 派生数据路径：.writer/derived/<kind>/<id>.json（kind/id 做路径安全校验）。 */
  private derivedPath(kind: string, id: string): string {
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(kind)) {
      throw new Error(`派生数据 kind 非法：${JSON.stringify(kind)}（小写字母开头，仅小写字母/数字/下划线/连字符）`)
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(id) || WINDOWS_RESERVED.has(id.toLowerCase())) {
      throw new Error(`派生数据 id 非法：${JSON.stringify(id)}`)
    }
    return join(this.projectRoot, '.writer', 'derived', kind, `${id}.json`)
  }

  private indexPromise: Promise<void> | undefined

  /**
   * 解析快照缓存（P4 关闭轮次 8 限制②）：absPath → (mtimeMs,size,ctimeMs,ino) 锚定的已解析实体。
   * 多处 list 共用一次重建时，未变更文件的 readFile+parse 直接复用（索引重建仍是全量
   * readdir+stat 扫描，「list 恒反映磁盘现状」语义不变——stat 任一变化即失效重读；
   * ctime/ino 覆盖 rename 保 mtime 与同刻同尺寸改写两类锚漂移）。
   */
  private parseCache = new Map<string, { mtimeMs: number; size: number; ctimeMs: number; ino: number; entity: WriterEntity | undefined }>()

  /** 每次读写前刷新索引（P1 语义：list 恒反映磁盘现状；in-flight 去重共享同一次重建）。 */
  private ensureIndex(): Promise<void> {
    return this.rebuildIndex()
  }

  private async doRebuildIndex(): Promise<void> {
    const next = new Map<EntityKind, Map<string, WriterEntity>>()
    for (const kind of Object.keys(KIND_LAYOUT) as EntityKind[]) {
      next.set(kind, new Map())
      for (const entity of await this.scanKind(kind)) {
        next.get(kind)!.set(entity.id, entity)
      }
    }
    this.index = next
  }

  /** 扫描某 kind 的全部实体文件（索引重建的单一实现；走解析快照缓存）。 */
  private async scanKind(kind: EntityKind): Promise<WriterEntity[]> {
    const layout = KIND_LAYOUT[kind]
    if ('file' in layout) {
      const abs = join(this.projectRoot, layout.file)
      // 单文件实体坏 frontmatter 同样不毒化全局索引（与目录分支同款隔离）
      try {
        const entity = await this.readRawCached(kind, layout.file, abs)
        return entity === undefined ? [] : [entity]
      } catch (err) {
        this.warnSkipped(layout.file, err)
        return []
      }
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
      // 单文件坏 frontmatter 不毒化全局索引：跳过并告警（索引是缓存，坏文件修复后 rebuild 即恢复）
      try {
        const entity = await this.readRawCached(kind, posix.join(layout.dir, name), join(dirAbs, name))
        if (entity !== undefined) entities.push(entity)
      } catch (err) {
        this.warnSkipped(`${layout.dir}/${name}`, err)
      }
    }
    return entities
  }

  /**
   * 快照读：mtime+size 未变即复用上次解析结果（get() 的直读磁盘路径不受影响，保持被动新鲜度）。
   * 缓存条目含 undefined（文件缺席/坏文件），缺席同样被锚定避免重复探测。
   */
  private async readRawCached(kind: EntityKind, relPath: string, absPath: string): Promise<WriterEntity | undefined> {
    let anchor: { mtimeMs: number; size: number; ctimeMs: number; ino: number }
    try {
      const info = await stat(absPath)
      anchor = { mtimeMs: info.mtimeMs, size: info.size, ctimeMs: info.ctimeMs, ino: Number(info.ino) }
    } catch {
      this.parseCache.set(absPath, { mtimeMs: -1, size: -1, ctimeMs: -1, ino: -1, entity: undefined })
      return undefined
    }
    const cached = this.parseCache.get(absPath)
    if (cached !== undefined && cached.mtimeMs === anchor.mtimeMs && cached.size === anchor.size
      && cached.ctimeMs === anchor.ctimeMs && cached.ino === anchor.ino) return cached.entity
    const entity = await this.readRaw(kind, relPath, absPath)
    this.parseCache.set(absPath, { ...anchor, entity })
    return entity
  }

  private warnSkipped(relPath: string, err: unknown): void {
    const logger = (this.ctx as { logger?: (name: string) => { warn: (msg: string) => void } }).logger?.('writer-store')
    const message = `跳过无法解析的实体文件 ${relPath}：${String(err)}`
    if (logger !== undefined) logger.warn(message)
    else console.warn(`[writer-store] ${message}`)
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
