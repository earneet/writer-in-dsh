/**
 * guard 措辞契约测试（P7：清偿轮次 9 限制⑤的漂移防护）。
 * domain guard.ts 的分类模式表与本仓 tools/engine/store/domain 的错误措辞强耦合（行首锚定）——
 * 本测试扫描四包源码的全部 `throw new Error(...)` 消息，断言每条要么被 classifyBusinessError
 * 归类（业务错误进预算观测），要么命中「有意不分类」的基建错误白名单（IO/模型/环境类，
 * 不属工具业务失败）。新增错误措辞若两头都不沾，测试即红——逼作者同步模式表或显式裁定白名单。
 * 动态拼接（变量开头）的消息无法静态提取，属已知边界（模式表覆盖其前缀字面量的仍可命中）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyBusinessError } from '../src/index.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SRC_DIRS = ['writer-tools', 'writer-engine', 'writer-store', 'writer-domain'].map((p) => join(repoRoot, 'packages', p, 'src'))

/** 有意不分类的基建/环境错误前缀（IO 落盘、模型/宿主环境、内部不变量——不是工具业务失败）。 */
const INTENTIONALLY_UNCLASSIFIED: readonly string[] = [
  '落盘失败', '派生数据落盘失败', 'pending.md 追加失败', 'pending.md 变更失败', '归档追加失败',
  '模型未返回任何文本', '审稿输出无法解析为结构化报告', '维护 pass 抽取输出无法解析', '一致性检查某批次输出无法解析',
  '恢复快照落盘失败', '维护 pass 自动触发失败', '检索增强失败', '外部',
  '窗口容量非法', '批次正文预算必须为正数', '一致性检查预算必须为正数',
  'keywordScoresFromCounts 形状不符', '范围内没有已写章节',
  'decideRewritePath', '模型调用失败', '模型输出达到 maxOutputTokens', '写作引擎调用不携带工具',
]

/** 插值占位 X 的代表性实参（模式表按运行时实参分支时，任一命中即视为已覆盖）。 */
const PLACEHOLDER_TOKENS: readonly string[] = ['plant', 'full', 'txt', 'nosuch', 'character', 'plot']

/** 从源码提取 throw new Error('...') / throw new Error(`...`) 的消息首行（模板插值替换为 X）。 */
async function collectThrownMessages(): Promise<string[]> {
  const messages: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.name.endsWith('.ts')) {
        const source = await readFile(full, 'utf8')
        for (const m of source.matchAll(/throw new Error\(\s*(['"`])([\s\S]*?)\1\s*[),]/g)) {
          const raw = m[2].split('\n').map((l) => l.trim()).join('')
          // 模板插值占位：${...} → X（保留前缀字面量可命中）
          const message = raw.replaceAll(/\$\{[^}]*\}/g, 'X')
          messages.push(message)
        }
      }
    }
  }
  for (const dir of SRC_DIRS) await walk(dir)
  return messages
}

test('错误措辞契约：全部 throw 消息可归类或命中基建白名单（漂移即红）', async () => {
  const messages = await collectThrownMessages()
  assert.ok(messages.length > 40, `扫描面异常（仅 ${messages.length} 条）`)
  const drift: string[] = []
  for (const message of messages) {
    // 插值占位 X 可能替换掉了模式表的分支前缀（如 `${action} 需要提供 chapter`）——任一代表实参命中即算覆盖
    const classified = classifyBusinessError(message, 'thrown') !== undefined
      || PLACEHOLDER_TOKENS.some((token) => classifyBusinessError(message.replaceAll('X', token), 'thrown') !== undefined)
    if (classified) continue
    if (INTENTIONALLY_UNCLASSIFIED.some((prefix) => message.startsWith(prefix))) continue
    drift.push(message)
  }
  assert.deepEqual(drift, [], `以下错误措辞未被 guard 模式表覆盖也不在基建白名单——请同步 domain/guard.ts 模式表，或显式裁定为基建错误加入白名单`)
})

test('软失败白名单契约：writer-tools 的错误型 return 前缀可归类', async () => {
  const toolsSrc = await readFile(join(repoRoot, 'packages', 'writer-tools', 'src', 'index.ts'), 'utf8')
  // 错误型软失败固定形态：return `实体不存在：...` / return `伏笔实体不存在：...` 等（提取前缀字面量）
  const softPrefixes = [...toolsSrc.matchAll(/return `((?:实体不存在|伏笔实体不存在|人物实体不存在)[^`]*)`/g)].map((m) => m[1].split('：')[0].split('(')[0])
  assert.ok(softPrefixes.length >= 3, `软失败前缀提取面异常（仅 ${softPrefixes.length} 条）`)
  for (const prefix of [...new Set(softPrefixes)]) {
    assert.notEqual(classifyBusinessError(`${prefix}：x`, 'soft'), undefined, `软失败前缀未被白名单覆盖：${prefix}`)
  }
})
