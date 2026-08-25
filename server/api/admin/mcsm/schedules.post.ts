import { recordAudit, requireFeaturePermission } from '../../../utils/db'
import { createSchedule, requireInstance, SCHEDULE_ACTION_LABELS } from '../../../utils/mcsm-server-config'

/**
 * 创建计划任务。
 * <p>
 * 定时任务能执行任意命令、也能停服，所以单独走「计划任务」区域权限，并把
 * 任务名、触发条件和动作一起写进操作记录。面板对任务数量有上限，超了会把
 * 原文报错透上来。
 * </p>
 */
export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-manage-schedule', 'edit')
  const body = await readBody<Record<string, unknown>>(event)

  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const instance = await requireInstance(uuid, daemonId)

  await createSchedule(uuid, daemonId, {
    name: body?.name,
    type: body?.type,
    time: body?.time,
    count: body?.count,
    actionType: body?.actionType,
    command: body?.command,
  })

  const actionLabel = SCHEDULE_ACTION_LABELS[String(body?.actionType) as keyof typeof SCHEDULE_ACTION_LABELS]
    || String(body?.actionType)
  const commandPart = body?.actionType === 'command' ? `：${String(body?.command || '')}` : ''
  recordAudit(
    event,
    user,
    `为实例「${instance.nickname || uuid}」创建计划任务 ${String(body?.name || '')}`
    + `（${actionLabel}${commandPart}，触发 ${String(body?.time || '')}）`,
  )
  return { ok: true }
})
