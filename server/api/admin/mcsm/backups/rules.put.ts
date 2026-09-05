import { recordAudit, requireFeaturePermission } from '../../../../utils/db'
import { setBackupRules } from '../../../../utils/mcsm-backup'
import { assertInstanceAllowed } from '../../../../utils/mcsm'

/** 保存整实例备份使用的 .epbaklst 黑白名单。 */
export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-manage-backup', 'edit')
  const body = await readBody<{ uuid?: string; daemonId?: string; text?: string }>(event)
  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const instance = await assertInstanceAllowed(uuid, daemonId)
  const text = await setBackupRules(uuid, daemonId, body?.text)
  recordAudit(event, user, `更新实例「${instance.nickname || uuid}」的备份规则（${text.length} 字符）`)
  return { ok: true, text }
})
