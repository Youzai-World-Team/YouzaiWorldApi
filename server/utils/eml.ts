/**
 * 把库里存的域名邮件重建成 RFC 5322 / MIME 的 `.eml` 文件，供后台下载后用
 * 邮件客户端（Thunderbird / Outlook / Apple Mail）打开。
 *
 * <p>
 * <b>这是重建，不是原文。</b>Worker 只上传解析后的字段（头部若干项、纯文本正文、
 * HTML 正文、附件），原始 MIME 字节没有入库，所以这里产出的文件与发信方发出的
 * 原始报文并不逐字节相同：原有的头部顺序、非必要头部、分段结构、原始传输编码
 * 都无法还原。收件内容本身是完整的，用于取证的字节级原文则需要另存原始 MIME。
 * </p>
 *
 * <p>
 * 全部正文与附件统一用 base64 传输编码：既能安全承载 UTF-8 与二进制，也避免了
 * quoted-printable 的行长与软换行细节。头部非 ASCII 走 RFC 2047 encoded-word，
 * 附件文件名同时给出 ASCII 回退与 RFC 2231 的 {@code filename*}。
 * </p>
 */

const CRLF = '\r\n'
/** base64 正文每行长度，RFC 2045 要求不超过 76。 */
const BASE64_LINE = 76
/**
 * 单个 encoded-word 允许的明文字节数。
 * `=?UTF-8?B?` + `?=` 占 12 字符，整词要 ≤ 75，故 base64 ≤ 63 → 明文 ≤ 47；
 * 取 45（3 的倍数）可避免词内出现 base64 填充。
 */
const ENCODED_WORD_BYTES = 45

export interface EmlAddress {
  name: string
  address: string
}

export interface EmlAttachment {
  filename: string
  mimeType: string
  disposition: string
  contentId: string
  size: number
  content: Buffer | null
}

export interface EmlInput {
  id: string
  messageId: string
  envelopeFrom: string
  envelopeTo: string
  fromAddress: string
  fromName: string
  toAddresses: EmlAddress[]
  ccAddresses: EmlAddress[]
  replyTo: string
  subject: string
  sentTime: number | null
  receivedTime: number
  textBody: string
  htmlBody: string
  spf: string
  dkim: string
  dmarc: string
  truncated: boolean
  attachments: EmlAttachment[]
}

/** 头部里不允许出现的字符（含 CR/LF，防头部注入）一律剔除。 */
function stripHeaderUnsafe(value: string): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ')
}

function isPrintableAscii(value: string): boolean {
  return /^[ -~]*$/.test(value)
}

/** 按 UTF-8 字节数切分字符串，且不切断码点（含 emoji 等代理对）。 */
function chunkByBytes(value: string, maxBytes: number): string[] {
  const chunks: string[] = []
  let current = ''
  let currentBytes = 0
  for (const char of value) {
    const size = Buffer.byteLength(char, 'utf8')
    if (currentBytes + size > maxBytes && current) {
      chunks.push(current)
      current = ''
      currentBytes = 0
    }
    current += char
    currentBytes += size
  }
  if (current) chunks.push(current)
  return chunks
}

/** RFC 2047 encoded-word，超长时拆成多个词并用折行连接。 */
function encodeWords(value: string): string {
  return chunkByBytes(value, ENCODED_WORD_BYTES)
    .map((chunk) => `=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`)
    .join(`${CRLF} `)
}

/** 头部取值：纯 ASCII 直接用，否则走 encoded-word。 */
function encodeHeaderValue(value: string): string {
  const clean = stripHeaderUnsafe(value)
  if (!clean) return ''
  return isPrintableAscii(clean) ? clean : encodeWords(clean)
}

