/**
 * writer-engine 提示词构建单测（纯函数，不依赖 cordis/llm）。
 * 运行：node --test packages/writer-engine/tests/prompts.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWriteSystemPrompt, buildRewriteSystemPrompt, buildWriteUserPrompt,
  buildRewriteUserPrompt, buildReviewSystemPrompt, buildReviewUserPrompt,
} from '../src/prompts.ts'
import { assembleWritingContext, type WriterEntity } from 'dsh-writer-domain'

function entity(kind: WriterEntity['kind'], id: string, frontmatter: WriterEntity['frontmatter'], content: string): WriterEntity {
  return { kind, id, path: `${kind}s/${id}.md`, frontmatter, content: `${content}\n`, hash: `h-${id}` }
}

test('写作用户提示词：分节渲染 + 模式收尾指令', () => {
  const assembled = assembleWritingContext({
    chapterNumber: 2,
    principles: entity('principles', 'principles', {}, '冷峻语感。'),
    outline: entity('outline', 'outline', {}, '### 第 2 章 残页\n- 残页指向排水系统'),
    chapters: [entity('chapter', '001', { number: 1 }, '前章正文。')],
    characters: [],
    plots: [],
    budgetChars: 1000,
  })
  const full = buildWriteUserPrompt(assembled, 'full')
  assert.ok(full.includes('## 创作准则（全量）') && full.includes('冷峻语感。'))
  assert.ok(full.includes('## 本章大纲（第 2 章）'))
  assert.ok(full.endsWith('现在写出本章完整正文。'))
  const assist = buildWriteUserPrompt(assembled, 'assist')
  assert.ok(assist.endsWith('现在从正文结尾处续写。'))
})

test('rewrite system 提示词：声明补丁协议与全文两种输出形态', () => {
  const s = buildRewriteSystemPrompt()
  assert.ok(s.includes('"patches"'))
  assert.ok(s.includes('find'))
  assert.ok(s.includes('整章正文全文'))
})

test('rewrite 用户提示词：正文 + 选区锚 + 指令', () => {
  const ch = entity('chapter', '003', { number: 3 }, '正文甲。正文乙。')
  const withSel = buildRewriteUserPrompt(ch, '收紧节奏', '正文甲。')
  assert.ok(withSel.includes('正文甲。') && withSel.includes('## 改写范围') && withSel.includes('收紧节奏'))
  const noSel = buildRewriteUserPrompt(ch, '收紧节奏')
  assert.ok(!noSel.includes('## 改写范围'))
})

test('审稿 system 提示词：维度与 JSON 契约；focus 过滤生效', () => {
  const all = buildReviewSystemPrompt()
  for (const dim of ['情节一致性', '人物一致性', '设定一致性', '文学质量']) assert.ok(all.includes(dim))
  assert.ok(all.includes('"suggestions"') && all.includes('quote'))
  const focused = buildReviewSystemPrompt(['文学质量'])
  assert.ok(focused.includes('文学质量') && !focused.includes('情节一致性'))
})

test('审稿用户提示词：准则/大纲/人物/伏笔 + 正文', () => {
  const ch = entity('chapter', '001', { number: 1 }, '章节内容。')
  const u = buildReviewUserPrompt(ch, {
    principles: '准则内容',
    chapterOutline: '大纲内容',
    charactersBrief: '- elin：守灯人',
    plotsBrief: '- green-flame：绿焰',
  })
  for (const kw of ['准则内容', '大纲内容', '- elin', '- green-flame', '章节内容。']) assert.ok(u.includes(kw))
})
