import { recordAudit, recordDomainMailSent, requireFeaturePermission, getSmtpTransportSettings } from '../../../utils/db'
import { normalizeDomainMailAttachments } from '../../../utils/domain-mail-attachments'
import { requireDomainMailSenderAddress } from '../../../utils/domain-mail-sender'
import { requireEmailAddress } from '../../../utils/game-input'
import { sendHtmlEmail } from '../../../utils/smtp'
import {
  DOMAIN_MAIL_HTML_MAX_BYTES,
  renderDomainMailComposition,
} from '../../../utils/domain-mail-composer'

const SUBJECT_MAX = 998

function textField(value: unknown, label: string, max: number, required = false): string {
  const text = String(value ?? '').trim()
  if ((required && !text) || text.length > max || /[\r\n]/.test(text)) {
    throw createError({ statusCode: 400, statusMessage: `${label}格式不正确` })
  }
  return text
}

export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'domain-mail-send', 'edit')
  const body = await readBody<any>(event)
  const recipient = requireEmailAddress(body?.to)
  const subject = textField(body?.subject, '邮件主题', SUBJECT_MAX, true)
  const textBody = body?.textBody == null ? '' : String(body.textBody)
  if (Buffer.byteLength(textBody, 'utf8') > DOMAIN_MAIL_HTML_MAX_BYTES) {
    throw createError({ statusCode: 400, statusMessage: '纯文本正文不能超过 512 KiB' })
  }

  const rendered = await renderDomainMailComposition(body)
  const html = rendered.html
  const attachments = normalizeDomainMailAttachments(body?.attachments)

  // 可见前缀只控制收件读取范围，不授予普通用户代发其它地址的权限。
  const senderAddress = user.isOwner
    ? requireDomainMailSenderAddress(body?.fromLocalPart ?? user.username)
    : `${user.username}@mcyzw.top`.toLowerCase()
  const senderName = user.isOwner && body?.fromName !== undefined
    ? textField(body.fromName, '发件人名称', 128)
    : (user.fullName || user.username)

  if (Buffer.byteLength(html, 'utf8') > DOMAIN_MAIL_HTML_MAX_BYTES) {
    throw createError({ statusCode: 400, statusMessage: 'HTML 正文过大' })
  }
  const smtp = getSmtpTransportSettings()
  try {
    await sendHtmlEmail(smtp, recipient, subject, html, textBody || rendered.text, {
      address: senderAddress,
      name: senderName,
    }, attachments)
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'SMTP 发送失败'
    throw createError({ statusCode: 502, statusMessage: `邮件发送失败：${detail}` })
  }

  const sentId = recordDomainMailSent({
    userId: user.id,
    senderAddress,
    senderName,
    recipient,
    subject,
    textBody: textBody || rendered.text,
    htmlBody: html,
    attachments,
  })
  const attachmentSummary = attachments.length ? `，附件 ${attachments.length} 个` : ''
  recordAudit(event, user, `发送域名邮件：${subject}（发件人 ${senderAddress}，收件人 ${recipient}${attachmentSummary}）`)
  return { ok: true, id: sentId, from: senderAddress, to: recipient, attachmentCount: attachments.length }
})
