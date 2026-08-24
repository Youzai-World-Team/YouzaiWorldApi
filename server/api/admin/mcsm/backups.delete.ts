import { getMcsmConfig, recordAudit, requireFeaturePermission } from '../../../utils/db'
import { assertInstanceAllowed, BACKUP_NAME_RE, deleteBackup, listBackups } from '../../../utils/mcsm'

/** 删除一个备份压缩包。只认备份目录下、符合命名规则的 zip。 */
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

  // 先确认这个名字真的在备份目录里列得出来，避免删掉刚好同名却不在列表中的文件。
  const { backupDir } = getMcsmConfig()
  const backups = await listBackups(uuid, daemonId, backupDir)
  if (!backups.some((backup) => backup.name === name)) {
    throw createError({ statusCode: 404, statusMessage: '备份不存在或已被删除' })
  }

  await deleteBackup(uuid, daemonId, backupDir, name)
  recordAudit(event, user, `删除实例「${instance.nickname || uuid}」的备份 ${name}`)
  return { ok: true }
})
