import { promises as fs } from 'node:fs'
import path from 'node:path'
import { requireAuth, requireFeaturePermission, requireOwner, requirePagePermission } from '../utils/db'

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const parts = await readMultipartFormData(event)
  const purpose = parts?.find((part) => part.name === 'purpose')?.data?.toString('utf8').trim() || ''
  if (purpose === 'account-avatar') {
    requireFeaturePermission(event, 'account-avatar', 'edit')
  } else if (purpose === 'admin-user-avatar') {
    requireOwner(event)
  } else if (purpose === 'donor-avatar') {
    requirePagePermission(event, 'donors', 'edit')
  } else {
    throw createError({ statusCode: 400, statusMessage: '上传用途无效' })
  }
  const file = parts?.find((p) => p.name === 'file' && p.data && p.data.length)
  if (!file) {
    throw createError({ statusCode: 400, statusMessage: '未找到上传文件' })
  }
  if (file.data.length > MAX_UPLOAD_BYTES) {
    throw createError({ statusCode: 413, statusMessage: '图片大小不能超过 2 MiB' })
  }

  const type = file.type || ''
  const ext = EXT_BY_TYPE[type]
  if (!ext) {
    throw createError({ statusCode: 400, statusMessage: '只支持 PNG/JPG/WebP/GIF/AVIF 图片' })
  }

  const uploadDir = path.resolve(process.cwd(), 'server/data/uploads')
  await fs.mkdir(uploadDir, { recursive: true })
  const filename = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${ext}`
  await fs.writeFile(path.join(uploadDir, filename), file.data)

  return { url: `/api/uploads/${filename}` }
})
