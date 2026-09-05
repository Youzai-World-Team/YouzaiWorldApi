import { recordAudit, requireFeaturePermission } from '../../../../utils/db'
import { assertInstanceAllowed } from '../../../../utils/mcsm'
import { downloadFromUrl } from '../../../../utils/mcsm-files'

export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-files-edit', 'edit')
  const body = await readBody<Record<string, unknown>>(event)
  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const instance = await assertInstanceAllowed(uuid, daemonId)
  const result = await downloadFromUrl(uuid, daemonId, body?.url, body?.fileName || body?.file_name)
  recordAudit(event, user, `让实例「${instance.nickname || uuid}」从 URL 下载文件 ${String(body?.fileName || body?.file_name || '')}`)
  return result
})
