import { recordAudit, requireFeaturePermission } from '../../../utils/db'
import { createSchedule, requireInstance } from '../../../utils/mcsm-server-config'

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

  const schedule = await createSchedule(uuid, daemonId, {
    name: body?.name,
    type: body?.type,
    time: body?.time,
    count: body?.count,
    actions: body?.actions,
  })

  recordAudit(
    event,
    user,
    `为实例「${instance.nickname || uuid}」创建计划任务 ${schedule.name}`
    + `（${schedule.actions.map((action) => action.typeLabel).join('、')}，${schedule.timeLabel}）`,
  )
  return { ok: true, schedule }
})
