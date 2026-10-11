/**
 * 冷启动总览聚合单测（node --test 直测纯函数；扫描 IO 层在浏览器 remote 之上，不在此覆盖）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOverview, extractPendingLines, splitSource } from '../src/client/overview.ts'

const chapter = (name: string, frontmatter: Record<string, unknown>, content: string) => ({
  name, frontmatter, content,
})

test('buildOverview：全字段聚合（卷/伏笔/进度/最近章节倒序）', () => {
  const scan = {
    root: 'novel',
    project: { title: '长夜有歌', genre: '都市', target_words: 1000, chapters: 10 },
    chapters: [
      chapter('002.md', { number: 2, title: '夜航', volume: '第一卷' }, '四个字'),
      chapter('001.md', { number: 1, title: '守灯', volume: '第一卷' }, '两个\n字'),
      chapter('003.md', { number: 3 }, '另起一卷'),
    ],
    plots: [
      { name: 'a.md', frontmatter: { status: 'planned' } },
      { name: 'b.md', frontmatter: { status: 'planted' } },
      { name: 'c.md', frontmatter: { status: 'planted' } },
    ],
    characterCount: 5,
    pendingLines: [],
  }
  const overview = buildOverview(scan)
  assert.equal(overview.title, '长夜有歌')
  assert.equal(overview.chapters, 3)
  assert.equal(overview.totalChars, 10)
  assert.equal(overview.progress, 10 / 1000)
  assert.deepEqual(overview.volumes, [{ name: '第一卷', count: 2 }, { name: '未分卷', count: 1 }])
  assert.deepEqual(overview.foreshadow, [{ status: 'planned', count: 1 }, { status: 'planted', count: 2 }])
  assert.deepEqual(overview.recentChapters.map(c => c.id), ['003', '002', '001'])
  assert.equal(overview.characterCount, 5)
})

test('buildOverview：无 project / 无目标字数时进度为 null，标题回退', () => {
  const overview = buildOverview({ root: 'novel', project: null, chapters: [], plots: [], characterCount: 0, pendingLines: [] })
  assert.equal(overview.title, '未命名项目')
  assert.equal(overview.progress, null)
  assert.equal(overview.targetWords, 0)
})

test('buildOverview：超额完成进度封顶 1', () => {
  const overview = buildOverview({
    root: 'novel',
    project: { target_words: 2 },
    chapters: [chapter('001.md', {}, '很多很多字')],
    plots: [], characterCount: 0, pendingLines: [],
  })
  assert.equal(overview.progress, 1)
})

test('splitSource：frontmatter 解析与坏格式宽容回退', () => {
  const parsed = splitSource('---\ntitle: "x"\nnumber: 3\n---\n正文')
  assert.equal(parsed.frontmatter.title, 'x')
  assert.equal(parsed.frontmatter.number, 3)
  assert.equal(parsed.content, '正文')
  const bad = splitSource('---\ntitle: [unterminated\n---\n正文')
  assert.equal(typeof bad.frontmatter.title, 'string')
})

test('extractPendingLines：只取列表行并剥前缀', () => {
  const lines = extractPendingLines('# 待办\n\n- 002 章伏笔升级\n* 复核 003 时间线\n普通段落\n  \n- [x] 已完成')
  assert.deepEqual(lines, ['002 章伏笔升级', '复核 003 时间线', '[x] 已完成'])
})
