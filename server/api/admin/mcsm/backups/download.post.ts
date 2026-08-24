import { getMcsmConfig, recordAudit, requireFeaturePermission } from '../../../../utils/db'
import {
  assertInstanceAllowed,
  backupDownloadUrl,
  BACKUP_NAME_RE,
  listBackups,
} from '../../../../utils/mcsm'

/**
 * 换取备份的一次性下载地址。
 * <p>
 * 下载走的是守护进程（节点）而不是面板，本服务端只负责换密码、拼地址，
 * 不做中转——备份动辄几百 MB，代理一遍纯属白占内存。地址里带一次性密码，
 * 因此接口本身按「备份管理」权限把关，并记入操作记录：这等于把整个世界拷走。
 * </p>
 * <p>
 * 节点地址可能是内网域名，浏览器打不开时只能改用面板自身的文件管理下载。
 * </p>
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const user = requireFeaturePermission(event, 'server-manage-backup', 'edit')
  const body = await readBody<{ uuid?: string; daemonId?: string; name?: string }>(event)

  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const name = String(body?.name || '')
  if (!BACKUP_NAME_RE.test(name)) {
    throw createError({ statusCode: 400, statusMessage: '备份文件名不合法' })
  }
  const instance = await assertInstanceAllowed(uuid, daemonId)

  const { backupDir } = getMcsmConfig()
  const backups = await listBackups(uuid, daemonId, backupDir)
  if (!backups.some((backup) => backup.name === name)) {
    throw createError({ statusCode: 404, statusMessage: '备份不存在或已被删除' })
  }

  const url = await backupDownloadUrl(uuid, daemonId, backupDir, name)
  recordAudit(event, user, `获取实例「${instance.nickname || uuid}」备份 ${name} 的下载地址`)
  return { url }
})
