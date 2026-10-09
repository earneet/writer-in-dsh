/**
 * dsh-writer-ui 宿主半（Node half）：无宿主侧行为，仅为 Loader 提供包身份与生命周期。
 * 全部功能在浏览器半（./client 导出，经 /plugins 路由运行期动态加载）。
 * @module dsh-writer-ui
 */

export const name = 'dsh-writer-ui'
export const inject: readonly string[] = []

export function apply(): void {
  // 宿主半空 apply：写作面板与富卡片全部在浏览器侧注册（slots），
  // 数据从工具结果文本派生，不新增宿主服务或 remote 端点。
}
