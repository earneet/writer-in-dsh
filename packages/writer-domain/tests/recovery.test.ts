/**
 * P4 断更恢复快照渲染纯函数单测。
 * 运行：node --test packages/writer-domain/tests/recovery.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderRecoverySnapshot } from '../src/recovery.ts'
import type { WriterEntity } from '../src/index.ts'

function chapter(id: string, number: number, content: string, title?: string): WriterEntity {
  return {
    kind: 'chapter', id, path: `chapters/${id}.md`, hash: 'h',
    frontmatter: title === undefined ? { number } : { number, title }, content,
  }
}

test('渲染：章节倒序 + 摘要优先正文兜底 + git 时间锚 + 伏笔/人物/事件/建议', () => {
  const markdown = renderRecoverySnapshot({
    chapters: [
      chapter('001', 1, '第一章正文：绿焰初现。'),
      chapter('002', 2, '第二章正文：港城风雨。'),
    ],
    summaries: { '002': '第二章新鲜摘要' },
    characters: [{ kind: 'character', id: 'elin', path: 'characters/elin.md', hash: 'h', frontmatter: {}, content: '持有绿焰剑的旅人' }],
    plots: [{ kind: 'plot', id: 'green-flame', path: 'plots/green-flame.md', hash: 'h', frontmatter: { status: 'planted', planned_resolution_hint: '焰色转蓝时回收' }, content: '绿焰伏笔' }],
    events: { kind: 'event', id: 'event', path: 'events.md', hash: 'h', frontmatter: {}, content: '- 大雪封港' },
    chapterTimes: { '001': '2026-01-01T00:00:00+08:00', '002': null },
    generatedAt: '2026-02-01T00:00:00Z',
  })
  // 倒序：第 2 章在第 1 章之前
  assert.ok(markdown.indexOf('第 2 章') < markdown.indexOf('第 1 章'))
  assert.ok(markdown.includes('第二章新鲜摘要'), '新鲜摘要优先')
  assert.ok(markdown.includes('绿焰初现'), '无摘要的章正文兜底')
  assert.ok(markdown.includes('时间未知（无 git 记录）'), '无 git 记录显示时间未知')
  assert.ok(markdown.includes('2026-01-01T00:00:00+08:00'))
  assert.ok(markdown.includes('green-flame（planted）'))
  assert.ok(markdown.includes('焰色转蓝时回收'))
  assert.ok(markdown.includes('elin：持有绿焰剑的旅人'))
  assert.ok(markdown.includes('大雪封港'))
  assert.ok(markdown.includes('## 恢复建议'))
  assert.ok(markdown.endsWith('\n'), '恰好一个结尾换行')
})

test('渲染：空项目与缺实体节的降级', () => {
  const markdown = renderRecoverySnapshot({
    chapters: [], summaries: {}, characters: [], plots: [], chapterTimes: {}, generatedAt: 'now',
  })
  assert.ok(markdown.includes('（暂无已写章节）'))
  assert.ok(!markdown.includes('## 伏笔现状'))
  assert.ok(!markdown.includes('## 关键事件'))
})
