import { createError } from 'h3'
import { EMAIL_RE } from './game-input'

/**
 * Cloudflare Email Worker 投递收件的载荷校验。
 * <p>
 * Worker 已经用 postal-mime 解析过 MIME，这里只做「不信任上游」的边界检查：
 * 长度、条数、编码合法性，以及附件二进制的体积预算。校验通过后由
 * {@code db.insertDomainMail} 落库。上限比 Cloudflare 的 25 MiB 入站限制小，
 * 超出部分由 Worker 侧丢弃并置 {@code truncated}。
 * </p>
 */

const TEXT_MAX = 256 * 1024
const HTML_MAX = 1024 * 1024
const SUBJECT_MAX = 512
const ADDRESS_NAME_MAX = 320
const ADDRESS_LIST_MAX = 50
const MESSAGE_ID_MAX = 512
const AUTH_VERDICT_MAX = 32
const FILENAME_MAX = 255
const MIME_TYPE_MAX = 128
const CONTENT_ID_MAX = 256
const ATTACHMENTS_MAX = 32
const ATTACHMENT_BYTES_MAX = 6 * 1024 * 1024
const ATTACHMENT_TOTAL_BYTES_MAX = 12 * 1024 * 1024
// Worker 因超出预算而只上报元信息时，声明的大小就是原附件的真实体积，
// 必然大于我们愿意保存的 ATTACHMENT_BYTES_MAX。这个上限只用来挡住溢出的数字，
// 不能拿保存预算去卡它，否则一封带大附件的信会被整封拒收。
const ATTACHMENT_DECLARED_SIZE_MAX = 64 * 1024 * 1024
// 邮件头 Date 允许的范围：1990-01-01 ~ 2200-01-01，挡住溢出与明显伪造的时间戳。
const SENT_TIME_MIN = 631_152_000_000
const SENT_TIME_MAX = 7_258_118_400_000
const AUTH_VERDICTS = new Set(['pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror', 'policy', ''])
const DISPOSITIONS = new Set(['attachment', 'inline', ''])

export interface InboundMailAddress {
  name: string
  address: string
}

export interface InboundMailAttachment {
  filename: string
  mimeType: string
  disposition: string
  contentId: string
  content: Buffer | null
  size: number
}

export interface InboundMailPayload {
  messageId: string
  envelopeFrom: string
  envelopeTo: string
  mailbox: string
  fromAddress: string
  fromName: string
  toAddresses: InboundMailAddress[]
  ccAddresses: InboundMailAddress[]
  replyTo: string
  subject: string
  sentTime: number | null
  receivedTime: number
  textBody: string
  htmlBody: string
  rawSize: number
  spf: string
  dkim: string
  dmarc: string
  truncated: boolean
  attachments: InboundMailAttachment[]
}

