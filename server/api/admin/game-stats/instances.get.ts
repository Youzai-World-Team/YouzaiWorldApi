import { getAdminMcsmConfig, requireFeaturePermission } from '../../../utils/db'
import { getPanelSnapshot } from '../../../utils/mcsm'

/** 游戏统计页专用的 MCSM 实例列表；只有具备立即同步权限的后台账户可读取。 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  requireFeaturePermission(event, 'game-stats-sync', 'edit')
  const config = getAdminMcsmConfig()
  if (!config.configured) return { configured: false, instances: [] }

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
