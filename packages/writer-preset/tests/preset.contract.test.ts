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

/**
 * 提取 preset-writer 行块（从行首到下一个顶格 `- ` 条目或文件尾）。
 * 本行 config 是用户在更高层 patch 里整段重述时的底稿（loader 方言：id 命中行
 * 字段整体替换、config 不深合并，preset 子行不可被外层 patch 按 id 直击），
 * 底稿自身缺字段即会随覆写扩散成装载失败——本测试把它锁在提交期。
 */
async function presetRowBlock(): Promise<string> {
  const yml = await readFile(join(here, '../cordis.patch.yml'), 'utf8')
  const lines = yml.split('\n')
  const start = lines.findIndex((l) => /^ *- id: preset-writer$/.test(l))
  assert.ok(start >= 0, 'preset-writer 行存在（行形态漂移即测试红）')
  const startIndent = lines[start]!.indexOf('-')
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!
    // 兄弟条目（同缩进 `- id:`）或回到顶格的下一 patch 条目即本行块结束
    if ((/^ *- id: /.test(line) && line.indexOf('-') === startIndent) || /^- /.test(line)) { end = i; break }
  }
  return lines.slice(start, end).join('\n')
}

test('isolate 契约：writer-core 发布的全部服务均须登记在 preset isolate 域（不多不少）', async () => {
  const [services, isolated] = await Promise.all([coreServiceNames(), presetIsolateKeys()])
  assert.ok(isolated.length > 0, 'isolate 块解析非空（YAML 结构漂移即测试红）')
  const missing = services.filter((s) => !isolated.includes(s))
  const extra = isolated.filter((k) => !services.includes(k))
  assert.deepEqual(missing, [], `以下服务未登记 isolate（该会话挂载会整体失败）：${missing.join('、')}`)
  assert.deepEqual(extra, [], `isolate 登记了不存在的服务（登记表漂移）：${extra.join('、')}`)
})

test('config 完整性：preset-writer 行必须整段自洽（agent-preset 必填字段 + 全部插件行）', async () => {
  const block = await presetRowBlock()
  // agent-preset Config 必填：id + plugins；展示元数据：name/description/order。
  // 行首锚 + 行尾锚，防 `id: writer` 误匹配 `- id: writer-persona` 等前缀。
  for (const [label, re] of [
    ['id: writer', /^ *id: writer$/m],
    ['name: 写作模式', /^ *name: 写作模式$/m],
    ['description:', /^ *description:/m],
    ['order:', /^ *order:/m],
    ['plugins:', /^ *plugins:/m],
  ] as const) {
    assert.ok(re.test(block), `preset-writer 行 config 缺 ${label}（外层整段重述底稿缺字段会随覆写扩散成 $.xx missing required value）`)
  }
  // 插件行完备性：人设 + 基础工具行 + writer-suite 组行与七个 writer 包（缺行 = 静默丢插件）。
  for (const id of [
    'writer-persona', 'agent-instructions', 'tool-bash', 'tool-pwsh', 'tool-fs',
    'tool-skill', 'tool-todo', 'tool-ask-user',
    'writer-suite', 'writer-store', 'writer-engine', 'writer-skills',
    'writer-export', 'writer-rag', 'writer-guard', 'writer-tools',
  ]) {
    assert.ok(new RegExp(`^ *- id: ${id}$`, 'm').test(block), `preset-writer 行 plugins 缺 - id: ${id}`)
  }
  // 组行语义锚：cordis:group + group: true（丢了则 isolate 域与子行索引全部失效）。
  assert.ok(/^ *name: cordis:group$/m.test(block), 'writer-suite 行 name 须为 cordis:group')
  assert.ok(/^ *group: true$/m.test(block), 'writer-suite 行须带 group: true')
})
