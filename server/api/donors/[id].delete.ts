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
  const donors = await readJson<Donor[]>('donors.json', [])
  const target = donors.find((d) => d.id === id)
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: '记录不存在' })
  }

  const next = donors.filter((d) => d.id !== id)
  await writeJson('donors.json', next)

  // 删除关联的头像文件
  if (target.avatar.startsWith(UPLOAD_PREFIX)) {
    const filename = target.avatar.slice(UPLOAD_PREFIX.length)
    if (/^[A-Za-z0-9._-]+$/.test(filename)) {
      const uploadDir = path.resolve(process.cwd(), 'server/data/uploads')
      await fs.rm(path.join(uploadDir, filename), { force: true }).catch(() => {})
    }
  }

  return { ok: true }
})
