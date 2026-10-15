/**
 * client 内容哈希口径契约测试（M1b 维护徽章数据源）：与 dsh-writer-domain
 * contentHash 同输入同输出（「两端各自对同内容算 hash 自然一致」的机制化锁定）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { contentHash } from 'dsh-writer-domain'
import { contentHashClient } from '../src/client/hash.ts'

test('contentHashClient 与 domain contentHash 同口径（字符串/数字/布尔/空 frontmatter）', async () => {
  const cases: Array<[Record<string, string | number | boolean>, string]> = [
    [{}, '正文内容'],
    [{ title: '守灯', number: 1, draft: true }, '# 守灯\n\n正文带"引号"与\\反斜杠\n'],
    [{ status: 'planned', planned_chapter: '066' }, ''],
    [{ '中文键': '值', empty: '' }, '多行\n正文\n'],
  ]
  for (const [frontmatter, content] of cases) {
    assert.equal(await contentHashClient(frontmatter, content), contentHash(frontmatter, content))
  }
})
