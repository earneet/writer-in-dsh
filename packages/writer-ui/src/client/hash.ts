/**
 * client 侧内容哈希（M1b 增量缓存 / 维护徽章数据源）。
 *
 * 口径与 dsh-writer-domain contentHash **逐字一致**（canonical 行 + 分隔符 + 正文 →
 * sha256 hex；字符串值 JSON 引号形式、其余 String()）——两端各自对同内容算 hash
 * 自然一致（roadmap §4.1 hash spike 裁定：domain 的 node:crypto 实现不可入 client
 * bundle，故此处用 WebCrypto 独立实现，tests/hash.test.ts 用 domain contentHash
 * 锁两端口径一致）。canonical 行的键排序与格式化在本模块内复刻，不 import domain
 * 运行时（formatValue 是 domain 私有函数）。
 */
import type { Frontmatter } from 'dsh-writer-domain'

/** domain formatValue 的同口径复刻：字符串恒 JSON 引号形式，其余 String()。 */
function formatValue(value: Frontmatter[string]): string {
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

/** canonical 行（与 domain contentHash 相同规范化）：键排序后的 `key=value` 行。 */
function canonicalLines(frontmatter: Frontmatter): string {
  return Object.keys(frontmatter).sort().map(key => `${key}=${formatValue(frontmatter[key])}`).join('\n')
}

/**
 * 计算实体内容哈希（sha256 hex；与 domain contentHash 同输入同输出）。
 * @param frontmatter 实体 frontmatter（flat 标量）。
 * @param content 正文（不含 frontmatter 块）。
 */
export async function contentHashClient(frontmatter: Frontmatter, content: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${canonicalLines(frontmatter)}\n\u0000\n${content}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}
