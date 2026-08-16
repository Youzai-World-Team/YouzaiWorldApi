const TYPES = ['info', 'success', 'warning', 'error'] as const

export default defineEventHandler(async (event) => {
  requireAuth(event)

  const body = await readBody<{ type?: string; date?: string; content?: string }>(event)

  if (!body.type || !(TYPES as readonly string[]).includes(body.type)) {
    throw createError({ statusCode: 400, statusMessage: '类型无效' })
  }
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    throw createError({ statusCode: 400, statusMessage: '日期格式应为 YYYY-MM-DD' })
  }
  if (!body.content || typeof body.content !== 'string' || !body.content.trim()) {
    throw createError({ statusCode: 400, statusMessage: '内容不能为空' })
  }

  const item = {
    id: `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    type: body.type,
    date: body.date,
    content: body.content.trim(),
  }
  insertActivity(item)

  return item
})
