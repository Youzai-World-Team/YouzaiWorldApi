interface Activity {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  date: string
  content: string
}

const TYPES = ['info', 'success', 'warning', 'error'] as const

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

  const body = await readBody<{ type?: string; date?: string; content?: string }>(event)

  if (!body.type || !TYPES.includes(body.type as Activity['type'])) {
    throw createError({ statusCode: 400, statusMessage: '类型无效' })
  }
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    throw createError({ statusCode: 400, statusMessage: '日期格式应为 YYYY-MM-DD' })
  }
  if (!body.content || typeof body.content !== 'string' || !body.content.trim()) {
    throw createError({ statusCode: 400, statusMessage: '内容不能为空' })
  }

  const items = await readJson<Activity[]>('activities.json', [])
  const item: Activity = {
    id: `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    type: body.type as Activity['type'],
    date: body.date,
    content: body.content.trim(),
  }
  items.unshift(item)
  await writeJson('activities.json', items)

  return item
})
