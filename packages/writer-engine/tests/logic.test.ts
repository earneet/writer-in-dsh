/**
 * writer-engine 纯决策逻辑单测（无 cordis/llm 运行时依赖；FinishReason 仅类型）。
 * 运行：node --test packages/writer-engine/tests/logic.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { FinishReason } from '@deepseek-ai/dsh-llm'
import type { WriterEntity } from 'dsh-writer-domain'
import {
  assertFinish, assertRewriteFullTextPlausible, decideRewritePath, mergeAssistContent,
  mergeFullFrontmatter, validateWriteRequest,
} from '../src/logic.ts'

function chapterEntity(id: string, frontmatter: WriterEntity['frontmatter'] = { number: Number(id) }): WriterEntity {
  return { kind: 'chapter', id, path: `chapters/${id}.md`, frontmatter, content: '正文。\n', hash: `h-${id}` }
}

// —— validateWriteRequest ——

test('validateWriteRequest：id 三位序号 / assist/rewrite 需存在 / rewrite 需 instruction', () => {
  assert.throws(() => validateWriteRequest({ chapterId: '2', mode: 'full' }, undefined), /三位序号/)
  assert.throws(() => validateWriteRequest({ chapterId: '002', mode: 'assist' }, undefined), /章节不存在/)
  assert.throws(() => validateWriteRequest({ chapterId: '002', mode: 'rewrite' }, chapterEntity('002')), /instruction/)
  validateWriteRequest({ chapterId: '002', mode: 'full' }, undefined)
  validateWriteRequest({ chapterId: '002', mode: 'rewrite', instruction: '收紧' }, chapterEntity('002'))
})

// —— mergeFullFrontmatter ——

test('mergeFullFrontmatter：新建回填 number、显式 title 覆盖、已存在保留原值', () => {
  assert.deepEqual(mergeFullFrontmatter(undefined, '003', '残页'), { number: 3, title: '残页' })
  assert.deepEqual(mergeFullFrontmatter(undefined, '003'), { number: 3 })
  const existing = chapterEntity('002', { number: 2, title: '旧题', volume: '第一卷' })
  assert.deepEqual(mergeFullFrontmatter(existing, '002', '新题'), { number: 2, title: '新题', volume: '第一卷' })
  assert.deepEqual(mergeFullFrontmatter(existing, '002'), { number: 2, title: '旧题', volume: '第一卷' })
})

// —— mergeAssistContent ——

test('mergeAssistContent：尾空白清理、空正文直接起章', () => {
  assert.equal(mergeAssistContent('前文。\n\n  ', '续写。'), '前文。\n\n续写。')
  assert.equal(mergeAssistContent('', '从头续写。'), '从头续写。')
})

// —— decideRewritePath（P2 验收核心决策树）——

test('decideRewritePath：空补丁 no-change / 命中 save-patch / 全不命中与全文走 fulltext', () => {
  const fulltext = { kind: 'fulltext' as const, text: '整章' }
  assert.deepEqual(decideRewritePath({ kind: 'patches', patches: [] }), { action: 'no-change' })
  const hit = { content: '改后', applied: 1, skipped: [] }
  assert.deepEqual(decideRewritePath({ kind: 'patches', patches: [{ find: 'a', replace: 'b' }] }, hit), { action: 'save-patch', patch: hit })
  const allMiss = { content: '原文', applied: 0, skipped: [{ find: 'a', reason: 'not-found' as const }] }
  assert.deepEqual(decideRewritePath({ kind: 'patches', patches: [{ find: 'a', replace: 'b' }] }, allMiss), { action: 'fulltext' })
  assert.deepEqual(decideRewritePath(fulltext), { action: 'fulltext' })
  assert.throws(() => decideRewritePath({ kind: 'patches', patches: [{ find: 'a', replace: 'b' }] }))
})

// —— assertRewriteFullTextPlausible ——

test('assertRewriteFullTextPlausible：以 { 开头的「全文」拒绝落盘', () => {
  assertRewriteFullTextPlausible('正常的整章正文。')
  assertRewriteFullTextPlausible('\n\n  缩进正文')
  assert.throws(() => assertRewriteFullTextPlausible('{"patches":[]}'), /疑似补丁 JSON/)
})

// —— assertFinish ——

test('assertFinish：stop 放行、四种失败终态各自抛错', () => {
  assertFinish({ kind: 'stop' } as FinishReason)
  assert.throws(() => assertFinish({ kind: 'error', failure: { message: 'x', code: 'AUTH' } } as unknown as FinishReason), /模型调用失败（error）/)
  assert.throws(() => assertFinish({ kind: 'aborted', failure: { message: 'x', code: 'ABORT' } } as unknown as FinishReason), /aborted/)
  assert.throws(() => assertFinish({ kind: 'max-tokens' } as FinishReason), /maxOutputTokens/)
  assert.throws(() => assertFinish({ kind: 'tool-calls' } as FinishReason), /工具调用/)
})