function bad(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

/** 去掉除换行外的控制字符：邮件头里的 CR/LF 注入和 NUL 都不该进数据库。 */
function cleanText(value: unknown, allowNewline: boolean, max: number, label: string): string {
  const raw = String(value ?? '')
  const filtered = Array.from(raw)
    .filter((char) => {
      if (char === '\n') return allowNewline
      if (char === '\r') return false
      const code = char.codePointAt(0) ?? 0
      return code >= 32 && code !== 127
    })
    .join('')
  if (filtered.length > max) bad(`${label}超出长度上限`)
  return filtered
}

/** 收件地址（我们自己的 @mcyzw.top）：由 Cloudflare 给出，必须合法，mailbox 由它派生。 */
function requireOwnAddress(value: unknown, label: string): string {
  const address = cleanText(value, false, ADDRESS_NAME_MAX, label).trim().toLowerCase()
  if (!address) return ''
  if (!EMAIL_RE.test(address)) bad(`${label}格式不正确`)
  return address
}

/**
 * 对外来地址一律宽松处理：只清洗控制字符与长度，不做 EMAIL_RE 强校验。
 * <p>
 * catch-all 收的是互联网上任何人发来的信，From / Reply-To 畸形甚至伪造都很常见
 * （退信用空信封发件人，垃圾邮件更是什么都敢写）。为一个坏地址整封 400 拒收，
 * 等于把邮件丢了，还不如原样存下来供后台排查。
 * </p>
 */
function lenientAddress(value: unknown, label: string): string {
  return cleanText(value, false, ADDRESS_NAME_MAX, label).trim().toLowerCase()
}

function addressList(value: unknown, label: string): InboundMailAddress[] {
  if (value == null) return []
  if (!Array.isArray(value)) bad(`${label}格式不正确`)
  if (value.length > ADDRESS_LIST_MAX) bad(`${label}最多 ${ADDRESS_LIST_MAX} 个`)
  return value.map((item: any) => ({
    name: cleanText(item?.name, false, ADDRESS_NAME_MAX, label).trim(),
    address: lenientAddress(item?.address, label),
  }))
}

/** 未知的验证结论一律归为空串：一个没见过的 Authentication-Results 不该让整封信被拒。 */
function authVerdict(value: unknown): string {
  const verdict = String(value ?? '').trim().toLowerCase().slice(0, AUTH_VERDICT_MAX)
  return AUTH_VERDICTS.has(verdict) ? verdict : ''
}

function requireByteLength(value: unknown, label: string, max: number): number {
  const size = Number(value ?? 0)
  if (!Number.isSafeInteger(size) || size < 0 || size > max) bad(`${label}不正确`)
  return size
}

function decodeAttachmentContent(value: unknown, index: number): Buffer | null {
  if (value == null || value === '') return null
  const base64 = String(value)
  // 4/3 膨胀后仍要挡住超大载荷，先按字符数粗筛再解码。
  if (base64.length > Math.ceil(ATTACHMENT_BYTES_MAX / 3) * 4 + 16) {
    bad(`第 ${index + 1} 个附件超过 ${Math.floor(ATTACHMENT_BYTES_MAX / 1024 / 1024)} MiB`)
  }
  if (!/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(base64)) bad(`第 ${index + 1} 个附件编码不正确`)
  const content = Buffer.from(base64, 'base64')
  if (content.length === 0) bad(`第 ${index + 1} 个附件内容为空`)
  if (content.length > ATTACHMENT_BYTES_MAX) {
    bad(`第 ${index + 1} 个附件超过 ${Math.floor(ATTACHMENT_BYTES_MAX / 1024 / 1024)} MiB`)
  }
  return content
}

function attachments(value: unknown): InboundMailAttachment[] {
  if (value == null) return []
  if (!Array.isArray(value)) bad('附件列表格式不正确')
  if (value.length > ATTACHMENTS_MAX) bad(`附件最多 ${ATTACHMENTS_MAX} 个`)

  let storedBytes = 0
  return value.map((item: any, index: number) => {
    const disposition = String(item?.disposition ?? '').trim().toLowerCase()
    if (!DISPOSITIONS.has(disposition)) bad(`第 ${index + 1} 个附件的 disposition 不正确`)
    const content = decodeAttachmentContent(item?.content, index)
    if (content) {
      storedBytes += content.length
      if (storedBytes > ATTACHMENT_TOTAL_BYTES_MAX) {
        bad(`附件合计超过 ${Math.floor(ATTACHMENT_TOTAL_BYTES_MAX / 1024 / 1024)} MiB`)
      }
    }
    // 保存了内容就以实际字节数为准；只有元信息时才采信 Worker 声明的大小，
    // 让后台能显示「原信这个附件有多大、只是没存下来」。
    const declaredSize = requireByteLength(
      item?.size,
      `第 ${index + 1} 个附件大小`,
      ATTACHMENT_DECLARED_SIZE_MAX,
    )
    return {
      filename: cleanText(item?.filename, false, FILENAME_MAX, `第 ${index + 1} 个附件文件名`).trim(),
      mimeType: cleanText(item?.mimeType, false, MIME_TYPE_MAX, `第 ${index + 1} 个附件类型`).trim().toLowerCase(),
      disposition,
      contentId: cleanText(item?.contentId, false, CONTENT_ID_MAX, `第 ${index + 1} 个附件 Content-ID`).trim(),
      content,
      size: content ? content.length : declaredSize,
    }
  })
}

/** 邮件头 Date 可能缺失或畸形；不合法就返回 null，由后台回退显示接收时间。 */
function optionalSentTime(value: unknown): number | null {
  if (value == null || String(value).trim() === '') return null
  const time = Number(value)
  if (!Number.isSafeInteger(time) || time < SENT_TIME_MIN || time > SENT_TIME_MAX) return null
  return time
}

/** 收件地址的本地部分（@ 之前），用于后台按前缀筛选。 */
export function mailboxLocalPart(envelopeTo: string): string {
  const at = envelopeTo.lastIndexOf('@')
  return at <= 0 ? '' : envelopeTo.slice(0, at)
}

export function requireInboundMailPayload(body: unknown): InboundMailPayload {
  if (!body || typeof body !== 'object' || Array.isArray(body)) bad('收件载荷格式不正确')
  const input = body as Record<string, unknown>

  const envelopeTo = requireOwnAddress(input.envelopeTo, '收件地址')
  if (!envelopeTo) bad('收件地址不能为空')

  const receivedTime = Number(input.receivedTime ?? 0)
  const now = Date.now()
  // Worker 的时钟由 Cloudflare 提供；偏差过大时以服务端时间为准，避免列表排序错乱。
  const normalizedReceived = Number.isSafeInteger(receivedTime)
    && receivedTime > SENT_TIME_MIN
    && Math.abs(now - receivedTime) <= 24 * 60 * 60 * 1000
    ? receivedTime
    : now

  return {
    messageId: cleanText(input.messageId, false, MESSAGE_ID_MAX, 'Message-ID').trim(),
    envelopeFrom: lenientAddress(input.envelopeFrom, '发件地址'),
    envelopeTo,
    mailbox: mailboxLocalPart(envelopeTo),
    fromAddress: lenientAddress(input.fromAddress, '发件人地址'),
    fromName: cleanText(input.fromName, false, ADDRESS_NAME_MAX, '发件人名称').trim(),
    toAddresses: addressList(input.toAddresses, '收件人列表'),
    ccAddresses: addressList(input.ccAddresses, '抄送列表'),
    replyTo: lenientAddress(input.replyTo, '回复地址'),
    subject: cleanText(input.subject, false, SUBJECT_MAX, '邮件主题').trim(),
    sentTime: optionalSentTime(input.sentTime),
    receivedTime: normalizedReceived,
    textBody: cleanText(input.textBody, true, TEXT_MAX, '纯文本正文'),
    htmlBody: cleanText(input.htmlBody, true, HTML_MAX, 'HTML 正文'),
    rawSize: requireByteLength(input.rawSize, '原始邮件大小', 64 * 1024 * 1024),
    spf: authVerdict(input.spf),
    dkim: authVerdict(input.dkim),
    dmarc: authVerdict(input.dmarc),
    truncated: input.truncated === true,
    attachments: attachments(input.attachments),
  }
}
