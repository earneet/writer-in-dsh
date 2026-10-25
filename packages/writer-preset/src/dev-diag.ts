/**
 * 临时诊断插件（仅 dev overlay 使用，不发布）：启动后查询 agentPresets 服务，
 * 把模式 roster（含 broken 诊断）写到仓库根 dev-diag.json，供本地验证 preset 挂载状态。
 * @module dev-diag
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const name = 'dev-diag'
export const inject: readonly string[] = []

export function apply(ctx: any): void {
  void writeFile(join(process.cwd(), 'dev-diag.json'), JSON.stringify({ at: new Date().toISOString(), stage: 'apply' }, null, 2)).catch(() => {})
  let tries = 0
  const timer: any = setInterval(async () => {
    tries += 1
    try {
      const svc = ctx.get('agentPresets')
      if (svc === undefined) {
        if (tries < 30) return
        clearInterval(timer)
        await writeFile(join(process.cwd(), 'dev-diag.json'), JSON.stringify({ at: new Date().toISOString(), error: 'agentPresets service not present' }, null, 2)).catch(() => {})
        return
      }
      clearInterval(timer)
      const presets = await svc.list()
      await writeFile(join(process.cwd(), 'dev-diag.json'), JSON.stringify({ at: new Date().toISOString(), stage: 'list', presets }, null, 2)).catch(() => {})
    } catch (error: any) {
      clearInterval(timer)
      await writeFile(join(process.cwd(), 'dev-diag.json'), JSON.stringify({ at: new Date().toISOString(), error: String(error?.stack ?? error) }, null, 2)).catch(() => {})
    }
  }, 2000)
  // 插件卸载时停表，避免计时器在 dispose 后继续轮询/写 dev-diag.json
  ctx.on('dispose', () => clearInterval(timer))
}
