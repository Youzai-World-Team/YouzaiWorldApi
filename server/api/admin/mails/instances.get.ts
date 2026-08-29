import { getAdminMcsmConfig, requireFeaturePermission } from '../../../utils/db'
import { getPanelSnapshot } from '../../../utils/mcsm'

/** 后台发布服内邮件时可通知的 MCSM 实例。 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  requireFeaturePermission(event, 'mail-publish', 'edit')

  const config = getAdminMcsmConfig()
  if (!config.configured) {
    return { configured: false, instances: [] }
  }

  const snapshot = await getPanelSnapshot()
  return {
    configured: true,
    instances: snapshot.instances.map(instance => ({
      instanceUuid: instance.instanceUuid,
      daemonId: instance.daemonId,
      nickname: instance.nickname,
      status: instance.status,
      statusLabel: instance.statusLabel,
      hostIp: instance.hostIp,
      remarks: instance.remarks,
    })),
  }
})
