import { requireFeaturePermission } from '../../../../utils/db'
import { getModBatchInfo } from '../../../../utils/mcsm-mods'

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'server-manage-mods', 'view')
  const body = await readBody<{ hashes?: unknown }>(event)
  return getModBatchInfo(body?.hashes)
})
