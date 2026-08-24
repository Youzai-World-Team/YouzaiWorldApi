import { recordAudit, requireFeaturePermission } from '../../../utils/db'
import { assertInstanceAllowed, requireCommand, sendCommand } from '../../../utils/mcsm'

/**
 * 向实例控制台发送一条命令。
 * <p>
 * 等同于在服务器后台敲命令（可以 op、ban、stop），因此除页面编辑权限外还要
 * 单独的「发送命令」区域权限，并把命令原文写进操作记录——事后要能查是谁发的。
 * </p>
 */
export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-manage-command', 'edit')
  const body = await readBody<{ uuid?: string; daemonId?: string; command?: string }>(event)

  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const command = requireCommand(body?.command)
  const instance = await assertInstanceAllowed(uuid, daemonId)

  await sendCommand(uuid, daemonId, command)
  recordAudit(event, user, `向实例「${instance.nickname || uuid}」发送命令：${command}`)
  return { ok: true, command }
})
