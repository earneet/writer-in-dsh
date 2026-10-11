/**
 * 浏览器半端到端自测 harness（node scripts/client-harness.mjs）：
 * 真实加载 lib/client.js（factory-form CJS），mock 浏览器模块表（react/jsx-runtime）
 * 与 slots/sessions/remote 服务，用 react-dom/server 渲染写作面板，验证：
 *   ① 插件激活（inject/apply/槽注册）不抛错；② 冷启动扫描 → 总览渲染出内容。
 */
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'

// react 不在仓库依赖树里（浏览器模块表供给）——harness 用 scratch 目录的安装
const harnessRequire = createRequire(new URL('../../../../.writer-ui-harness/na.js', import.meta.url))
const React = harnessRequire('react')
const jsxRuntime = harnessRequire('react/jsx-runtime')
const { renderToStaticMarkup } = harnessRequire('react-dom/server')

globalThis.window = { __ModuleLoader__: { load: (m) => { globalThis.__loaded = m } } }
const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
// factory 形态：eval 后 window.__ModuleLoader__.load 已接收 {id, factory}
const factoryWrapper = new Function(`${code}; return window.__ModuleLoader__ === undefined ? undefined : globalThis.__loaded`)
factoryWrapper()
const loaded = globalThis.__loaded
if (loaded === undefined) throw new Error('bundle 未注册到 __ModuleLoader__')

const moduleTable = {
  react: React,
  'react/jsx-runtime': jsxRuntime,
  'react-dom': harnessRequire('react-dom'),
  'react-dom/client': harnessRequire('react-dom/client'),
}
const browserRequire = (name) => {
  if (moduleTable[name] !== undefined) return moduleTable[name]
  throw new Error(`浏览器模块表缺少基线模块: ${name}`)
}

const client = loaded.factory(browserRequire)
console.log('activate: name=%s inject=%j', client.name, client.inject)

// —— mock 宿主服务 ——
const registered = []
const slots = {
  inject: (name, register) => { registered.push(name); return () => {} },
  register: () => () => {},
}
const fileSystem = {
  // 与 example-project/novel 布局一致的最小项目
  'novel': [{ name: 'project.md', type: 'file' }, { name: 'pending.md', type: 'file' }, { name: 'chapters', type: 'directory' }, { name: 'characters', type: 'directory' }, { name: 'plots', type: 'directory' }],
  '': [{ name: 'novel', type: 'directory' }],
  'novel/chapters': [{ name: '001.md', type: 'file' }, { name: '002.md', type: 'file' }],
  'novel/characters': [{ name: 'a.md', type: 'file' }, { name: 'hero.md', type: 'file' }],
  'novel/characters/a.md': `---\nname: "甲"\n---\n人物\n`,
  'novel/characters/hero.md': `---\nname: "主角"\nrole: "主角"\ntimeline: [{}, {}]\n---\n人物\n`,
  'novel/worldbuilding': [{ name: 'w.md', type: 'file' }],
  'novel/plots': [{ name: 'p1.md', type: 'file' }],
  'novel/project.md': `---\ntitle: "测试书"\ngenre: "测试"\ntarget_words: 1000\nchapters: 10\n---\n简介\n`,
  'novel/pending.md': `# 待办\n\n- 002 章伏笔升级\n- 复核时间线\n`,
  'novel/chapters/001.md': `---\nnumber: 1\ntitle: "守灯"\nvolume: "第一卷"\n---\n四个字。\n`,
  'novel/chapters/002.md': `---\nnumber: 2\ntitle: "夜航"\nvolume: "第一卷"\n---\n又是四个字。\n`,
  'novel/plots/p1.md': `---\nhint: "x"\nstatus: "planned"\n---\n正文\n`,
}
const remote = {
  workspaceFiles: {
    async list(_sid, path) {
      const entries = fileSystem[path]
      return entries === undefined ? { ok: false, error: { message: `no such dir ${path}` } } : { ok: true, value: { path, entries } }
    },
    async read(_sid, path, range = {}) {
      const text = fileSystem[path]
      if (text === undefined) return { ok: false, error: { message: `no such file ${path}` } }
      const lines = text.split('\n')
      const offset = range.offset ?? 1
      const page = lines.slice(offset - 1, offset - 1 + (range.limit ?? lines.length)).join('\n')
      return { ok: true, value: { text: page, lines: page.length > 0 ? page.split('\n').length : 0, eof: offset - 1 + (range.limit ?? lines.length) >= lines.length } }
    },
  },
}
const sessions = { list: { getSnapshot: () => ({ byId: { 's1': { id: 's1', retainedBy: { mainView: 1 } } } }) } }

