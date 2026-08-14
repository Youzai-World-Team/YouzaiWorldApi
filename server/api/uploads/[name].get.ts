import { promises as fs } from 'node:fs'
import path from 'node:path'

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
}

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  if (!name || !/^[A-Za-z0-9._-]+$/.test(name)) {
    throw createError({ statusCode: 400, statusMessage: '无效文件名' })
  }

  const uploadDir = path.resolve(process.cwd(), 'server/data/uploads')
  const filePath = path.resolve(uploadDir, name)
  if (!filePath.startsWith(uploadDir)) {
    throw createError({ statusCode: 400, statusMessage: '无效文件名' })
  }

  try {
    const data = await fs.readFile(filePath)
    const ext = path.extname(name).slice(1).toLowerCase()
    const mime = MIME_BY_EXT[ext] || 'application/octet-stream'
    setResponseHeader(event, 'Content-Type', mime)
    return data
  } catch {
    throw createError({ statusCode: 404, statusMessage: '文件不存在' })
  }
})
