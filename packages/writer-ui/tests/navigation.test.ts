import test from 'node:test'
import assert from 'node:assert/strict'
import { chapterGroups, directoryPage, adjacentChapter } from '../src/client/navigation.ts'
import type { ChapterRow } from '../src/client/types.ts'

const chapters: ChapterRow[] = Array.from({ length: 150 }, (_, i) => ({ id: String(i + 1).padStart(3, '0'), number: i + 1, path: `chapters/${String(i + 1).padStart(3, '0')}.md`, title: `标题${i + 1}`, volume: '', chars: 10, status: '', storyline: '', preview: '', content: '正文' }))

test('目录：150 章无分卷自动分六组，精确章号跨组查找，每页最多八条', () => {
    const groups = chapterGroups(chapters)
    assert.equal(groups.length, 6)
    assert.equal(directoryPage(chapters, groups[0]!.id, '', 0).items.length, 8)
    assert.deepEqual(directoryPage(chapters, groups[0]!.id, '128', 0).items.map(row => row.id), ['128'])
    assert.equal(directoryPage(chapters, groups[0]!.id, '不存在', 0).total, 0)
    assert.equal(directoryPage(chapters, groups[0]!.id, '', 999).page, 3)
    assert.equal(directoryPage(chapters, groups[0]!.id, '', 999).items.length, 1)
})

test('目录：单卷百章分页、同名跨卷定位、有缺号前后章与首尾边界', () => {
    const volume = chapters.map(row => ({ ...row, volume: '第一卷' }))
    assert.equal(chapterGroups(volume).length, 1)
    assert.equal(directoryPage(volume, chapterGroups(volume)[0]!.id, '', 0).pages, 19)
    const sparse = [chapters[0]!, chapters[4]!, chapters[127]!]
    assert.equal(adjacentChapter(sparse, sparse[0]!.path, 1)?.id, '005')
    assert.equal(adjacentChapter(sparse, sparse[1]!.path, -1)?.id, '001')
    assert.equal(adjacentChapter(sparse, sparse[0]!.path, -1), null)
    assert.equal(adjacentChapter(sparse, sparse[2]!.path, 1), null)
})
