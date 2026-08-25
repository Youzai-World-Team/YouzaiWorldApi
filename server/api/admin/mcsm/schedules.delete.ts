import { recordAudit, requireFeaturePermission } from '../../../utils/db'
import { deleteSchedule, listSchedules, requireInstance } from '../../../utils/mcsm-server-config'

/** 删除计划任务。先确认任务真的在列表里，避免误删同名以外的东西。 */
export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-manage-schedule', 'edit')
  const body = await readBody<{ uuid?: string; daemonId?: string; name?: string }>(event)

  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const name = String(body?.name || '')
  const instance = await requireInstance(uuid, daemonId)

  const schedules = await listSchedules(uuid, daemonId)
  if (!schedules.some((schedule) => schedule.name === name)) {
    throw createError({ statusCode: 404, statusMessage: '计划任务不存在或已被删除' })
  }

  await deleteSchedule(uuid, daemonId, name)
  recordAudit(event, user, `删除实例「${instance.nickname || uuid}」的计划任务 ${name}`)
  return { ok: true }
})
