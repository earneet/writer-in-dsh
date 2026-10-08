/**
 * 人物状态时间线纯函数单测（P5：解析/追加/校验/倒序矛盾检测）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  appendTimelineEntry, arcCoverageOf, inspectTimelines, parseTimeline, serializeTimeline, validateTimeline,
  type CharacterTimelineEntry, type WriterEntity,
} from '../src/index.ts'

function entry(chapter: string, state: string): CharacterTimelineEntry {
  return { chapter, state }
}

describe('parseTimeline', () => {
  it('缺失/空串返回空数组', () => {
    assert.deepEqual(parseTimeline(undefined), [])
    assert.deepEqual(parseTimeline(''), [])
  })

  it('合法 JSON 数组按序解析', () => {
    const raw = JSON.stringify([{ chapter: '001', state: '初出茅庐' }, { chapter: '003', state: '受伤' }])
    assert.deepEqual(parseTimeline(raw), [entry('001', '初出茅庐'), entry('003', '受伤')])
  })

  it('非法 JSON / 非数组 / 缺字段抛错', () => {
    assert.throws(() => parseTimeline('{bad'), /JSON 解析失败/)
    assert.throws(() => parseTimeline('"text"'), /必须是 JSON 数组/)
    assert.throws(() => parseTimeline('[{"chapter":"001"}]'), /缺少 state/)
    assert.throws(() => parseTimeline('[42]'), /非对象/)
  })

  it('非字符串类型（数字等脏值）抛错', () => {
    assert.throws(() => parseTimeline(5), /必须是 JSON 字符串/)
  })
})

describe('appendTimelineEntry', () => {
  it('空时间线追加首条', () => {
    assert.deepEqual(appendTimelineEntry([], entry('002', '觉醒')), [entry('002', '觉醒')])
  })

  it('按章号升序插入中间条目', () => {
    const base = [entry('001', '初出'), entry('003', '受伤')]
    assert.deepEqual(
      appendTimelineEntry(base, entry('002', '成长')),
      [entry('001', '初出'), entry('002', '成长'), entry('003', '受伤')],
    )
  })

  it('同章覆盖（改稿后刷新该章状态）且其余条目不动', () => {
    const base = [entry('001', '初出'), entry('002', '旧状态')]
    assert.deepEqual(
      appendTimelineEntry(base, entry('002', '新状态')),
      [entry('001', '初出'), entry('002', '新状态')],
    )
  })

  it('章锚非法 / state 空白抛错', () => {
    assert.throws(() => appendTimelineEntry([], entry('2', 'x')), /章节锚非法/)
    assert.throws(() => appendTimelineEntry([], entry('a02', 'x')), /章节锚非法/)
    assert.throws(() => appendTimelineEntry([], entry('002', '   ')), /state 不能为空/)
  })

  it('现有时间线自身非法时拒绝追加（不毒化）', () => {
    const bad = [entry('003', 'a'), entry('001', 'b')]
    assert.throws(() => appendTimelineEntry(bad, entry('002', 'x')), /拒绝追加/)
  })

  it('state 两端空白被裁剪', () => {
    assert.deepEqual(appendTimelineEntry([], entry('001', '  状态  ')), [entry('001', '状态')])
  })
})

describe('validateTimeline', () => {
  it('合法时间线返回空错误清单', () => {
    assert.deepEqual(validateTimeline([entry('001', 'a'), entry('002', 'a2'), entry('004', 'b')]), [])
  })

  it('章锚非法 / state 空 / 章序倒序 / 同章重复逐条报错', () => {
    const errors = validateTimeline([entry('1', 'a'), entry('002', '  '), entry('003', 'b'), entry('002', 'c')])
    assert.equal(errors.length, 4)
    assert.match(errors[0], /章节锚非法/)
    assert.match(errors[1], /state 为空/)
    assert.match(errors[2], /章节锚重复/)
    assert.match(errors[3], /章序倒序/)
  })

  it('同章重复条目报错（append 同章覆盖语义隐含每章唯一）', () => {
    assert.equal(validateTimeline([entry('002', 'a'), entry('002', 'b')]).length, 1)
  })
})

describe('inspectTimelines', () => {
  const character = (id: string, timeline: string | number | undefined): WriterEntity => ({
    kind: 'character',
    id,
    path: `characters/${id}.md`,
    frontmatter: timeline === undefined ? {} : { timeline },
    content: '',
    hash: 'x',
  })

  it('无 timeline / 单调时间线无矛盾', () => {
    const clean = [
      character('elin', undefined),
      character('kael', JSON.stringify([entry('001', 'a'), entry('003', 'b')])),
    ]
    const result = inspectTimelines(clean)
    assert.deepEqual(result.inversions, [])
    assert.deepEqual(result.malformed, [])
    assert.deepEqual(result.invalid, [])
  })

  it('章序下降报告倒序对（相邻对语义：003→001→002 只报 003→001 一对）', () => {
    const bad = character('elin', JSON.stringify([entry('003', 'a'), entry('001', 'b'), entry('002', 'c')]))
    const result = inspectTimelines([bad])
    assert.equal(result.inversions.length, 1)
    assert.equal(result.inversions[0].characterId, 'elin')
    assert.equal(result.inversions[0].earlier.chapter, '003')
    assert.equal(result.inversions[0].later.chapter, '001')
  })

  it('非法 JSON / 非字符串脏值计入 malformed（不静默）', () => {
    const broken = [character('elin', '{oops'), character('kael', 5)]
    const result = inspectTimelines(broken)
    assert.deepEqual(result.inversions, [])
    assert.equal(result.malformed.length, 2)
    assert.match(result.malformed[0].reason, /JSON 解析失败/)
    assert.match(result.malformed[1].reason, /必须是 JSON 字符串/)
  })

  it('JSON 合法但条目非法（章锚脏/同章重复/state 空）计入 invalid——堵形状脏值逃逸', () => {
    const bad = character('elin', JSON.stringify([entry('2', 'a'), entry('004', 'b'), entry('004', 'c'), entry('005', '  ')]))
    const result = inspectTimelines([bad])
    assert.deepEqual(result.malformed, [])
    assert.equal(result.invalid.length, 1)
    assert.equal(result.invalid[0].characterId, 'elin')
    assert.equal(result.invalid[0].errors.length, 3, '章锚非法 + 同章重复 + state 空')
  })
})

describe('arcCoverageOf', () => {
  const character = (id: string, timeline: string | undefined): WriterEntity => ({
    kind: 'character',
    id,
    path: `characters/${id}.md`,
    frontmatter: timeline === undefined ? {} : { timeline },
    content: '',
    hash: 'x',
  })

  it('无人物时零覆盖不炸', () => {
    assert.deepEqual(arcCoverageOf([]), { withTimeline: 0, characters: 0, entries: 0, arcs: [], broken: [] })
  })

  it('空 timeline / 有 timeline / 非法 timeline 三分支：坏值不毒化其余统计', () => {
    const result = arcCoverageOf([
      character('empty', undefined),
      character('elin', JSON.stringify([entry('001', 'a'), entry('003', 'b')])),
      character('bad', '{oops'),
    ])
    assert.equal(result.withTimeline, 1)
    assert.equal(result.characters, 3)
    assert.equal(result.entries, 2)
    assert.deepEqual(result.broken, ['bad'])
    assert.deepEqual(result.arcs, [
      { id: 'empty', count: 0 },
      { id: 'elin', lastChapter: '003', count: 2 },
      { id: 'bad', count: 0 },
    ])
  })

  it('lastChapter 取最大章号（倒序落盘数据不误导展示）；全脏章锚留 undefined', () => {
    const result = arcCoverageOf([character('elin', JSON.stringify([entry('005', 'a'), entry('002', 'b')]))])
    assert.equal(result.arcs[0].lastChapter, '005')
    const dirty = arcCoverageOf([character('kael', JSON.stringify([entry('2', 'a'), entry('x', 'b')]))])
    assert.equal(dirty.arcs[0].lastChapter, undefined, '全脏章锚不展示「至第 000 章」式误导')
    assert.equal(dirty.withTimeline, 1)
  })

  it('倒序只进 inversions 不在 invalid 双报（同因文本行被剔除）', () => {
    const result = inspectTimelines([character('elin', JSON.stringify([entry('004', 'a'), entry('002', 'b')]))])
    assert.equal(result.inversions.length, 1)
    assert.equal(result.invalid.length, 0, '章序倒序不重复出现在 invalid')
  })

  it('倒序被脏锚隔断仍上报（prev 链跨脏锚延续，两通道不双漏）', () => {
    const result = inspectTimelines([character('elin', JSON.stringify([entry('005', 'a'), entry('x', 'b'), entry('003', 'c')]))])
    assert.equal(result.inversions.length, 1, '005→003 跨脏锚倒退仍被上报')
    assert.equal(result.inversions[0].earlier.chapter, '005')
    assert.equal(result.inversions[0].later.chapter, '003')
    assert.equal(result.invalid.length, 1, '脏锚本身进 invalid')
    assert.match(result.invalid[0].errors.join('；'), /章节锚非法/)
  })
})

describe('serializeTimeline', () => {
  it('与 parseTimeline 往返无损', () => {
    const entries = [entry('001', '初出'), entry('002', '成长')]
    assert.deepEqual(parseTimeline(serializeTimeline(entries)), entries)
  })
})
