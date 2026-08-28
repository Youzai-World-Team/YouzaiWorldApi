import { randomBytes } from 'node:crypto'

export interface HtmlEmailAttachment {
  filename: string
  contentType: string
  content: Buffer
}

interface SmtpMessageSender {
  fromAddress: string
  fromName: string
}

function encodeHeader(value: string): string {
  const chunks: string[] = []
  let current = ''
  let currentBytes = 0
  for (const char of value) {
    const charBytes = Buffer.byteLength(char, 'utf8')
    if (current && currentBytes + charBytes > 45) {
      chunks.push(current)
      current = ''
      currentBytes = 0
    }
    current += char
    currentBytes += charBytes
  }
  if (current || !chunks.length) chunks.push(current)
  return chunks
    .map((chunk) => `=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`)
    .join('\r\n ')
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join('\r\n') || ''
}

function attachmentFilename(value: string): { fallback: string; encoded: string } {
  const fallback = value
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\;]/g, '_')
    .trim() || 'attachment'
  const encoded = encodeURIComponent(value).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return { fallback, encoded }
}

export function buildSmtpMessage(
  settings: SmtpMessageSender,
  recipient: string,
  subjectText: string,
  contentLines: string[],
  htmlContent: string,
  attachments: HtmlEmailAttachment[] = [],
): string {
  const fromName = encodeHeader(settings.fromName || '悠哉世界')
  const subject = encodeHeader(subjectText)
  const domain = settings.fromAddress.split('@')[1] || 'localhost'
  const messageId = `${randomBytes(16).toString('hex')}@${domain}`
  const content = contentLines.join('\r\n')
  const alternativeBoundary = `=_YouzaiWorld_alt_${randomBytes(12).toString('hex')}`
  const headers = [
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${messageId}>`,
    `From: ${fromName} <${settings.fromAddress}>`,
    `To: <${recipient}>`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
  ]
  const alternative = [
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(content, 'utf8').toString('base64')),
    `--${alternativeBoundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(htmlContent, 'utf8').toString('base64')),
    `--${alternativeBoundary}--`,
  ]

  if (!attachments.length) {
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
      '',
      ...alternative,
    ].join('\r\n')
  }

  const mixedBoundary = `=_YouzaiWorld_mixed_${randomBytes(12).toString('hex')}`
  const parts = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    '',
    ...alternative,
  ]
  for (const attachment of attachments) {
    const filename = attachmentFilename(attachment.filename)
    parts.push(
      `--${mixedBoundary}`,
      `Content-Type: ${attachment.contentType}; name="${filename.fallback}"; name*=UTF-8''${filename.encoded}`,
      `Content-Disposition: attachment; filename="${filename.fallback}"; filename*=UTF-8''${filename.encoded}`,
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(attachment.content.toString('base64')),
    )
  }
  parts.push(`--${mixedBoundary}--`)
  return parts.join('\r\n')
}
