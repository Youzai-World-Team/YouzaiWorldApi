import { promises as fs } from 'node:fs'
import path from 'node:path'

interface Donor {
  id: string
  avatar: string
  name: string
  intro: string
  amount: number
}

const UPLOAD_PREFIX = '/api/uploads/'

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

  const id = getRouterParam(event, 'id')
  const body = await readBody<{ avatar?: string; name?: string; intro?: string; amount?: number | string }>(event)

  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    throw createError({ statusCode: 400, statusMessage: '名称不能为空' })
  }

  const donors = await readJson<Donor[]>('donors.json', [])
  const idx = donors.findIndex((d) => d.id === id)
  if (idx === -1) {
    throw createError({ statusCode: 404, statusMessage: '记录不存在' })
  }

  const rawAmount = Number(body.amount)
  const amount = Number.isFinite(rawAmount) && rawAmount >= 0 ? Math.round(rawAmount * 100) / 100 : 0

  const prevAvatar = donors[idx].avatar
  const nextAvatar = typeof body.avatar === 'string' ? body.avatar : ''
  const updated: Donor = {
    ...donors[idx],
    avatar: nextAvatar,
    name: body.name.trim(),
    intro: typeof body.intro === 'string' ? body.intro.trim() : '',
    amount,
  }
  donors[idx] = updated
  await writeJson('donors.json', donors)

  // 若头像被替换成新的上传文件，删除旧的头像文件
  if (prevAvatar && prevAvatar !== nextAvatar && prevAvatar.startsWith(UPLOAD_PREFIX)) {
    const filename = prevAvatar.slice(UPLOAD_PREFIX.length)
    if (/^[A-Za-z0-9._-]+$/.test(filename)) {
      const uploadDir = path.resolve(process.cwd(), 'server/data/uploads')
      await fs.rm(path.join(uploadDir, filename), { force: true }).catch(() => {})
    }
  }

  return updated
})
