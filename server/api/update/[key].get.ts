interface UpdateEntry {
  id: string
  key: string
  name: string
  latestVersion: string
  type: string
  forcedUpdate: boolean
  release_date: string
  release_time: string
  changelog: string[]
}

export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key') ?? ''
  const list = await readJson<UpdateEntry[]>('updates.json', [])
  const target = list.find((u) => u.key === key)

  if (!target) {
    throw createError({ statusCode: 404, statusMessage: '未找到该程序的更新信息' })
  }

  return {
    latestVersion: target.latestVersion,
    type: target.type,
    forcedUpdate: target.forcedUpdate,
    release_date: target.release_date,
    release_time: target.release_time,
    changelog: target.changelog,
  }
})
