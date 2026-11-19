/**
 * Provider：Markdown SoT 存储，发布 `ctx.writer`。
 * 写路径 = 原子写（temp+rename）落盘 → 解析缓存更新（纯内存缓存，无落盘物）。
 * 不变量：.writer/ 整目录可删且无损——derived/ 由维护 pass 重建、recovery-snapshot.md 由下次
 * 恢复快照再生成；归档 pending-archive.md 是不可重建史料，住项目根入 git（轮次 42）。
 * 乐观锁：save 带 expectHash 时与磁盘当前 hash 比对，不符抛错（read-before-update 防护）。
 * 规划见 docs/implementation-plan.md §1.3；R-改进来源 docs/novel-writer-review.md §6.2-1/§6.2-2。
 * @module dsh-writer-store
 */
import { type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, dirname, isAbsolute, posix, resolve, relative, sep } from 'node:path'
import {
  contentHash, parseFrontmatter, serializeEntity,
  type EntityKind, type Frontmatter, type MaintenanceDerived, type WriterEntity,
} from 'dsh-writer-domain'
import { WriterService, type EntityPatch, type PendingAppendOptions } from 'dsh-writer-core'
import type { WorkspaceProjectState } from 'dsh-writer-core'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import { inspectProject, initializeProject } from './project.ts'

/** projectRoot 显式配置固定项目；省略时按调用会话目录解析。 */
export interface Config {
  projectRoot?: string
}

export const Config: Schema<Config> = Schema.object({
  projectRoot: Schema.string().description('固定小说项目的绝对路径；省略时使用当前会话工作目录的 novel/'),
})

function isMaintenanceDerived(value: unknown): value is MaintenanceDerived {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    if (typeof record.sourceHash !== 'string' || typeof record.summary !== 'string' || typeof record.updatedAt !== 'string') return false
    if (record.partial !== undefined && typeof record.partial !== 'boolean') return false
    const strings = (items: unknown) => Array.isArray(items) && items.every(item => typeof item === 'string')
    if (record.rejected !== undefined && !strings(record.rejected)) return false
    if (typeof record.extraction !== 'object' || record.extraction === null || Array.isArray(record.extraction)) return false
    const extraction = record.extraction as Record<string, unknown>
    const entries = (items: unknown, valid: (item: Record<string, unknown>) => boolean) =>
        Array.isArray(items) && items.every(item => typeof item === 'object' && item !== null && !Array.isArray(item) && valid(item))
    return entries(extraction.facts, item => typeof item.description === 'string'
        && (item.characters === undefined || strings(item.characters)) && (item.plots === undefined || strings(item.plots)))
        && entries(extraction.foreshadowEvents, item => typeof item.plot === 'string'
            && ['planted', 'reinforcement', 'partial_reveal', 'callback', 'red_herring', 'resolved'].includes(String(item.action))
            && (item.note === undefined || typeof item.note === 'string'))
        && entries(extraction.characterStates, item => typeof item.character === 'string' && typeof item.state === 'string')
}

