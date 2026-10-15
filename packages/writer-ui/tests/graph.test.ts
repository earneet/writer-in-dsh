/**
 * buildEntityGraph 实体图单测（node --test 直测纯函数；M1a 验收面）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEntityGraph, coerceChapterNumber } from '../src/client/graph.ts'
import { buildOverview, type NovelScan } from '../src/client/project.ts'
import { paginate } from '../src/client/types.ts'

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

test('coerceChapterNumber：数字/数字串/中文数字/缺失', () => {
  assert.equal(coerceChapterNumber(12), 12)
  assert.equal(coerceChapterNumber('012'), 12)
  assert.equal(coerceChapterNumber('十二'), 12)
  assert.equal(coerceChapterNumber('一百零三'), 103)
  assert.equal(coerceChapterNumber('卷一'), null)
  assert.equal(coerceChapterNumber(undefined), null)
})

test('章号 coerce 排序：字符串/中文数字/缺失回退数字文件名（原实现归 0 退化）', () => {
  const graph = buildEntityGraph({
    ...baseScan,
    chapters: [
      { name: '012.md', frontmatter: {}, content: '' },            // 无 number → id 回退 12
      { name: 'ch3.md', frontmatter: { number: '三' }, content: '' }, // 中文数字 → 3
      { name: '002.md', frontmatter: { number: '002' }, content: '' }, // 字符串序号 → 2
      { name: '001.md', frontmatter: { number: 1 }, content: '' },   // 数字 → 1
    ],
  })
  assert.deepEqual(graph.chapters.map(c => c.id), ['001', '002', 'ch3', '012'])
  assert.deepEqual(graph.chapters.map(c => c.number), [1, 2, 3, 12])
  // 章号 ↔ 章节索引
  assert.equal(graph.indexes.chapterByNumber.get(3)?.id, 'ch3')
  assert.equal(graph.indexes.chapterByNumber.has(0), false)
})

test('一层卷子目录：subdir 补 volume 兜底与 path 前缀', () => {
  const graph = buildEntityGraph({
    ...baseScan,
    chapters: [
      { name: '001.md', frontmatter: {}, content: '', subdir: '卷一' },
      { name: '002.md', frontmatter: { volume: '外传' }, content: '', subdir: '卷一' },
    ],
  })
  assert.equal(graph.chapters[0]!.volume, '卷一')       // frontmatter 缺失回退子目录名
  assert.equal(graph.chapters[0]!.path, 'chapters/卷一/001.md')
  assert.equal(graph.chapters[1]!.volume, '外传')       // frontmatter 优先
})

test('Plot 字段级纳入：planned/planted/resolved coerce + milestones', () => {
  const graph = buildEntityGraph({
    ...baseScan,
    plots: [
      {
        name: 'mirror.md',
        frontmatter: {
          status: 'resolved', hint: '镜子', planned_chapter: 2, planted_chapter: 3, resolved_chapter: '005',
          milestones: JSON.stringify([{ type: 'partial_reveal', chapter: '003', note: '半遮半掩' }]),
        },
        content: '',
      },
    ],
  })
  const plot = graph.plots[0]!
  assert.equal(plot.plannedChapter, '002')   // 数字 2 → 三位序号 "002"
  assert.equal(plot.plantedChapter, '003')
  assert.equal(plot.resolvedChapter, '005')
  assert.deepEqual(plot.milestones, [{ type: 'partial_reveal', chapter: '003', note: '半遮半掩' }])
  // 伏笔 ↔ 种植/回收章双向索引（planted 落点回退 planned）
  assert.deepEqual(graph.indexes.plotsByChapter.get(3)?.planted.map(p => p.id), ['mirror'])
  assert.deepEqual(graph.indexes.plotsByChapter.get(5)?.resolved.map(p => p.id), ['mirror'])
  // 坏 milestones → 告警不抛错
  const bad = buildEntityGraph({ ...baseScan, plots: [{ name: 'x.md', frontmatter: { milestones: '{oops' }, content: '' }] })
  assert.equal(bad.plots[0]!.milestones.length, 0)
  assert.equal(bad.warnings.some(w => w.includes('plot/x：milestones 解析失败')), true)
})

test('timeline：JSON 字符串双形态 + 数字 chapter 补零 coerce + domain 校验告警', () => {
  const graph = buildEntityGraph({
    ...baseScan,
    characters: [
      {
        name: 'su-mian.md',
        // 示例项目实际存放形态：JSON 内联字符串；chapter 为数字（domain 脏值）→ coerce 补零
        frontmatter: { timeline: JSON.stringify([{ chapter: 2, state: '交稿' }, { chapter: '001', state: '登场' }]) },
        content: '',
      },
      { name: 'bad.md', frontmatter: { timeline: '{broken' }, content: '' },
    ],
  })
  const su = graph.characters[0]!
  // 落盘顺序保留；数字 chapter coerce 为 "002"（domain 三位序号约定），未知字段丢弃
  assert.deepEqual(su.timeline, [{ chapter: '002', state: '交稿' }, { chapter: '001', state: '登场' }])
  // domain validateTimeline 章序倒序告警（与服务端 writer_stats 同口径，不静默）
  assert.equal(graph.warnings.some(w => w.includes('su-mian') && w.includes('章序倒序')), true)
  // 坏 JSON → 告警 + 空 timeline
  assert.deepEqual(graph.characters[1]!.timeline, [])
  assert.equal(graph.warnings.some(w => w.includes('characters/bad：timeline JSON 解析失败')), true)
})

test('关系反查索引：名字与 id 双键（frontmatter 结构化 + 正文小节合并）', () => {
  const graph = buildEntityGraph({
    ...baseScan,
    characters: [
      {
        name: 'su-mian.md',
        frontmatter: { name: '苏眠', relations: [{ name: '周宁', relation: '挚友' }] },
        content: '## 关系\n\n- **林芝雅**：委托人\n',
      },
      { name: 'zhou-ning.md', frontmatter: { name: '周宁' }, content: '' },
    ],
  })
  // 按名字反查：谁声明与「周宁」有关系
  assert.deepEqual(graph.indexes.relationsByTarget.get('周宁'), [{ owner: 'su-mian', name: '周宁', desc: '挚友' }])
  // 按 id 反查（其他实体引用 id 的形态）
  assert.deepEqual(graph.indexes.relationsByTarget.get('zhou-ning')?.map(e => e.owner), ['su-mian'])
  // 正文「## 关系」小节补充进边（与 overview 同源解析）
  assert.deepEqual(graph.indexes.relationsByTarget.get('林芝雅'), [{ owner: 'su-mian', name: '林芝雅', desc: '委托人' }])
})

test('大纲节点章号锚 ↔ 章节联动', () => {
  const graph = buildEntityGraph({
    ...baseScan,
    chapters: [{ name: '002.md', frontmatter: { number: 2 }, content: '' }],
    outline: { frontmatter: { synopsis: '梗概' }, content: '# 大纲\n\n## 第一卷\n\n总述\n\n## 第 2 章 夜航\n\n本章要点\n' },
  })
  assert.notEqual(graph.outline, null)
  const node = graph.indexes.outlineByChapterNumber.get(2)
  assert.notEqual(node, undefined)
  assert.equal(node!.title, '第 2 章 夜航')
  assert.equal(node!.body, '本章要点')
  // 卷小节无章号锚，不入索引
  assert.equal(graph.indexes.outlineByChapterNumber.has(1), false)
})

test('扫描缺口四实体 + worldbuilding 名单（对照 KIND_LAYOUT）', () => {
  const graph = buildEntityGraph({
    ...baseScan,
    principles: { frontmatter: {}, content: '# 准则\n\n## 红线\n\n不写超自然\n' },
    events: { frontmatter: {}, content: '# 事件\n\n## 第 1 章 灯塔失窃\n\n描述\n' },
    ideas: { frontmatter: {}, content: '# 灵感\n\n- 桥段：雨夜站台\n' },
    style: [{ name: 'lyric.md', frontmatter: {}, content: '## 示范\n\n一段语感\n' }],
    worldbuildingNames: ['city.md'],
    worldbuildingCount: 1,
  })
  assert.deepEqual(graph.principles?.sections.map(s => s.title), ['红线'])
  assert.deepEqual(graph.events?.sections.map(s => s.title), ['第 1 章 灯塔失窃'])
  assert.deepEqual(graph.ideas?.sections.map(s => s.title), ['简介'])
  assert.deepEqual(graph.styleRefs.map(s => s.id), ['lyric'])
  assert.deepEqual(graph.worldEntries, [{ id: 'city' }])
  // 缺省（旧扫描形状）不炸
  const empty = buildEntityGraph(baseScan)
  assert.equal(empty.principles, null)
  assert.equal(empty.events, null)
  assert.equal(empty.ideas, null)
  assert.deepEqual(empty.styleRefs, [])
})

test('paginate：cursor 分页参数位（id 稳定序）', () => {
  const items = [{ id: '001' }, { id: '002' }, { id: '003' }, { id: '004' }]
  const first = paginate(items, { limit: 2 })
  assert.deepEqual(first, { items: [{ id: '001' }, { id: '002' }], nextCursor: '003' })
  const second = paginate(items, { limit: 2, cursor: first.nextCursor })
  assert.deepEqual(second, { items: [{ id: '003' }, { id: '004' }], nextCursor: null })
  // 未知 cursor 返回空页（与「缺省从头」可区分，防循环重放首页）；limit 缺省取全量
  assert.deepEqual(paginate(items, { cursor: 'nope' }), { items: [], nextCursor: null })
  assert.deepEqual(paginate(items, {}).nextCursor, null)
})

test('跨卷同名章号冲突不静默（章号索引取首者 + 告警）', () => {
  const graph = buildEntityGraph({
    ...baseScan,
    chapters: [
      { name: '001.md', frontmatter: { number: 1 }, content: '', subdir: '卷一' },
      { name: '001.md', frontmatter: { number: 1 }, content: '', subdir: '卷二' },
    ],
  })
  assert.equal(graph.chapters.length, 2)
  assert.equal(graph.indexes.chapterByNumber.get(1)?.path, 'chapters/卷一/001.md')
  assert.equal(graph.warnings.some(w => w.includes('章号 1 与 chapters/卷一/001.md 冲突')), true)})

test('纯数字串章锚与数字统一补零（"2" 与 2 同命 → "002"）', () => {
  const graph = buildEntityGraph({
    ...baseScan,
    plots: [{ name: 'p.md', frontmatter: { planted_chapter: '2', planned_chapter: 2 }, content: '' }],
    characters: [{ name: 'c.md', frontmatter: { timeline: JSON.stringify([{ chapter: '2', state: '登场' }]) }, content: '' }],
  })
  assert.equal(graph.plots[0]!.plannedChapter, '002')
  assert.equal(graph.plots[0]!.plantedChapter, '002')
  assert.equal(graph.characters[0]!.timeline[0]!.chapter, '002')
  // 补零后满足 domain 三位序号校验：无「章节锚非法」告警
  assert.equal(graph.warnings.some(w => w.includes('章节锚非法')), false)
})

test('卷子目录章节进入面板总览（M1b 起 volume 回退子目录名——修复性纳入的口径锁定）', () => {
  const overview = buildOverview({
    ...baseScan,
    chapters: [{ name: '001.md', frontmatter: { title: '夜航' }, content: '正文', subdir: '卷一' }],
  })
  assert.equal(overview.chapters, 1)
  assert.equal(overview.chapterRows[0]!.id, '001')
  assert.equal(overview.chapterRows[0]!.volume, '卷一')
  assert.deepEqual(overview.volumes, [{ name: '卷一', count: 1 }])
})
