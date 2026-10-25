/**
 * 实体图 → 面板总览投影（M1b 换源：overview 形状从实体图投影，替代 v5 的
 * 扫描直出聚合）。行数据全部来自冻结实体（coerce/索引已在 buildEntityGraph 完成），
 * 本模块只做视图投影 + 决策面计算（伏笔三色/风险排序/情境卡），纯函数可单测。
 */
import type { EntityGraph } from './types.ts'
import { buildEntityGraph } from './graph.ts'
import type {
  ChapterRow, CharacterRow, NextStep, NovelOverview, OutlineOverview, PendingSection, PlotRow, SectionEntry, TimelineEvent, RelationEntry,
} from './types.ts'
import type { NovelScan } from './overview.ts'

/** 伏笔风险档（三色汇总 + 排序键；roadmap M1b：红=planted 未回收超期/黄=活跃待关注/灰=planned 未种植）。 */
export type PlotRiskLevel = 'red' | 'yellow' | 'gray' | 'none'

/** 伏笔「停滞」判定窗口（章）：最后被触碰（planted/最后 milestone）距今超过该值视为停滞。 */
export const FORESHADOW_STALL_CHAPTERS = 3

/** 计划章锚数值化（"066"/66 → 66；不可解析为 null）。 */
function anchorNum(anchor: string | null): number | null {
  if (anchor === null) return null
  const n = Number(anchor)
  return Number.isFinite(n) ? n : null
}

/** 最后一章（当前章）：全部章节的最大章号；无章返回 null。 */
export function currentChapterOf(graph: EntityGraph): number | null {
  let max: number | null = null
  for (const n of graph.indexes.chapterByNumber.keys()) max = max === null ? n : Math.max(max, n)
  return max
}

/** plotRiskOf 的输入形状（投影前的伏笔数据）。 */
export interface PlotRiskInput {
  status: string
  /** 计划章锚（planned_chapter 的投影值；空串 = 无锚）。 */
  plannedChapter: string
  plantedChapter?: string | null
  milestones?: { chapter: string }[]
}

/**
 * 单个伏笔的风险档（纯函数；roadmap §4.1 M1b 口径）：
 * - 红 = planted 且超过 planned_chapter 仍未回收（planned_chapter 是种植计划锚，
 *   此处兼作整体预期锚——超出即「未回收超期」）；
 * - 黄 = planted 未红但停滞：距最后被触碰（max(planted_chapter, 最后 milestone 章)）
 *   超过 FORESHADOW_STALL_CHAPTERS 章；无任何可判锚的 planted 按活跃计黄（无法排除风险）；
 * - 灰 = planned（未种植；计划章已过 → overdue 逾期未种植）；
 * - none = resolved/abandoned，以及「有锚、未超期、未停滞」的新鲜 planted（无需关注）。
 * current 为 null（无章/章号全不可判）时不做逾期与停滞判定，planted 无锚仍计黄。
 */
export function plotRiskOf(plot: PlotRiskInput, current: number | null): { level: PlotRiskLevel; overdue: boolean; dueDelta: number | null } {
  const planned = anchorNum(plot.plannedChapter.length > 0 ? plot.plannedChapter : null)
  const dueDelta = planned !== null && current !== null ? planned - current : null
  if (plot.status === 'planned') {
    return { level: 'gray', overdue: dueDelta !== null && dueDelta < 0, dueDelta }
  }
  if (plot.status === 'planted') {
    if (dueDelta !== null && dueDelta < 0) return { level: 'red', overdue: true, dueDelta }
    // 停滞锚：种植章与全部 milestone 章的最大值（「最后一次被触摸是哪章」）
    const touchAnchors = [anchorNum(plot.plantedChapter ?? null), ...(plot.milestones ?? []).map(m => anchorNum(m.chapter))]
    const lastTouch = touchAnchors.reduce<number | null>((max, n) => n === null ? max : max === null ? n : Math.max(max, n), null)
    if (lastTouch === null) return { level: 'yellow', overdue: false, dueDelta } // 无锚活跃：无法排除风险
    const stalled = current !== null && current - lastTouch > FORESHADOW_STALL_CHAPTERS
    return { level: stalled ? 'yellow' : 'none', overdue: false, dueDelta }
  }
  return { level: 'none', overdue: false, dueDelta }
}

/** 风险排序：红>黄>灰>完成，同档按 |与当前章差值| 升序（近的先看），再按 id。 */
const RISK_ORDER: Record<PlotRiskLevel, number> = { red: 0, yellow: 1, gray: 2, none: 3 }

/** 下一步情境卡（概况页：按项目状态给出最高价值动作）。 */
export type { NextStep }

/** 计算下一步情境（纯函数；无大纲→规划；有纲无章→首章；有待维护→维护；否则→下一章）。 */
export function nextStepOf(overview: { chapters: number; outline: OutlineOverview | null; currentChapter: number | null; staleChapters: string[]; riskSummary: { red: number } }): NextStep {
  if (overview.outline === null) {
    return { kind: 'outline', title: '规划整体大纲', hint: '还没有大纲（outline.md）——让助手先规划卷/章结构与主线。' }
  }
  if (overview.chapters === 0) {
    return { kind: 'first-chapter', title: '写第一章', hint: '大纲已就绪——让助手按大纲写第一章（write_chapter）。' }
  }
  if (overview.staleChapters.length > 0) {
    return { kind: 'maintain', title: `处理 ${overview.staleChapters.length} 章待维护`, hint: `改稿后未跑维护 pass 的章节：${overview.staleChapters.join('、')}——确认后让助手执行维护（可 recompute_derived）。` }
  }
  const red = overview.riskSummary.red
  // 章号全不可判（无 frontmatter number 且文件名非数字）时不能给出「第 N 章」——如实降级
  if (overview.currentChapter === null) {
    return { kind: 'next-chapter', title: '写下一章', hint: '现有章节缺章号锚（frontmatter number / 数字文件名）——补齐后可给出具体章号；红伏笔提示同理暂缺。' }
  }
  const next = overview.currentChapter + 1
  return {
    kind: 'next-chapter',
    title: `写第 ${next} 章`,
    hint: red > 0 ? `有 ${red} 个伏笔已超期未回收——写作时优先回收或强化。` : '上章数据已维护——按大纲推进下一章。',
  }
}

