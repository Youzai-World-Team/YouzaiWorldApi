import { gameMailSummaryWire, listGameMails, requireGameApiKey } from '../../../utils/db'

/** 已发送邮件列表（摘要，不含正文与附件），供管理界面渲染。 */
export default defineEventHandler((event) => {
  requireGameApiKey(event)
  return { ok: true, mails: listGameMails().map((mail) => gameMailSummaryWire(mail)) }
})
