import { recordAudit, requireFeaturePermission } from '../../../utils/db'
import { getConfigFile, requireInstance, setConfigFile } from '../../../utils/mcsm-server-config'

/**
 * 保存实例配置文件。
 * <p>
 * 面板是整份覆盖写，所以这里先读一遍旧值，只把请求里真正变化的项记进操作记录
 * ——server.properties 有七十来项，全量记下去没法看，而「谁把 white-list 关了」
 * 恰恰是事后最需要查的。
 * </p>
 * <p>
 * 改动要重启服务器才生效（Minecraft 只在启动时读 server.properties），
 * 这一点由页面提示，不在这里代替管理员决定是否重启。
 * </p>
 */
export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-manage-properties', 'edit')
  const body = await readBody<{ uuid?: string; daemonId?: string; fileName?: string; values?: unknown }>(event)

  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const instance = await requireInstance(uuid, daemonId)

  const before = await getConfigFile(uuid, daemonId, body?.fileName)
  const values = await setConfigFile(uuid, daemonId, body?.fileName, body?.values)

  const changed = Object.keys(values).filter((key) => String(before[key] ?? '') !== String(values[key] ?? ''))
  const summary = changed.length
    ? changed.slice(0, 8).map((key) => `${key}=${String(values[key] ?? '')}`).join('、')
      + (changed.length > 8 ? ` 等 ${changed.length} 项` : '')
    : '无实际改动'
  recordAudit(event, user, `修改实例「${instance.nickname || uuid}」的 ${body?.fileName}：${summary}`)

  return { values, changed }
})
