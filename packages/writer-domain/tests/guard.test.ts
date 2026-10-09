/**
 * P4 guard 业务错误预算纯函数单测：分类、滚动窗口、预算判定、纠偏文案。
 * 运行：node --test packages/writer-domain/tests/guard.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCorrectiveHint, classifyBusinessError, createErrorBudgetWindow, failureRate,
  recordAttempt, shouldInjectHint, windowStats,
} from '../src/guard.ts'

test('classifyBusinessError：可分类类别命中；无关消息不可分类', () => {
  assert.equal(classifyBusinessError('乐观锁失败：磁盘版本已变化（chapter/002），请重新 read'), 'optimistic-lock')
  assert.equal(classifyBusinessError('实体已存在：plot/x。更新必须先 read 并提供 expectHash'), 'optimistic-lock')
  assert.equal(classifyBusinessError('审稿输出无法解析为结构化报告'), 'parse')
  assert.equal(classifyBusinessError('foreshadowEvent 引用不存在的伏笔：plot/ghost'), 'reference-reject')
  assert.equal(classifyBusinessError('伏笔状态非法迁移：resolved → planted'), 'illegal-transition')
  assert.equal(classifyBusinessError('实体不存在：chapter/009'), 'not-found')
  assert.equal(classifyBusinessError('未知 action：explode（可选 plant / resolve）'), 'validation')
  assert.equal(classifyBusinessError('plant 需要提供 chapter（三位序号，伏笔落点章节）'), 'validation')
  assert.equal(classifyBusinessError('content 与 frontmatter 至少提供其一'), 'validation')
  assert.equal(classifyBusinessError('max_results 非法：0（须为 1-20 的整数）'), 'validation')
  assert.equal(classifyBusinessError('网络超时'), undefined)
})

test('classifyBusinessError：行首锚定防误报（正文含关键词不算失败）', () => {
  // 小说正文/正常输出中出现这些词不得被判为业务失败（居中裸子串是误报源）
  assert.equal(classifyBusinessError('他研究了那套状态机的设计，还翻出旧 schema 文档。'), undefined)
  assert.equal(classifyBusinessError('本章解析失败的原因在角色自身。'), undefined)
  assert.equal(classifyBusinessError('……引用校验……这段是审稿意见的引用'), undefined)
})

test('classifyBusinessError：soft 模式只认白名单前缀', () => {
  assert.equal(classifyBusinessError('实体不存在：chapter/009（可先不带 id 列出清单）', 'soft'), 'not-found')
  assert.equal(classifyBusinessError('伏笔实体不存在：plot/ghost（可先 writer_read 列出）', 'soft'), 'not-found')
  // 软失败成功正文含关键词：不分类（防成功调用被误计为失败）
  assert.equal(classifyBusinessError('已保存 chapter/002（hash=…）\n正文提及状态机与 schema', 'soft'), undefined)
  assert.equal(classifyBusinessError('审稿完成……乐观锁失败只是剧情梗概', 'soft'), undefined)
})

test('createErrorBudgetWindow：容量 <5 响亮失败', () => {
  assert.throws(() => createErrorBudgetWindow(4), /窗口容量非法/)
})

test('滚动窗口：预算判定预热满才生效；滑出窗口的失败被扣除', () => {
  const window = createErrorBudgetWindow(5)
  // 前 5 次：3 失败 2 成功 → 预热满后 rate=0.6
  recordAttempt(window, 'optimistic-lock')
  recordAttempt(window, undefined)
  recordAttempt(window, 'optimistic-lock')
  recordAttempt(window, undefined)
  assert.equal(shouldInjectHint(window, 0.3), false, '第 4 次时窗口未预热满')
  recordAttempt(window, 'parse')
  assert.equal(failureRate(window), 0.6)
  assert.equal(shouldInjectHint(window, 0.3), true)
  assert.equal(shouldInjectHint(window, 0.7), false, '预算内不提示')
  // 滑出：再记 3 次成功，滑出 F/S/F → 剩 F/S（failures=1，rate=0.2 回到预算内）
  recordAttempt(window, undefined)
  recordAttempt(window, undefined)
  assert.equal(failureRate(window), 0.4, '滑出 1 次失败后仍超预算')
  assert.equal(shouldInjectHint(window, 0.3), true)
  recordAttempt(window, undefined)
  assert.equal(failureRate(window), 0.2)
  assert.equal(shouldInjectHint(window, 0.3), false)
})

test('窗口统计与纠偏文案：类别计数 + 当前类别指引排前', () => {
  const window = createErrorBudgetWindow(10)
  recordAttempt(window, 'optimistic-lock')
  recordAttempt(window, 'optimistic-lock')
  recordAttempt(window, 'parse')
  recordAttempt(window, undefined)
  const stats = windowStats(window)
  assert.deepEqual(stats, { attempts: 4, failures: 3, rate: 0.75, categories: ['optimistic-lock×2', 'parse×1'] })
  const hint = buildCorrectiveHint(window, 'parse')
  assert.ok(hint.includes('[writer-guard]'))
  assert.ok(hint.includes('parse×1'))
  assert.ok(hint.includes('纠偏指引：结构化输出解析失败频发'), '当前类别指引优先')
  assert.ok(hint.includes('不阻止任何工具调用'))
})

test('不可分类失败计入失败数但不计类别', () => {
  const window = createErrorBudgetWindow(5)
  recordAttempt(window, null)
  assert.equal(failureRate(window), 1)
  assert.equal(window.categoryCounts.size, 0)
  const hint = buildCorrectiveHint(window)
  assert.ok(!hint.includes('构成：'), '无类别时统计行不含构成段')
  assert.ok(hint.includes('[writer-guard]'))
})

test('不可分类失败滑出窗口时失败数同步扣减（null 出窗不留残账）', () => {
  const window = createErrorBudgetWindow(5)
  recordAttempt(window, null)
  recordAttempt(window, 'parse')
  recordAttempt(window, null)
  recordAttempt(window, undefined)
  recordAttempt(window, null)
  assert.equal(failureRate(window), 0.8)
  // 5 次成功滑出 null/parse/null/S/null，窗口剩 5 成功 → 失败率归零（null 不在类别表也必须被扣）
  recordAttempt(window, undefined)
  recordAttempt(window, undefined)
  recordAttempt(window, undefined)
  recordAttempt(window, undefined)
  recordAttempt(window, undefined)
  assert.equal(windowStats(window).failures, 0)
  assert.equal(failureRate(window), 0)
})
