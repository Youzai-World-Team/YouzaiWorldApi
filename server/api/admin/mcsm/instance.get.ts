import { requireAuth } from '../../../utils/db'
import { getInstanceDetail } from '../../../utils/mcsm'

/** 单个实例的运行详情（状态、玩家数、CPU/内存、存储、工作目录等）。 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  const query = getQuery(event)
  return getInstanceDetail(String(query.uuid || ''), String(query.daemonId || ''))
})
