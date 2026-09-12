import { getMcsmManagedInstance, mcsmConfigured, requireFeaturePermission } from '../../../utils/db'
import { getPanelSnapshot } from '../../../utils/mcsm'

/** 设置页的可选实例列表不包含面板密钥。 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  requireFeaturePermission(event, 'settings-mcsm', 'view')
  if (!mcsmConfigured()) {
    return { configured: false, managedInstance: null, user: null, instances: [] }
  }
  const snapshot = await getPanelSnapshot()
  return { configured: true, managedInstance: getMcsmManagedInstance(), ...snapshot }
})
