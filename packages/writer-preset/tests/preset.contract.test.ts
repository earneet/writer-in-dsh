/**
 * 轮次 38（P2-9）：preset isolate 域契约测试。
 * writer 各 Provider 发布的服务必须全部落在「写作模式」preset 的 isolate 域内
 * （宿主 agent-preset-registry 契约：preset 服务必须落 isolate realm，否则该会话挂载整体失败）。
 * 新增服务忘了登记时，失败被推迟到运行期某个会话——本测试把它拉回提交期。
 * 运行：node --test packages/writer-preset/tests/preset.contract.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** 从 writer-core 源码提取全部抽象基类发布的服务名（super(ctx, '<name>') 形态）。 */
async function coreServiceNames(): Promise<string[]> {
  const src = await readFile(join(here, '../../writer-core/src/index.ts'), 'utf8')
  const names = [...src.matchAll(/super\(ctx, '([A-Za-z][A-Za-z0-9]*)'\)/g)].map((m) => m[1]!)
  assert.ok(names.length > 0, '至少应识别出一个服务名（正则漂移即测试红）')
  // 防形态漂移漏检（对抗审查 P3）：core 中 super(ctx 出现次数必须与提取数一致——
  // 未来新服务若改用双引号/常量名等写法，此处先红，逼作者同步本正则
  const superCount = [...src.matchAll(/super\(ctx[,)]/g)].length
  assert.equal(names.length, superCount, `服务发布形态漂移：core 有 ${superCount} 处 super(ctx，正则仅识别 ${names.length} 处`)
  return names
}

/** 从 preset 的 cordis.patch.yml 提取 isolate 域登记键（isolate: 之下缩进的 `<name>: true` 行）。 */
async function presetIsolateKeys(): Promise<string[]> {
  const yml = await readFile(join(here, '../cordis.patch.yml'), 'utf8')
  const lines = yml.split('\n')
  const keys: string[] = []
  let inIsolate = false
  for (const line of lines) {
    if (/^\s*isolate:\s*$/.test(line)) { inIsolate = true; continue }
    if (inIsolate) {
      const m = line.match(/^\s+([A-Za-z][A-Za-z0-9]*):\s*true\s*$/)
      if (m === null) break // isolate 块结束（遇到非条目行）
      keys.push(m[1]!)
    }
  }
  return keys
}

test('isolate 契约：writer-core 发布的全部服务均须登记在 preset isolate 域（不多不少）', async () => {
  const [services, isolated] = await Promise.all([coreServiceNames(), presetIsolateKeys()])
  assert.ok(isolated.length > 0, 'isolate 块解析非空（YAML 结构漂移即测试红）')
  const missing = services.filter((s) => !isolated.includes(s))
  const extra = isolated.filter((k) => !services.includes(k))
  assert.deepEqual(missing, [], `以下服务未登记 isolate（该会话挂载会整体失败）：${missing.join('、')}`)
  assert.deepEqual(extra, [], `isolate 登记了不存在的服务（登记表漂移）：${extra.join('、')}`)
})
