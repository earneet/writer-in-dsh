/**
 * guard 措辞契约测试（P7：清偿轮次 9 限制⑤的漂移防护）。
 * domain guard.ts 的分类模式表与本仓 tools/engine/store/domain 的错误措辞强耦合（行首锚定）——
 * 本测试扫描四包源码的全部 `throw new Error(...)` 消息，断言每条要么被 classifyBusinessError
 * 归类（业务错误进预算观测），要么命中「有意不分类」的基建错误白名单（IO/模型/内部不变量，
 * 不属工具业务失败）。新增错误措辞若两头都不沾，测试即红——逼作者同步模式表或显式裁定白名单。
 *
 * 已知边界（注释即契约）：① 变量开头的动态拼接消息无法静态提取（模式表覆盖其前缀字面量的仍可命中）；
 * ② 字符串换行拼接（'a' + 'b'）会整体漏扫；③ 插值含嵌套大括号时提取提前截断（靠前缀锚定兜底）；
 * ④ 扫描面仅四包——rag/export 包的工具层错误（如 embeddings 端点 5xx）属基建错误，观测到
 * 也不可分类（null 计数无纠偏提示），不在本契约面内。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyBusinessError } from '../src/index.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SRC_DIRS = ['writer-tools', 'writer-engine', 'writer-store', 'writer-domain'].map((p) => join(repoRoot, 'packages', p, 'src'))

/** 有意不分类的基建/环境/内部不变量错误前缀（IO 落盘、模型与宿主、逻辑断言——不是工具业务失败）。 */
const INTENTIONALLY_UNCLASSIFIED: readonly string[] = [
  '落盘失败', '派生数据落盘失败', '派生数据读取失败', 'pending.md 追加失败', 'pending.md 变更失败', '归档追加失败',
  '模型未返回任何文本', '恢复快照落盘失败',
  '窗口容量非法', '批次正文预算必须为正数', '一致性检查预算必须为正数',
  'keywordScoresFromCounts 形状不符', '范围内没有已写章节', '切片参数非法',
  'decideRewritePath', '模型调用失败', '模型输出达到 maxOutputTokens', '写作引擎调用不携带工具',
]

/** 插值占位 X 的代表性实参（模式表按运行时实参分支时，任一命中即视为已覆盖；
 * 词表刻意避开可能出现在消息正文里的字母，防 replaceAll 洗白未覆盖消息）。 */
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

/** 软失败 return 的「有意不分类」前缀：环境/插件缺席（模型不可纠偏）与成功型文案。 */
const SOFT_UNCLASSIFIED: readonly string[] = [
  '写作引擎未启用', '导出插件未启用', '检索插件未启用', 'git 不可用', '项目目录不是 git 仓库',
  '没有可存档的变更', '没有在飞', '无命中',
]

test('软失败白名单契约：writer-tools 全部错误型 return 可归类或命中环境/成功白名单', async () => {
  const toolsSrc = await readFile(join(repoRoot, 'packages', 'writer-tools', 'src', 'index.ts'), 'utf8')
  // 全量提取模板 return（插值占位 X），排除成功型与白名单前缀后必须可软分类——新增软失败前缀漂移即红
  const softReturns = [...toolsSrc.matchAll(/return `([^`\\]*)`/g)]
    .map((m) => m[1].replaceAll(/\$\{[^}]*\}/g, 'X'))
    // 含未闭合 ${ 的截断提取（嵌套模板字面量超出静态提取能力）无法判定，跳过并在注释边界声明
    .filter((text) => !text.includes('${'))
    .filter((text) => text.trim().length > 0)
  assert.ok(softReturns.length > 8, `软失败提取面异常（仅 ${softReturns.length} 条）`)
  const drift: string[] = []
  for (const text of softReturns) {
    if (classifyBusinessError(text, 'soft') !== undefined) continue
    if (SOFT_UNCLASSIFIED.some((prefix) => text.startsWith(prefix))) continue
    // 成功型文案前缀（已/没有/当前/统计报告/列表行/序号行/无操作提示等）不是软失败
    if (/^(已|没有|当前|章节：|卷分布|人物|伏笔：|关键事件|维护派生覆盖|审稿完成|一致性检查完成|派生重算完成|rewrite 判定无需修改|（|-|\d|[a-z]+\/)/.test(text)) continue
    drift.push(text)
  }
  assert.deepEqual(drift, [], `以下 return 文案未被软失败白名单覆盖也不在成功/环境前缀——请同步 domain/guard.ts SOFT_PATTERNS 或显式裁定`)
})
