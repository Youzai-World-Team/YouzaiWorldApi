import { requireFeaturePermission } from '../../../../utils/db'
import { assertManagedInstanceAllowed, createManagedInstanceGuard } from '../../../../utils/mcsm'
import { inspectUploadTarget } from '../../../../utils/mcsm-upload-target'

/** 上传前查询同名项；只查询当前绑定实例，且必须具备上传权限。 */
export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'server-files-upload', 'edit')
  const query = getQuery(event)
  const uuid = String(query.uuid || '')
  const daemonId = String(query.daemonId || '')
  await assertManagedInstanceAllowed(uuid, daemonId)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return inspectUploadTarget(uuid, daemonId, query.path, query.name, {
    assertCurrent: createManagedInstanceGuard(uuid, daemonId),
  })
})
