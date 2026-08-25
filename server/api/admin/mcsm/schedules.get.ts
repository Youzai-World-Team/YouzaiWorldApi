import { requireAuth } from '../../../utils/db'
import {
  listSchedules,
  requireInstance,
  SCHEDULE_ACTION_LABELS,
  SCHEDULE_TYPE_LABELS,
} from '../../../utils/mcsm-server-config'

/** 实例的计划任务列表，附上给下拉框用的类型与动作枚举。 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  const query = getQuery(event)
  const uuid = String(query.uuid || '')
  const daemonId = String(query.daemonId || '')
  await requireInstance(uuid, daemonId)

  return {
    schedules: await listSchedules(uuid, daemonId),
    types: Object.entries(SCHEDULE_TYPE_LABELS).map(([value, label]) => ({ value: Number(value), label })),
    actions: Object.entries(SCHEDULE_ACTION_LABELS).map(([value, label]) => ({ value, label })),
  }
})
