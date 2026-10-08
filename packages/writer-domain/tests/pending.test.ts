/**
 * pending.md 归档分区纯函数单测（P7：轮次 8 限制⑤清偿）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  partitionPendingByChapter, renderPending, sectionChapterIds, splitPendingSections,
} from '../src/index.ts'

const sample = [
  '# 待办清单',
  '',
  '## [维护 pass] chapter/001（2026-01-01T00:00:00Z）待人工确认',
  '- 摘要：第一章摘要',
  '- 人物状态建议：character/elin 第 001 章末 → 受伤（如属实请用 timeline_update 确认写入人物时间线）',
  '',
  '## [recompute mark] chapter/001 派生已标记过期——此前待办作废',
  '',
  '## [维护 pass] chapter/002（2026-01-02T00:00:00Z）待人工确认',
  '- 摘要：第二章摘要',
  '- 事实：事实B（人物：elin）',
].join('\n')

describe('splitPendingSections', () => {
  it('preamble 与节正确切分，正文含空行边界', () => {
    const { preamble, sections } = splitPendingSections(sample)
    assert.match(preamble, /# 待办清单/)
    assert.equal(sections.length, 3)
    assert.match(sections[0].header, /chapter\/001.*待人工确认/)
    assert.match(sections[0].body, /timeline_update/)
    assert.match(sections[1].header, /recompute mark/)
    assert.match(sections[2].header, /chapter\/002/)
  })

  it('空文本与无节文本', () => {
    assert.deepEqual(splitPendingSections(''), { preamble: '', sections: [] })
    const noSections = splitPendingSections('只有前言没有节')
    assert.equal(noSections.sections.length, 0)
    assert.match(noSections.preamble, /只有前言/)
  })
})

describe('sectionChapterIds', () => {
  it('头行与正文的 chapter/<id> 全部提取', () => {
    const ids = sectionChapterIds({ header: '## [维护 pass] chapter/003（t）', body: '- 涉及 chapter/004 的引用' })
    assert.deepEqual([...ids].sort(), ['003', '004'])
  })
})

describe('renderPending / partitionPendingByChapter', () => {
  it('按章归档：该章节移出、其余与 preamble 保留；再归档幂等（archived 空）', () => {
    const first = partitionPendingByChapter(sample, '001')
    assert.match(first.archived, /chapter\/001.*待人工确认/)
    assert.match(first.archived, /recompute mark.*chapter\/001/)
    assert.doesNotMatch(first.keep, /chapter\/001/)
    assert.match(first.keep, /# 待办清单/, 'preamble 保留')
    assert.match(first.keep, /chapter\/002/)
    const second = partitionPendingByChapter(first.keep, '001')
    assert.equal(second.archived, '', '二次归档无产出（幂等）')
    assert.equal(second.keep, first.keep)
  })

  it('归档后 keep 可被再次追加新节（renderPending 保证节间空行）', () => {
    const { keep } = partitionPendingByChapter(sample, '002')
    const reappended = `${keep}${keep.endsWith('\n') ? '' : '\n'}## [维护 pass] chapter/003（t）待人工确认\n- 新建议\n`
    const again = partitionPendingByChapter(reappended, '003')
    assert.match(again.archived, /chapter\/003/)
    assert.doesNotMatch(again.keep, /chapter\/003/)
  })

  it('章节 id 非三位序号抛错', () => {
    assert.throws(() => partitionPendingByChapter(sample, '1'), /三位序号/)
  })

  it('无归属章的节保留（不被误归档）', () => {
    const text = '## 通用待办\n- 与章节无关的事项\n'
    const { keep, archived } = partitionPendingByChapter(text, '001')
    assert.equal(archived, '')
    assert.match(keep, /通用待办/)
  })

  it('renderPending 往返：切分→重建不丢节', () => {
    const { preamble, sections } = splitPendingSections(sample)
    const rebuilt = renderPending(preamble, sections)
    const resplit = splitPendingSections(rebuilt)
    assert.equal(resplit.sections.length, 3)
    assert.match(resplit.sections[2].body, /事实B/)
  })
})
