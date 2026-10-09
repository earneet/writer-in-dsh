/**
 * dsh-writer-ui 浏览器半：注册侧边栏「写作面板」与写作工具富卡片。
 *
 * 机制：本模块经 package.json 的 `dsh.client { platform: 'web' }` 声明 + `./client`
 * 导出（lib/client.js，factory-form CJS）由宿主在 /plugins 路由运行期动态加载；
 * 基线模块（react/cordis/ui-slots…）经注入的 require 从浏览器模块表取。
 * 扩展位（第三方约定）：`ctx.slots.inject(槽名, () => ctx.slots.register(...))`——
 * 声明感知注入，宿主槽声明出现前后激活均可。
 */
import type { Context } from '@deepseek-ai/cordis'
import { WriterPanel, WriterPanelIcon } from './Panel.tsx'
import { ReviewCard, StatsCard, SummaryCard, WriteChapterCard } from './Cards.tsx'

/** 浏览器侧 slots 服务的本地最小契约（第三方不做 ui-slots 类型依赖；运行时由模块表供给同源实现）。 */
interface SlotsService {
  inject(name: string, register: () => unknown): () => void
  register(options: Record<string, unknown>, Component: unknown): () => void
}
type BrowserContext = Context & { slots: SlotsService }

export const name = 'dsh-writer-ui'
export const inject = ['slots']

/** 注册全部 UI 面：侧边栏面板 + 五个工具结果卡片。 */
export function apply(context: Context): void {
  const ctx = context as BrowserContext
  ctx.effect(() => {
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
    card('foreshadow_update', SummaryCard as never)
    card('consistency_check', SummaryCard as never)

    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-writer-ui: panel + toolviews')
}
