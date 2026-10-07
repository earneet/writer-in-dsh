/**
 * Service Definition：`ctx.writer` 抽象基类 + 领域事件声明。
 * 本包是纯契约（Cordis 惯例：定义包导出抽象基类，由 Provider 继承实现并发布服务实例），
 * 不做存储与 LLM。规划见 docs/implementation-plan.md §1.2。
 * @module dsh-writer-core
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  ChapterWriteRequest, ChapterWriteResult, EntityKind, Frontmatter, ReviewReport, WriterEntity,
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
}