/** 实体扫描表：kind → 目录/文件约定与 id 派生。 */
const KIND_LAYOUT: Readonly<Record<EntityKind, { dir: string } | { file: string }>> = {
  project: { file: 'project.md' },
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

/** 维护 pass 派生数据的磁盘 kind（唯一真源；消费者经 readMaintenance 业务方法访问）。 */
const MAINTENANCE_KIND = 'maintenance'

/**
 * 进程内共享的写串行化链（轮次 38 修复 P0-1：跨实例静默丢数据）。
 *
 * 原先链是**每个 Service 实例私有**的 `saveChains`，而「写作模式」preset 给每个会话各挂一组
 * store、projectRoot 又默认同指 `<cwd>/novel`——两个会话并发写同一 pending.md 时，后写者按
 * 旧快照整体重写，先写者的段静默消失（实测两实例共 40 次追加只落 20 节、零报错）。
 *
 * 提到 module 级：realm 隔离隔离的是服务注册符号，不是模块代码，故跨 isolate 域仍共享同一张表，
 * 单写者语义由此成立。键 = projectRoot + 资源名，不同项目互不阻塞。
 * 已知限制：跨进程（两个 dsh 进程共用一个小说目录）仍无保护，与派生缓存跨进程不共享同口径。
 */
const WRITE_CHAINS = new Map<string, Promise<void>>()

/** 在共享串行链上排队执行：同键并发排队（上一环失败不阻断后续排队，仅传递落点）。 */
function withWriteChain<T>(projectRoot: string, resource: string, task: () => Promise<T>): Promise<T> {
  // 键内归一化（对抗审查 P3）：resolve 消尾斜杠/相对段 + Windows 盘符大小写归一——
  // 否则 F:\a 与 f:\a\ 会同根异键，双链并行使保护失效。
  // 已知边界（留痕）：Linux 大小写敏感文件系统上仅大小写不同的两个项目根会共链——
  // 后果只是多余的跨项目串行（保守方向，绝不会漏保护）；小说场景 projectRoot 来自同一配置源，实际不可达。
    const resourceKey = process.platform === 'win32' ? resource.toLowerCase() : resource
    const key = `${resolve(projectRoot).toLowerCase()}\u0000${resourceKey}`
  const prev = WRITE_CHAINS.get(key) ?? Promise.resolve()
  const run = prev.then(task, task)
  const tail = run.then(() => undefined, () => undefined)
  WRITE_CHAINS.set(key, tail)
  void tail.then(() => {
    // 身份校验清理：只删自己入表的 entry，防误删并发后继的登记
    if (WRITE_CHAINS.get(key) === tail) WRITE_CHAINS.delete(key)
  })
  return run
}

/** 唯一临时文件名（并发写者不共用固定 tmp 互踩；与 writeDerived 同范式）。 */
let tmpCounter = 0
function uniqueTmpPath(absPath: string): string {
  tmpCounter += 1
  return `${absPath}.${process.pid.toString(36)}${tmpCounter.toString(36)}.tmp`
}

/** rename 瞬时占用（Windows 杀软/索引器短暂锁目标文件）的可重试错误码。 */
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

async function readOptionalText(path: string): Promise<string> {
    try {
        return await readFile(path, 'utf8')
    } catch (err) {
        if ((err as { code?: string }).code === 'ENOENT') return ''
        throw new Error(`项目文件读取失败：${path}：${String(err)}`)
    }
}

/**
 * 原子 rename + 有界重试（轮次 38 收口）：串行化已消除自撞，但 Windows 上对同一文件的高频
 * 连续 rename 仍会被杀软/索引器的实时扫描瞬时锁住（EPERM/EACCES/EBUSY）——重试 3 次
 * （10/20/40ms 退避）后仍失败才按原口径响亮报错（目标文件可能被外部程序占用）。
 */
async function renameWithRetry(tmpPath: string, absPath: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmpPath, absPath)
      return
    } catch (err) {
      const code = (err as { code?: string }).code
      if (attempt >= 3 || code === undefined || !RENAME_RETRY_CODES.has(code)) throw err
      await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt))
    }
  }
}

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
  if (kind === 'chapter' && !/^\d{3}$/.test(id)) {
    // 章节 id 是全书排序键：一致性检查 scope 区间比较、导出章序、RAG/组装器序号
    // 解析均按三位序号假设；非数字 id 会在下游静默失效（轮次 33），存储层统一设防。
    throw new Error(`章节 id 必须为三位序号（001-999）：${JSON.stringify(id)}`)
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

    private readonly configuredRoot: string | undefined
    private readonly indexes = new Map<string, Map<EntityKind, Map<string, WriterEntity>>>()
    private readonly indexPromises = new Map<string, Promise<void>>()
    private readonly migrations = new Map<string, Promise<void>>()
  /** 派生索引：内存态，save 时增量更新；缺失时由 ensureIndex 全量重建。 */
    private get index(): Map<EntityKind, Map<string, WriterEntity>> | undefined {
        return this.indexes.get(this.projectRoot)
    }

    private set index(value: Map<EntityKind, Map<string, WriterEntity>> | undefined) {
        if (value) this.indexes.set(this.projectRoot, value)
    }

    private get sessionWorkspaceRoot(): string {
        const cwd = this.ctx.get('agents')?.currentInitiator()?.session.header.cwd
        if (!cwd) throw new Error('当前会话没有工作目录，请在小说工作目录中打开写作会话，或显式配置 projectRoot。')
        return cwd
    }

    private get projectRoot(): string {
        return this.configuredRoot ?? join(this.sessionWorkspaceRoot, 'novel')
    }

  constructor(ctx: Context, config: Config) {
    super(ctx)
    // 轮次 38（P2-5）：相对路径按 process.cwd() 解析极其隐蔽（错一个字符要到首次 save 才以
    // 「实体不存在」间接暴露）——配置错误在构造期响亮失败，给出当前值与建议。
    if (config.projectRoot !== undefined && !isAbsolute(config.projectRoot)) {
      throw new Error(`projectRoot 必须为绝对路径：${JSON.stringify(config.projectRoot)}（相对路径会按宿主进程启动目录解析；请改为绝对路径，如 preset 的 !!js join(process.cwd(), 'novel') 形式）`)
    }
    this.configuredRoot = config.projectRoot
    // 固定项目装载时、会话项目首次访问时迁移；失败仅告警，避免损坏归档阻断正常稿件读取。
    // 关闭「纯读/完结项目永不产生归档写入 → 旧归档无限期滞留 .writer/」的窗口：
    // 窗口内「.writer/ 整目录可删且无损」不变量不成立，archive_point 也会把它挡在存档外。
    if (this.configuredRoot !== undefined) void this.ensureMigration()
    ctx.inject(['commands', 'agents'], child => {
        for (const action of ['status', 'init'] as const) child.commands.register({
            name: `writer-project-${action}`,
            description: action === 'init' ? '在空工作目录初始化小说项目' : '检查当前工作目录的小说项目状态',
            handler: ({ agent, signal, rawInput }) => {
                if (rawInput.trim()) return { kind: 'error', text: '此命令不接受参数，请直接使用写作面板的初始化入口。' }
                const cwd = agent.session.header.cwd
                if (!cwd) return { kind: 'error', text: '当前会话没有工作目录，请先打开一个工作目录。' }
                return child.agents.withInitiator(agent, async () => {
                    const state = action === 'init' ? await this.initializeProject(cwd, signal) : await this.inspectProject(cwd)
                    return { kind: 'success' as const, text: JSON.stringify(state) }
                })
            },
        })
    })
  }

    private ensureMigration(): Promise<void> {
        const root = this.projectRoot
        let task = this.migrations.get(root)
        if (!task) {
            task = this.runPendingArchiveMigration().catch(error => {
                this.migrations.delete(root)
                const logger = (this.ctx as { logger?: (name: string) => { warn: (message: string) => void } }).logger?.('writer-store')
                logger?.warn(`旧归档迁移未完成（将在下次访问时重试）：${error instanceof Error ? error.message : String(error)}`)
            })
            this.migrations.set(root, task)
        }
        return task
    }

    inspectProject(workspaceRoot: string): Promise<WorkspaceProjectState> {
        return inspectProject(workspaceRoot, this.projectRoot)
    }

    async initializeProject(workspaceRoot: string, signal?: AbortSignal): Promise<WorkspaceProjectState> {
        const canonicalWorkspace = await realpath(workspaceRoot)
        return withWriteChain(canonicalWorkspace, 'initialize', () => initializeProject(canonicalWorkspace, this.projectRoot, signal))
    }

    async assertProjectWritable(): Promise<void> {
        if (this.configuredRoot !== undefined) return
        const state = await this.inspectProject(this.sessionWorkspaceRoot)
        if (state.status !== 'ready') {
            throw new Error(state.message ?? '小说项目尚未初始化，请在当前写作会话点击“一键初始化”后再写入。')
        }
    }

  /** 触发一次旧布局归档迁移（幂等；走归档串行链，与归档写入互斥；构造期与归档写入共用）。 */
  private runPendingArchiveMigration(): Promise<void> {
    return withWriteChain(this.projectRoot, 'pending-archive.md', async () => {
      await this.migrateLegacyPendingArchiveLocked()
    })
  }

  async list(kind: EntityKind): Promise<readonly WriterEntity[]> {
    await this.ensureIndex()
    return [...(this.index!.get(kind)?.values() ?? [])].sort((a, b) => a.id.localeCompare(b.id))
  }

  async get(kind: EntityKind, id: string): Promise<WriterEntity | undefined> {
    await this.ensureMigration()
    // 直读磁盘（被动新鲜度：外部编辑器修改后立即可见；内存索引仅服务 list 清单）
    assertSafeId(kind, id)
    return this.readFromDisk(kind, id)
  }

  async save(kind: EntityKind, id: string, patch: EntityPatch, expectHash?: string): Promise<WriterEntity> {
    // (kind,id) 在共享串行链上排队：同键并发 save 串行执行，关闭读-改-写窗口的 TOCTOU。
    // 用模块级共享链而非实例私有链，使多会话（多 store 实例）指向同一项目时仍是单写者（P0-1）。
    return withWriteChain(this.projectRoot, `entity:${kind}/${id}`, () => this.saveLocked(kind, id, patch, expectHash))
  }

  /** 串行化保护下的实际保存（read→校验→原子写→索引→emit 的临界区）。 */
  private async saveLocked(kind: EntityKind, id: string, patch: EntityPatch, expectHash?: string): Promise<WriterEntity> {
    assertSafeId(kind, id)
    await this.assertProjectWritable()
    const existing = await this.readFromDisk(kind, id)
    if (expectHash === undefined) {
      // 显式 create 语义：不带乐观锁的 save 仅允许创建，已存在即抛错（防 "new" 误填静默覆盖）
      if (existing !== undefined) throw new Error(`实体已存在：${kind}/${id}。更新必须先 read 并提供 expectHash`)
    } else if (existing === undefined) {
      throw new Error(`乐观锁失败：实体不存在（${kind}/${id}）。创建请将 expectHash 填 "new"（服务层调用则省略 expectHash）`)
    } else if (existing.hash !== expectHash) {
      // 区分「用了列表预览的截断 hash」与「内容真被改过」：前者是新手高频打转点，必须给出可行动指引
      const hint = expectHash.length < existing.hash.length && existing.hash.startsWith(expectHash)
        ? '你填的是列表预览的截断 hash——请带 id 重新 writer_read 取完整 hash'
        : '内容已变化，请重新 read 后用新 hash 重试'
      throw new Error(`乐观锁失败：hash 不符（${kind}/${id}，当前完整 hash=${existing.hash}），${hint}`)
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
    const tmpPath = uniqueTmpPath(absPath)
    await writeFile(tmpPath, text, 'utf8')
    try {
      await renameWithRetry(tmpPath, absPath)
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
    this.ctx.emit(this, 'writer/entity-saved', entity)
    return entity
  }

  /** 全量重建派生索引（公开入口与内部缺省触发共享同一次 in-flight 重建，防并发互踩）。 */
  rebuildIndex(): Promise<void> {
    const root = this.projectRoot
    let task = this.indexPromises.get(root)
    if (!task) {
        task = this.ensureMigration().then(() => this.doRebuildIndex()).finally(() => this.indexPromises.delete(root))
        this.indexPromises.set(root, task)
    }
    return task
  }

  get root(): string {
    return this.projectRoot
  }

  /**
   * 读取某章的维护 pass 派生记录（轮次 38 P0-3 第一步：业务方法上提）。
   * `'maintenance'` 这个磁盘 kind 字面量只允许出现在本文件，消费者一律走本方法。
   */
  async readMaintenance(chapterId: string): Promise<MaintenanceDerived | undefined> {
        const record = await this.readDerived(MAINTENANCE_KIND, chapterId)
        if (record === undefined) return undefined
        if (isMaintenanceDerived(record)) return record
        this.warnSkipped(relativePathOf(this.projectRoot, this.derivedPath(MAINTENANCE_KIND, chapterId)), new Error('维护缓存形状非法，按缺失重建'))
        return undefined
  }

  /** 写维护缓存与章节保存共用锁，避免旧版本或迟到partial覆盖有效完整记录。 */
  async writeMaintenance(chapterId: string, record: MaintenanceDerived, expectedChapterHash?: string): Promise<void> {
        await withWriteChain(this.projectRoot, `entity:chapter/${chapterId}`, async () => {
            if (expectedChapterHash !== undefined && (await this.readFromDisk('chapter', chapterId))?.hash !== expectedChapterHash) return
            const current = await this.readMaintenance(chapterId)
            if (record.partial && current?.sourceHash === record.sourceHash && !current.partial) return
            await this.writeDerived(MAINTENANCE_KIND, chapterId, record)
        })
  }

  /** 删除某章的维护 pass 派生记录（改稿期标记过期 = 删除）。 */
  async deleteMaintenance(chapterId: string): Promise<void> {
    await this.deleteDerived(MAINTENANCE_KIND, chapterId)
  }

  async readDerived(kind: string, id: string): Promise<unknown | undefined> {
    const abs = this.derivedPath(kind, id)
    let raw: string
    try {
      raw = await readFile(abs, 'utf8')
    } catch (err) {
      // ENOENT = 派生缺失（正常，按 undefined 处理由维护 pass 重建）；
      // 其他 IO 错（EACCES/EBUSY 等）是环境故障，静默当缺失会掩盖问题并多耗一次模型重算——响亮失败
      if ((err as { code?: string }).code === 'ENOENT') return undefined
      throw new Error(`派生数据读取失败：${relativePathOf(this.projectRoot, abs)}：${String(err)}`)
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
    // 唯一 tmp 名（与 engine recoverySnapshot 同范式）：无串行化链时并发写者不共用 tmp 互踩
    const tmpPath = uniqueTmpPath(abs)
    await writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8')
    try {
      await renameWithRetry(tmpPath, abs)
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

  async appendPending(section: string, options?: PendingAppendOptions): Promise<void> {
    // 读-改-写跨并发维护 pass 必须串行：共享链按项目根取键，跨 store 实例仍是单写者（P0-1）
        return withWriteChain(this.projectRoot, 'pending.md', async () => {
            if (!options?.chapter) return this.appendPendingLocked(section, options)
            const chapter = options.chapter
            await withWriteChain(this.projectRoot, `entity:chapter/${chapter.id}`, async () => {
                if ((await this.readFromDisk('chapter', chapter.id))?.hash !== chapter.hash) return
                if (chapter.maintenanceHash !== undefined) {
                    const current = await this.readMaintenance(chapter.id)
                    if (current === undefined || contentHash({}, JSON.stringify(current)) !== chapter.maintenanceHash) return
                }
                await this.appendPendingLocked(section, options)
            })
        })
  }

  /** 串行化保护下的实际追加（读 → 拼接 → 原子写）。 */
  private async appendPendingLocked(section: string, options?: PendingAppendOptions): Promise<void> {
    const abs = join(this.projectRoot, 'pending.md')
    const existing = await readOptionalText(abs)
        let body = section.trim()
        const sectionKind = /^## \[(维护 pass|recompute mark)\] chapter\/(\d{3})/.exec(body)
        if (options?.dedupKey !== undefined || sectionKind?.[1] === 'recompute mark') {
            const archived = await withWriteChain(this.projectRoot, 'pending-archive.md', async () =>
                `${await readOptionalText(join(this.projectRoot, 'pending-archive.md'))}\n${await readOptionalText(join(this.projectRoot, '.writer/pending-archive.md'))}`)
            let epoch = 0
            for (const match of `${existing}\n${archived}`.matchAll(/^<!-- writer-maintenance-epoch:(\d{3}):(\d+) -->$/gm)) {
                if (match[1] === sectionKind?.[2]) epoch = Math.max(epoch, Number(match[2]))
            }
            if (sectionKind?.[1] === 'recompute mark') {
                body = `${body}\n<!-- writer-maintenance-epoch:${sectionKind[2]}:${epoch + 1} -->`
            } else if (options?.dedupKey !== undefined) {
                const marker = (key: string) => `<!-- writer-pending:${key}${epoch ? `:${epoch}` : ''} -->`
                const markers = [marker(options.dedupKey), ...(options.supersedingKey ? [marker(options.supersedingKey)] : [])]
                if ([existing, archived].some(text => markers.some(value => text.includes(value)) || (!epoch && text.includes(body)))) return
                if (sectionKind?.[1] === '维护 pass' && options.chapter?.id === sectionKind[2]) {
                    const headerEnd = body.indexOf('\n')
                    const header = headerEnd < 0 ? body : body.slice(0, headerEnd)
                    const rest = headerEnd < 0 ? '' : body.slice(headerEnd)
                    body = `${header}\n<!-- writer-pending-source:${options.chapter.hash} -->${rest}`
                }
                body = `${body}\n${markers[0]}`
            }
        }
    const next = `${existing}${existing.endsWith('\n') || existing.length === 0 ? '' : '\n'}${body}\n`
    const tmpPath = uniqueTmpPath(abs)
    await writeFile(tmpPath, next, 'utf8')
    try {
      await renameWithRetry(tmpPath, abs)
    } catch (err) {
      await rm(tmpPath, { force: true }).catch(() => {})
      throw new Error(`pending.md 追加失败：${String(err)}`)
    }
  }

  /**
   * 归档式变更 pending.md：pending.md 链锁定区内——mutator 分区 → 先原子追加归档文件 → 再原子重写
   * pending.md（失败方向安全：归档先落，pending 重写失败时待办仍在清单，重试只在归档多一份副本）。
   * extracted 为空串时零文件写入（幂等 no-op）。返回 extracted。
   */
  async archivePending(mutator: (text: string) => { next: string; extracted: string }): Promise<string> {
    return withWriteChain(this.projectRoot, 'pending.md', () => this.archivePendingLocked(mutator))
  }

  private async archivePendingLocked(mutator: (text: string) => { next: string; extracted: string }): Promise<string> {
    const abs = join(this.projectRoot, 'pending.md')
    const existing = await readOptionalText(abs)
    const { next, extracted } = mutator(existing)
    if (extracted.trim().length === 0) return extracted
    // 先归档后改清单（顺序即安全语义，见方法注释；extracted 由调用方包装好归档头）。
    // 归档写入走 appendPendingArchive 的串行链（与 pending.md 链不同 key，无死锁）——
    // 与公开 API 并发追加归档不互踩（否则两处对同一文件读-改-写可能丢段）。
    await this.appendPendingArchive(extracted)
    const tmpPath = uniqueTmpPath(abs)
    await writeFile(tmpPath, next, 'utf8')
    try {
      await renameWithRetry(tmpPath, abs)
    } catch (err) {
      await rm(tmpPath, { force: true }).catch(() => {})
      throw new Error(`pending.md 变更失败（归档已写入，待办仍在本清单，重试安全）：${String(err)}`)
    }
    return extracted
  }

  /**
   * 归档追加：<projectRoot>/pending-archive.md（只增不删；独立串行化链防并发互踩）。
   * 归档是不可重建的人工史料（维护 pass 一次性产出的唯一副本），与 pending.md 同住项目根入 git
   * （轮次 42；旧位置 .writer/ 随「整目录可删」口径被 gitignore/清理静默丢弃——架构评审 P2-2）。
   * 每次追加前先做旧布局幂等迁移（migrateLegacyPendingArchiveLocked）。
   */
  async appendPendingArchive(section: string): Promise<void> {
    return withWriteChain(
      this.projectRoot,
      'pending-archive.md',
      async () => {
        await this.migrateLegacyPendingArchiveLocked()
        await this.appendFileAtomic(join(this.projectRoot, 'pending-archive.md'), section)
      },
    )
  }

  /**
   * 旧布局迁移（.writer/pending-archive.md → 根下 pending-archive.md）：幂等，在归档串行链内执行。
   * 旧文件不存在即 no-op（每次调用一次读取探测，无标记位）；旧存在 → 内容原子拼接进新文件
   * （appendFileAtomic 复用：建父目录/唯一 tmp/rename 重试；新文件不存在时等价整体搬移）→ 删旧。
   * 失败方向安全（对抗审查 #3 强化）：拼接失败时旧文件原样保留，重试安全；删旧失败时新文件已含
   * 全部内容，重试经「已并入检测」跳过拼接只重试删旧——副本不随重试次数增长（归档只增不删不丢数据）。
   * 触发时机 = store 装载（构造期 fire-and-forget）+ 任何归档写入（appendPendingArchive /
   * archivePending / pending_cleanup 工具）；UI 侧另对旧路径保留兜底读取（writer-ui load.ts）。
   * 裁定留痕（对抗审查 #5）：新旧并存的迁移中断态续迁后，较老的旧段拼接在新文件末尾，归档区
   * 「最新在前」的展示顺序可能瞬时乱序——节头时间戳可辨识，不修；按节头时间戳排序入 UI backlog。
   */
  private async migrateLegacyPendingArchiveLocked(): Promise<void> {
    const legacyPath = join(this.projectRoot, '.writer', 'pending-archive.md')
    let legacy: string
    try {
      legacy = await readFile(legacyPath, 'utf8')
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') return
      throw new Error(`旧归档迁移读取失败：${relativePathOf(this.projectRoot, legacyPath)}：${String(err)}`)
    }
    const targetPath = join(this.projectRoot, 'pending-archive.md')
    // 已并入检测：上次「拼接成功、删旧失败」的重试不再重复拼接（旧文件全文已在新文件中）
    const existing = await readOptionalText(targetPath)
    if (!existing.includes(legacy.trim())) {
      await this.appendFileAtomic(targetPath, legacy)
    }
    try {
      await rm(legacyPath, { force: true })
    } catch (err) {
      throw new Error(`旧归档已并入根下 ${relativePathOf(this.projectRoot, targetPath)}，但旧文件删除失败（旧文件保留，下次归档写入只重试删除、不重复并入）：${String(err)}`)
    }
  }

  /** 通用原子追加（建父目录；跨调用方串行由调用方的链保证）。 */
  private async appendFileAtomic(abs: string, section: string): Promise<void> {
    await mkdir(dirname(abs), { recursive: true })
    const existing = await readOptionalText(abs)
    const next = `${existing}${existing.endsWith('\n') || existing.length === 0 ? '' : '\n'}${section.trim()}\n`
    const tmpPath = uniqueTmpPath(abs)
    await writeFile(tmpPath, next, 'utf8')
    try {
      await renameWithRetry(tmpPath, abs)
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
    } catch (err) {
      if ((err as { code?: string }).code !== 'ENOENT') {
        throw new Error(`实体文件状态读取失败：${relPath}：${String(err)}`)
      }
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
    } catch (err) {
      // 与 readDerived 同口径：ENOENT = 实体缺席（create 路径合法）；
      // 其他 IO 错（EACCES/EBUSY 等）静默当缺席会让 get 误报「实体不存在」、create 覆盖暂时不可读的文件——响亮失败
      if ((err as { code?: string }).code === 'ENOENT') return undefined
      throw new Error(`实体文件读取失败：${relPath}：${String(err)}`)
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