const ctx = { slots, remote, sessions, effect: (fn) => { fn(); return () => {} } }
client.apply(ctx)
console.log('registered slots:', registered.join(', '))

// 面板组件：从注册回调抓 Component 太绕，直接从模块导出拿（factory 返回 exports）
const Panel = client.__writerPanel ?? undefined
if (Panel === undefined) {
  // 未直接导出面板：经 slots.register 捕获 key=writer-panel 的组件
  let captured = null
  const captureSlots = {
    inject: (_name, register) => { register(); return () => {} },
    register: (options, Component) => { if (options.key === 'writer-panel') captured = Component; return () => {} },
  }
  client.apply({ ...ctx, slots: captureSlots })
  if (captured === null) throw new Error('未能捕获 writer-panel 组件')
  // 轮询等待异步 scanNovel 完成后渲染
  await new Promise(r => setTimeout(r, 300))
  const html = renderToStaticMarkup(React.createElement(captured, {}))
  console.log('--- panel html ---')
  console.log(html)
  const noCrash = html.includes('写作面板') && html.includes('刷新')
  console.log('--- render verdict:', noCrash ? 'PASS（面板渲染不抛错）' : 'FAIL')

  // ② 冷启动扫描链路：直接驱动源码 scanNovel + buildOverview（renderToStaticMarkup 不跑 effect）
  const { setBrowserContext, scanNovel } = await import('../src/client/load.ts')
  const { buildOverview } = await import('../src/client/overview.ts')
  setBrowserContext({ remote, sessions })
  const scan = await scanNovel('s1', new AbortController().signal)
  const overview = buildOverview(scan)
  console.log('--- scan:', JSON.stringify({ root: scan.root, chapters: scan.chapters.length, characters: scan.characterCount, pending: scan.pendingLines }))
  console.log('--- overview:', JSON.stringify({ title: overview.title, chapters: overview.chapters, totalChars: overview.totalChars, foreshadow: overview.foreshadow }))
  const scanOk = overview.title === '测试书' && overview.chapters === 2 && overview.totalChars === 10
    && overview.foreshadow.length === 1 && overview.characterRows.length === 2 && overview.pendingLines.length === 2
  console.log('--- scan verdict:', scanOk ? 'PASS（冷启动总览聚合成功）' : 'FAIL')

  // ③ 旧布局回退：工作区根直铺（无 novel/、无 chapters/，仅 outline+characters+plots）
  delete fileSystem['novel']
  fileSystem[''] = [
    { name: 'outline.md', type: 'file' }, { name: 'characters', type: 'directory' }, { name: 'plots', type: 'directory' },
  ]
  fileSystem['outline.md'] = `# 《根目录书》\n\n## 第一章\n大纲内容\n`
  fileSystem['characters'] = fileSystem['novel/characters']
  fileSystem['characters/a.md'] = fileSystem['novel/characters/a.md']
  fileSystem['characters/hero.md'] = fileSystem['novel/characters/hero.md']
  fileSystem['plots'] = fileSystem['novel/plots']
  fileSystem['plots/p1.md'] = fileSystem['novel/plots/p1.md']
  const legacyScan = await scanNovel('s1', new AbortController().signal)
  const legacyOverview = buildOverview(legacyScan)
  console.log('--- legacy scan:', JSON.stringify({ root: legacyScan.root, chapters: legacyScan.chapters.length, characters: legacyScan.characters.length }))
  const legacyOk = legacyScan.root === '.' && legacyOverview.title === '《根目录书》' && legacyOverview.chapters === 0 && legacyOverview.characterRows.length === 2
  console.log('--- legacy verdict:', legacyOk ? 'PASS（根目录直铺布局识别成功）' : 'FAIL')
  process.exitCode = noCrash && scanOk && legacyOk ? 0 : 1
} else {
  console.log('direct export path')
}
