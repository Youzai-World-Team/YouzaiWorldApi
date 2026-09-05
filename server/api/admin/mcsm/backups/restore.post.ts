import { recordAudit, requireFeaturePermission } from '../../../../utils/db'
import {
  BACKUP_NAME_RE,
  listBackups,
  restoreBackup,
} from '../../../../utils/mcsm-backup'
import { assertInstanceAllowed } from '../../../../utils/mcsm'

/**
 * 恢复备份：把压缩包解压回实例根目录，同名文件直接覆盖。
 * <p>
 * 只在实例已停止（面板状态 0）时允许执行。运行中的服务器持有世界文件句柄，
 * 边跑边覆盖存档要么写不进去、要么把存档搅坏，而且服务器退出时还会用内存里的
 * 旧状态把刚恢复的文件再覆盖一遍。
 * </p>
 */
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
  if (instance.status !== 0) {
    throw createError({
      statusCode: 409,
      statusMessage: `实例当前${instance.statusLabel}，请先停止实例再恢复备份`,
    })
  }

  const backups = await listBackups(uuid, daemonId)
  if (!backups.some((backup) => backup.name === name)) {
    throw createError({ statusCode: 404, statusMessage: '备份不存在或已被删除' })
  }

  await restoreBackup(uuid, daemonId, name)
  recordAudit(event, user, `为实例「${instance.nickname || uuid}」启动备份恢复 ${name}`)
  return { ok: true, started: true }
})
