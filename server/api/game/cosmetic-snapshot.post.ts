import { requireGameApiKey, replaceGameCosmetics } from '../../utils/db'

const SLOTS = ['skin.png', 'skin_slim.png', 'cloak.png'] as const
const MAX_BYTES = 512 * 1024

function decodePng(value: unknown): Buffer {
  if (!value) return Buffer.alloc(0)
  const data = Buffer.from(String(value), 'base64')
  if (data.length > MAX_BYTES) throw createError({ statusCode: 400, statusMessage: '外观文件过大' })
  if (data.length && !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw createError({ statusCode: 400, statusMessage: '外观文件不是 PNG' })
  }
  return data
}

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  const uuid = String(body?.uuid || '').trim()
  if (!uuid) throw createError({ statusCode: 400, statusMessage: '缺少 UUID' })
  const files = Object.fromEntries(SLOTS.map((slot) => [slot, decodePng(body?.files?.[slot])]))
  if (files['skin.png'].length && files['skin_slim.png'].length) {
    throw createError({ statusCode: 400, statusMessage: '普通与纤细皮肤不能同时启用' })
  }
  replaceGameCosmetics(uuid, files)
  return { ok: true }
})
