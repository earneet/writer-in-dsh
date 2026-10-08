/**
 * 人物状态时间线纯函数单测（P5：解析/追加/校验/倒序矛盾检测）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  appendTimelineEntry, detectTimelineInversions, parseTimeline, serializeTimeline, validateTimeline,
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
    assert.deepEqual(validateTimeline([entry('001', 'a'), entry('001', 'a2'), entry('004', 'b')]), [])
  })

  it('章锚非法 / state 空 / 章序倒序逐条报错', () => {
    const errors = validateTimeline([entry('1', 'a'), entry('002', '  '), entry('003', 'b'), entry('002', 'c')])
    assert.equal(errors.length, 3)
    assert.match(errors[0], /章节锚非法/)
    assert.match(errors[1], /state 为空/)
    assert.match(errors[2], /章序倒序/)
  })

  it('同章重复条目不算倒序（单调不减语义）', () => {
    assert.deepEqual(validateTimeline([entry('002', 'a'), entry('002', 'b')]), [])
  })
})

describe('detectTimelineInversions', () => {
  const character = (id: string, timeline: string | undefined): WriterEntity => ({
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
    const result = detectTimelineInversions(clean)
    assert.deepEqual(result.inversions, [])
    assert.deepEqual(result.malformed, [])
  })

  it('章序下降报告倒序对（含两侧章节锚）', () => {
    const bad = character('elin', JSON.stringify([entry('004', 'a'), entry('002', 'b')]))
    const result = detectTimelineInversions([bad])
    assert.equal(result.inversions.length, 1)
    assert.equal(result.inversions[0].characterId, 'elin')
    assert.equal(result.inversions[0].earlier.chapter, '004')
    assert.equal(result.inversions[0].later.chapter, '002')
  })

  it('非法 JSON 计入 malformed（不静默）', () => {
    const broken = character('elin', '{oops')
    const result = detectTimelineInversions([broken])
    assert.deepEqual(result.inversions, [])
    assert.equal(result.malformed.length, 1)
    assert.match(result.malformed[0].reason, /JSON 解析失败/)
  })
})

describe('serializeTimeline', () => {
  it('与 parseTimeline 往返无损', () => {
    const entries = [entry('001', '初出'), entry('002', '成长')]
    assert.deepEqual(parseTimeline(serializeTimeline(entries)), entries)
  })
})
