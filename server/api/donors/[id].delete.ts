import { promises as fs } from 'node:fs'
import path from 'node:path'

const UPLOAD_PREFIX = '/api/uploads/'

export default defineEventHandler(async (event) => {
  requireAuth(event)

  const id = getRouterParam(event, 'id')
  const target = listDonors().find((d) => d.id === id)
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: '记录不存在' })
  }

  deleteDonor(id)

  if (target.avatar.startsWith(UPLOAD_PREFIX)) {
    const filename = target.avatar.slice(UPLOAD_PREFIX.length)
    if (/^[A-Za-z0-9._-]+$/.test(filename)) {
      const uploadDir = path.resolve(process.cwd(), 'server/data/uploads')
      await fs.rm(path.join(uploadDir, filename), { force: true }).catch(() => {})
    }
  }

  return { ok: true }
})
