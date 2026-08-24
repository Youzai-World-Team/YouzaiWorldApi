import { getMcsmConfig, requireAuth } from '../../../utils/db'
import { assertInstanceAllowed, listBackups, listRootDirectories } from '../../../utils/mcsm'

/**
 * 备份目录里的压缩包，以及实例根目录下的一级目录（供「创建备份」时挑选打包内容）。
 * <p>
 * 目录列举失败不影响备份列表：新实例可能还没有备份目录，页面照样要能开出来。
 * </p>
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  const query = getQuery(event)
  const uuid = String(query.uuid || '')
  const daemonId = String(query.daemonId || '')
  await assertInstanceAllowed(uuid, daemonId)

  const { backupDir } = getMcsmConfig()
  const [backups, directories] = await Promise.all([
    listBackups(uuid, daemonId, backupDir),
    listRootDirectories(uuid, daemonId).catch(() => [] as string[]),
  ])
  return { backupDir, backups, directories }
})
