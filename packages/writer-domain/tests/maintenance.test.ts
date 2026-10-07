/**
 * 维护 pass 纯函数单测：分节解析、引用存在性校验（拒收 + 按节重试语义）。
 * 运行：node --test packages/writer-domain/tests/maintenance.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseMaintenanceExtraction, validateExtractionSections,
  type ExtractionReferenceIndex,
} from '../src/maintenance.ts'

const REFS: ExtractionReferenceIndex = { chapters: ['001', '002'], characters: ['elin', 'kael'], plots: ['green-flame'] }

test('parseMaintenanceExtraction：合法 JSON 三节全收敛', () => {
  const parsed = parseMaintenanceExtraction(JSON.stringify({
    facts: [{ description: '绿焰只在雨夜显现', characters: ['elin'], plots: ['green-flame'] }],
    foreshadowEvents: [{ plot: 'green-flame', action: 'partial_reveal', note: '焰色转蓝' }],
    characterStates: [{ character: 'elin', state: '左手受伤' }],
  }))
  assert.notEqual(parsed, undefined)
  assert.equal(parsed!.facts!.length, 1)
  assert.equal(parsed!.foreshadowEvents![0].action, 'partial_reveal')
  assert.equal(parsed!.characterStates!.length, 1)
})

test('parseMaintenanceExtraction：栅栏包裹与寒暄前缀宽容提取', () => {
  const raw = '好的，以下是抽取结果：\n```json\n{"facts":[{"description":"a"}],"characterStates":[]}\n```\n以上。'
  const parsed = parseMaintenanceExtraction(raw)
  assert.notEqual(parsed, undefined)
  assert.equal(parsed!.facts!.length, 1)
  assert.deepEqual(parsed!.characterStates, [])
})

test('parseMaintenanceExtraction：非法 action / 缺 description 条目被丢弃', () => {
  const parsed = parseMaintenanceExtraction(JSON.stringify({
    facts: [{ description: '' }, { description: 'ok' }, 'not-object'],
    foreshadowEvents: [{ plot: 'green-flame', action: 'exploded' }],
  }))
  assert.notEqual(parsed, undefined)
  assert.equal(parsed!.facts!.length, 1)
  assert.equal(parsed!.foreshadowEvents!.length, 0, '非法 action 词汇丢弃')
})

test('parseMaintenanceExtraction：完全非 JSON 返回 undefined', () => {
  assert.equal(parseMaintenanceExtraction('这是正文，不是 JSON'), undefined)
  assert.equal(parseMaintenanceExtraction('[]'), undefined)
})

test('validateExtractionSections：引用不存在的实体被拒收并给出原因', () => {
  const result = validateExtractionSections({
    facts: [
      { description: '对', characters: ['elin'] },
      { description: '错引人物', characters: ['ghost'] },
    ],
    foreshadowEvents: [{ plot: 'no-such-plot', action: 'planted' }],
    characterStates: [{ character: 'elin', state: '疲惫' }],
  }, REFS)
  assert.equal(result.facts.entries.length, 1)
  assert.equal(result.facts.errors.length, 1)
  assert.match(result.facts.errors[0], /character\/ghost/)
  assert.equal(result.foreshadowEvents.entries.length, 0)
  assert.match(result.foreshadowEvents.errors[0], /plot\/no-such-plot/)
  assert.equal(result.characterStates.entries.length, 1)
  assert.equal(result.characterStates.errors.length, 0)
})

test('validateExtractionSections：空抽取全部通过（无信息章节）', () => {
  const result = validateExtractionSections({}, REFS)
  assert.deepEqual(result.facts.entries, [])
  assert.deepEqual(result.facts.errors, [])
  assert.deepEqual(result.foreshadowEvents.errors, [])
  assert.deepEqual(result.characterStates.errors, [])
})

test('validateExtractionSections：facts 双引用（人物+伏笔）都校验', () => {
  const result = validateExtractionSections({
    facts: [{ description: 'x', characters: ['elin'], plots: ['wrong'] }],
  }, REFS)
  assert.equal(result.facts.entries.length, 0)
  assert.match(result.facts.errors[0], /plot\/wrong/)
})
