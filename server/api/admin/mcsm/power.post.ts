import { recordAudit, requireFeaturePermission } from '../../../utils/db'
import {
  assertInstanceAllowed,
  isPowerAction,
  POWER_ACTION_LABELS,
  runPowerAction,
} from '../../../utils/mcsm'

/**
 * 实例电源操作：启动 / 停止 / 重启 / 强制结束进程。
 * <p>
 * 停止和重启会踢掉所有在线玩家，强制结束还会跳过存档保存，所以都放在
 * 「电源操作」区域权限后面，并逐次写操作记录。
 * </p>
 */
export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-manage-power', 'edit')
  const body = await readBody<{ uuid?: string; daemonId?: string; action?: string }>(event)

  const action = body?.action
  if (!isPowerAction(action)) {
    throw createError({ statusCode: 400, statusMessage: '电源操作类型无效' })
  }
  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const instance = await assertInstanceAllowed(uuid, daemonId)

  await runPowerAction(uuid, daemonId, action)
  recordAudit(event, user, `对实例「${instance.nickname || uuid}」执行${POWER_ACTION_LABELS[action]}`)
  return { ok: true, action }
})