/** 显示名：ASCII 但含特殊字符时加引号；非 ASCII 走 encoded-word（不能再套引号）。 */
function encodeDisplayName(name: string): string {
  const clean = stripHeaderUnsafe(name).trim()
  if (!clean) return ''
  if (!isPrintableAscii(clean)) return encodeWords(clean)
  if (/[()<>@,;:\\".[\]]/.test(clean)) {
    return `"${clean.replace(/([\\"])/g, '\\$1')}"`
  }
  return clean
}

function formatAddress(item: EmlAddress): string {
  const address = stripHeaderUnsafe(item.address).trim()
  if (!address) return ''
  const name = encodeDisplayName(item.name)
  return name ? `${name} <${address}>` : address
}

function formatAddressList(list: EmlAddress[]): string {
  const parts = list.map(formatAddress).filter(Boolean)
  if (!parts.length) return ''
  // 地址之间折行，避免超过 998 字符的行长上限
  return parts.join(`,${CRLF} `)
}

/** RFC 5322 的日期格式；toUTCString 只差把 GMT 换成 +0000。 */
function formatDate(ms: number): string {
  return new Date(ms).toUTCString().replace(/GMT$/, '+0000')
}

function base64Body(data: Buffer): string {
  const encoded = data.toString('base64')
  const lines: string[] = []
  for (let offset = 0; offset < encoded.length; offset += BASE64_LINE) {
    lines.push(encoded.slice(offset, offset + BASE64_LINE))
  }
  return lines.join(CRLF)
}

/**
 * 分段边界。
 * <p>
 * 只用 `-` 与十六进制：base64 字母表里没有 `-`，而所有分段正文都是 base64，
 * 所以边界串绝不可能出现在正文中，不需要再做碰撞检测。
 * </p>
 */
function makeBoundary(seed: string, index: number): string {
  const token = seed.replace(/[^0-9a-f]/gi, '').slice(0, 24) || '0'
  return `----=_YzwPart-${index}-${token}`
}

/** MIME 类型只保留 type/subtype 形状，其余一律回退到八位字节流。 */
function safeMimeType(value: string, fallback: string): string {
  const type = stripHeaderUnsafe(value).trim().toLowerCase()
  return /^[a-z0-9!#$&^_.+-]{1,64}\/[a-z0-9!#$&^_.+-]{1,64}$/.test(type) ? type : fallback
}

/** 文件名：ASCII 回退 + RFC 2231 的 filename*，两者都给。 */
function attachmentDispositionParams(filename: string): string {
  const clean = stripHeaderUnsafe(filename).replace(/[\\/"]/g, '_').trim() || 'attachment.bin'
  const ascii = clean.replace(/[^ -~]/g, '_').replace(/"/g, '_').slice(0, 128)
  let params = `; filename="${ascii}"`
  if (!isPrintableAscii(clean)) {
    params += `; filename*=UTF-8''${encodeURIComponent(clean)}`
  }
  return params
}

interface MimePart {
  headers: string[]
  body: string
}

function textPart(mimeType: string, content: string): MimePart {
  return {
    headers: [
      `Content-Type: ${mimeType}; charset="utf-8"`,
      'Content-Transfer-Encoding: base64',
    ],
    body: base64Body(Buffer.from(content, 'utf8')),
  }
}

function attachmentPart(item: EmlAttachment, content: Buffer): MimePart {
  const headers = [
    `Content-Type: ${safeMimeType(item.mimeType, 'application/octet-stream')}`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: ${item.disposition === 'inline' ? 'inline' : 'attachment'}`
      + attachmentDispositionParams(item.filename),
  ]
  const contentId = stripHeaderUnsafe(item.contentId).trim()
  if (contentId) {
    headers.push(`Content-ID: ${contentId.startsWith('<') ? contentId : `<${contentId}>`}`)
  }
  return { headers, body: base64Body(content) }
}

/** 把多个分段包成一个 multipart 分段。 */
function multipart(subtype: string, boundary: string, parts: MimePart[]): MimePart {
  const chunks: string[] = []
  for (const part of parts) {
    chunks.push(`--${boundary}`)
    chunks.push(part.headers.join(CRLF))
    chunks.push('')
    chunks.push(part.body)
  }
  chunks.push(`--${boundary}--`)
  return {
    headers: [`Content-Type: multipart/${subtype}; boundary="${boundary}"`],
    body: chunks.join(CRLF),
  }
}

/**
 * 重建 `.eml`。
 *
 * @returns 完整报文字节，可直接作为下载内容
 */
export function buildEml(input: EmlInput): Buffer {
  // ===== 正文分段 =====
  const bodyParts: MimePart[] = []
  if (input.textBody) bodyParts.push(textPart('text/plain', input.textBody))
  if (input.htmlBody) bodyParts.push(textPart('text/html', input.htmlBody))

  let root: MimePart
  if (bodyParts.length === 0) root = textPart('text/plain', '')
  else if (bodyParts.length === 1) root = bodyParts[0]!
  else root = multipart('alternative', makeBoundary(input.id, 1), bodyParts)

  // 只有真正存下内容的附件能重建；被体积预算丢掉的用 X- 头记录
  const stored = input.attachments.filter((item) => item.content && item.content.length > 0)
  const dropped = input.attachments.filter((item) => !item.content || item.content.length === 0)
  if (stored.length) {
    root = multipart('mixed', makeBoundary(input.id, 2), [
      root,
      ...stored.map((item) => attachmentPart(item, item.content!)),
    ])
  }

  // ===== 头部 =====
  const headers: string[] = ['MIME-Version: 1.0']

  const dateSource = input.sentTime ?? input.receivedTime
  headers.push(`Date: ${formatDate(dateSource)}`)

  const from = formatAddress({ name: input.fromName, address: input.fromAddress || input.envelopeFrom })
  if (from) headers.push(`From: ${from}`)

  const to = formatAddressList(input.toAddresses.length
    ? input.toAddresses
    : [{ name: '', address: input.envelopeTo }])
  if (to) headers.push(`To: ${to}`)

  const cc = formatAddressList(input.ccAddresses)
  if (cc) headers.push(`Cc: ${cc}`)

  if (input.replyTo) headers.push(`Reply-To: ${encodeHeaderValue(input.replyTo)}`)

  const subject = encodeHeaderValue(input.subject)
  headers.push(`Subject: ${subject || '(no subject)'}`)

  const messageId = stripHeaderUnsafe(input.messageId).trim()
  if (messageId) {
    headers.push(`Message-ID: ${messageId.startsWith('<') ? messageId : `<${messageId}>`}`)
  }

  const auth = [
    input.spf && `spf=${input.spf}`,
    input.dkim && `dkim=${input.dkim}`,
    input.dmarc && `dmarc=${input.dmarc}`,
  ].filter(Boolean).join('; ')
  if (auth) headers.push(`Authentication-Results: mcyzw.top; ${auth}`)

  // 标明这是重建产物，并保留库里的原始元信息，便于日后核对
  headers.push('X-Yzwc-Reconstructed: yes; source=youzaiworld-api; original-mime-not-stored')
  headers.push(`X-Yzwc-Mail-Id: ${stripHeaderUnsafe(input.id)}`)
  if (input.envelopeFrom) headers.push(`X-Yzwc-Envelope-From: ${encodeHeaderValue(input.envelopeFrom)}`)
  if (input.envelopeTo) headers.push(`X-Yzwc-Envelope-To: ${encodeHeaderValue(input.envelopeTo)}`)
  headers.push(`X-Yzwc-Received-Time: ${formatDate(input.receivedTime)}`)
  if (input.truncated) headers.push('X-Yzwc-Truncated: yes; body-or-attachments-exceeded-limits')
  for (const item of dropped) {
    headers.push(`X-Yzwc-Dropped-Attachment: ${encodeHeaderValue(item.filename || '(unnamed)')}`
      + `; size=${Number(item.size) || 0}`)
  }

  headers.push(...root.headers)

  return Buffer.from(`${headers.join(CRLF)}${CRLF}${CRLF}${root.body}${CRLF}`, 'utf8')
}

/** 下载文件名：主题清洗后加 .eml，取不到主题就用邮件 id。 */
export function emlFileName(subject: string, id: string): string {
  const base = String(subject ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
    .slice(0, 80)
  return `${base || `mail-${id.slice(0, 8)}`}.eml`
}
