/**
 * 工具结果文本解析器单测（与 writer-tools 渲染格式逐字对齐；node --test 直测纯函数）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseConsistency, parseForeshadow, parseReview, parseWriteChapter, parseWriterStats,
} from '../src/client/parse.ts'
import { readPanelState, recordToolResult } from '../src/client/state.ts'

const STATS = [
  '章节：3 章，共约 8500 字',
  '卷分布：第一卷×3',
  '人物：1 个',
  '人物弧线覆盖：1/1（timeline 共 2 条）',
  '人物时间线一览：',
  '- elin（至第 003 章共 2 条）',
  '伏笔：planned×1、planted×2',
  '关键事件：已记录',
  '维护派生覆盖：2/3（待维护 pass：002、003）',
].join('\n')

test('parseWriterStats：全字段解析（含坏 timeline 与待维护章）', () => {
  const stats = parseWriterStats(STATS)
  assert.notEqual(stats, null)
  assert.equal(stats!.chapters, 3)
  assert.equal(stats!.totalChars, 8500)
  assert.deepEqual(stats!.volumes, [{ name: '第一卷', count: 3 }])
  assert.equal(stats!.characters, 1)
  assert.equal(stats!.arcCoverage, '1/1（timeline 共 2 条）')
  assert.deepEqual(stats!.foreshadow, [{ status: 'planned', count: 1 }, { status: 'planted', count: 2 }])
  assert.deepEqual(stats!.staleChapters, ['002', '003'])
  assert.equal(stats!.derivedCoverage, '2/3')
  const broken = parseWriterStats(STATS.replace('（timeline 共 2 条）', '（timeline 共 2 条；⚠ 非法 timeline：kael）'))
  assert.deepEqual(broken!.arcBroken, ['kael'])
  assert.equal(broken!.arcCoverage, '1/1（timeline 共 2 条）')
})

test('parseWriterStats：非 stats 文本返回 null', () => {
  assert.equal(parseWriterStats('项目暂无已写章节。'), null)
  assert.equal(parseWriterStats('随便一段话'), null)
})

const WRITE = [
  '已完成 full 写作并保存 chapter/004（hash=abc123，字数≈3200）',
  '补丁协议：命中 3 条，跳过 1 条',
  '  - 跳过：锚点未命中：旧句',
  '⚠ 丢句守卫告警（共 2 条原句未保留，仅列前 10 条，请人工复核是否为有意删除）：',
  '维护 pass 已在后台异步运行（若引擎启用 autoMaintenance（默认开））：维护 pass 正在后台异步运行，摘要/事实抽取稍后落盘，建议项会追加到 pending.md——下轮可读取确认；任务收尾前可调用 maintenance_flush 排空（提示可能补跑时可再 flush 一次）。',
].join('\n')

test('parseWriteChapter：保存回执 + 补丁 + 丢句计数', () => {
  const parsed = parseWriteChapter(WRITE)
  assert.notEqual(parsed, null)
  assert.equal(parsed!.mode, 'full')
  assert.equal(parsed!.chapterId, '004')
  assert.equal(parsed!.chars, 3200)
  assert.equal(parsed!.patchesApplied, 3)
  assert.equal(parsed!.patchesSkipped, 1)
  assert.equal(parsed!.droppedSentences, 2)
  assert.equal(parsed!.note, null)
})

test('parseWriteChapter：rewrite 无修改 no-op 与不可解析回退', () => {
  const noop = parseWriteChapter('rewrite 判定无需修改，未落盘（chapter/004 保持原样，hash=abc）')
  assert.notEqual(noop, null)
  assert.equal(noop!.chapterId, '004')
  assert.equal(noop!.note !== null && noop!.note.includes('无需修改'), true)
  assert.equal(parseWriteChapter('别的输出'), null)
})

const REVIEW = [
  '审稿完成（2 条建议）。总评：整体扎实，两处需复核。',
  '',
  '1. [high] 情节一致性：绿焰在第 2 章已认主，第 3 章又表现为陌生',
  '   原文：火焰无声地偏了偏',
  '   建议：改为呼应认主后的行为',
  '2. [low] 文学质量：对话略密集',
  '   建议：穿插动作描写',
].join('\n')

test('parseReview：建议条数/severity/维度解析与无建议分支', () => {
  const parsed = parseReview(REVIEW)
  assert.notEqual(parsed, null)
  assert.equal(parsed!.count, 2)
  assert.equal(parsed!.summary, '整体扎实，两处需复核。')
  assert.deepEqual(parsed!.suggestions.map(s => [s.severity, s.dimension]), [['high', '情节一致性'], ['low', '文学质量']])
  const clean = parseReview('审稿完成，无结构化建议。总评：干净通过。')
  assert.deepEqual(clean, { count: 0, summary: '干净通过。', suggestions: [] })
  assert.equal(parseReview('别的文本'), null)
})

test('parseForeshadow / parseConsistency', () => {
  assert.deepEqual(parseForeshadow('已更新伏笔 green-flame（status=planted，hash=abc）'), { id: 'green-flame', status: 'planted' })
  assert.equal(parseForeshadow('伏笔实体不存在：plot/x'), null)
  assert.deepEqual(parseConsistency('一致性检查完成（2 批：001-002、003-003），发现 3 条矛盾。'), { batches: '2 批：001-002、003-003', issues: 3 })
  assert.equal(parseConsistency('别的'), null)
})

test('面板状态：recordToolResult 派生快照与动态时间线', () => {
  recordToolResult('', 'writer_stats', STATS, { stats: parseWriterStats })
  recordToolResult('', 'write_chapter', WRITE, { write: parseWriteChapter })
  const state = readPanelState('')
  assert.notEqual(state, null)
  assert.equal(state!.stats?.chapters, 3)
  assert.equal(state!.lastWrite?.chapterId, '004')
  assert.equal(state!.writes.length, 1)
  assert.equal(state!.activities.length >= 2, true)
  assert.equal(state!.activities[0].tool, 'write_chapter')
})