/** 实体图 + 扫描 → 面板总览（纯函数；pending/project 等扫描侧数据直通）。 */
export function projectOverview(graph: EntityGraph, scan: NovelScan): NovelOverview {
  const chapterRows: ChapterRow[] = graph.chapters.map(ch => ({
    id: ch.id,
    title: ch.title,
    volume: ch.volume,
    chars: ch.chars,
    status: ch.status,
    storyline: ch.storyline,
    preview: ch.preview,
  }))

  const current = currentChapterOf(graph)

  const plotRows: PlotRow[] = graph.plots.map(p => {
    const risk = plotRiskOf({
      status: p.status, plannedChapter: p.plannedChapter ?? '',
      plantedChapter: p.plantedChapter, milestones: p.milestones,
    }, current)
    return {
      id: p.id,
      hint: p.hint,
      status: p.status,
      type: p.type,
      plannedChapter: p.plannedChapter ?? p.plantedChapter ?? '',
      preview: p.preview,
      risk: risk.level,
      overdue: risk.overdue,
      dueDelta: risk.dueDelta,
    }
  }).sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk]
    || Math.abs(a.dueDelta ?? Number.MAX_SAFE_INTEGER) - Math.abs(b.dueDelta ?? Number.MAX_SAFE_INTEGER)
    || a.id.localeCompare(b.id, undefined, { numeric: true }))

  const riskSummary = {
    red: plotRows.filter(p => p.risk === 'red').length,
    yellow: plotRows.filter(p => p.risk === 'yellow').length,
    gray: plotRows.filter(p => p.risk === 'gray').length,
  }

  const characterRows: CharacterRow[] = graph.characters.map(c => ({
    id: c.id,
    name: c.name,
    role: c.role,
    arc: c.arc,
    timelineCount: c.timeline.length,
    relationCount: c.relations.length,
    timeline: c.timeline as TimelineEvent[],
    relations: c.relations.map(r => ({ name: r.name, desc: r.desc }) as RelationEntry),
    sections: c.sections as SectionEntry[],
  })).sort((a, b) => b.timelineCount - a.timelineCount || a.id.localeCompare(b.id))

  const volumeMap = new Map<string, number>()
  for (const ch of graph.chapters) {
    // 未标 volume 的章归「正文」桶——与 writer_stats 服务端口径一致（轮次 33 统一）
    const volume = ch.volume.length > 0 ? ch.volume : '正文'
    volumeMap.set(volume, (volumeMap.get(volume) ?? 0) + 1)
  }

  const foreshadowMap = new Map<string, number>()
  for (const plot of graph.plots) {
    const status = plot.status.length > 0 ? plot.status : 'unknown'
    foreshadowMap.set(status, (foreshadowMap.get(status) ?? 0) + 1)
  }

  const outline: OutlineOverview | null = graph.outline === null ? null : {
    synopsis: graph.outline.synopsis,
    volumes: graph.outline.volumes,
    chapterTarget: graph.outline.chapterTarget,
    sections: graph.outline.nodes.map(n => ({ title: n.title, body: n.body })),
  }

  const project = scan.project
  const targetWords = project !== null && typeof project.target_words === 'number' ? project.target_words : null
  const chapterTarget = project !== null && typeof project.chapters === 'number' ? project.chapters : null
  const totalChars = graph.chapters.reduce((sum, ch) => sum + ch.chars, 0)
  const pending = scan.pending as PendingSection[]

  const partial: Omit<NovelOverview, 'nextStep'> = {
    title: project !== null && typeof project.title === 'string' && project.title.length > 0 ? project.title : '未命名项目',
    genre: project !== null && typeof project.genre === 'string' ? project.genre : '',
    targetWords: targetWords ?? 0,
    chapterTarget: chapterTarget ?? 0,
    chapters: graph.chapters.length,
    totalChars,
    progress: targetWords !== null && targetWords > 0 ? Math.min(totalChars / targetWords, 1) : null,
    volumes: [...volumeMap.entries()].map(([name, count]) => ({ name, count })),
    foreshadow: [...foreshadowMap.entries()].map(([status, count]) => ({ status, count })),
    outline,
    recentChapters: chapterRows.slice(-5).reverse(),
    chapterRows,
    plotRows,
    characterRows,
    worldbuildingCount: graph.worldEntries.length,
    pendingSections: pending,
    pendingLineTotal: pending.reduce((sum, section) => sum + section.lines.length, 0),
    riskSummary,
    currentChapter: current,
    staleChapters: scan.staleChapters ?? [],
    failedFiles: scan.failedFiles ?? [],
    pendingArchive: scan.pendingArchive ?? [],
  }
  return { ...partial, nextStep: nextStepOf(partial) }
}

/** 兼容入口（旧调用方/测试）：扫描 → 实体图 → 投影。 */
export function buildOverview(scan: NovelScan): NovelOverview {
  return projectOverview(buildEntityGraph(scan), scan)
}
