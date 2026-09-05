import { recordAudit, requireFeaturePermission } from '../../../utils/db'
import { replaceSchedule, requireInstance } from '../../../utils/mcsm-server-config'

/** 更新计划任务。面板没有原生更新路由，适配层会删除同名任务后重建并在失败时回滚。 */
export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-manage-schedule', 'edit')
  const body = await readBody<Record<string, unknown>>(event)
  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const instance = await requireInstance(uuid, daemonId)
  const schedule = await replaceSchedule(uuid, daemonId, {
    name: body?.name,
    type: body?.type,
    time: body?.time,
    count: body?.count,
    actions: body?.actions,
  })
  recordAudit(
    event,
    user,
    `更新实例「${instance.nickname || uuid}」的计划任务 ${schedule.name}`
    + `（${schedule.actions.map((action) => action.typeLabel).join('、')}，${schedule.timeLabel}）`,
  )
  return { ok: true, schedule }
})
