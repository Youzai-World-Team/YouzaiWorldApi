import { recordAudit, requireFeaturePermission } from '../../../../utils/db'
import { assertManagedInstanceAllowed, createManagedInstanceGuard } from '../../../../utils/mcsm'
import { ensureUploadDirectory } from '../../../../utils/mcsm-upload-target'

/** 上传目录只允许创建或复用文件夹，不授予新建文件、编辑或删除权限。 */
export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-files-upload', 'edit')
  const body = await readBody<{ uuid?: string; daemonId?: string; path?: string; name?: string }>(event)
  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const instance = await assertManagedInstanceAllowed(uuid, daemonId)
  const result = await ensureUploadDirectory(uuid, daemonId, body?.path, body?.name, {
    assertCurrent: createManagedInstanceGuard(uuid, daemonId),
  })
  if (result.created) recordAudit(event, user, `在实例「${instance.nickname || uuid}」上传文件夹 ${result.path}`)
  return { ok: true, ...result }
})
