import { promises as fs } from 'node:fs'
import path from 'node:path'

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
}

export default defineEventHandler(async (event) => {
  const cookie = getCookie(event, 'youzai_token')
  const header = getHeader(event, 'authorization')?.replace('Bearer ', '')
  const token = cookie || header

  if (!token) {
    throw createError({ statusCode: 401, statusMessage: '未登录' })
  }

  const sessions = await readJson<Record<string, number>>('sessions.json', {})
  if (!sessions[token]) {
    throw createError({ statusCode: 401, statusMessage: '会话已失效' })
  }

  const parts = await readMultipartFormData(event)
  const file = parts?.find((p) => p.name === 'file' && p.data && p.data.length)
  if (!file) {
    throw createError({ statusCode: 400, statusMessage: '未找到上传文件' })
  }

  const type = file.type || ''
  const ext = EXT_BY_TYPE[type]
  if (!ext) {
    throw createError({ statusCode: 400, statusMessage: '只支持图片文件（PNG/JPG/WebP/GIF 等）' })
  }

  const uploadDir = path.resolve(process.cwd(), 'server/data/uploads')
  await fs.mkdir(uploadDir, { recursive: true })
  const filename = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${ext}`
  await fs.writeFile(path.join(uploadDir, filename), file.data)

  return { url: `/api/uploads/${filename}` }
})
