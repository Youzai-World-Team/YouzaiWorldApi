import { promises as fs } from 'node:fs'
import path from 'node:path'
import { uploadsDir } from '../../utils/data-dir'

const UPLOAD_PREFIX = '/api/uploads/'

export default defineEventHandler(async (event) => {
  requireAuth(event)

  const id = getRouterParam(event, 'id')
  const body = await readBody<{ avatar?: string; name?: string; intro?: string; amount?: number | string }>(event)

  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    throw createError({ statusCode: 400, statusMessage: '名称不能为空' })
  }

  const prev = listDonors().find((d) => d.id === id)
  if (!prev) {
    throw createError({ statusCode: 404, statusMessage: '记录不存在' })
  }

  const rawAmount = Number(body.amount)
  const amount = Number.isFinite(rawAmount) && rawAmount >= 0 ? Math.round(rawAmount * 100) / 100 : 0

  const prevAvatar = prev.avatar
  const nextAvatar = typeof body.avatar === 'string' ? body.avatar : ''
  const updated = {
    ...prev,
    avatar: nextAvatar,
    name: body.name.trim(),
    intro: typeof body.intro === 'string' ? body.intro.trim() : '',
    amount,
  }
  updateDonor(updated)

  if (prevAvatar && prevAvatar !== nextAvatar && prevAvatar.startsWith(UPLOAD_PREFIX)) {
    const filename = prevAvatar.slice(UPLOAD_PREFIX.length)
    if (/^[A-Za-z0-9._-]+$/.test(filename)) {
      await fs.rm(path.join(uploadsDir, filename), { force: true }).catch(() => {})
    }
  }

  return updated
})
