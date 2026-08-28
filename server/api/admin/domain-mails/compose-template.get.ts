import { requireFeaturePermission } from '../../../utils/db'
import {
  buildDomainMailSourceTemplate,
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
    sourceHtml: buildDomainMailSourceTemplate(html),
    fields: { ...defaultDomainMailTemplateData(), ...parsed },
    sender: {
      owner: user.isOwner,
      defaultLocalPart: user.username.toLowerCase(),
      defaultAddress: `${user.username}@mcyzw.top`.toLowerCase(),
      defaultName: senderName,
    },
  }
})
