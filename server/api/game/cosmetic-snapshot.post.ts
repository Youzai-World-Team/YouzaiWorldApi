import { requireGameApiKey, replaceGameCosmetics } from '../../utils/db'
import { UUID_RE, validatePng } from '../../utils/game-input'

const SLOTS = ['skin.png', 'skin_slim.png', 'cloak.png'] as const
const MAX_BYTES = 512 * 1024

function decodePng(value: unknown): Buffer {
  if (!value) return Buffer.alloc(0)
  const data = Buffer.from(String(value), 'base64')
  if (data.length > MAX_BYTES) throw createError({ statusCode: 400, statusMessage: '外观文件过大' })
  return data
}

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  const uuid = String(body?.uuid || '').trim()
  if (!UUID_RE.test(uuid)) throw createError({ statusCode: 400, statusMessage: 'UUID 格式不正确' })
  const files = Object.fromEntries(SLOTS.map((slot) => {
    const data = decodePng(body?.files?.[slot])
    if (data.length) validatePng(data, slot, MAX_BYTES)
    return [slot, data]
  }))
  if (files['skin.png'].length && files['skin_slim.png'].length) {
    throw createError({ statusCode: 400, statusMessage: '普通与纤细皮肤不能同时启用' })
  }
  replaceGameCosmetics(uuid, files)
  return { ok: true }
})
