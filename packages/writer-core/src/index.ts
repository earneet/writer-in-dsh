/**
 * Service Definition：`ctx.writer` 抽象基类 + 领域事件声明。
 * 本包是纯契约（Cordis 惯例：定义包导出抽象基类，由 Provider 继承实现并发布服务实例），
 * 不做存储与 LLM。规划见 docs/implementation-plan.md §1.2。
 * @module dsh-writer-core
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  ChapterWriteRequest, ChapterWriteResult, ConsistencyReport, EntityKind, Frontmatter,
  MaintenanceExtraction, ReviewReport, WriterEntity,
} from 'dsh-writer-domain'

/** 实体写入补丁：frontmatter 与正文均可选，至少提供其一。 */
export interface EntityPatch {
  frontmatter?: Frontmatter
  content?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    writer: WriterService
    writerEngine: EngineService
    writerExport: ExportService
    writerRag: RagService
  }
  interface Events {
    /**
     * 实体保存成功后发出（emit；Markdown SoT 落盘 + 索引更新之后）。
     * @param entity - 保存后的完整实体（含新 hash）。
     */
    'writer/entity-saved'(entity: WriterEntity): void
    /**
     * 引擎完成一次章节写作并落盘后发出（emit；在 writer/entity-saved 之后）。
     * @param result - 写作结果（实体 + 实际模式 + 补丁统计/丢句告警）。
     * @mode event
     */
    'writer/chapter-written'(result: ChapterWriteResult): void
    /**
     * 维护 pass 完成一次章节的派生数据写回后发出（emit；hash 锚定命中的 up-to-date 跳过不 emit）。
     * @param result - 维护结果（章节 id + 锚定 hash + 状态）。
     * @mode event
     */
    'writer/maintenance-pass'(result: MaintenancePassResult): void
  }
}

/**
 * 写作领域服务抽象基线：实体读取、带乐观锁的写入、索引重建。
 * P1 由 `dsh-writer-store`（Markdown SoT Provider）实现；后续 engine/tools 经 `inject: ['writer']` 消费。
 */
export abstract class WriterService extends Service {
  protected constructor(ctx: Context) {
    super(ctx, 'writer')
  }

  /** 列出某类实体（从派生索引读取，索引缺失时触发全量重建）。 */
  abstract list(kind: EntityKind): Promise<readonly WriterEntity[]>

  /** 读取单个实体；不存在返回 undefined。 */
  abstract get(kind: EntityKind, id: string): Promise<WriterEntity | undefined>

  /**
   * 保存实体（原子写 temp+rename）。`expectHash` 提供时执行乐观锁校验：
   * 与磁盘当前 hash 不符即抛错（read-before-update 防护）。
   */
  abstract save(kind: EntityKind, id: string, patch: EntityPatch, expectHash?: string): Promise<WriterEntity>

  /** 全量重建派生索引（索引是纯缓存，可随时删除重建）。 */
  abstract rebuildIndex(): Promise<void>

  /** 项目根目录的绝对路径（导出/存档点等文件系统消费方使用）。 */
  abstract get root(): string

  /**
   * 读取派生数据缓存（.writer/derived/<kind>/<id>.json）；不存在返回 undefined。
   * @param kind - 派生数据种类（如 "maintenance"）。
   * @param id - 实体 id（如章节三位序号）。
   */
  abstract readDerived(kind: string, id: string): Promise<unknown | undefined>

  /** 写入派生数据缓存（JSON 可序列化值；覆盖写）。 */
  abstract writeDerived(kind: string, id: string, value: unknown): Promise<void>

  /** 删除派生数据缓存（改稿期标记过期 = 删除，重建走维护 pass）。 */
  abstract deleteDerived(kind: string, id: string): Promise<void>

  /** 列出某类派生数据的全部 id（统计派生覆盖率用）。 */
  abstract listDerived(kind: string): Promise<string[]>

  /** 向 pending.md 追加一节待办（维护 pass 产出，供人确认；原子写）。 */
  abstract appendPending(section: string): Promise<void>
}

/**
 * 维护 pass 结果：done = 本次完成两次调用并写回；up-to-date = hash 锚定命中跳过（防读己之写重复触发）。
 */
export interface MaintenancePassResult {
  chapterId: string
  status: 'done' | 'up-to-date'
  /** 锚定的章节 content_hash。 */
  sourceHash: string
  summary?: string
  extraction?: MaintenanceExtraction
  /** 经过按节重试才收敛的节名。 */
  retriedSections?: string[]
  /** 重试预算耗尽仍有条目被拒收（rejected 为拒收原因；派生记录同步标记）。 */
  partial?: boolean
  rejected?: string[]
  /** 执行期间章节被再次改写：本结果基于旧版本，补跑会覆盖（pending 未追加旧版本待办）。 */
  superseded?: boolean
}

/** 一致性检查范围（章节 id 区间，缺省全书已写章节）。 */
export interface ConsistencyScope {
  from?: string
  to?: string
}

/** 改稿期重算的单章结果。 */
export interface RecomputeDerivedResult {
  chapterId: string
  /** recomputed = 重算完成；up-to-date = 派生新鲜无需重算；marked = 仅标记（删除过期派生）；no-chapter = 章节不存在。 */
  status: 'recomputed' | 'up-to-date' | 'marked' | 'no-chapter'
}

/**
 * 写作引擎抽象基线：章节写作三模式（full/assist/rewrite 补丁协议）与 3+1 维审稿。
 * P2 由 `dsh-writer-engine`（Provider，inject writer+llm）实现并发布 `ctx.writerEngine`；
 * tools 经 `ctx.get('writerEngine')` 可选消费（缺席时写作类工具返回「引擎未启用」）。
 */
