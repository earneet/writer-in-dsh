/**
 * Consumer：bundled skill provider，把 assets/ 下的写作技能目录束注册进 `ctx.skills`。
 * 资产为单一真源：每个 `<name>/SKILL.md` 的 frontmatter（name/description/whenToUse/
 * 调用控制布尔）即候选元数据，正文即技能体；apply 时同步加载并严格校验（配置错误响亮失败）。
 * 范式参考 references/deepseek-harness/packages/skill/skill-badge/src/index.ts（bundled provider）。
 * 规划见 docs/implementation-plan.md §1.6。
 * @module dsh-writer-skills
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { BUNDLED_SKILL_RANK, isSkillName, type SkillCandidate, type SkillDefinition, type SkillProvider } from '@deepseek-ai/dsh-skill'
import { parseFrontmatter } from 'dsh-writer-domain'

export const name = 'writer-skills'
export const inject = ['skills']

/** 技能资产根（打包后随包分发，目录束 `<name>/SKILL.md`）。 */
const ASSETS_ROOT = fileURLToPath(new URL('../assets/', import.meta.url))
/** 提供者名（技能缝 registry 内唯一标识）。 */
const PROVIDER_NAME = 'writer-bundled'

/** 一个已加载的 bundled 技能：候选 + 正文成对出现（get 不再二次读盘）。 */
export interface BundledSkill {
  candidate: SkillCandidate
  content: string
}

/** 校验并装配单个技能目录束；任何资产缺陷都在此响亮失败。 */
export function loadSkill(dirName: string, root: string = ASSETS_ROOT): BundledSkill {
  const dirAbs = join(root, dirName)
  const bodyPath = join(dirAbs, 'SKILL.md')
  let raw: string
  try {
    raw = readFileSync(bodyPath, 'utf8')
  } catch (err) {
    throw new Error(`bundled skill 资产缺失或不可读：${bodyPath}：${String(err)}`)
  }
  const { frontmatter, content } = parseFrontmatter(raw)
  const fmName = frontmatter['name']
  const description = frontmatter['description']
  if (typeof fmName !== 'string' || !isSkillName(fmName) || fmName !== dirName) {
    throw new Error(`bundled skill 的 frontmatter name 非法或与目录名不符：${dirName} → ${JSON.stringify(fmName)}`)
  }
  if (typeof description !== 'string' || description.length === 0) {
    throw new Error(`bundled skill 缺少非空 description：${dirName}`)
  }
  const whenToUse = frontmatter['whenToUse']
  if (whenToUse !== undefined && typeof whenToUse !== 'string') {
    throw new Error(`bundled skill 的 whenToUse 必须是字符串：${dirName}`)
  }
  // 调用控制与文件系统技能同语义：disable-model-invocation 默认关（模型可调用），user-invocable 默认开
  const disableModel = frontmatter['disable-model-invocation']
  const userInvocable = frontmatter['user-invocable']
  for (const flag of [disableModel, userInvocable]) {
    if (flag !== undefined && typeof flag !== 'boolean') {
      throw new Error(`bundled skill 的调用控制字段必须为布尔：${dirName}`)
    }
  }
  const candidate: SkillCandidate = {
    name: fmName,
    description,
    whenToUse,
    invocation: {
      modelInvocable: disableModel !== true,
      userInvocable: userInvocable !== false,
    },
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: { kind: 'directory', path: dirAbs },
    rank: BUNDLED_SKILL_RANK,
    locator: pathToFileURL(bodyPath),
  }
  return { candidate, content }
}

/** 扫描资产根并加载全部技能；空资产是打包事故，同样响亮失败。root 参数供测试注入临时目录。 */
export function loadSkills(root: string = ASSETS_ROOT): BundledSkill[] {
  const skills = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadSkill(entry.name, root))
  if (skills.length === 0) throw new Error(`writer-skills 资产目录为空：${root}`)
  return skills
}

/** 注册 bundled provider。技能体在 apply 时一次读入，运行期不可变。 */
export function apply(ctx: Context): void {
  const skills = loadSkills()
  const provider: SkillProvider = {
    name: PROVIDER_NAME,
    list: () => Promise.resolve(skills.map((skill) => skill.candidate)),
    async get(candidate) {
      // 候选与定义同源成对装配；注册后资产不可变，同名即同体
      const skill = skills.find((entry) => entry.candidate.name === candidate.name)
      if (skill === undefined) return undefined
      return {
        name: skill.candidate.name,
        description: skill.candidate.description,
        whenToUse: skill.candidate.whenToUse,
        invocation: skill.candidate.invocation,
        provider: PROVIDER_NAME,
        source: 'bundled',
        resourceBase: skill.candidate.resourceBase,
        content: skill.content,
      } satisfies SkillDefinition
    },
  }
  ctx.skills.registerProvider(() => provider)
}
