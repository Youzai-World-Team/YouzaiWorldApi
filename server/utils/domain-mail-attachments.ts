import { createError } from 'h3'
import type { HtmlEmailAttachment } from './smtp-message'

const ATTACHMENT_MAX_COUNT = 5
const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024
const ATTACHMENTS_TOTAL_MAX_BYTES = 10 * 1024 * 1024
const MIME_TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i

export function normalizeDomainMailAttachments(value: unknown): HtmlEmailAttachment[] {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > ATTACHMENT_MAX_COUNT) {
    throw createError({ statusCode: 400, statusMessage: `附件最多只能选择 ${ATTACHMENT_MAX_COUNT} 个` })
  }

  const attachments: HtmlEmailAttachment[] = []
  let totalBytes = 0
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw createError({ statusCode: 400, statusMessage: '附件格式不正确' })
    }
    const filename = String(item.filename ?? '').trim()
    if (!filename
      || Buffer.byteLength(filename, 'utf8') > 200
      || /[\u0000-\u001f\u007f/\\]/.test(filename)) {
      throw createError({ statusCode: 400, statusMessage: '附件文件名格式不正确' })
    }

    const contentType = String(item.contentType || 'application/octet-stream').trim().toLowerCase()
    if (!MIME_TYPE_RE.test(contentType)) {
      throw createError({ statusCode: 400, statusMessage: `附件 MIME 类型不正确：${filename}` })
    }

    const encoded = String(item.contentBase64 ?? '')
    const maxEncodedLength = Math.ceil(ATTACHMENT_MAX_BYTES / 3) * 4
    if (!encoded
      || encoded.length > maxEncodedLength
      || encoded.length % 4 !== 0
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      throw createError({ statusCode: 400, statusMessage: `附件内容格式不正确：${filename}` })
    }
    const content = Buffer.from(encoded, 'base64')
    if (!content.length
      || content.length > ATTACHMENT_MAX_BYTES
      || content.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
      throw createError({ statusCode: 400, statusMessage: `附件不能超过 5 MiB：${filename}` })
    }

    totalBytes += content.length
    if (totalBytes > ATTACHMENTS_TOTAL_MAX_BYTES) {
      throw createError({ statusCode: 400, statusMessage: '附件总大小不能超过 10 MiB' })
    }
    attachments.push({ filename, contentType, content })
  }
  return attachments
}
