const KEY_RE = /^[A-Za-z0-9_-]+$/

function nowParts() {
  const n = new Date()
  const pad = (x: number) => String(x).padStart(2, '0')
  return {
    date: `${n.getFullYear()}.${n.getMonth() + 1}.${n.getDate()}`,
    time: `${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`,
  }
}

export default defineEventHandler(async (event) => {
  requireAuth(event)

  const body = await readBody<{
    key?: string
    name?: string
    latestVersion?: string
    type?: string
    forcedUpdate?: boolean
    release_date?: string
    release_time?: string
    changelog?: string[]
  }>(event)

  const key = typeof body.key === 'string' ? body.key.trim() : ''
  if (!key || !KEY_RE.test(key)) {
    throw createError({ statusCode: 400, statusMessage: '标识格式不正确（仅限字母、数字、-、_）' })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: '名称不能为空' })
  }

  const latestVersion = typeof body.latestVersion === 'string' ? body.latestVersion.trim() : ''
  if (!latestVersion) {
    throw createError({ statusCode: 400, statusMessage: '最新版本不能为空' })
  }

  if (listUpdates().some((u) => u.key === key)) {
    throw createError({ statusCode: 400, statusMessage: '该标识已存在' })
  }

  const now = nowParts()
  const entry = {
    id: `upd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    key,
    name,
    latestVersion,
    type: typeof body.type === 'string' && body.type.trim() ? body.type.trim() : 'release',
    forcedUpdate: body.forcedUpdate === true,
    release_date: typeof body.release_date === 'string' && body.release_date.trim() ? body.release_date.trim() : now.date,
    release_time: typeof body.release_time === 'string' && body.release_time.trim() ? body.release_time.trim() : now.time,
    changelog: Array.isArray(body.changelog) ? body.changelog.filter((c) => typeof c === 'string' && c.trim()) : [],
  }
  insertUpdate(entry)

  return entry
})
