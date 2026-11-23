import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { contentHash, parseFrontmatter } from 'dsh-writer-domain'

const output = resolve(process.env.WRITER_FIXTURE_REPORT_DIR ?? '.tmp/ui-implementation/browser')
const fixtureOrigin = process.env.WRITER_FIXTURE_ORIGIN ?? 'http://127.0.0.1:63438'
const shellMode = process.argv.includes('--shell')
const initMode = process.argv.includes('--init')
const blankInitMode = process.argv.includes('--blank-init')
const watchMode = process.argv.includes('--watch')
await mkdir(output, { recursive: true })
const pages = await fetch((process.env.WRITER_FIXTURE_CDP_ORIGIN ?? 'http://127.0.0.1:9227') + '/json/list', { signal: AbortSignal.timeout(10_000) }).then(response => response.json())
const socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
let nextId = 0
const pending = new Map()
const errors = []
socket.addEventListener('close', () => {
    for (const task of pending.values()) {
        clearTimeout(task.timer)
        task.reject(new Error('浏览器调试连接已关闭'))
    }
    pending.clear()
})
socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.executionContextsCleared') errors.length = 0
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
    if (!message.id || !pending.has(message.id)) return
    const task = pending.get(message.id)
    pending.delete(message.id)
    clearTimeout(task.timer)
    if (message.error) task.reject(new Error(JSON.stringify(message.error)))
    else task.resolve(message.result)
})
function call(method, params = {}) {
    if (socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('浏览器调试连接已关闭'))
    return new Promise((resolve, reject) => {
        const id = ++nextId
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout ' + method)) }, 20000)
        pending.set(id, { resolve, reject, timer })
        socket.send(JSON.stringify({ id, method, params }))
    })
}
async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
}
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
async function check(expression, label) {
    if (!await evaluate('(async()=>(' + expression + '))()')) throw new Error('FAIL: ' + label)
    console.log('PASS:', label)
}
async function waitFor(expression, label) {
    for (let attempt = 0; attempt < 80; attempt++) {
        if (await evaluate('(async()=>(' + expression + '))()')) {
            console.log('PASS:', label)
            return
        }
        await pause(80)
    }
    throw new Error('FAIL: ' + label)
}
async function click(selector) {
    await evaluate('(() => { const element = document.querySelector(' + JSON.stringify(selector) + '); element.focus(); element.click(); })()')
    await pause(60)
}
async function textButton(text, scope = '.writer-studio') {
    await evaluate('(() => { const button = [...document.querySelector(' + JSON.stringify(scope) + ').querySelectorAll("button")].find(element => element.getClientRects().length && element.textContent.trim() === ' + JSON.stringify(text) + '); if (!button) throw new Error("button missing"); button.focus(); button.click(); })()')
    await pause(60)
}
async function fill(selector, value) {
    await evaluate('(() => { const input = document.querySelector(' + JSON.stringify(selector) + '); Object.getOwnPropertyDescriptor(input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,"value").set.call(input,' + JSON.stringify(value) + '); input.dispatchEvent(new Event("input",{bubbles:true})); })()')
    await pause(60)
}
async function key(key, code) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code })
    await pause(60)
}
async function screenshot(name) {
    const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    await writeFile(resolve(output, name), Buffer.from(result.data, 'base64'))
}

