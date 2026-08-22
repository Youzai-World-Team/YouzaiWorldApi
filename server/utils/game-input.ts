import { createHash } from 'node:crypto'
import { createError } from 'h3'

export const GAME_USERNAME_RE = /^[A-Za-z0-9_]{1,16}$/
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z0-9-]{2,63}$/
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export function requireGameUsername(value: unknown): string {
  const username = String(value ?? '').trim()
  if (!GAME_USERNAME_RE.test(username)) {
    throw createError({ statusCode: 400, statusMessage: '玩家代号格式不正确' })
  }
  return username
}

export function optionalUuid(value: unknown): string | null {
  if (value == null || String(value).trim() === '') return null
  const uuid = String(value).trim()
  if (!UUID_RE.test(uuid)) throw createError({ statusCode: 400, statusMessage: 'UUID 格式不正确' })
  return uuid
}

export function requireEmailAddress(value: unknown): string {
  const email = String(value ?? '').trim().toLowerCase()
  if (email.length > 254 || email.startsWith('.') || email.includes('..')
      || !EMAIL_RE.test(email) || /[\r\n]/.test(email)) {
    throw createError({ statusCode: 400, message: '邮箱地址格式不正确' })
  }
  return email
}

/** Minecraft 原版离线服务器使用的 UUID.nameUUIDFromBytes("OfflinePlayer:" + name) 算法。 */
export function offlinePlayerUuid(username: string): string {
  const bytes = createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest()
  bytes[6] = (bytes[6] & 0x0f) | 0x30
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export function optionalPosition(value: unknown): string | null {
  if (value == null || String(value) === '') return null
  const position = String(value)
  if (position.length > 4096) throw createError({ statusCode: 400, statusMessage: '位置数据过大' })
  try {
    const parsed = JSON.parse(position) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object')
    if (typeof parsed.dim !== 'string' || parsed.dim.length > 128
      || !Number.isFinite(Number(parsed.x)) || !Number.isFinite(Number(parsed.y))
      || !Number.isFinite(Number(parsed.z)) || !Number.isFinite(Number(parsed.yaw))
      || !Number.isFinite(Number(parsed.pitch))) throw new Error('invalid position')
  } catch {
    throw createError({ statusCode: 400, statusMessage: '位置数据格式不正确' })
  }
  return position
}

// ===== 邮件系统输入校验 =====
// 上限比模组界面的输入限制（主题 64 字 / 正文 500 字 / 10 个物品槽）宽松，
// 使模组端配置调高后不必同步改动 Api，同时仍然为数据库写入设定硬边界。

export const MAIL_TYPES = ['ANNOUNCEMENT', 'NOTICE', 'REWARD'] as const
export const MAIL_ATTACHMENT_TYPES = [
  'ITEM', 'COMMAND', 'VANILLA_EXP', 'VANILLA_LEVEL', 'ADVENTURE_EXP', 'ADVENTURE_LEVEL',
] as const
export const MAIL_ACTIONS = ['read', 'star', 'unstar', 'delete'] as const

export type MailType = (typeof MAIL_TYPES)[number]
export type MailAttachmentType = (typeof MAIL_ATTACHMENT_TYPES)[number]
export type MailAction = (typeof MAIL_ACTIONS)[number]

/** 接收范围：0=ALL、1=NONADMIN、2=PLAYER、3=ROLE，与模组 TargetSpec 一致。 */
export interface MailTargetSpec {
  scope: number
  args: string[]
}

export interface MailAttachment {
  type: MailAttachmentType
  data: string
  amount: number
  itemNbt: string | null
}

const MAIL_TITLE_MAX = 256
const MAIL_BODY_MAX = 4096
const MAIL_SENDER_MAX = 64
const MAIL_SCOPE_SUMMARY_MAX = 512
const MAIL_TARGETS_MAX = 64
const MAIL_TARGET_ARGS_MAX = 1024
const MAIL_TARGET_ARG_MAX = 128
const MAIL_ATTACHMENTS_MAX = 64
const MAIL_ATTACHMENT_DATA_MAX = 512
const MAIL_ATTACHMENT_NBT_MAX = 32_768
const MAIL_RECIPIENTS_MAX = 20_000
// 过期时间上限取 2200-01-01，既能容纳「30 天后」也能拦住溢出的时间戳。
const MAIL_EXPIRE_TIME_MAX = 7_258_118_400_000

export function requireMailId(value: unknown): string {
  const id = String(value ?? '').trim().toLowerCase()
  if (!UUID_RE.test(id)) throw createError({ statusCode: 400, message: '邮件 ID 格式不正确' })
  return id
}

export function requirePlayerUuid(value: unknown): string {
  const uuid = String(value ?? '').trim().toLowerCase()
  if (!UUID_RE.test(uuid)) throw createError({ statusCode: 400, message: '玩家 UUID 格式不正确' })
  return uuid
}

export function requireMailType(value: unknown): MailType {
  const type = String(value ?? '').trim().toUpperCase()
  if (!(MAIL_TYPES as readonly string[]).includes(type)) {
    throw createError({ statusCode: 400, message: '邮件类型不正确' })
  }
  return type as MailType
}

export function requireMailAction(value: unknown): MailAction {
  const action = String(value ?? '').trim().toLowerCase()
  if (!(MAIL_ACTIONS as readonly string[]).includes(action)) {
    throw createError({ statusCode: 400, message: '邮件操作类型不正确' })
  }
  return action as MailAction
}

/** 过滤掉除换行以外的控制字符，避免把终端转义或 NUL 写进数据库。 */
function printableText(value: unknown, allowNewline: boolean): string {
  return Array.from(String(value ?? ''))
    .filter((char) => {
      if (char === '\n' || char === '\r') return allowNewline
      const code = char.codePointAt(0) ?? 0
      return code >= 32 && code !== 127
    })
    .join('')
}

export function requireMailTitle(value: unknown): string {
  const title = printableText(value, false).trim()
  if (!title) throw createError({ statusCode: 400, message: '邮件主题不能为空' })
  if (title.length > MAIL_TITLE_MAX) {
    throw createError({ statusCode: 400, message: `邮件主题不能超过 ${MAIL_TITLE_MAX} 个字符` })
  }
  return title
}

export function requireMailBody(value: unknown): string {
  const body = printableText(value, true).replace(/\r\n?/g, '\n')
  if (body.length > MAIL_BODY_MAX) {
    throw createError({ statusCode: 400, message: `邮件正文不能超过 ${MAIL_BODY_MAX} 个字符` })
  }
  return body
}

export function requireMailSender(value: unknown): string {
  const sender = printableText(value, false).trim()
  if (!sender) throw createError({ statusCode: 400, message: '发件人不能为空' })
  if (sender.length > MAIL_SENDER_MAX) {
    throw createError({ statusCode: 400, message: `发件人不能超过 ${MAIL_SENDER_MAX} 个字符` })
  }
  return sender
}

export function requireMailScopeSummary(value: unknown): string {
  const summary = printableText(value, false).trim()
  if (summary.length > MAIL_SCOPE_SUMMARY_MAX) {
    throw createError({ statusCode: 400, message: `接收范围摘要不能超过 ${MAIL_SCOPE_SUMMARY_MAX} 个字符` })
  }
  return summary
}

/** null 表示永久有效，与模组 {@code Mail.expireTime == null} 语义一致。 */
export function optionalMailExpireTime(value: unknown): number | null {
  if (value == null || String(value).trim() === '') return null
  const expireTime = Number(value)
  if (!Number.isSafeInteger(expireTime) || expireTime <= 0 || expireTime > MAIL_EXPIRE_TIME_MAX) {
    throw createError({ statusCode: 400, message: '邮件过期时间不正确' })
  }
  return expireTime
}

export function requireMailTargets(value: unknown): MailTargetSpec[] {
  if (!Array.isArray(value)) throw createError({ statusCode: 400, message: '接收范围格式不正确' })
  if (value.length === 0) throw createError({ statusCode: 400, message: '请至少选择一个接收范围' })
  if (value.length > MAIL_TARGETS_MAX) {
    throw createError({ statusCode: 400, message: `接收范围最多 ${MAIL_TARGETS_MAX} 项` })
  }
  return value.map((item: any) => {
    const scope = Number(item?.scope)
    if (!Number.isInteger(scope) || scope < 0 || scope > 3) {
      throw createError({ statusCode: 400, message: '接收范围类型不正确' })
    }
    const rawArgs = item?.args
    if (rawArgs != null && !Array.isArray(rawArgs)) {
      throw createError({ statusCode: 400, message: '接收范围参数格式不正确' })
    }
    const args = (rawArgs ?? []) as unknown[]
    if (args.length > MAIL_TARGET_ARGS_MAX) {
      throw createError({ statusCode: 400, message: `单项接收范围最多 ${MAIL_TARGET_ARGS_MAX} 个参数` })
    }
    return {
      scope,
      args: args.map((arg) => {
        const text = printableText(arg, false).trim()
        if (!text || text.length > MAIL_TARGET_ARG_MAX) {
          throw createError({ statusCode: 400, message: '接收范围参数不正确' })
        }
        return text
      }),
    }
  })
}

export function requireMailAttachments(value: unknown): MailAttachment[] {
  if (value == null) return []
  if (!Array.isArray(value)) throw createError({ statusCode: 400, message: '邮件附件格式不正确' })
  if (value.length > MAIL_ATTACHMENTS_MAX) {
    throw createError({ statusCode: 400, message: `邮件附件最多 ${MAIL_ATTACHMENTS_MAX} 项` })
  }
  return value.map((item: any) => {
    const type = String(item?.type ?? '').trim().toUpperCase()
    if (!(MAIL_ATTACHMENT_TYPES as readonly string[]).includes(type)) {
      throw createError({ statusCode: 400, message: '邮件附件类型不正确' })
    }
    const amount = Number(item?.amount ?? 0)
    if (!Number.isInteger(amount) || amount < 0 || amount > 2_147_483_647) {
      throw createError({ statusCode: 400, message: '邮件附件数量不正确' })
    }
    const data = printableText(item?.data ?? '', false)
    if (data.length > MAIL_ATTACHMENT_DATA_MAX) {
      throw createError({ statusCode: 400, message: `邮件附件内容不能超过 ${MAIL_ATTACHMENT_DATA_MAX} 个字符` })
    }
    const rawNbt = item?.item_nbt ?? item?.itemNbt
    let itemNbt: string | null = null
    if (rawNbt != null && String(rawNbt) !== '') {
      itemNbt = String(rawNbt)
      if (itemNbt.length > MAIL_ATTACHMENT_NBT_MAX) {
        throw createError({ statusCode: 400, message: '邮件物品附件数据过大' })
      }
    }
    if (type === 'ITEM' && !itemNbt) {
      throw createError({ statusCode: 400, message: '物品附件缺少物品数据' })
    }
    return { type: type as MailAttachmentType, data, amount, itemNbt }
  })
}

/** 收件人由模组解析接收范围后给出（NONADMIN / ROLE 需要 LuckPerms），Api 只做去重与格式校验。 */
export function requireMailRecipients(value: unknown): string[] {
  if (value == null) return []
  if (!Array.isArray(value)) throw createError({ statusCode: 400, message: '收件人列表格式不正确' })
  if (value.length > MAIL_RECIPIENTS_MAX) {
    throw createError({ statusCode: 400, message: `收件人最多 ${MAIL_RECIPIENTS_MAX} 个` })
  }
  return [...new Set(value.map((item) => requirePlayerUuid(item)))]
}

export function validatePng(data: Buffer, slot: string, maxBytes: number): void {
  if (!data.length || data.length > maxBytes || data.length < 33 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw createError({ statusCode: 400, statusMessage: '外观文件不是有效 PNG' })
  }
  if (data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR') {
    throw createError({ statusCode: 400, statusMessage: 'PNG 文件头无效' })
  }
  const width = data.readUInt32BE(16)
  const height = data.readUInt32BE(20)
  const validSize = slot === 'cloak.png'
    ? width === 64 && height === 32
    : width === 64 && (height === 32 || height === 64)
  if (!validSize) throw createError({ statusCode: 400, statusMessage: '外观图片尺寸不正确' })
}
