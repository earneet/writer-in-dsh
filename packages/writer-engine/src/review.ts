import type { WriterService } from 'dsh-writer-core'
import {
    chapterNumberOf, extractChapterOutline, parseTimeline, REVIEW_DIMENSIONS, truncateCodePoints, validateTimeline, visibleEvents,
    type ReviewDimension, type ReviewReport, type WriterEntity,
} from 'dsh-writer-domain'

interface Source {
    ref: string
    text: string
}

interface Material {
    label: string
    dimensions: readonly ReviewDimension[]
    sources: readonly Source[]
    incomplete?: boolean
}

export interface ReviewContext {
    materials: Material[]
    coverage: string[]
}

const plot = ['情节一致性'] as const
const people = ['人物一致性'] as const
const setting = ['设定一致性'] as const
const history = ['情节一致性', '人物一致性'] as const

function entitySources(entities: readonly WriterEntity[], chapterNumber: number): Source[] {
    return entities.map(entity => ({ ref: `${entity.kind}/${entity.id}`, text: visibleEvents(entity.content, chapterNumber) }))
}

export async function loadReviewContext(
    writer: WriterService, chapter: WriterEntity, focus: readonly string[] | undefined, budget: number,
): Promise<ReviewContext> {
    const enabled = (dimensions: readonly ReviewDimension[]) => !focus?.length || dimensions.some(dim => focus.includes(dim))
    const chapterNumber = chapterNumberOf(chapter) ?? Number(chapter.id)
    const [principles, outline, chapters, events, plots, characters, world] = await Promise.all([
        writer.get('principles', 'principles'),
        enabled(plot) ? writer.get('outline', 'outline') : undefined,
        enabled(history) ? writer.list('chapter') : [],
        enabled(plot) ? writer.get('event', 'event') : undefined,
        enabled(plot) ? writer.list('plot') : [],
        enabled(people) ? writer.list('character') : [],
        enabled(setting) ? writer.list('worldbuilding') : [],
    ])
    const earlier = chapters
        .map(item => ({ item, number: chapterNumberOf(item) ?? Infinity }))
        .filter(row => row.item.id < chapter.id && row.number < chapterNumber)
        .sort((a, b) => b.number - a.number)
        .map(row => row.item)
    const chapterOutline = outline && extractChapterOutline(outline.content, chapterNumber)
    const timelineSources = characters.flatMap(character => {
        try {
            const timeline = parseTimeline(character.frontmatter['timeline'])
            if (validateTimeline(timeline).length > 0) return []
            const entries = timeline.filter(entry => Number(entry.chapter) <= chapterNumber)
            return entries.length > 0 ? [{
                ref: `character/${character.id}`,
                text: entries.map(entry => `第 ${entry.chapter} 章：${entry.state}`).join('\n'),
            }] : []
        } catch {
            return []
        }
    })
    const groups: Material[] = ([
        { label: '创作准则', dimensions: ['设定一致性', '文学质量'], sources: principles ? entitySources([principles], chapterNumber) : [] },
        { label: '本章大纲', dimensions: plot, sources: chapterOutline ? [{ ref: 'outline/outline', text: chapterOutline }] : [] },
        { label: '前文', dimensions: history, sources: entitySources(earlier, chapterNumber) },
        { label: '关键事件', dimensions: plot, sources: events ? entitySources([events], chapterNumber) : [] },
        { label: '伏笔档案', dimensions: plot, sources: entitySources(plots.filter(item =>
            ['planned_chapter', 'planted_chapter', 'resolved_chapter'].every(key => !(Number(item.frontmatter[key]) > chapterNumber))), chapterNumber) },
        { label: '人物设定', dimensions: people, sources: entitySources(characters, chapterNumber) },
        { label: '人物时间线', dimensions: people, sources: timelineSources, incomplete: timelineSources.length < characters.length },
        { label: '世界观', dimensions: setting, sources: entitySources(world, chapterNumber) },
    ] satisfies Material[]).filter(group => enabled(group.dimensions))

    const activeGroups = groups.filter(group => group.sources.some(source => source.text.trim().length > 0))
    let remaining = Math.floor(budget)
    const coverage = [`本章正文：全文；审稿维度：${(focus?.length ? focus : REVIEW_DIMENSIONS).join('、')}`]
    const materials: Material[] = []
    for (const group of groups) {
        const entries = group.sources.filter(source => source.text.trim().length > 0)
        if (entries.length === 0) {
            coverage.push(`${group.label}：缺少材料，待核对`)
            continue
        }
        const groupBudget = Math.floor(remaining / (activeGroups.length - materials.length))
        let available = groupBudget - `## ${group.label}\n\n`.length
        const sources: Source[] = []
        let cropped = false
        for (const { ref, text } of entries) {
            const overhead = `### ${ref}\n\n\n`.length
            if (available <= overhead) break
            const trimmed = text.trim()
            const excerpt = truncateCodePoints(trimmed, available - overhead)
            cropped ||= excerpt.length < trimmed.length
            sources.push({ ref, text: excerpt })
            available -= overhead + Array.from(excerpt).length
        }
        remaining -= sources.length > 0 ? groupBudget - available : 0
        cropped ||= sources.length < entries.length
        const limit = `${cropped ? '；材料已裁剪，未提供部分待核对' : ''}${group.incomplete ? '；部分人物缺少可用时间线，待核对' : ''}`
        coverage.push(`${group.label}：已提供 ${sources.length}/${entries.length} 处${limit}`)
        materials.push({ ...group, sources })
    }
    return { materials, coverage }
}

export function reviewWithEvidence(report: ReviewReport, chapter: WriterEntity, context: ReviewContext): ReviewReport {
    const suggestions = report.suggestions.map(({ evidence, ...suggestion }) => {
        const verified = evidence !== undefined && context.materials.some(group =>
            group.dimensions.some(dimension => dimension === suggestion.dimension) && group.sources.some(source =>
                source.ref === evidence.ref && source.text.includes(evidence.quote)))
        const needsVerification = suggestion.severity === 'high' && suggestion.dimension !== '文学质量'
            && (!verified || !suggestion.quote?.trim() || !chapter.content.includes(suggestion.quote))
        return needsVerification
            ? { ...suggestion, severity: 'medium' as const, needsVerification: true, ...(verified ? { evidence } : {}) }
            : { ...suggestion, ...(verified ? { evidence } : {}) }
    })
    return { ...report, suggestions, coverage: context.coverage }
}
