/**
 * 一致性检查纯函数单测：按预算分批（无固定章数/字数截断）、批次输出解析与引用校验、时间锚倒序。
 * 运行：node --test packages/writer-domain/tests/consistency.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  detectTimeAnchorInversions, parseConsistencyBatchOutput, parseDayAnchor, planConsistencyBatches,
} from '../src/consistency.ts'

function chapter(id: string, chars: number, summary?: string): { id: string; content: string; summary?: string } {
  return { id, content: 'x'.repeat(chars), ...(summary !== undefined ? { summary } : {}) }
}

test('planConsistencyBatches：预算内贪心分批，无章数硬上限', () => {
  // 20 章每章 1000 字、预算 5000 → 4-5 批（原项目 12 章截断缺陷的改进点）
  const chapters = Array.from({ length: 20 }, (_, i) => chapter(String(i + 1).padStart(3, '0'), 1000))
  const batches = planConsistencyBatches(chapters, 5000)
  const covered = batches.flatMap((b) => b.chapters)
  assert.equal(covered.length, 20, '全部章节入批，无一截断丢失')
  assert.ok(batches.length >= 4)
  for (const batch of batches) assert.equal(batch.truncated, false)
})

test('planConsistencyBatches：有摘要用摘要（扩大单批容量）', () => {
  const chapters = [
    chapter('001', 9000, '百字摘要'),
    chapter('002', 9000, '百字摘要'),
  ]
  const batches = planConsistencyBatches(chapters, 500)
  assert.equal(batches.length, 1, '摘要使大章同批')
  assert.equal(batches[0].chapters.length, 2)
})

test('planConsistencyBatches：单章超预算独占一批并标记截断', () => {
  const batches = planConsistencyBatches([chapter('001', 10000), chapter('002', 100)], 1000)
  assert.equal(batches.length, 2)
  assert.deepEqual(batches[0].chapters, ['001'])
  assert.equal(batches[0].truncated, true, '超预算正文截断保头并标记')
  assert.equal(batches[1].truncated, false)
})

test('planConsistencyBatches：非正预算响亮失败', () => {
  assert.throws(() => planConsistencyBatches([chapter('001', 1)], 0), /正数/)
})

test('parseConsistencyBatchOutput：合法输出收敛 + 幻觉引用丢弃', () => {
  const refs = new Set(['chapter/001', '001', 'plot/green-flame', 'character/elin', 'elin'])
  const parsed = parseConsistencyBatchOutput(JSON.stringify({
    summary: '总体一致',
    issues: [
      { dimension: '人物一致性', severity: 'high', refs: ['chapter/001', 'character/elin'], description: '瞳色前后不一' },
      { dimension: '情节一致性', refs: ['chapter/999'], description: '幻觉引用' },
      { dimension: '设定一致性', refs: [], description: '无引用条目保留（refs 可选）' },
    ],
  }), refs)
  assert.notEqual(parsed, undefined)
  assert.equal(parsed!.issues.length, 2, '引用全部不存在的条目被丢弃')
  assert.equal(parsed!.dropped, 1)
  assert.equal(parsed!.issues[0].severity, 'high')
  assert.equal(parsed!.issues[1].severity, 'medium', '非法 severity 收敛为 medium')
})

test('parseConsistencyBatchOutput：非 JSON 返回 undefined', () => {
  assert.equal(parseConsistencyBatchOutput('无矛盾。', new Set()), undefined)
})

test('parseDayAnchor / detectTimeAnchorInversions：第 N 日倒序检测', () => {
  assert.equal(parseDayAnchor('第 3 日 夜'), 3)
  assert.equal(parseDayAnchor('三日后'), undefined, '非「第 N 日」形态不强行比较')
  const inversions = detectTimeAnchorInversions([
    { chapterId: '001', raw: '第 5 日' },
    { chapterId: '002', raw: '第 3 日' },
    { chapterId: '003', raw: '第 6 日' },
  ])
  assert.equal(inversions.length, 1)
  assert.equal(inversions[0].earlier.chapterId, '001')
  assert.equal(inversions[0].later.chapterId, '002')
})