try {
    await call('Page.enable')
    await call('Runtime.enable')
    await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
    await call('Page.navigate', { url: fixtureOrigin + '/' + (blankInitMode ? '?blank-init=1' : watchMode ? '?watch=1' : shellMode ? '?shell=1' : initMode ? '?init=1' : '') })
    if (blankInitMode) {
        const hero = '[data-slot="conversation.hero.options"]'
        const heroText = 'document.querySelector(' + JSON.stringify(hero) + ')?.textContent'
        await waitFor('!!document.querySelector("[data-content-phase=hero]") && !document.querySelector("[data-conversation-tabs], .writer-studio") && !!document.querySelector("[data-native-input]")', '首轮前宿主 Hero 和输入框可见，工作台标签和正文未挂载')
        await pause(100)
        await check('!' + heroText + '?.includes("一键初始化")', '未启用写作服务的会话不显示初始化入口')
        await evaluate('writerFixture.setPreset("writer")')
        await waitFor(heroText + '?.includes("一键初始化")', '首轮前通过宿主 Hero 槽提供一键初始化')
        await textButton('一键初始化', hero)
        await waitFor(heroText + '?.includes("项目已就绪")', '初始化成功后宿主仍停在首轮前 Hero')
        await check('(await writerFixture.readFile("init-blank", "novel/project.md")).value.text.includes("未命名作品")', '首轮前创建的作品信息实际写入磁盘')
        await check('document.querySelector("[data-native-input]").value === "初始化前已有草稿" && !document.querySelector("[data-conversation-tabs], .writer-studio") && writerFixture.calls.filter(call => call[0] === "command" && call[2] === "/writer-project-init").length === 1 && !writerFixture.calls.some(call => call[0] === "append" || call[0] === "view")', '初始化只执行一次命令，保留草稿和宿主 blank 状态')
        await textButton('和助手确定故事方向', hero)
        await waitFor('document.querySelector("[data-native-input]").value.startsWith("初始化前已有草稿") && document.querySelector("[data-native-input]").value.includes("故事方向") && !document.querySelector("[data-conversation-tabs]")', '起步要求追加到首轮草稿，保留原文字和首轮前状态')
        for (const [id, name] of [['init-nonempty', 'notes.txt'], ['init-hidden', '.hidden']]) {
            await evaluate('writerFixture.switchSession(' + JSON.stringify(id) + ')')
            await waitFor(heroText + '?.includes("目录指引")', '非空目录在 Hero 显示使用指引：' + id)
            await click(hero + ' summary')
            await check('!' + heroText + '?.includes("一键初始化") && (await writerFixture.readFile(' + JSON.stringify(id) + ', ' + JSON.stringify(name) + ')).value.text.includes("已有内容")', '非空目录保留原文件且不显示初始化入口：' + id)
        }
        await evaluate('writerFixture.switchSession("init-git")')
        await waitFor(heroText + '?.includes("一键初始化")', '仅有 Git 元数据和空 novel 的工作区可一键初始化')
        await textButton('一键初始化', hero)
        await waitFor(heroText + '?.includes("项目已就绪")', 'Git 工作区初始化成功')
        await check('(await writerFixture.readFile("init-git", ".git/HEAD")).value.text === "ref: refs/heads/main"', '初始化保留 Git 元数据')
        await evaluate('writerFixture.switchSession("init-retry")')
        await waitFor(heroText + '?.includes("重试初始化")', '首轮前显示重试初始化')
        await textButton('重试初始化', hero)
        await waitFor(heroText + '?.includes("项目已就绪")', '原目录可以重试初始化')
        await check('(await writerFixture.readFile("init-retry", "novel/outline.md")).value.text.includes("必须保留") && (await writerFixture.readFile("init-retry", "novel/project.md")).ok && !(await writerFixture.readFile("init-retry", "novel/.initializing")).ok', '重试保留作者的大纲，补齐缺失项并清除标记')
        await evaluate('writerFixture.switchSession("init-blank"); writerFixture.endBlank()')
        await waitFor('!!document.querySelector("[data-conversation-tabs]") && !!document.querySelector(".ws-nav") && !document.querySelector("[data-content-phase=hero]")', '宿主首轮状态变化后原工作台标签可达')
        await check('document.querySelector("#writer-view-manuscript").textContent.includes("和助手确定故事方向") && !document.querySelector("#writer-view-manuscript").textContent.includes("准备第一章要求")', '新项目的稿件空态提供构思入口，等待第一章计划')
        if (errors.length) throw new Error(errors.join('\n'))
        socket.close()
        process.exit(0)
    }
    if (watchMode) {
        await waitFor('document.querySelector(".ws-top")?.textContent.includes("监听验证") && writerFixture.watchPaths.has("novel")', '面板读到已有项目，根目录监听就绪')
        const dirs = ['novel', 'novel/chapters', 'novel/chapters/卷一', 'novel/characters', 'novel/plots', 'novel/style', 'novel/worldbuilding']
        await waitFor('JSON.stringify([...writerFixture.watchPaths].sort()) === ' + JSON.stringify(JSON.stringify(dirs)), '每个存在的空实体目录都已订阅，缺失目录未订阅')
        await check('JSON.stringify([...writerFixture.watchAttempts].sort()) === ' + JSON.stringify(JSON.stringify(dirs)), '只尝试订阅已存在的目录')
        await check('(await writerFixture.editFile("novel/project.md", "---\\ntitle: 项目根更新\\n---\\n")).ok', '修改根目录作品信息')
        await waitFor('document.querySelector(".ws-top")?.textContent.includes("项目根更新")', '根目录文件变动自动刷新')
        const entities = [
            ['chapters/001.md', '章稿监听内容'],
            ['chapters/卷一/002.md', '卷稿监听内容'],
            ['characters/one.md', '人物监听内容'],
            ['plots/one.md', '伏笔监听内容'],
            ['style/one.md', '文风监听内容'],
            ['worldbuilding/one.md', '设定监听内容'],
        ]
        let chapterSource
        for (const [file, title] of entities) {
            const path = 'novel/' + file
            const source = '---\nname: ' + title + '\nnumber: ' + (file.includes('002.md') ? 2 : 1) + '\ntitle: ' + title + '\nhint: ' + title + '\n---\n# ' + title + '\n\n' + title + '测试正文。\n'
            if (file === 'chapters/001.md') chapterSource = source
            await check('(await writerFixture.editFile(' + JSON.stringify(path) + ', ' + JSON.stringify(source) + ')).ok', '写入子目录首个文件：' + file)
            if (file === 'chapters/卷一/002.md') {
                await waitFor('[...document.querySelectorAll(".ws-reader-footer button")].some(button => button.textContent.includes("下一章") && !button.disabled)', '章节导航发现卷目录新增章')
                await textButton('下一章 →')
            }
            await waitFor('document.querySelector(".writer-studio")?.textContent.includes(' + JSON.stringify(title) + ')', '新增文件自动刷新：' + file)
        }
        await check('(await writerFixture.editFile("novel/characters/one.md", "---\\nname: 更新后人物\\n---\\n正文")).ok', '修改人物文件成功')
        await waitFor('document.querySelector("#writer-view-characters")?.textContent.includes("更新后人物")', '修改文件自动刷新')
        await check('(await writerFixture.editFile("novel/characters/one.md", null)).ok', '删除人物文件成功')
        await waitFor('!document.querySelector("#writer-view-characters")?.textContent.includes("更新后人物")', '删除文件自动刷新')
        await click('[aria-controls="writer-view-pending"]')
        const pendingView = 'document.querySelector("#writer-view-pending .ws-detail")?.textContent'
        await check('(await writerFixture.editFile("novel/pending.md", "# 待办\\n\\n## chapter/001\\n\\n- 初版建议：核对旧情节。\\n")).ok', '从磁盘新增待办文件')
        await waitFor(pendingView + '?.includes("初版建议：核对旧情节。")', '工作台自动读取新建的待办文件')
        await check('(await writerFixture.editFile("novel/pending.md", "# 待办\\n\\n## chapter/001\\n\\n- 更新建议：核对场景顺序。\\n")).ok', '从磁盘更新待办文件')
        await waitFor(pendingView + '?.includes("更新建议：核对场景顺序。") && !' + pendingView + '?.includes("初版建议")', '待确认页自动替换旧建议')
        await check(pendingView + '?.includes("归档本章建议") && !' + pendingView + '?.includes("准备确认请求")', '旧格式待办可归档，版本待核时没有确认入口')
        const { frontmatter, content } = parseFrontmatter(chapterSource)
        const currentPending = `## [维护 pass] chapter/001（冒烟测试）待人工确认\n<!-- writer-pending-source:${contentHash(frontmatter, content)} -->\n- 核对开场。\n`
        await check('(await writerFixture.editFile("novel/pending.md", ' + JSON.stringify(currentPending) + ')).ok', '写入带真实源章哈希的待办')
        await waitFor(pendingView + '?.includes("当前版本") && ' + pendingView + '?.includes("准备确认请求")', '源章哈希匹配时可准备确认')
        await check('(await writerFixture.editFile("novel/chapters/001.md", ' + JSON.stringify(chapterSource + '\n修改后的章稿。\n') + ')).ok', '从磁盘改写源章')
        await waitFor(pendingView + '?.includes("源章已变化") && !' + pendingView + '?.includes("准备确认请求")', '章稿变更后取消旧建议的确认入口')
        await textButton('对话', '[data-conversation-tabs]')
        await waitFor('!document.querySelector(".writer-studio") && writerFixture.watchPaths.size === 0', '卸载工作台后全部退订')
        await fill('[data-native-input]', '保留这段原始草稿')
        await textButton('写作面板', '[data-conversation-tabs]')
        await waitFor('!!document.querySelector(".ws-nav")', '已有项目重新打开工作台')
        await click('[aria-controls="writer-view-manuscript"]')
        await textButton('← 上一章')
        await check('document.querySelector(".ws-chapter-title")?.textContent === "章稿监听内容"', '选中磁盘上的已有章稿')
        const chapterRead = '(await writerFixture.readFile("init-watch", "novel/chapters/001.md")).value.text'
        const before = await evaluate('(async () => ' + chapterRead + ')()')
        await textButton('局部改稿')
        await evaluate('(() => { const field = document.querySelector(".ws-dialog textarea[readonly]"); const text = "修改后的章稿。"; const index = field.value.indexOf(text); field.setSelectionRange(index, index + text.length) })()')
        await textButton('使用所选原文', '.ws-dialog')
        await fill('[aria-label="修改要求"]', '仅修改所选句子。')
        await textButton('登记改稿范围', '.ws-dialog')
        await waitFor('document.querySelector(".ws-dialog textarea")?.value.includes("request_id=")', '已登记原文和版本')
        const revised = await evaluate('document.querySelector(".ws-dialog textarea").value')
        const id = /request_id="([^"]+)"/.exec(revised)[1]
        await textButton('添加到对话草稿', '.ws-dialog')
        await waitFor('!!document.querySelector("[data-chat-view]") && document.querySelector("[data-native-input]").value === ' + JSON.stringify('保留这段原始草稿\n\n' + revised), '改稿请求追加到宿主已有草稿，回到对话且保留原有文字')
        await check(chapterRead + ' === ' + JSON.stringify(before), '准备改稿请求后磁盘原稿保持原样')
        const runRewrite = patches => 'writerFixture.rewrite(' + JSON.stringify(id) + ', ' + JSON.stringify(patches) + ')'
        await check('!(await ' + runRewrite([{ find: '章稿监听内容测试正文。', replace: '越界。' }]) + ').ok', '越界补丁经真实登记和引擎拒绝')
        await check(chapterRead + ' === ' + JSON.stringify(before), '越界失败后原稿字节保持不变')
        await check('(await ' + runRewrite([{ find: '修改后的章稿。', replace: '确认后的章稿。' }]) + ').ok', '合法补丁经真实登记和引擎保存')
        await check('(' + chapterRead + ').split("\\n---\\n")[1] === ' + JSON.stringify(before.split('\n---\n')[1].replace('修改后的章稿。', '确认后的章稿。')), '落盘只修改所选正文，元数据保持原义')
        if (errors.length) throw new Error(errors.join('\n'))
        socket.close()
        process.exit(0)
    }
    if (initMode) {
        const ready = async text => {
            for (let attempt = 0; attempt < 80; attempt++) {
                if (await evaluate('document.querySelector(".writer-studio")?.textContent.includes(' + JSON.stringify(text) + ')')) return
                await pause(80)
            }
            throw new Error('等待界面超时：' + text)
        }
        await ready('一键初始化')
        await check('!document.querySelector(".ws-nav") && !document.querySelector("[role=alert]")', '空目录显示欢迎页，隐藏无效导航和错误')
        await screenshot('project-init-welcome.png')
        await textButton('一键初始化')
        await ready('未命名作品')
        await check('!!document.querySelector(".ws-nav") && !document.querySelector(".ws-welcome")', '真实目录初始化后自动进入工作台')
        await check('writerFixture.drafts["init-empty"] === "初始化前已有草稿" && !writerFixture.calls.some(call => call[0] === "append")', '初始化不改草稿，不调用模型')
        await check('(await writerFixture.readFile("init-empty", "novel/project.md")).value.text.includes("未命名作品")', '作品信息实际写入磁盘')
        await evaluate('writerFixture.switchSession("init-other")')
        await ready('一键初始化')
        await check('!document.querySelector(".ws-nav")', '另一个空目录仍显示欢迎页，项目不串台')
        for (const [id, name] of [['init-nonempty', 'notes.txt'], ['init-hidden', '.hidden']]) {
            await evaluate('writerFixture.switchSession(' + JSON.stringify(id) + ')')
            await ready('当前工作目录非空')
            await check('![...document.querySelectorAll("button")].some(button => button.textContent.includes("一键初始化")) && document.querySelector(".ws-welcome").textContent.includes(' + JSON.stringify(name) + ')', '非空目录和隐藏文件阻止初始化：' + id)
        }
        await screenshot('project-init-blocked.png')
        await evaluate('writerFixture.switchSession("init-race")')
        await ready('一键初始化')
        await evaluate('writerFixture.addFile("init-race")')
        await textButton('一键初始化')
        await ready('当前工作目录非空')
        await check('(await writerFixture.readFile("init-race", "notes.txt")).value.text.includes("新放入的文件")', '检查后目录变化仍保留文件并拒绝初始化')
        await evaluate('writerFixture.switchSession("init-error")')
        await ready('权限不足')
        await check('!document.querySelector(".ws-welcome-preview")', '读取失败不伪装成空目录')
        await evaluate('writerFixture.switchSession("init-other")')
        await ready('一键初始化')
        for (const width of [1280, 960, 720, 390]) {
            await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
            await pause(80)
            await check('document.documentElement.scrollWidth <= innerWidth + 1 && document.documentElement.scrollHeight <= innerHeight + 1', '欢迎页无整页溢出：' + width)
        }
        await screenshot('project-init-narrow.png')
        await evaluate('writerFixture.failStatus("init-other")')
        await textButton('重新检查')
        await ready('连接已断开')
        await check('!document.querySelector(".ws-welcome-preview") && ![...document.querySelectorAll("button")].some(button => button.textContent === "一键初始化")', '再次检查失败后清除陈旧空目录判定')
        if (errors.length) throw new Error(errors.join('\n'))
        console.log('PASS: 初始化浏览器流程及异常检查')
        socket.close()
        process.exit(0)
    }
    for (let attempt = 0; attempt < 80; attempt++) { await pause(100); if (await evaluate('!!document.querySelector(".ws-chapter-title")')) break }
    await check('document.querySelector(".ws-top").textContent.includes("长夜有歌")', '真实 bundle 冷扫描呈现项目')
    await check('getComputedStyle(document.querySelector(".writer-studio")).getPropertyValue("--writer-bg").trim().length > 0', '宿主主题变量已加载')
    if (shellMode) {
        await check('!!document.querySelector("[data-composer-seat]") && !document.querySelector("[data-composer-seat]").getClientRects().length', '写作面板隐藏宿主底部区域且保留挂载')
        await check('![...document.querySelectorAll("[data-native-todos],[data-native-input]")].some(element => element.getClientRects().length)', '任务列表与输入框不可见')
        await evaluate('window.nativeInput = document.querySelector("[data-native-input]"); const other = document.createElement("div"); other.dataset.composerSeat=""; other.dataset.unrelatedComposer=""; other.textContent="另一区域"; other.style="position:fixed;right:0;bottom:0"; document.body.append(other)')
        await check('document.querySelector("[data-unrelated-composer]").getClientRects().length > 0', '不影响其他区域的宿主底部控件')
        await evaluate('document.querySelector("[data-unrelated-composer]").remove()')
        for (const width of [1280, 390]) {
            await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
            await pause(120)
            await check('Math.abs(document.querySelector(".writer-studio").getBoundingClientRect().height - document.querySelector("[data-conversation-scroll]").clientHeight) <= 1 && document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1', '工作台占满会话高度且无整页溢出：' + width)
            await textButton('对话', '[data-conversation-tabs]')
            await check('document.querySelector("[data-composer-seat]").getClientRects().length > 0 && document.querySelector("[data-native-todos]").getClientRects().length > 0 && document.querySelector("[data-native-input]") === window.nativeInput', '切回对话恢复任务及原输入节点：' + width)
            await fill('[data-native-input]', '需要保留的宿主草稿')
            await textButton('写作面板', '[data-conversation-tabs]')
            await pause(150)
            await check('!document.querySelector("[data-composer-seat]").getClientRects().length && document.querySelector("[data-native-input]").value === "需要保留的宿主草稿" && document.querySelector("[data-native-input]") === window.nativeInput', '再次进入面板隐藏底部且不丢草稿：' + width)
        }
        await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
        await screenshot('studio-shell.png')
        await textButton('续写本章')
        await textButton('添加到对话草稿', '.ws-dialog')
        await check('!!document.querySelector("[data-chat-view]") && document.querySelector("[data-native-input]") === window.nativeInput && window.nativeInput.getClientRects().length > 0 && window.nativeInput.value.startsWith("需要保留的宿主草稿") && window.nativeInput.value.includes("chapter/")', '交给助手时返回对话并恢复追加后的原输入框')
        await writeFile(resolve(output, 'shell-checks.json'), JSON.stringify({ errors }, null, 4))
        if (errors.length) throw new Error(errors.join('\n'))
        console.log('PASS: 实际宿主外壳的隐藏、恢复、高度与草稿交接')
    } else {
        await click('.ws-toolbar button.ws-outline')
        await check('document.activeElement.matches(".ws-dialog input[type=search]")', '目录初始焦点位于搜索框')
        await key('Escape', 27)
        await check('document.activeElement.matches(".ws-toolbar button.ws-outline")', 'Esc 关闭目录后恢复触发按钮焦点')
        await click('.ws-toolbar button.ws-outline')
        const before = await evaluate('document.querySelector(".ws-directory-list").getBoundingClientRect().height')
        await fill('.ws-dialog input[type=search]', '128')
        await check('document.querySelectorAll(".ws-directory-list button").length === 1', '跨卷精确定位第128章')
        await check('document.querySelector(".ws-directory-list").getBoundingClientRect().height === ' + before, '搜索不改变目录高度')
        await click('.ws-directory-list button')
        await check('document.querySelector(".ws-chapter-title").textContent === "夜航之前"', '选章切换真实全文')
        await textButton('← 上一章')
        await check('document.querySelector(".ws-eyebrow").textContent.includes("126")', '前后章跳过缺失的127章')
        await textButton('下一章 →')
        await click('[aria-controls="writer-view-characters"]')
        await fill('#writer-view-characters input[type=search]', '苏眠')
        await textButton('关系', '#writer-view-characters')
        await textButton('陈默', '#writer-view-characters')
        await check('document.querySelector("#writer-view-characters .ws-detail h2").textContent === "陈默"', '人物搜索后关系跳转仍可定位目标')
        await click('[aria-controls="writer-view-manuscript"]')
        await textButton('续写本章')
        await check('document.querySelector(".ws-dialog textarea").value.includes("chapter/128")', '请求含准确章号')
        await textButton('添加到对话草稿', '.ws-dialog')
        await check('writerFixture.drafts.a.startsWith("已有草稿与引用") && writerFixture.drafts.a.includes("chapter/128") && writerFixture.referenceChips.a.length === 1', '草稿追加保留原文字与引用')
        await check('writerFixture.calls.slice(-2).map(call=>call[0]).join(",") === "persist,view"', '草稿持久化后导航，未触发发送')
        await evaluate('writerFixture.phases.a = "claimed"')
        await textButton('审阅本章')
        const count = await evaluate('writerFixture.calls.length')
        await textButton('添加到对话草稿', '.ws-dialog')
        await check('writerFixture.calls.length === ' + count + ' && !!document.querySelector(".ws-dialog textarea")', '命令草稿阻止追加并保留请求')
        await key('Escape', 27)
        await evaluate('writerFixture.phases.a = "plain"')
        await click('[aria-controls="writer-view-pending"]')
        await check('document.querySelectorAll("#writer-view-pending .ws-suggestion").length >= 20', '超过原十五行上限的待确认全部可达')
        await evaluate('document.querySelector("#writer-view-pending .ws-archive").open = true')
        await check('document.querySelector("#writer-view-pending .ws-archive").textContent.includes("人工说明不可丢失") && document.querySelector("#writer-view-pending .ws-archive").textContent.includes("已确认状态")', '归档完成项与非列表原文完整保留')
        await evaluate('writerFixture.switchSession("b")')
        for (let attempt = 0; attempt < 40; attempt++) { await pause(100); if (await evaluate('document.querySelector(".ws-top").textContent.includes("第二本小说")')) break }
        await check('document.querySelector(".ws-top").textContent.includes("第二本小说") && !writerFixture.drafts.b.includes("chapter/128")', '切换会话不串扫描或草稿')
        await evaluate('writerFixture.switchSession("a")')
        await pause(250)
        await click('[aria-controls="writer-view-manuscript"]')
        await screenshot('studio-light.png')
        const measurements = []
        for (const width of [1280, 960, 720, 390]) {
            await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
            await pause(120)
            for (const page of ['manuscript', 'outline', 'characters', 'plots', 'library', 'pending', 'overview']) {
                await click('[aria-controls="writer-view-' + page + '"]')
                const metrics = await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,height:innerHeight,body:document.documentElement.scrollHeight})')
                if (metrics.scroll > width + 1 || metrics.body > metrics.height + 1) throw new Error('overflow ' + page + ': ' + JSON.stringify(metrics))
                measurements.push({ page, ...metrics })
            }
        }
        await click('[aria-controls="writer-view-manuscript"]')
        await screenshot('studio-narrow.png')
        const lightColor = await evaluate('getComputedStyle(document.querySelector(".writer-studio")).backgroundColor')
        await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
        await evaluate('document.body.setAttribute("data-ds-dark-theme", "")')
        await pause(200)
        await check('getComputedStyle(document.querySelector(".writer-studio")).backgroundColor !== ' + JSON.stringify(lightColor), '暗色主题切换实际背景色')
        await screenshot('studio-dark.png')
        await writeFile(resolve(output, 'checks.json'), JSON.stringify({ errors, measurements }, null, 4))
        if (errors.length) throw new Error(errors.join('\n'))
        console.log('PASS: 28 页面/宽度组合、亮暗截图与无页面异常')
    }
} catch (error) {
    console.error('页面错误:', errors)
    console.error(await evaluate('document.body.innerText.slice(0,1200)').catch(() => '无法读取页面'))
    await screenshot('failure.png').catch(() => {})
    throw error
} finally {
    socket.close()
}
