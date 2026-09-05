import { recordAudit, requireFeaturePermission } from '../../../utils/db'
import { BACKUP_NAME_RE, deleteBackup, listBackups } from '../../../utils/mcsm-backup'
import { assertInstanceAllowed } from '../../../utils/mcsm'

/** 删除一个备份压缩包。只认备份插件返回、符合命名规则的文件名。 */
export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-manage-backup', 'edit')
  const body = await readBody<{ uuid?: string; daemonId?: string; name?: string }>(event)

  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const name = String(body?.name || '')
  if (!BACKUP_NAME_RE.test(name)) {
    throw createError({ statusCode: 400, statusMessage: '备份文件名不合法' })
  }
  const instance = await assertInstanceAllowed(uuid, daemonId)

  const backups = await listBackups(uuid, daemonId)
  if (!backups.some((backup) => backup.name === name)) {
    throw createError({ statusCode: 404, statusMessage: '备份不存在或已被删除' })
  }

  await deleteBackup(uuid, daemonId, name)
  recordAudit(event, user, `删除实例「${instance.nickname || uuid}」的备份 ${name}`)
  return { ok: true }
})
