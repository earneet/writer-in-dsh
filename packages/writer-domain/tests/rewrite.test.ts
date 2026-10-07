/**
 * P2 新增纯函数单测：rewrite 补丁协议、丢句守卫、上下文组装器、审稿解析、milestones。
 * 运行：node --test packages/writer-domain/tests/rewrite.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyRewritePatches, parseRewriteModelOutput, splitSentences, detectDroppedSentences,
  assembleWritingContext, extractChapterOutline, parseReviewReport, parseMilestones,
  filterSuggestionsByQuotes, filterSuggestionsByFocus,
  type WriterEntity,
} from '../src/index.ts'

function entity(kind: WriterEntity['kind'], id: string, frontmatter: WriterEntity['frontmatter'], content: string, path = `${kind}s/${id}.md`): WriterEntity {
  return { kind, id, path, frontmatter, content: `${content}\n`, hash: `h-${id}` }
}

// —— rewrite 补丁协议 ——

test('applyRewritePatches：唯一命中替换 + 空白归一容错', () => {
  const content = '夜风从港口吹来。\n\n艾琳提着工具袋走上灯塔街。\n\n风停了。\n'
  const r = applyRewritePatches(content, [{ find: '艾琳 提着 工具袋', replace: '艾琳拎着旧工具袋' }])
  assert.equal(r.applied, 1)
  assert.ok(r.content.includes('艾琳拎着旧工具袋'))
  assert.ok(r.content.includes('夜风从港口吹来。'))
  // 锚点后的尾随空白/换行原样保留（明确单一语义，不用 || 双收）
  assert.ok(r.content.includes('风停了。\n'))
})

test('applyRewritePatches：文首锚点 / 跨行 find / 空串 replace 删除', () => {
  // 文首
  const head = applyRewritePatches('开头句。后续。', [{ find: '开头句', replace: '起手句' }])
  assert.equal(head.content, '起手句。后续。')
  // find 含换行（跨段落锚点，空白归一后可命中）
  const crossPara = applyRewritePatches('上段结尾。\n\n下段开头。', [{ find: '上段结尾。\n\n下段开头', replace: '合并后的一句' }])
  assert.equal(crossPara.applied, 1)
  assert.equal(crossPara.content, '合并后的一句。')
  // replace 为空串 = 删除
  const removed = applyRewritePatches('保留。删除我。再保留。', [{ find: '删除我。', replace: '' }])
  assert.equal(removed.content, '保留。再保留。')
})

test('applyRewritePatches：零命中与歧义命中均跳过并记录原因', () => {
  const content = '甲句。乙句。甲句。'
  const r = applyRewritePatches(content, [
    { find: '不存在的句子', replace: 'x' },
    { find: '甲句', replace: '丙句' },
    { find: '乙句', replace: '丁句' },
  ])
  assert.equal(r.applied, 1)
  assert.deepEqual(r.skipped.map((s) => s.reason), ['not-found', 'ambiguous'])
  assert.equal(r.content, '甲句。丁句。甲句。')
})

test('applyRewritePatches：链式应用（后一条在前一条结果上匹配）', () => {
  const r = applyRewritePatches('原句A。原句B。', [
    { find: '原句A', replace: '新句A' },
    { find: '新句A。原句B', replace: '全新开头' },
  ])
  assert.equal(r.applied, 2)
  assert.equal(r.content, '全新开头。')
})

test('parseRewriteModelOutput：补丁 JSON / 栅栏包裹 / 全文三分支', () => {
  assert.deepEqual(
    parseRewriteModelOutput('{"patches":[{"find":"a","replace":"b"}]}'),
    { kind: 'patches', patches: [{ find: 'a', replace: 'b' }] },
  )
  assert.deepEqual(
    parseRewriteModelOutput('```json\n{"patches":[]}\n```'),
    { kind: 'patches', patches: [] },
  )
  // 前后缀寒暄宽容提取（防误走全文替换危险路径）
  assert.deepEqual(
    parseRewriteModelOutput('好的，补丁如下：\n{"patches":[{"find":"a","replace":"b"}]}\n以上。'),
    { kind: 'patches', patches: [{ find: 'a', replace: 'b' }] },
  )
  // patches 字段非法 → 全文
  assert.equal(parseRewriteModelOutput('{"patches":"nope"}').kind, 'fulltext')
  // 条目级非法（find 非字符串）→ 全文
  assert.equal(parseRewriteModelOutput('{"patches":[{"find":1,"replace":"b"}]}').kind, 'fulltext')
  const full = parseRewriteModelOutput('改写后的整章正文……')
  assert.equal(full.kind, 'fulltext')
  assert.equal(full.text, '改写后的整章正文……')
})

// —— 丢句守卫 ——

test('splitSentences：中文句末标点切句', () => {
  assert.deepEqual(splitSentences('第一句。第二句！第三句？'), ['第一句。', '第二句！', '第三句？'])
})

test('detectDroppedSentences：保留原句不告警、蒸发原句逐句列出', () => {
  const ok = detectDroppedSentences('甲句。乙句。丙句。', '甲句。乙句。丙句。')
  assert.deepEqual(ok.dropped, [])
  const edited = detectDroppedSentences('甲句。乙句。', '改写的开头。乙句。')
  assert.deepEqual(edited.dropped, ['甲句。'])
  const bad = detectDroppedSentences('甲句。乙句。丙句。丁句。', '只保留丙句。')
  assert.deepEqual(bad.dropped.sort(), ['甲句。', '乙句。', '丁句。'].sort())
  assert.ok(bad.retention < 0.5)
})

// —— 上下文组装器 ——

const principles = entity('principles', 'principles', {}, '冷峻克制的哥特语感。禁止现代词汇。')
const outline = entity('outline', 'outline', {}, '# 大纲\n## 第一卷\n### 第 1 章 守灯人\n- 巡灯发现绿焰\n### 第 2 章 残页\n- 残页指向排水系统\n- 结识档案员卡尔\n### 第 3 章 地底\n- 下探')
const ch1 = entity('chapter', '001', { number: 1, title: '守灯人' }, '第一章正文。')
const ch2 = entity('chapter', '002', { number: 2 }, '第二章正文。')
const elin = entity('character', 'elin', {}, '守灯人，谨慎，怕黑却装作不怕。')
const karl = entity('character', 'karl', {}, '档案员，博学。')
const plotDue = entity('plot', 'green-flame', { status: 'planned', planned_chapter: '002' }, '绿焰的本质。')
const plotActive = entity('plot', 'old-lamp', { status: 'planted', planted_chapter: '001', planned_chapter: '001' }, '旧灯的来历。')
const plotFuture = entity('plot', 'deep-thing', { status: 'planned', planned_chapter: '004' }, '地底之物。')
const plotDone = entity('plot', 'settled', { status: 'resolved', planned_chapter: '001', resolved_chapter: '001' }, '已回收。')

test('extractChapterOutline：定位第 N 章小节', () => {
  assert.equal(extractChapterOutline(outline.content, 2), '### 第 2 章 残页\n- 残页指向排水系统\n- 结识档案员卡尔')
  assert.equal(extractChapterOutline(outline.content, 9), undefined)
})

test('assembleWritingContext：必注分节 + 防剧透 + 伏笔指令分级', () => {
  const r = assembleWritingContext({
    chapterNumber: 2,
    principles, outline,
    chapters: [ch1, ch2],
    characters: [elin, karl],
    plots: [plotDue, plotActive, plotFuture, plotDone],
    budgetChars: 10000,
    instruction: '本章要引入卡尔',
  })
  const titles = r.sections.map((s) => s.title)
  assert.ok(titles.includes('用户特别要求'))
  assert.ok(titles.includes('创作准则（全量）'))
  assert.ok(titles.some((t) => t.includes('本章大纲') && t.includes('2')))
  const foreshadow = r.sections.find((s) => s.title === '伏笔指令')
  assert.ok(foreshadow !== undefined)
  assert.ok(foreshadow.body.includes('🔴') && foreshadow.body.includes('green-flame'))
  assert.ok(foreshadow.body.includes('🟡') && foreshadow.body.includes('old-lamp'))
  assert.ok(!foreshadow.body.includes('deep-thing')) // 未来伏笔不注入
  assert.ok(!foreshadow.body.includes('settled')) // 已回收不注入
  // 防剧透：只注入第 1 章，不注入第 2 章（当前章）自身
  assert.ok(r.sections.some((s) => s.title.includes('前一章原文') && s.body.includes('第一章正文')))
  assert.ok(!r.sections.some((s) => s.body.includes('第二章正文')))
})

test('assembleWritingContext：预算裁剪只作用于可降级分节（principles/本章大纲永不截断）', () => {
  const hugePrinciples = entity('principles', 'principles', {}, '红'.repeat(3000))
  const r = assembleWritingContext({
    chapterNumber: 2,
    principles: hugePrinciples, outline,
    chapters: [ch1],
    characters: [elin],
    plots: [plotDue],
    budgetChars: 500,
  })
  const byTitle = (kw: string) => r.sections.find((s) => s.title.includes(kw))
  assert.equal(byTitle('创作准则')?.truncated, false)
  assert.equal(byTitle('本章大纲')?.truncated, false)
  assert.ok(r.usageChars > 500) // 必注部分不受预算限制
  // 预算耗尽后可降级分节不再注入（上一版此处为空洞断言，已收紧）
  assert.equal(byTitle('前一章原文'), undefined)
})

test('assembleWritingContext：前一章原文超出预算保头截断且 truncated 标记', () => {
  const smallPrinciples = entity('principles', 'principles', {}, '克制。')
  const longPrev = entity('chapter', '001', { number: 1 }, '甲'.repeat(50) + '。前章结尾句。')
  const r = assembleWritingContext({
    chapterNumber: 2,
    principles: smallPrinciples, outline,
    chapters: [longPrev],
    characters: [],
    plots: [],
    // 预算小到装不下整段前章正文（必注 + 伏笔后余量 < 正文长度）
    budgetChars: 120,
  })
  const prev = r.sections.find((s) => s.title.includes('前一章原文'))
  assert.ok(prev !== undefined, '预算尚有余量时前一章分节存在')
  assert.equal(prev.truncated, true)
  assert.ok(prev.body.length < longPrev.content.trim().length, '正文被截短')
  assert.ok(prev.body.endsWith('…'))
  assert.ok(prev.body.startsWith('甲'), '保头截断（开头保留）')
})

test('assembleWritingContext：逾期 planned 伏笔标记必须设置（状态机禁止 planned 直接回收）', () => {
  const r = assembleWritingContext({
    chapterNumber: 3,
    principles, outline,
    chapters: [ch1, ch2],
    characters: [],
    plots: [plotDue],
    budgetChars: 5000,
  })
  const foreshadow = r.sections.find((s) => s.title === '伏笔指令')
  assert.ok(foreshadow !== undefined)
  assert.ok(foreshadow.body.includes('🔴') && foreshadow.body.includes('逾期') && foreshadow.body.includes('设置'))
  assert.ok(!foreshadow.body.includes('回收'), '不诱导 planned 直接 resolve')
})

test('assembleWritingContext：planned_chapter 脏值按缺失处理（不误触发红线也不静默降级为活跃误导）', () => {
  const dirty = entity('plot', 'dirty', { status: 'planned', planned_chapter: '第三章' }, '脏锚点伏笔。')
  const r = assembleWritingContext({
    chapterNumber: 3,
    principles, outline,
    chapters: [],
    characters: [],
    plots: [dirty],
    budgetChars: 5000,
  })
  const foreshadow = r.sections.find((s) => s.title === '伏笔指令')
  assert.ok(foreshadow !== undefined, '锚点不可解析仍按 planned 注入（不因脏值丢失伏笔）')
  assert.ok(foreshadow.body.includes('dirty'))
})

test('extractChapterOutline：小节到任意级别标题行终止（不吞入后续卷/附录）', () => {
  const content = '# 大纲\n### 第 2 章 残页\n- 要点\n## 第二卷 新篇\n- 卷级内容'
  assert.equal(extractChapterOutline(content, 2), '### 第 2 章 残页\n- 要点')
})

test('detectDroppedSentences：纯标点/空白原文不告警（retention=1）', () => {
  const r = detectDroppedSentences('！！！。。。', '任何改写')
  assert.deepEqual(r.dropped, [])
  assert.equal(r.retention, 1)
})

// —— 审稿解析 ——

test('parseReviewReport：合法 JSON / 栅栏 / 逐条收敛非法项', () => {
  const raw = '```json\n{"summary":"总评","suggestions":[{"dimension":"情节一致性","severity":"high","quote":"原文","problem":"p","suggestion":"s","rewriteOption":"r"},{"dimension":"人物一致性","problem":"缺 severity 与 quote","suggestion":"补齐"},{"bad":1}]}\n```'
  const r = parseReviewReport(raw)
  assert.ok(r !== undefined)
  assert.equal(r.suggestions.length, 2)
  assert.equal(r.suggestions[0].severity, 'high')
  assert.equal(r.suggestions[1].severity, 'medium') // 缺省收敛
  assert.equal(parseReviewReport('完全不是 JSON'), undefined)
  assert.equal(parseReviewReport('{"nope":1}'), undefined)
  assert.equal(parseReviewReport('{"suggestions":"x","summary":"s"}'), undefined)
  // summary 缺失收敛为 ''（而非 undefined）
  const noSummary = parseReviewReport('{"suggestions":[]}')
  assert.deepEqual(noSummary, { suggestions: [], summary: '' })
})

test('filterSuggestionsByQuotes：幻觉 quote 丢弃、无 quote 保留、空白归一匹配', () => {
  const report = {
    summary: 's',
    suggestions: [
      { dimension: 'a', severity: 'high' as const, problem: 'p1', suggestion: 's1', quote: '正文里有的 原句' },
      { dimension: 'a', severity: 'medium' as const, problem: 'p2', suggestion: 's2', quote: '正文里没有的幻觉引文' },
      { dimension: 'a', severity: 'low' as const, problem: 'p3', suggestion: 's3' },
    ],
  }
  const filtered = filterSuggestionsByQuotes(report, '开头。正文里有的\n原句。结尾。')
  assert.equal(filtered.suggestions.length, 2)
  assert.ok(filtered.suggestions.every((s) => s.problem !== 'p2'))
})

test('filterSuggestionsByFocus：维度命中保留、空 focus 全保留', () => {
  const report = {
    summary: '',
    suggestions: [
      { dimension: '情节一致性', severity: 'high' as const, problem: 'p', suggestion: 's' },
      { dimension: '文学质量', severity: 'low' as const, problem: 'q', suggestion: 't' },
    ],
  }
  assert.equal(filterSuggestionsByFocus(report, ['文学质量']).suggestions.length, 1)
  assert.equal(filterSuggestionsByFocus(report, []).suggestions.length, 2)
  assert.equal(filterSuggestionsByFocus(report).suggestions.length, 2)
})

// —— milestones ——

test('parseMilestones：空/合法/非法', () => {
  assert.deepEqual(parseMilestones(undefined), [])
  assert.deepEqual(parseMilestones(''), [])
  assert.deepEqual(
    parseMilestones('[{"type":"callback","chapter":"005","note":"n"}]'),
    [{ type: 'callback', chapter: '005', note: 'n' }],
  )
  assert.throws(() => parseMilestones('not-json'))
  assert.throws(() => parseMilestones('[{"type":"callback"}]'))
  // type 枚举校验：非法类型响亮失败
  assert.throws(() => parseMilestones('[{"type":"bogus","chapter":"005"}]'), /type 非法/)
  // note 非字符串（null）按省略处理，不落 "null" 字面量
  assert.deepEqual(parseMilestones('[{"type":"callback","chapter":"005","note":null}]'), [{ type: 'callback', chapter: '005' }])
})
