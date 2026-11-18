import { recordAudit, requireFeaturePermission } from '../../../utils/db'
import { requestGameMapUpload } from '../../../utils/game-map-upload'

export default defineEventHandler(async event => {
  const user = requireFeaturePermission(event, 'settings-game-maps', 'edit')
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const request = await requestGameMapUpload()
  recordAudit(event, user, `请求地图上传：${request.message}`)
  return request
})
