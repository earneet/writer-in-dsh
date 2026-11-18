import type { ChapterRow } from './types.ts'

export interface ChapterGroup {
    id: string
    label: string
    chapters: ChapterRow[]
}

export function chapterGroups(chapters: readonly ChapterRow[]): ChapterGroup[] {
    const groups: ChapterGroup[] = []
    const volumes = new Map<string, ChapterGroup>()
    const ungroupedTotal = chapters.filter(row => !row.volume).length
    let ungrouped = 0
    for (const chapter of chapters) {
        const index = chapter.volume ? 0 : Math.floor(ungrouped++ / 25)
        const id = chapter.volume ? `volume:${chapter.volume}` : `group:${index}`
        let group = volumes.get(id)
        if (group === undefined) {
            group = { id, label: chapter.volume || `正文 · 第 ${index * 25 + 1}—${Math.min((index + 1) * 25, ungroupedTotal)} 项`, chapters: [] }
            volumes.set(id, group)
            groups.push(group)
        }
        group.chapters.push(chapter)
    }
    return groups
}

export function directoryPage(chapters: readonly ChapterRow[], group: string, query: string, requestedPage: number) {
    const text = query.trim().toLocaleLowerCase()
    const numeric = /^\d+$/.test(text) ? Number(text) : null
    const rows = text.length > 0
        ? chapters.filter(row => numeric !== null ? row.number === numeric : row.title.toLocaleLowerCase().includes(text) || row.id.toLocaleLowerCase().includes(text))
        : chapterGroups(chapters).find(item => item.id === group)?.chapters ?? []
    const pages = Math.max(1, Math.ceil(rows.length / 8))
    const page = Math.max(0, Math.min(Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0, pages - 1))
    return { items: rows.slice(page * 8, page * 8 + 8), total: rows.length, pages, page }
}

export function adjacentChapter(chapters: readonly ChapterRow[], path: string, direction: -1 | 1): ChapterRow | null {
    const index = chapters.findIndex(row => row.path === path)
    return index < 0 ? null : chapters[index + direction] ?? null
}
