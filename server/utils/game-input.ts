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
