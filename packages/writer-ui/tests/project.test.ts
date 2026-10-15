/**
 * 实体图投影与决策面计算单测（M1b）：伏笔三色/风险排序/逾期、情境卡、扫描侧新字段直通。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOverview, nextStepOf, plotRiskOf } from '../src/client/project.ts'
import type { NovelScan } from '../src/client/overview.ts'

const baseScan: NovelScan = {
  root: 'novel',
  project: null,
  outline: null,
  chapters: [],
  plots: [],
  characters: [],
  worldbuildingCount: 0,
  pending: [],
}

test('伏笔三色与风险排序：超期红 > 活跃黄 > 未种植灰 > 已收束；近的先看', () => {
  const overview = buildOverview({
    ...baseScan,
    // 当前章 = 3
    chapters: [{ name: '001.md', frontmatter: { number: 1 }, content: '一' }, { name: '003.md', frontmatter: { number: 3 }, content: '三' }],
    plots: [
      { name: 'resolved-p.md', frontmatter: { status: 'resolved' }, content: '' },
      { name: 'future-p.md', frontmatter: { status: 'planned', planned_chapter: '009' }, content: '' },
      { name: 'active-p.md', frontmatter: { status: 'planted', planned_chapter: '005' }, content: '' },
      { name: 'late-p.md', frontmatter: { status: 'planted', planned_chapter: '001' }, content: '' },
      { name: 'overdue-gray.md', frontmatter: { status: 'planned', planned_chapter: '002' }, content: '' },
    ],
  })
  assert.equal(overview.currentChapter, 3)
  assert.deepEqual(overview.riskSummary, { red: 1, yellow: 1, gray: 2 })
  // 排序：红（late）> 黄（active）> 灰（overdue-gray 差值 1 先于 future 差值 6）> none
  assert.deepEqual(overview.plotRows.map(p => p.id), ['late-p', 'active-p', 'overdue-gray', 'future-p', 'resolved-p'])
  const late = overview.plotRows[0]!
  assert.equal(late.risk, 'red')
  assert.equal(late.overdue, true)
  assert.equal(late.dueDelta, -2)
  const gray = overview.plotRows[2]!
  assert.equal(gray.risk, 'gray')
  assert.equal(gray.overdue, true) // planned 且计划章已过 = 逾期未种植
})

test('plotRiskOf：无章节（current=null）不做逾期判定，planted 仍计黄档', () => {
  assert.deepEqual(plotRiskOf({ status: 'planted', plannedChapter: '001' }, null), { level: 'yellow', overdue: false, dueDelta: null })
  assert.deepEqual(plotRiskOf({ status: 'planned', plannedChapter: '001' }, null), { level: 'gray', overdue: false, dueDelta: null })
  assert.deepEqual(plotRiskOf({ status: 'abandoned', plannedChapter: '001' }, 5), { level: 'none', overdue: false, dueDelta: -4 })
})

test('plotRiskOf：停滞窗口（milestone 停滞=黄；新鲜 planted 不计风险档）', () => {
  // 新鲜：planted_chapter 002、current 3（距 1 章 ≤ 3）→ none
  assert.equal(plotRiskOf({ status: 'planted', plannedChapter: '', plantedChapter: '002' }, 3).level, 'none')
  // 停滞：planted_chapter 001、current 5（距 4 章 > 3）→ yellow
  assert.equal(plotRiskOf({ status: 'planted', plannedChapter: '', plantedChapter: '001' }, 5).level, 'yellow')
  // 最后 milestone 拉新停滞锚：planted 001 + milestone 004、current 5（距 1 章）→ none
  assert.equal(plotRiskOf({ status: 'planted', plannedChapter: '', plantedChapter: '001', milestones: [{ chapter: '004' }] }, 5).level, 'none')
  // milestone 也停了：最后 milestone 001、current 5 → yellow（「最后一次被触摸是哪章」）
  assert.equal(plotRiskOf({ status: 'planted', plannedChapter: '009', plantedChapter: '001', milestones: [{ chapter: '001' }] }, 5).level, 'yellow')
})

test('nextStepOf：章节全无章号锚时如实降级（不给「写第 1 章」的矛盾建议）', () => {
  const step = nextStepOf({
    chapters: 2, outline: { synopsis: '', volumes: 1, chapterTarget: 10, sections: [] },
    currentChapter: null, staleChapters: [], riskSummary: { red: 0 },
  })
  assert.equal(step.kind, 'next-chapter')
  assert.equal(step.title, '写下一章')
  assert.match(step.hint, /缺章号锚/)
})

test('情境卡：无大纲→规划；有纲无章→首章；待维护→维护；否则→下一章（含红伏笔提示）', () => {
  const none = nextStepOf({ chapters: 0, outline: null, currentChapter: null, staleChapters: [], riskSummary: { red: 0 } })
  assert.equal(none.kind, 'outline')
  const first = nextStepOf({ chapters: 0, outline: { synopsis: '', volumes: 1, chapterTarget: 10, sections: [] }, currentChapter: null, staleChapters: [], riskSummary: { red: 0 } })
  assert.equal(first.kind, 'first-chapter')
  const maintain = nextStepOf({ chapters: 3, outline: { synopsis: '', volumes: 1, chapterTarget: 10, sections: [] }, currentChapter: 3, staleChapters: ['002', '003'], riskSummary: { red: 0 } })
  assert.equal(maintain.kind, 'maintain')
  assert.match(maintain.hint, /002、003/)
  const next = nextStepOf({ chapters: 3, outline: { synopsis: '', volumes: 1, chapterTarget: 10, sections: [] }, currentChapter: 3, staleChapters: [], riskSummary: { red: 2 } })
  assert.equal(next.kind, 'next-chapter')
  assert.equal(next.title, '写第 4 章')
  assert.match(next.hint, /2 个伏笔已超期/)
})

test('扫描侧新字段直通：staleChapters/failedFiles/pendingArchive/nextStep 进总览', () => {
  const overview = buildOverview({
    ...baseScan,
    outline: { frontmatter: { synopsis: 's' }, content: '# 大纲\n\n## 一览\n\n- x\n' },
    chapters: [{ name: '002.md', frontmatter: { number: 2 }, content: '二' }],
    staleChapters: ['002'],
    failedFiles: ['chapters/002.md'],
    pendingArchive: [{ heading: '[已归档] chapter/003', lines: ['- 旧建议'] }],
  })
  assert.deepEqual(overview.staleChapters, ['002'])
  assert.deepEqual(overview.failedFiles, ['chapters/002.md'])
  assert.equal(overview.pendingArchive.length, 1)
  assert.equal(overview.nextStep.kind, 'maintain')
})

test('换源等价抽查：基础聚合字段与 v5 口径一致（标题/进度/卷分组/最近章节/待办）', () => {
  const overview = buildOverview({
    ...baseScan,
    project: { title: '长夜有歌', genre: '都市', target_words: 1000, chapters: 10 },
    chapters: [
      { name: '002.md', frontmatter: { number: 2, title: '夜航', volume: '第一卷' }, content: '四个字' },
      { name: '001.md', frontmatter: { number: 1, title: '守灯', volume: '第一卷' }, content: '两个字' },
    ],
    outline: { frontmatter: {}, content: '# 大纲\n\n## 一览\n\n- x\n' },
    pending: [{ heading: '待办', lines: ['a', 'b'] }],
  })
  assert.equal(overview.title, '长夜有歌')
  assert.equal(overview.totalChars, 6)
  assert.equal(overview.progress, 6 / 1000)
  assert.deepEqual(overview.volumes, [{ name: '第一卷', count: 2 }])
  assert.deepEqual(overview.recentChapters.map(c => c.id), ['002', '001'])
  assert.equal(overview.pendingLineTotal, 2)
  assert.equal(overview.nextStep.kind, 'next-chapter')
})
