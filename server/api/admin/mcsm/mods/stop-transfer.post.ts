import { requireFeaturePermission } from '../../../../utils/db'
import { stopModTransfer } from '../../../../utils/mcsm-mods'

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'server-manage-mods', 'edit')
  const body = await readBody<Record<string, unknown>>(event)
  return stopModTransfer(String(body?.uuid || ''), String(body?.daemonId || ''), body || {})
})
