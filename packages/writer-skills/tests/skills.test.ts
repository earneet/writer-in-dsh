/**
 * writer-skills 组合测试：真实 SkillRegistry + bundled provider 注册闭环。
 * 运行：node --test packages/writer-skills/tests/skills.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { apply, loadSkills } from '../src/index.ts'

test('bundled provider 经真实 SkillRegistry 列出并加载 writer-onboarding', async () => {
  // @ts-expect-error 测试桩：真实 Context 由 loader 提供，此处仅需服务发布与查询
  const ctx = new Context()
  const registry = new SkillRegistry(ctx)
  assert.ok(registry, 'registry 已构造')
  apply(ctx)
  const list = await ctx.skills.list()
  const onboarding = list.find((skill) => skill.name === 'writer-onboarding')
  assert.ok(onboarding, '目录中可见 writer-onboarding')
  assert.equal(onboarding.source, 'bundled')
  assert.equal(onboarding.provider, 'writer-bundled')
  assert.equal(onboarding.invocation.modelInvocable, true)
  assert.equal(onboarding.invocation.userInvocable, true)
  assert.ok(onboarding.description.length > 0 && onboarding.description.length <= 500)
  // P2 新增技能（chapter-writing / foreshadow-guide）一并注册可见
  assert.ok(list.some((skill) => skill.name === 'chapter-writing'), '目录中可见 chapter-writing')
  assert.ok(list.some((skill) => skill.name === 'foreshadow-guide'), '目录中可见 foreshadow-guide')
  const definition = await ctx.skills.get('writer-onboarding')
  assert.ok(definition, '可加载技能体')
  assert.ok(definition!.content.includes('read-before-update'), '正文含写作纪律')
  assert.equal(definition!.resourceBase?.kind, 'directory')
})

test('资产目录束自洽：frontmatter name 与目录名一致且为 kebab-case', async () => {
  const assetsRoot = fileURLToPath(new URL('../assets/', import.meta.url))
  const dirs = (await readdir(assetsRoot, { withFileTypes: true })).filter((e) => e.isDirectory())
  assert.ok(dirs.length > 0, '资产目录非空')
  for (const dir of dirs) {
    const body = await readFile(join(assetsRoot, dir.name, 'SKILL.md'), 'utf8')
    assert.ok(body.startsWith('---\n'), `${dir.name}/SKILL.md 有 frontmatter`)
    assert.ok(body.includes(`name: ${dir.name}\n`), `${dir.name}/SKILL.md frontmatter name 与目录名一致`)
    assert.ok(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(dir.name), `${dir.name} 为 kebab-case`)
    // description 非空且 ≤500 对全部资产生效（与 onboarding 断言同约束）
    const desc = body.match(/^description:\s*(.+)$/m)?.[1] ?? ''
    assert.ok(desc.trim().length > 0 && desc.length <= 500, `${dir.name}/SKILL.md description 非空且 ≤500`)
  }
})

test('响亮失败：坏 frontmatter name、缺 description、缺 SKILL.md 在加载期抛错', async () => {
  // 每个子例独立临时根，避免前一个坏技能先行命中
  const caseBadName = await mkdtemp(join(tmpdir(), 'writer-skills-'))
  const caseNoDesc = await mkdtemp(join(tmpdir(), 'writer-skills-'))
  const caseOrphan = await mkdtemp(join(tmpdir(), 'writer-skills-'))
  try {
    await mkdir(join(caseBadName, 'bad-skill'), { recursive: true })
    await writeFile(join(caseBadName, 'bad-skill', 'SKILL.md'), '---\nname: other-name\ndescription: "x"\n---\n正文\n', 'utf8')
    assert.throws(() => loadSkills(caseBadName), /name 非法或与目录名不符/)

    await mkdir(join(caseNoDesc, 'no-desc'), { recursive: true })
    await writeFile(join(caseNoDesc, 'no-desc', 'SKILL.md'), '---\nname: no-desc\n---\n正文\n', 'utf8')
    assert.throws(() => loadSkills(caseNoDesc), /缺少非空 description/)

    await mkdir(join(caseOrphan, 'orphan'), { recursive: true })
    assert.throws(() => loadSkills(caseOrphan), /资产缺失或不可读/)
  } finally {
    for (const dir of [caseBadName, caseNoDesc, caseOrphan]) {
      await rm(dir, { recursive: true, force: true })
    }
  }
})
