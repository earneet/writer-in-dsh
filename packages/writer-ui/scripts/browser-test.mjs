/**
 * 真实浏览器自测（node scripts/browser-test.mjs <url>）：
 * 打开 Web GUI，收集 console/pageerror，截图；点击侧边栏「写作面板」入口后再截图。
 * 产物写到 scripts/browser-test-out/（诊断用，不入库）。
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
const { chromium } = createRequire(new URL('../../../../.writer-ui-harness/na.js', import.meta.url))('playwright-core')

function writeReport(label, page) {
  return page.evaluate(() => document.body.innerText).then(text => {
    writeFileSync(`./browser-test-out/body-${label}.txt`, text)
    console.log(`=== ${label} ===`)
    const idx = text.indexOf('写作面板')
    const tail = idx >= 0 ? text.slice(Math.max(0, text.indexOf('刷新', idx)), idx + 700) : '(写作面板未找到)'
    console.log(tail.slice(0, 700))
  })
}

const url = process.argv[2]
if (url === undefined) { console.error('usage: node browser-test.mjs <url>'); process.exit(2) }
mkdirSync(new URL('./browser-test-out/', import.meta.url), { recursive: true })

const browser = await chromium.launch({ executablePath: 'C:/Users/earne/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const logs = []
page.on('console', m => logs.push(`[console.${m.type()}] ${m.text()}`))
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`))
page.on('requestfailed', r => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`))

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(12000)
await page.screenshot({ path: new URL('./browser-test-out/1-load.png', import.meta.url).pathname.replace(/^\//, '') && './browser-test-out/1-load.png' })

// 尝试打开写作面板（侧边栏面板入口）
let clicked = false
for (const label of ['写作面板']) {
  const el = page.getByText(label, { exact: false }).first()
  if (await el.count() > 0) { await el.click({ timeout: 3000 }).then(() => { clicked = true }, () => {}); break }
}
await page.waitForTimeout(6000)
await page.screenshot({ path: './browser-test-out/2-panel.png' })
writeReport('writer-in-dsh 会话', page)

// 切到默认工作区的一个会话再开面板（用户实际场景：旧布局根目录直铺）
const group = page.getByText('默认工作区', { exact: false }).first()
if (await group.count() > 0) {
  await group.click({ timeout: 3000 }).then(() => {}, () => {})
  await page.waitForTimeout(1500)
  // 组内第一个会话（默认工作区：新小说创作开始）
  const sessionRow = page.getByText('新小说创作开始', { exact: false }).first()
  if (await sessionRow.count() > 0) await sessionRow.click({ timeout: 3000 }).then(() => {}, () => {})
  await page.waitForTimeout(3000)
  const panelEntry = page.getByText('写作面板', { exact: false }).first()
  if (await panelEntry.count() > 0) await panelEntry.click({ timeout: 3000 }).then(() => {}, () => {})
  await page.waitForTimeout(6000)
  await page.screenshot({ path: './browser-test-out/3-default-workspace.png' })
  writeReport('默认工作区会话', page)
}

// 抓主区域文本（面板内容落 DOM 文本，直接断言）
await writeReport('initial', page)
const bodyText = readFileSync('./browser-test-out/body-initial.txt', 'utf8')
const panelMarks = ['写作面板', '全书概况', '项目扫描失败', '正在定位', '章节', '伏笔']
console.log('--- panel markers ---')
for (const mark of panelMarks) console.log(`${mark}: ${bodyText.includes(mark) ? 'FOUND' : 'missing'}`)
const idx = bodyText.indexOf('写作面板')
if (idx >= 0) console.log('--- context ---\n' + bodyText.slice(idx, idx + 600))

writeFileSync('./browser-test-out/console.log', logs.join('\n'))
console.log('clicked-panel-entry:', clicked)
console.log('--- console/page errors ---')
console.log(logs.filter(l => l.includes('error') || l.includes('Error') || l.includes('failed')).slice(0, 30).join('\n') || '(none)')
await browser.close()