export abstract class EngineService extends Service {
  protected constructor(ctx: Context) {
    super(ctx, 'writerEngine')
  }

  /**
   * 章节写作：full（整章生成）/ assist（续写追加）/ rewrite（补丁协议优先，大改回退全文）。
   * 保存走 store（乐观锁）；signal 透传宿主 llm 缝（工具层观测 exec.signal）。
   */
  abstract writeChapter(request: ChapterWriteRequest): Promise<ChapterWriteResult>

  /**
   * 3+1 维审稿（情节/人物/设定一致性 + 文学质量）：结构化建议报告，预览不自动持久化。
   * @param chapterId - 三位序号章节 id。
   * @param focus - 可选维度过滤（缺省全维度）。
   * @param signal - 取消信号。
   */
  abstract reviewChapter(chapterId: string, focus?: readonly string[], signal?: AbortSignal): Promise<ReviewReport>

  /**
   * 维护 pass（保存后异步，默认两次调用）：①章节摘要 ②事实/伏笔/人物状态抽取（分节校验 + 按节重试）。
   * 同章 inflight 去重；完成 hash 锚定（派生与当前章节一致时返回 up-to-date 不再调用）。
   * @param chapterId - 三位序号章节 id。
   * @param opts - force=true 忽略 hash 锚定强制重算；signal 取消。
   */
  abstract maintenancePass(chapterId: string, opts?: { force?: boolean; signal?: AbortSignal }): Promise<MaintenancePassResult>

  /**
   * 一致性检查：全书（plot/outline/key_events/principles vs 已写章节），按预算分批，
   * 输出结构化矛盾报告（预览不自动持久化）。
   */
  abstract consistencyCheck(scope?: ConsistencyScope, signal?: AbortSignal): Promise<ConsistencyReport>

  /**
   * 改稿期派生重算：对章节区间标记（删除过期派生）或重算（重跑维护 pass）下游派生物。
   * @param range - 章节 id（"002"）或区间（"001-003"）。
   * @param opts - mode 默认 recompute；mark 仅删除过期派生不调 LLM。
   */
  abstract recomputeDerived(range: string, opts?: { mode?: 'mark' | 'recompute'; signal?: AbortSignal }): Promise<RecomputeDerivedResult[]>

  /**
   * 断更恢复快照：从章节/派生摘要/事件/伏笔实况渲染 Markdown 快照并写入项目
   * `.writer/recovery-snapshot.md`（章节时间锚取 git log 最后提交时间）。
   * @param range - 可选章节区间（"002" / "001-003"；缺省全部已写章节）。
   */
  abstract recoverySnapshot(range?: string): Promise<RecoverySnapshotResult>
}

/** 恢复快照结果：落盘路径 + 快照全文。 */
export interface RecoverySnapshotResult {
  path: string
  markdown: string
  chapters: number
}

/** 导出请求：格式 + 可选卷过滤/附录 + 输出路径。 */
export interface ExportRequest {
  format: 'txt' | 'html' | 'epub'
  /** 只导出该卷（卷名或卷号字符串；缺省全书）。 */
  volume?: string
  includeOutline?: boolean
  includeCharacters?: boolean
  /** 相对项目根的输出路径（缺省 exports/book.<format>）。 */
  outputPath?: string
}

/** 导出结果：落盘路径 + 章节数 + 字节数。 */
export interface ExportResult {
  path: string
  chapters: number
  bytes: number
}

/**
 * 导出服务抽象基线（TXT/HTML/ePub）。P3 由 `dsh-writer-export`（Consumer，inject writer）实现并发布
 * `ctx.writerExport`；tools 经 `ctx.get('writerExport')` 可选消费（缺席时 export_book 返回「导出未启用」，
 * 独立禁用不阻塞核心写作）。
 */
export abstract class ExportService extends Service {
  protected constructor(ctx: Context) {
    super(ctx, 'writerExport')
  }

  /** 导出全书（按卷组织，XSS/XML 转义），写入项目内输出文件并返回路径与统计。 */
  abstract exportBook(request: ExportRequest): Promise<ExportResult>
}

/**
 * 检索增强选项：命中数上限、防剧透章号上限（章节块只保留序号小于该值的）、取消信号。
 */
export interface RagSearchOptions {
  maxResults?: number
  /** 防剧透：只检索序号小于该章号的章节块（与组装器防剧透红线同语义）。 */
  chapterLimit?: number
  signal?: AbortSignal
}

/**
 * 混合检索服务抽象基线（P4）：关键词先行（自实现 TF-IDF）+ 可选语义档（后端 Config 驱动），
 * RRF 融合。检索对象 = 章节原文 + 派生摘要 + 人物/伏笔/世界观条目。
 * 由 `dsh-writer-rag`（Provider，inject writer）实现并发布 `ctx.writerRag`；
 * engine/tools 经 `ctx.get('writerRag')` 可选消费（缺席即检索增强关闭，不阻塞写作）。
 */
export abstract class RagService extends Service {
  protected constructor(ctx: Context) {
    super(ctx, 'writerRag')
  }

  /**
   * 混合检索：返回按融合得分降序的命中（snippet 已截断，含来源引用供核对）。
   * @param query - 查询文本（通常为大纲小节 + 写作指令）。
   */
  abstract search(query: string, opts?: RagSearchOptions): Promise<import('dsh-writer-domain').RagHit[]>
}
