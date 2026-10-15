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
  // primitives 桩：其 lib 为 ESM + CSS imports（Node 侧无法 require），harness 只验证
  // 结构化渲染不抛错；真实观感（token/亮暗主题）由 scripts/browser-test.mjs 在宿主里验证。
  '@deepseek-ai/dsh-client-ui-primitives': makePrimitivesStub(jsxRuntime.jsx),
}

function makePrimitivesStub(jsx) {
  const icon = (name) => (props) => jsx('svg', { 'data-icon': name, ...props })
  return {
    DisclosureRow: ({ icon: ic, title, open, expandable, collapsedContent, children }) =>
      jsx('div', { 'data-disclosure': String(open), children: [ic, title, collapsedContent, open ? children : null] }),
    Tag: ({ children }) => jsx('span', { children }),
    TextShimmer: ({ children }) => jsx('span', { children }),
    Button: ({ children }) => jsx('button', { children }),
    SegmentedTabs: () => jsx('div', {}),
    Tooltip: ({ children }) => children,
    StateDot: () => jsx('span', {}),
    IconEditOutlineRegular: icon('edit'),
    IconEditOutlineMedium: icon('edit-m'),
    IconInspectOutlineRegular: icon('inspect'),
    IconDataOutlineRegular: icon('data'),
    IconBranchOutlineRegular: icon('branch'),
    IconClockOutlineRegular: icon('clock'),
    IconSearchOutlineRegular: icon('search'),
    IconShieldOutlineRegular: icon('shield'),
    IconDownloadOutlineRegular: icon('download'),
    IconWarningTriangleOutlineMedium: icon('warn'),
    IconRefreshOutlineRegular: icon('refresh'),
    IconChecklistOutlineRegular: icon('checklist'),
    IconListPenOutlineRegular: icon('listpen'),
    IconUsersOutlineRegular: icon('users'),
    IconInfoOutlineRegular: icon('info'),
    IconFolderOpenOutlineRegular: icon('folder-open'),
    IconArchiveOutlineRegular: icon('archive'),
    IconSparkleRegular: icon('sparkle'),
  }
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
  'novel': [{ name: 'project.md', type: 'file' }, { name: 'outline.md', type: 'file' }, { name: 'pending.md', type: 'file' }, { name: 'chapters', type: 'directory' }, { name: 'characters', type: 'directory' }, { name: 'plots', type: 'directory' }],
  '': [{ name: 'novel', type: 'directory' }],
  'novel/chapters': [{ name: '001.md', type: 'file' }, { name: '002.md', type: 'file' }],
  'novel/characters': [{ name: 'a.md', type: 'file' }, { name: 'hero.md', type: 'file' }],
  'novel/characters/a.md': `---\nname: "甲"\n---\n# 甲\n\n## 关系\n\n- **主角**：老友\n`,
  'novel/characters/hero.md': `---\nname: "主角"\nrole: "主角"\ntimeline: "[{\\"chapter\\":\\"001\\",\\"state\\":\\"登场\\"}]"\n---\n# 主角\n\n## 背景\n\n从北地来。\n\n## 关系\n\n- **甲**：老友\n`,
  'novel/outline.md': `---\nvolumes: 2\nchapters: 10\nsynopsis: "两卷十章的最小大纲"\n---\n# 大纲\n\n## 一览\n\n- 主线\n\n## 第二卷\n\n收束\n`,
  'novel/worldbuilding': [{ name: 'w.md', type: 'file' }],
  'novel/plots': [{ name: 'p1.md', type: 'file' }, { name: 'p2.md', type: 'file' }],
  // M1b：派生维护产物（002 哈希不匹配 → 待维护；001 缺派生 → 待维护）与归档
  'novel/.writer': [{ name: 'pending-archive.md', type: 'file' }, { name: 'derived', type: 'directory' }],
  'novel/.writer/derived': [{ name: 'maintenance', type: 'directory' }],
  'novel/.writer/derived/maintenance': [{ name: '002.json', type: 'file' }],
  'novel/.writer/derived/maintenance/002.json': JSON.stringify({ sourceHash: 'stale', updatedAt: '2026-10-01T00:00:00.000Z' }),
  'novel/.writer/pending-archive.md': '# 归档\n\n## [已归档] chapter/001（2026-10-01T00:00:00.000Z）\n\n- 旧建议\n',
  'novel/project.md': `---\ntitle: "测试书"\ngenre: "测试"\ntarget_words: 1000\nchapters: 10\n---\n简介\n`,
  'novel/pending.md': `# 待办\n\n- 002 章伏笔升级\n- 复核时间线\n`,
  'novel/chapters/001.md': `---\nnumber: 1\ntitle: "守灯"\nvolume: "第一卷"\n---\n四个字。\n`,
  'novel/chapters/002.md': `---\nnumber: 2\ntitle: "夜航"\nvolume: "第一卷"\n---\n又是四个字。\n`,
  'novel/plots/p1.md': `---\nhint: "x"\nstatus: "planned"\nplanned_chapter: "009"\n---\n正文\n`,
  'novel/plots/p2.md': `---\nhint: "绿焰"\nstatus: "planted"\nplanned_chapter: "001"\n---\n正文\n`,
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
    // changes 流桩：ready 一帧后挂起（Panel watch 接线路径不在此覆盖，bus 单测覆盖）
    async *changes(_sid, _path, _signal) {
      yield { kind: 'ready' }
      await new Promise(() => {})
    },
  },
}
const sessions = {
  list: {
    getSnapshot: () => ({ byId: { 's1': { id: 's1', retainedBy: { mainView: 1 } } } }),
    subscribe: () => () => {},
  },
}

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
  const { buildOverview } = await import('../src/client/project.ts')
  setBrowserContext({ remote, sessions })
  const scan = await scanNovel('s1', new AbortController().signal)
  const overview = buildOverview(scan)
  console.log('--- scan:', JSON.stringify({ root: scan.root, chapters: scan.chapters.length, characters: scan.characters.length, pending: scan.pending }))
  console.log('--- overview:', JSON.stringify({ title: overview.title, chapters: overview.chapters, totalChars: overview.totalChars, foreshadow: overview.foreshadow }))
  const scanOk = overview.title === '测试书' && overview.chapters === 2 && overview.totalChars === 10
    && overview.foreshadow.length === 2 && overview.characterRows.length === 2 && overview.pendingSections.length === 1 && overview.pendingLineTotal === 2
    // v5：大纲小节 + timeline JSON 字符串解析 + 正文关系解析
    && overview.outline !== null && overview.outline.sections.length === 2
    && overview.characterRows.some(c => c.name === '主角' && c.timelineCount === 1 && c.relationCount === 1)
  console.log('--- scan verdict:', scanOk ? 'PASS（冷启动总览聚合成功）' : 'FAIL')

  // ④ M1b 决策面 + 六页签数据基线（换源后关键内容断言：三色/排序/情境卡/维护/归档/待办）
  const tabsOk = overview.riskSummary.red === 1 && overview.riskSummary.gray === 1
    && overview.plotRows[0]?.id === 'p2' && overview.plotRows[0]?.risk === 'red'
    && overview.plotRows[0]?.overdue === true
    && overview.currentChapter === 2
    && overview.staleChapters.length === 2 && overview.staleChapters.join(',') === '001,002'
    && overview.pendingArchive.length === 1
    && overview.nextStep.kind === 'maintain'
    && overview.outline !== null && overview.outline.sections.length === 2
    && overview.chapterRows.length === 2 && overview.characterRows.length === 2
    && overview.pendingLineTotal === 2
  console.log('--- tabs data:', JSON.stringify({
    risk: overview.riskSummary, plotOrder: overview.plotRows.map(p => [p.id, p.risk]),
    current: overview.currentChapter, stale: overview.staleChapters, archive: overview.pendingArchive.length, next: overview.nextStep.kind,
  }))
  console.log('--- tabs verdict:', tabsOk ? 'PASS（六页签数据基线 + 决策面字段）' : 'FAIL')

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
  process.exitCode = noCrash && scanOk && legacyOk && tabsOk ? 0 : 1
} else {
  console.log('direct export path')
}
