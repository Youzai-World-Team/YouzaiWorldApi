import { requireFeaturePermission } from '../../../utils/db'
import {
  defaultDomainMailTemplateData,
  parseDomainMailTemplate,
  readDomainMailTemplate,
} from '../../../utils/domain-mail-composer'

export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'domain-mail-send', 'edit')
  const html = await readDomainMailTemplate()
  const parsed = parseDomainMailTemplate(html)
  const senderName = user.fullName || user.username
  return {
    html,
    fields: { ...defaultDomainMailTemplateData(), ...parsed },
    sender: {
      owner: user.isOwner,
      defaultAddress: `${user.username}@mcyzw.top`.toLowerCase(),
      defaultName: senderName,
    },
  }
})
