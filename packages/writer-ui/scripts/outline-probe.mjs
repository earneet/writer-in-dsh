/**
 * 大纲页 Markdown 渲染探针（node scripts/outline-probe.mjs <url>，诊断用不入库）：
 * 打开写作面板 → 切「大纲」页签 → 断言 GFM 表格/标题已按 Markdown 渲染（DOM 含 <table>
 * 与人物表内容），截图与 console 错误一并落 browser-test-out/。
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
const { chromium } = createRequire(new URL('../../../../.writer-ui-harness/na.js', import.meta.url))('playwright-core')

const url = process.argv[2]
if (url === undefined) { console.error('usage: node outline-probe.mjs <url>'); process.exit(2) }
mkdirSync('./browser-test-out/', { recursive: true })

const browser = await chromium.launch({ executablePath: 'C:/Users/earne/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const logs = []
page.on('console', m => logs.push(`[console.${m.type()}] ${m.text()}`))
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`))
page.on('requestfailed', r => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`))

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(12000)
await page.screenshot({ path: './browser-test-out/o1-load.png' })
console.log('--- after load ---')
console.log((await page.evaluate(() => document.body.innerText)).slice(0, 600))

// 若无活跃会话（欢迎页）：新建「写作模式」会话（面板 main 槽需要会话持有）
if (await page.getByText('写作面板', { exact: false }).count() === 0
  || await page.getByRole('tabpanel').count() === 0) {
  const newSession = page.getByText('新会话', { exact: true }).first()
  if (await newSession.count() > 0) {
    await newSession.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(2000)
    const mode = page.getByText('写作模式', { exact: false }).first()
    if (await mode.count() > 0) await mode.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(8000)
  }
}

// 切到「默认工作区」的示例项目会话（example-project cwd → novel/ 可见）
const group = page.getByText('默认工作区', { exact: false }).first()
if (await group.count() > 0) {
  await group.click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(1500)
  const sessionRow = page.getByText('新小说创作开始', { exact: false }).first()
  if (await sessionRow.count() > 0) {
    await sessionRow.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(5000)
  }
}

// 打开写作面板
const entry = page.getByText('写作面板', { exact: false }).first()
if (await entry.count() > 0) await entry.click({ timeout: 5000 }).catch(() => {})
await page.waitForTimeout(6000)
await page.screenshot({ path: './browser-test-out/o2-panel.png' })
console.log('--- after panel attempt ---')
console.log(JSON.stringify(await page.evaluate(() => ({
  hasPanelId: document.querySelector('[id^="writer-panel-"]') !== null,
  hasPanelTitle: document.body.innerText.includes('下一步：'),
  tabsRole: [...document.querySelectorAll('[role="tab"]')].map(t => t.textContent?.trim()).slice(0, 10),
  mainText: (document.querySelector('main') ?? document.body).innerText.slice(0, 300),
})), null, 2))

// 切「大纲」页签（SegmentedTabs 的 tab role）
const tab = page.getByRole('tab', { name: '大纲' }).first()
if (await tab.count() === 0) {
  // 兜底：非 tab role 时按文本点击
  const fallback = page.getByText('大纲', { exact: true }).first()
  if (await fallback.count() > 0) await fallback.click({ timeout: 3000 }).catch(() => {})
} else {
  await tab.click({ timeout: 3000 }).catch(() => {})
}
await page.waitForTimeout(2500)
await page.screenshot({ path: './browser-test-out/o3-outline.png', fullPage: false })

// 展开「出场人物表」分节（默认只展开首个分节；aside 预览按设计是纯文本）
const tableSection = page.getByText('出场人物表', { exact: false }).first()
if (await tableSection.count() > 0) await tableSection.click({ timeout: 3000 }).catch(() => {})
await page.waitForTimeout(1500)
await page.screenshot({ path: './browser-test-out/o4-outline-expanded.png' })

// 断言：Markdown 渲染证据——面板 DOM 内出现 <table>（人物表）与表格内容文本
const result = await page.evaluate(() => {
  const panel = document.querySelector('#writer-panel-outline') ?? document.body
  const tables = panel.querySelectorAll('table')
  const headings = [...panel.querySelectorAll('h1,h2,h3,h4')].map(h => h.textContent?.trim()).filter(Boolean)
  const strong = panel.querySelectorAll('strong,b').length
  return {
    tableCount: tables.length,
    tableHasSuMian: tables.length > 0 && (tables[0]?.textContent ?? '').includes('苏眠'),
    headings: headings.slice(0, 8),
    strongCount: strong,
    bodySnippet: panel.textContent?.slice(0, 400) ?? '',
  }
})
console.log(JSON.stringify(result, null, 2))

writeFileSync('./browser-test-out/console.log', logs.join('\n'))
console.log('--- console/page errors ---')
console.log(logs.filter(l => l.includes('error') || l.includes('Error') || l.includes('failed')).slice(0, 20).join('\n') || '(none)')
await browser.close()
