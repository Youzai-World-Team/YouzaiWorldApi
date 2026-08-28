import { requireFeaturePermission, setAdminGameAccountSettings } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<any>(event)
  if (body?.emailTemplates !== undefined) {
    requireFeaturePermission(event, 'game-accounts-email-templates', 'edit')
  }
  if (Object.keys(body || {}).some((key) => key !== 'emailTemplates')) {
    requireFeaturePermission(event, 'game-accounts-settings', 'edit')
  }
  return setAdminGameAccountSettings(body || {})
})
