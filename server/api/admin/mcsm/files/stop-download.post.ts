import { recordAudit, requireFeaturePermission } from '../../../../utils/db'
import { assertInstanceAllowed } from '../../../../utils/mcsm'
import { stopDownload } from '../../../../utils/mcsm-files'

export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-files-edit', 'edit')
  const body = await readBody<{ uuid?: string; daemonId?: string; fileName?: string }>(event)
  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const instance = await assertInstanceAllowed(uuid, daemonId)
  const result = await stopDownload(uuid, daemonId, body?.fileName)
  recordAudit(event, user, `停止实例「${instance.nickname || uuid}」的文件下载 ${String(body?.fileName || '')}`)
  return result
})
