import {
  gamePlayerTitleSnapshotWire,
  grantGameTitleManually,
  requireFeaturePermission,
  revokeEditableGameTitleGrants,
} from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'game-titles-grants', 'edit')
  const body = await readBody<any>(event)
  const action = String(body?.action ?? '')
  const snapshot = action === 'grant'
    ? grantGameTitleManually(body?.username, body?.title_id, user.username)
    : action === 'revoke'
      ? revokeEditableGameTitleGrants(body?.username, body?.title_id)
      : null
  if (!snapshot) throw createError({ statusCode: 400, statusMessage: '称号授权操作不正确' })
  return gamePlayerTitleSnapshotWire(snapshot)
})
