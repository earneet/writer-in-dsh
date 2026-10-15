/**
 * 冷启动总览聚合单测（node --test 直测纯函数；扫描 IO 层在浏览器 remote 之上，不在此覆盖）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOverview, extractBodyRelations, extractPendingSections, splitSections, splitSource } from '../src/client/overview.ts'

const chapter = (name: string, frontmatter: Record<string, unknown>, content: string) => ({
  name, frontmatter, content,
})

test('buildOverview：全字段聚合（卷/伏笔/进度/最近章节倒序/人物行/大纲/预览）', () => {
  const scan = {
    root: 'novel',
    project: { title: '长夜有歌', genre: '都市', target_words: 1000, chapters: 10 },
    outline: {
      frontmatter: { volumes: 4, chapters: 100, synopsis: '梗概一句话' },
      content: '# 大纲\n\n## 一览\n\n- 主线\n\n## 第二卷\n\n内容',
    },
    chapters: [
      chapter('002.md', { number: 2, title: '夜航', volume: '第一卷', status: 'draft' }, '四个字'),
      chapter('001.md', { number: 1, title: '守灯', volume: '第一卷' }, '两个\n字'),
      chapter('003.md', { number: 3 }, '另起一卷'),
    ],
    plots: [
      { name: 'a.md', frontmatter: { status: 'planned' }, content: '计划正文' },
      { name: 'b.md', frontmatter: { status: 'planted', hint: '镜子', planned_chapter: '066' }, content: '镜子伏笔正文' },
      { name: 'c.md', frontmatter: { status: 'planted' }, content: '' },
    ],
    characters: [
      { name: 'su-mian.md', frontmatter: { name: '苏眠', role: '主角', timeline: [{ chapter: '001', state: '登场' }, { chapter: '002', state: '交稿' }], relations: [{ name: '周宁', relation: '挚友' }] }, content: '' },
      { name: 'zhou-ning.md', frontmatter: {}, content: '' },
    ],
    worldbuildingCount: 1,
    pending: [],
  }
  const overview = buildOverview(scan)
  assert.equal(overview.title, '长夜有歌')
  assert.equal(overview.chapters, 3)
  assert.equal(overview.totalChars, 10)
  assert.equal(overview.progress, 10 / 1000)
  assert.deepEqual(overview.volumes, [{ name: '第一卷', count: 2 }, { name: '未分卷', count: 1 }])
  assert.deepEqual(overview.foreshadow, [{ status: 'planned', count: 1 }, { status: 'planted', count: 2 }])
  assert.deepEqual(overview.recentChapters.map(c => c.id), ['003', '002', '001'])
  assert.deepEqual(overview.characterRows.map(c => c.name), ['苏眠', 'zhou-ning'])
  assert.equal(overview.characterRows[0]!.timelineCount, 2)
  assert.equal(overview.characterRows[0]!.relationCount, 1)
  const mirror = overview.plotRows.find(p => p.id === 'b')
  assert.notEqual(mirror, undefined)
  assert.equal(mirror!.hint, '镜子')
  assert.equal(mirror!.plannedChapter, '066')
  assert.equal(mirror!.preview, '镜子伏笔正文')
  // 大纲：梗概 + 小节切分
  assert.notEqual(overview.outline, null)
  assert.equal(overview.outline!.synopsis, '梗概一句话')
  assert.equal(overview.outline!.volumes, 4)
  assert.equal(overview.outline!.chapterTarget, 100)
  assert.deepEqual(overview.outline!.sections.map(s => s.title), ['一览', '第二卷'])
  // 章节预览（去记号 + 折叠空白）
  assert.equal(overview.chapterRows[0]!.preview, '两个字')
})

test('buildOverview：timeline 为 JSON 字符串形态也可解析（示例项目实际存放形态）', () => {
  const overview = buildOverview({
    root: 'novel',
    project: null,
    outline: null,
    chapters: [],
    plots: [],
    characters: [
      {
        name: 'su-mian.md',
        frontmatter: { name: '苏眠', timeline: JSON.stringify([{ chapter: '001', state: '被限明晚交稿' }, { chapter: '002', state: '交稿' }]) },
        content: '',
      },
    ],
    worldbuildingCount: 0,
    pending: [],
  })
  const row = overview.characterRows[0]!
  assert.equal(row.timelineCount, 2)
  assert.deepEqual(row.timeline, [{ chapter: '001', state: '被限明晚交稿' }, { chapter: '002', state: '交稿' }])
})

test('splitSections / extractBodyRelations：正文小节与「## 关系」列表解析', () => {
  const content = '# 苏眠\n\n导语。\n\n## 背景\n\n云澜市人。\n\n## 关系\n\n- **周宁**：唯一从头就在的人\n- **韩澈**：让他改词的人\n- 普通行不算\n\n## 性格\n\n- 沉默'
  const sections = splitSections(content)
  assert.deepEqual(sections.map(s => s.title), ['简介', '背景', '关系', '性格'])
  assert.equal(sections[0]!.body, '导语。')
  const relations = extractBodyRelations(content)
  assert.deepEqual(relations, [
    { name: '周宁', desc: '唯一从头就在的人' },
    { name: '韩澈', desc: '让他改词的人' },
  ])
  // frontmatter relations + 正文关系合并去重（frontmatter 优先）
  const overview = buildOverview({
    root: 'novel', project: null, outline: null, chapters: [], plots: [],
    characters: [{ name: 'su-mian.md', frontmatter: { name: '苏眠', relations: [{ target: '周宁', relation: '挚友' }] }, content }],
    worldbuildingCount: 0, pending: [],
  })
  const row = overview.characterRows[0]!
  // frontmatter 周宁与正文周宁按名字去重（frontmatter 版本优先）→ 共 2 条
  assert.equal(row.relationCount, 2)
  assert.deepEqual(row.relations[0], { name: '周宁', desc: '挚友' })
  assert.equal(row.relations[1]!.name, '韩澈')
  assert.equal(row.sections.length, 4)
})

test('buildOverview：无 project / 无目标字数时进度为 null，标题回退；无 outline 时 outline 为 null', () => {
  const overview = buildOverview({ root: 'novel', project: null, outline: null, chapters: [], plots: [], characters: [], worldbuildingCount: 0, pending: [] })
  assert.equal(overview.title, '未命名项目')
  assert.equal(overview.progress, null)
  assert.equal(overview.targetWords, 0)
  assert.equal(overview.outline, null)
})

test('buildOverview：超额完成进度封顶 1', () => {
  const overview = buildOverview({
    root: 'novel',
    project: { target_words: 2 },
    chapters: [chapter('001.md', {}, '很多很多字')],
    plots: [], characters: [], worldbuildingCount: 0, pending: [],
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

test('extractPendingSections：分节倒序 + 跨节去重（保留最新）+ [x] 过滤 + 无标题回退', () => {
  const text = [
    '# 待办',
    '',
    '- 散装待办（最旧）',
    '',
    '## [维护 pass] chapter/001（09:52）待人工确认',
    '- 伏笔升级建议',
    '- [x] 已完成项',
    '',
    '## [维护 pass] chapter/001（09:53）待人工确认',
    '- 伏笔升级建议',
    '- 新版时间线建议',
  ].join('\n')
  const sections = extractPendingSections(text)
  // 倒序：最新 pass 在前；重复建议只保留最新节的出现；[x] 过滤；散装归「待办」节放最末
  assert.deepEqual(sections.map(s => s.heading), ['[维护 pass] chapter/001（09:53）待人工确认', '待办'])
  assert.deepEqual(sections[0]!.lines, ['伏笔升级建议', '新版时间线建议'])
  assert.deepEqual(sections[1]!.lines, ['散装待办（最旧）'])
})

test('extractPendingSections：重复建议去重后空节剔除', () => {
  const sections = extractPendingSections('## 旧 pass\n- 同一条建议\n\n## 新 pass\n- 同一条建议\n- 另一条\n')
  assert.deepEqual(sections, [{ heading: '新 pass', lines: ['同一条建议', '另一条'] }])
})

test('extractPendingSections：全部行已完成（[x]）时返回空数组（面板空态入口）', () => {
  assert.deepEqual(extractPendingSections('## pass A\n- [x] 已完成一\n- [x] 已完成二\n'), [])
  assert.deepEqual(extractPendingSections(''), [])
})
