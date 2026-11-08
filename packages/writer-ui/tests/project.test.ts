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

test('大纲树：卷→幕→章分型嵌套 + 章节叶联动已写状态 + 未锚定章节回填', () => {
  const overview = buildOverview({
    ...baseScan,
    outline: {
      frontmatter: {},
      content: [
        '# 大纲',
        '## 第一卷 启程',
        '开局设定。',
        '### 第一幕 逃离',
        '幕级铺垫。',
        '#### 第 1 章 灯塔',
        '章级节拍 A。',
        '#### 第 2 章 海雾',
        '章级节拍 B。',
        '## 第二卷 归途',
        '卷级走向。',
        '### 第 5 章 归航',
        '章级节拍 C。',
      ].join('\n'),
    },
    chapters: [
      { name: '001.md', frontmatter: { number: 1, title: '灯塔' }, content: '正文一' },
      { name: '002.md', frontmatter: { number: 2, title: '海雾' }, content: '正文二' },
      { name: '009.md', frontmatter: { number: 9, title: '番外' }, content: '正文九' },
    ],
  })
  // 树形：卷一 > 幕一 > 章 1/2；卷二 > 章 5（无幕直挂卷）
  const [vol1, vol2] = overview.outlineTree
  assert.equal(vol1!.kind, 'volume')
  assert.equal(vol1!.title, '第一卷 启程')
  const [act1] = vol1!.children
  assert.equal(act1!.kind, 'act')
  assert.equal(act1!.title, '第一幕 逃离')
  assert.deepEqual(act1!.children.map(c => c.kind), ['chapter', 'chapter'])
  assert.deepEqual(act1!.children.map(c => c.chapterNumber), [1, 2])
  // 章节叶联动：1/2 已写（带字数），5 未写（written=null）
  assert.equal(act1!.children[0]!.written!.title, '灯塔')
  assert.equal(vol2!.children[0]!.written, null)
  assert.equal(vol2!.children[0]!.chapterNumber, 5)
  // 009 无大纲锚 → 未锚定回填区
  assert.deepEqual(overview.unanchoredChapters.map(c => c.id), ['009'])
})

test('大纲树容器分型边界：连续幕为兄弟不嵌套；幕前无卷挂根；章在容器前平铺根', () => {
  const overview = buildOverview({
    ...baseScan,
    outline: {
      frontmatter: {},
      content: [
        '## 第 1 章 开局',
        '章在一切容器前。',
        '## 第一幕 无根之幕',
        '幕 A。',
        '## 第二幕 兄弟幕',
        '幕 B。',
        '## 第 2 章 入幕',
        '入幕章。',
      ].join('\n'),
    },
  })
  // 根层：章1、幕A、幕B（兄弟），幕B 下挂章 2
  assert.deepEqual(overview.outlineTree.map(n => n.kind), ['chapter', 'act', 'act'])
  assert.deepEqual(overview.outlineTree[1]!.children.map(n => n.title), [])
  assert.deepEqual(overview.outlineTree[2]!.children.map(n => n.title), ['第 2 章 入幕'])
})

test('大纲切分：平铺 ### 第 N 章（无 ## 上级）也能成节点（与 splitSections ## 切分的行为差异点）', () => {
  const overview = buildOverview({
    ...baseScan,
    outline: { frontmatter: {}, content: '### 第 3 章 孤章\n\n节拍。\n' },
  })
  assert.equal(overview.outlineTree.length, 1)
  assert.equal(overview.outlineTree[0]!.kind, 'chapter')
  assert.equal(overview.outlineTree[0]!.chapterNumber, 3)
})

test('worldbuilding 标题三级回退：frontmatter.name > 正文首标题 > id', () => {
  const mk = (fm: object, content: string) => buildOverview({
    ...baseScan,
    worldbuilding: [{ name: 'city.md', frontmatter: fm, content }],
    worldbuildingCount: 1,
  })
  assert.equal(mk({ name: '雾都志' }, '# 无关标题\n').worldRows[0]!.title, '雾都志')
  assert.equal(mk({}, '# 雾都\n\n## 街区\n\nx\n').worldRows[0]!.title, '雾都')
  assert.equal(mk({}, '无标题正文').worldRows[0]!.title, 'city')
})

test('设定面投影：灵感/准则/事件/世界观/风格直通总览', () => {
  const overview = buildOverview({
    ...baseScan,
    principles: { frontmatter: {}, content: '## 红线\n\n不写超自然\n' },
    ideas: { frontmatter: {}, content: '## 雨夜站台\n\n桥段一枚\n' },
    events: { frontmatter: {}, content: '## 事件\n\n灯塔失窃\n' },
    style: [{ name: 'lyric.md', frontmatter: {}, content: '## 示范\n\n一段语感\n' }],
    worldbuilding: [{ name: 'city.md', frontmatter: {}, content: '# 雾都\n\n## 街区\n\n港口常年封冻\n' }],
    worldbuildingCount: 1,
  })
  assert.deepEqual(overview.ideas?.map(s => s.title), ['雨夜站台'])
  assert.deepEqual(overview.principles?.map(s => s.title), ['红线'])
  assert.deepEqual(overview.events?.map(s => s.title), ['事件'])
  assert.equal(overview.worldRows.length, 1)
  assert.equal(overview.worldRows[0]!.title, '雾都')
  assert.deepEqual(overview.styleRows.map(s => s.id), ['lyric'])
})

test('人物反查关系：他人档案声明的边进 reverseRelations（自己声明的不重复计）', () => {
  const overview = buildOverview({
    ...baseScan,
    characters: [
      { name: 'elin.md', frontmatter: { name: '艾琳' }, content: '' },
      { name: 'kai.md', frontmatter: { name: '凯', relations: [{ name: '艾琳', desc: '宿敌' }] }, content: '' },
    ],
  })
  const elin = overview.characterRows.find(c => c.id === 'elin')!
  assert.deepEqual(elin.reverseRelations, [{ name: '凯', desc: '宿敌' }])
  const kai = overview.characterRows.find(c => c.id === 'kai')!
  assert.deepEqual(kai.reverseRelations, [])
})

test('伏笔生命周期锚投影：planted/milestones/resolved 进行数据', () => {
  const overview = buildOverview({
    ...baseScan,
    plots: [{
      name: 'p1.md',
      frontmatter: {
        status: 'planted', planned_chapter: '004', planted_chapter: '002', resolved_chapter: '',
        milestones: '[{"type":"reinforcement","chapter":"003","note":"雨夜重提"}]',
      },
      content: '',
    }],
  })
  const p = overview.plotRows[0]!
  assert.equal(p.plannedChapter, '004')
  assert.equal(p.plantedChapter, '002')
  assert.equal(p.resolvedChapter, '')
  assert.deepEqual(p.milestones, [{ type: 'reinforcement', chapter: '003', note: '雨夜重提' }])
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
  // v9：正文全文进 ChapterRow（章节页签阅读面）
  assert.equal(overview.chapterRows.find(c => c.id === '001')!.content, '两个字')
  assert.equal(overview.pendingLineTotal, 2)
  assert.equal(overview.nextStep.kind, 'next-chapter')
})
