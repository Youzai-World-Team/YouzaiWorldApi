import {
  getDomainMailDetail,
  listDomainMailAttachmentsForEml,
  requireAuth,
} from '../../../utils/db'
import { UUID_RE } from '../../../utils/game-input'
import { buildEml, emlFileName } from '../../../utils/eml'

/**
 * 下载一封域名邮件的 `.eml`，可直接用邮件客户端打开。
 * <p>
 * <b>产出是重建结果，不是原始报文。</b>Worker 只上传解析后的字段，原始 MIME
 * 字节未入库，所以头部顺序、非必要头部与原始分段结构无法还原；重建文件里带
 * {@code X-Yzwc-Reconstructed} 头明示这一点。
 * </p>
 * <p>
 * 和附件下载同样的理由：一律 {@code Content-Disposition: attachment} 下发，
 * 不让浏览器有任何内联解析这份陌生来信的机会。
 * </p>
 */
export default defineEventHandler((event) => {
  requireAuth(event)
  const mailId = String(getQuery(event).mail || '').trim().toLowerCase()
  if (!UUID_RE.test(mailId)) throw createError({ statusCode: 400, statusMessage: '邮件 ID 格式不正确' })

  const detail = getDomainMailDetail(mailId)
  if (!detail) throw createError({ statusCode: 404, statusMessage: '邮件不存在' })

  const eml = buildEml({
    id: detail.id,
    messageId: detail.messageId,
    envelopeFrom: detail.envelopeFrom,
    envelopeTo: detail.envelopeTo,
    fromAddress: detail.fromAddress,
    fromName: detail.fromName,
    toAddresses: detail.toAddresses,
    ccAddresses: detail.ccAddresses,
    replyTo: detail.replyTo,
    subject: detail.subject,
    sentTime: detail.sentTime,
    receivedTime: detail.receivedTime,
    textBody: detail.textBody,
    htmlBody: detail.htmlBody,
    spf: detail.spf,
    dkim: detail.dkim,
    dmarc: detail.dmarc,
    truncated: detail.truncated,
    attachments: listDomainMailAttachmentsForEml(mailId),
  })

  const name = emlFileName(detail.subject, detail.id)
  const asciiName = name.replace(/[^\x20-\x7e]/g, '_')
  setResponseHeader(event, 'Content-Type', 'message/rfc822')
  setResponseHeader(event, 'Content-Disposition',
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`)
  setResponseHeader(event, 'Content-Length', String(eml.length))
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  return eml
})
