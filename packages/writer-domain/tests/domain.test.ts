/**
 * domain 纯函数单测：frontmatter 解析边界、序列化往返、hash 规范化、伏笔状态机。
 * 运行：node --test packages/writer-domain/tests/domain.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseFrontmatter, serializeEntity, contentHash, transitionForeshadow,
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
