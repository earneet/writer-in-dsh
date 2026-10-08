/**
 * P3 引擎纯逻辑单测：分节重试决策、章节区间解析、维护/一致性提示词。
 * 运行：node --test packages/writer-engine/tests/p3.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseChapterRange, planSectionRetry } from '../src/logic.ts'
import { renderPendingSection } from '../src/index.ts'
import {
  buildConsistencySystemPrompt, buildExtractionUserPrompt, buildSummarySystemPrompt,
} from '../src/prompts.ts'
import type { MaintenanceDerived, WriterEntity } from 'dsh-writer-domain'

const noErrors = { errors: [] as string[] }

test('planSectionRetry：有拒收的节进入重试清单，反馈含原因', () => {
  const plan = planSectionRetry({
    facts: noErrors,
    foreshadowEvents: { errors: ['foreshadowEvent 引用不存在的伏笔：plot/ghost'] },
    characterStates: { errors: ['characterState 引用不存在的人物：character/nobody'] },
  })
  assert.deepEqual(plan.sections, ['foreshadowEvents', 'characterStates'])
  assert.equal(plan.feedback.length, 2)
})

test('planSectionRetry：全部通过则无需重试', () => {
  const plan = planSectionRetry({ facts: noErrors, foreshadowEvents: noErrors, characterStates: noErrors })
  assert.deepEqual(plan.sections, [])
  assert.deepEqual(plan.feedback, [])
})

test('parseChapterRange：单章与区间；格式/倒序响亮失败', () => {
  assert.deepEqual(parseChapterRange('002'), ['002'])
  assert.deepEqual(parseChapterRange('001-003'), ['001', '002', '003'])
  assert.throws(() => parseChapterRange('2'), /格式非法/)
  assert.throws(() => parseChapterRange('003-001'), /倒序/)
})

const chapter: WriterEntity = {
  kind: 'chapter',
  id: '003',
  path: 'chapters/003.md',
  frontmatter: { number: 3, title: '雨夜' },
  content: '绿焰在雨夜里转蓝。',
  hash: 'h',
}

test('摘要提示词承诺纯文本；抽取提示词注入可用实体清单与重试反馈', () => {
  assert.match(buildSummarySystemPrompt(), /只输出摘要正文/)
  const plain = buildExtractionUserPrompt(chapter, { characters: ['elin'], plots: ['green-flame'] })
  assert.match(plain, /人物 id：elin/)
  assert.match(plain, /伏笔 id：green-flame/)
  const retried = buildExtractionUserPrompt(chapter, { characters: ['elin'], plots: [] }, ['引用不存在的伏笔：plot/ghost'])
  assert.match(retried, /上次输出被拒收的原因/)
  assert.match(retried, /plot\/ghost/)
})

test('一致性提示词：四维与 JSON 契约齐备', () => {
  const system = buildConsistencySystemPrompt()
  for (const dim of ['情节一致性', '人物一致性', '设定一致性', '时间线一致性']) {
    assert.ok(system.includes(dim), `${dim} 在维度清单中`)
  }
  assert.match(system, /"issues"/)
  assert.match(system, /全部引用都不存在时该条目会被丢弃/)
})

test('renderPendingSection：三节条目 + partial 拒收提示（人机确认界面格式回归）', () => {
  const record: MaintenanceDerived = {
    sourceHash: 'h',
    summary: '摘要文本',
    extraction: {
      facts: [{ description: '事实A', characters: ['elin'], plots: ['green-flame'] }],
      foreshadowEvents: [{ plot: 'green-flame', action: 'planted', note: '第七盏灯' }],
      characterStates: [{ character: 'elin', state: '左手受伤' }],
    },
    updatedAt: '2026-01-01T00:00:00Z',
    partial: true,
    rejected: ['foreshadowEvent 引用不存在的伏笔：plot/ghost'],
  }
  const section = renderPendingSection('001', record)
  assert.match(section, /## \[维护 pass\] chapter\/001/)
  assert.match(section, /- 摘要：摘要文本/)
  assert.match(section, /- 事实：事实A（人物：elin）（伏笔：green-flame）/)
  assert.match(section, /- 伏笔事件建议：plot\/green-flame planted——第七盏灯.*foreshadow_update/)
  assert.match(section, /- 人物状态建议：character\/elin 第 001 章末 → 左手受伤（如属实请用 timeline_update 确认写入人物时间线/)
  assert.match(section, /⚠ 部分抽取条目因引用校验未通过被拒收/)
  assert.match(section, /plot\/ghost/)
})
