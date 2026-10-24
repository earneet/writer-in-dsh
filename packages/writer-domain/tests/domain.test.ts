/**
 * domain 纯函数单测：frontmatter 解析边界、序列化往返、hash 规范化、伏笔状态机。
 * 运行：node --test packages/writer-domain/tests/domain.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseFrontmatter, serializeEntity, contentHash, transitionForeshadow, stripContinuationRepetition, guardContinuation,
} from '../src/index.ts'

test('parseFrontmatter：CRLF + BOM 归一', () => {
  const p = parseFrontmatter('\uFEFF---\r\nname: 测试\r\nn: 3\r\n---\r\n正文\r\n二行')
  assert.deepEqual(p.frontmatter, { name: '测试', n: 3 })
  assert.equal(p.content, '正文\n二行')
})

test('parseFrontmatter：值含冒号取首个分隔', () => {
  const p = parseFrontmatter('---\ntitle: 冒号: 在值里\n---\nx')
  assert.equal(p.frontmatter.title, '冒号: 在值里')
})

test('parseFrontmatter：数字推断限纯十进制（0x10/1e3/1_000/前导零保持字符串）', () => {
  const p = parseFrontmatter('---\nhex: "0x10"\nsci: "1e3"\nunder: "1_000"\nzero: 002\nreal: 3.14\nneg: -7\n---\nx')
  assert.equal(p.frontmatter.hex, '0x10')
  assert.equal(p.frontmatter.sci, '1e3')
  assert.equal(p.frontmatter.under, '1_000')
  assert.equal(p.frontmatter.zero, '002')
  assert.equal(p.frontmatter.real, 3.14)
  assert.equal(p.frontmatter.neg, -7)
})

test('parseFrontmatter：无 frontmatter 块返回全文', () => {
  const p = parseFrontmatter('# hi\n---\nnot fm')
  assert.deepEqual(p.frontmatter, {})
  assert.equal(p.content, '# hi\n---\nnot fm')
})

test('parseFrontmatter：正文中 --- 不误判', () => {
  const p = parseFrontmatter('---\na: 1\n---\n前文\n---\n后文')
  assert.deepEqual(p.frontmatter, { a: 1 })
  assert.equal(p.content, '前文\n---\n后文')
})

test('parseFrontmatter：坏行抛错', () => {
  assert.throws(() => parseFrontmatter('---\n没有冒号的行\n---\nx'))
})

test('parseFrontmatter：闭合 --- 无尾换行（EOF 手编文件）', () => {
  const p = parseFrontmatter('---\na: 1\n---')
  assert.deepEqual(p.frontmatter, { a: 1 })
  assert.equal(p.content, '')
})

test('stripContinuationRepetition：连续 ≥3 句复述段剔除、离散呼应保留、段落空白不丢（轮次 29）', () => {
  const existing = '夜里落雨。屋里静。她收了伞。灯芯忽地一跳。'
  // 续写中部连续复述 3 句（可来自正文任意位置——全量交叉），前后是新增句
  const continued = '新的开场句。夜里落雨。屋里静。她收了伞。后续新内容句。'
  const r = stripContinuationRepetition(existing, continued)
  assert.equal(r.removedCount, 3)
  assert.equal(r.kept, '新的开场句。后续新内容句。')
  // 单句/双句离散呼应低于阈值不剔（防误杀）
  const light = stripContinuationRepetition(existing, '全新一句。屋里静。又一新句。')
  assert.equal(light.removedCount, 0)
  assert.equal(light.kept, '全新一句。屋里静。又一新句。')
  // 剔除段末尾的段落分隔空白保留，防剔除后段落粘连（'新句一。'的尾随 \n\n + 被剔段末尾空白）
  const spaced = stripContinuationRepetition(existing, '新句一。\n\n夜里落雨。屋里静。她收了伞。\n\n新句二。')
  assert.equal(spaced.removedCount, 3)
  assert.match(spaced.kept, /^新句一。\n+新句二。$/, `段落分隔保留（got: ${JSON.stringify(spaced.kept)}`)
})

test('guardContinuation：全重复/剩余过短整轮拒绝（宁短勿重），正常续写原样放行', () => {
  const existing = '夜里落雨。屋里静。她收了伞。灯芯忽地一跳。'
  // 整段回声：剔除后无有效新内容 → 拒绝（undefined）
  assert.equal(guardContinuation(existing, '夜里落雨。屋里静。她收了伞。'), undefined)
  // 剩余过短且原输出达到最小有效长度（总长 203 ≥ 200，剔除复述后仅 188 < 200）→ 拒绝（宁短勿重）
  const mostly = `夜里落雨。屋里静。她收了伞。${'新内容。'.repeat(47)}`
  assert.equal(guardContinuation(existing, mostly), undefined)
  // 无复述：原样返回（trim 后），removedCount 0
  const fresh = guardContinuation(existing, '  她推门而出，走进雨幕深处。  ')
  assert.deepEqual(fresh, { content: '她推门而出，走进雨幕深处。', removedCount: 0 })
  // 部分剔除后仍有足量新内容：返回剔除后内容
  const partial = guardContinuation(existing, `新的开场。夜里落雨。屋里静。她收了伞。${'后续推进。'.repeat(50)}`)
  assert.ok(partial !== undefined && partial.removedCount === 3)
  assert.ok(partial!.content.startsWith('新的开场。') && !partial!.content.includes('屋里静'))
})

test('serializeEntity 往返与键排序（字符串值引号化）', () => {
  const s = serializeEntity({ b: 2, a: 'x' }, '正文\n')
  assert.ok(s.startsWith('---\na: "x"\nb: 2\n---\n'))
  const p = parseFrontmatter(s)
  assert.deepEqual(p.frontmatter, { a: 'x', b: 2 })
  assert.equal(p.content, '正文\n')
})

test('字符串字面量不再漂移："true"/"5"/含换行 roundtrip 稳定', () => {
  const fm = { s1: 'true', s2: '5', s3: 'a\nb=c', n: 5, b: false }
  const p = parseFrontmatter(serializeEntity(fm, 'x'))
  assert.deepEqual(p.frontmatter, fm)
})

test('hash 碰撞回归：值含 = 或换行不再与键值串混淆', () => {
  assert.notEqual(
    contentHash({ a: 'x', y: 'b=z' }, 'c'),
    contentHash({ a: 'x\ny=b=z' }, 'c'),
  )
})

test('serializeEntity：空 frontmatter 只输出正文', () => {
  assert.equal(serializeEntity({}, 'x'), 'x\n')
})

test('contentHash：键序无关、内容敏感', () => {
  assert.equal(contentHash({ a: 1, b: 'x' }, 'c'), contentHash({ b: 'x', a: 1 }, 'c'))
  assert.notEqual(contentHash({ a: 1 }, 'c'), contentHash({ a: 1 }, 'd'))
  assert.notEqual(contentHash({ a: 1 }, 'c'), contentHash({ a: 2 }, 'c'))
})

test('transitionForeshadow：合法与非法迁移', () => {
  assert.equal(transitionForeshadow('planned', 'planted'), 'planted')
  assert.equal(transitionForeshadow('planted', 'abandoned'), 'abandoned')
  assert.throws(() => transitionForeshadow('resolved', 'planned'))
  assert.throws(() => transitionForeshadow('planned', 'resolved'))
})
