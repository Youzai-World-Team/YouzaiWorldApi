import { requireFeaturePermission } from '../../../utils/db'
import { getConfigFile, listConfigFiles, requireInstance } from '../../../utils/mcsm-server-config'

/** 读取实例的配置文件（目前只放行 server.properties），面板已解析成带类型的键值对。 */
export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'server-manage-properties', 'view')
  const query = getQuery(event)
  const uuid = String(query.uuid || '')
  const daemonId = String(query.daemonId || '')
  await requireInstance(uuid, daemonId)

  const files = listConfigFiles()
  const fileName = String(query.fileName || files[0]?.fileName || '')
  return { files, fileName, values: await getConfigFile(uuid, daemonId, fileName) }
})
