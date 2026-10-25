/**
 * dsh-writer-ui 浏览器半：注册侧边栏「写作面板」与写作工具富卡片。
 *
 * 机制：本模块经 package.json 的 `dsh.client { platform: 'web' }` 声明 + `./client`
 * 导出（lib/client.js，factory-form CJS）由宿主在 /plugins 路由运行期动态加载；
 * 基线模块（react/cordis/ui-slots…）经注入的 require 从浏览器模块表取。
 * 扩展位（第三方约定）：`ctx.slots.inject(槽名, () => ctx.slots.register(...))`——
 * 声明感知注入，宿主槽声明出现前后激活均可。
 *
 * 注册面：侧边栏「写作面板」+ 14 张工具卡片全覆盖（八张语义富卡片：write_chapter/
 * review_chapter/writer_stats/foreshadow_update/consistency_check/writer_search/
 * timeline_update/export_book；六张治理工具通用 SummaryCard：writer_read/writer_update/
 * recompute_derived/archive_point/pending_cleanup/maintenance_flush）。视觉基元经基线模块 @deepseek-ai/dsh-client-ui-primitives 取用。
 */
import type { Context } from '@deepseek-ai/cordis'
import { WriterPanel, WriterPanelIcon } from './Panel.tsx'
import {
  ConsistencyCheckCard, ExportBookCard, ForeshadowUpdateCard, ReviewCard,
  StatsCard, SummaryCard, TimelineUpdateCard, WriterSearchCard, WriteChapterCard,
} from './Cards.tsx'
import {
  IconArchiveOutlineRegular, IconChecklistOutlineRegular, IconEditOutlineRegular,
  IconFolderOpenOutlineRegular, IconRefreshOutlineRegular, IconSparkleRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { setBrowserContext } from './load.ts'

/** 浏览器侧 slots 服务的本地最小契约（第三方不做 ui-slots 类型依赖；运行时由模块表供给同源实现）。 */
interface SlotsService {
  inject(name: string, register: () => unknown): () => void
  register(options: Record<string, unknown>, Component: unknown): () => void
}
type BrowserContext = Context & { slots: SlotsService }

export const name = 'dsh-writer-ui'
// remote 命名空间按属性粒度授权（与第一方 dsh-client-ui-sidebar-files 同款声明）；
// sessions 用于活跃会话探测（workspaceFiles 的 scope 是会话工作区根）。
export const inject = ['slots', 'remote', 'remote.workspaceFiles', 'sessions']

/** 注册全部 UI 面：侧边栏面板 + 14 张工具卡片（8 语义富卡片 + 6 治理通用卡）。 */
export function apply(context: Context): void {
  const ctx = context as BrowserContext
  ctx.effect(() => {
    // 运行时同源实现供给 remote/sessions（load.ts 本地契约）；随 effect 生命周期安装/清空，
    // 卸载或热重载后不再持有已销毁 fiber 的引用。跨包 Context 结构不可静态对齐，走 never 断言
    setBrowserContext(ctx as never)
    const disposers: Array<() => void> = []

    // 侧边栏「写作面板」：main 槽 keyed 面板体 + 面板列表入口
    disposers.push(ctx.slots.inject('main', () =>
      ctx.slots.register({ name: 'main', key: 'writer-panel' }, WriterPanel)))
    disposers.push(ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: 'writer-panel', order: 20, label: '写作面板' }, WriterPanelIcon)))

    // 写作工具富卡片（keyed toolview：任意工具名可注册，未注册工具落通用卡片）
    const card = (key: string, Component: (props: never) => React.ReactElement): void => {
      disposers.push(ctx.slots.inject('tool.call.toolview', () =>
        ctx.slots.register({ name: 'tool.call.toolview', key }, Component as never)))
    }
    card('write_chapter', WriteChapterCard as never)
    card('review_chapter', ReviewCard as never)
    card('writer_stats', StatsCard as never)
    card('foreshadow_update', ForeshadowUpdateCard as never)
    card('consistency_check', ConsistencyCheckCard as never)
    card('writer_search', WriterSearchCard as never)
    card('timeline_update', TimelineUpdateCard as never)
    card('export_book', ExportBookCard as never)
    // M1b 卡片覆盖补全：治理类六工具通用卡片（SummaryCard + TOOL_LABELS；治理动作回写「写作动态」）
    card('writer_read', ((props: never) => <SummaryCard {...props} icon={<IconFolderOpenOutlineRegular />} />) as never)
    card('writer_update', ((props: never) => <SummaryCard {...props} icon={<IconEditOutlineRegular />} />) as never)
    card('recompute_derived', ((props: never) => <SummaryCard {...props} icon={<IconRefreshOutlineRegular />} />) as never)
    card('archive_point', ((props: never) => <SummaryCard {...props} icon={<IconArchiveOutlineRegular />} />) as never)
    card('pending_cleanup', ((props: never) => <SummaryCard {...props} icon={<IconChecklistOutlineRegular />} />) as never)
    card('maintenance_flush', ((props: never) => <SummaryCard {...props} icon={<IconSparkleRegular />} />) as never)

    return () => {
      for (const dispose of disposers) dispose()
      setBrowserContext(null)
    }
  }, 'dsh-writer-ui: panel + toolviews')
}
