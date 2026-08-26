import { listDownloadProjects, requirePagePermission, updateDownloadProject, type DownloadProjectType } from '../../utils/db'

const TYPES: DownloadProjectType[] = ['整合包', '模组']

function isDownloadUrl(value: string) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export default defineEventHandler(async (event) => {
  requirePagePermission(event, 'downloads', 'edit')
  const id = getRouterParam(event, 'id')
  const previous = listDownloadProjects().find((item) => item.id === id)
  if (!previous) throw createError({ statusCode: 404, statusMessage: '下载项目不存在' })
  const body = await readBody<Record<string, unknown>>(event)
  const type = typeof body.type === 'string' && body.type.trim() ? body.type.trim() as DownloadProjectType : previous.type
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : previous.name
  const url = typeof body.url === 'string' && body.url.trim() ? body.url.trim() : previous.url
  const version = typeof body.version === 'string' && body.version.trim() ? body.version.trim() : previous.version
  const description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : previous.description
  if (!TYPES.includes(type)) throw createError({ statusCode: 400, statusMessage: '项目类型只能是整合包或模组' })
  if (!isDownloadUrl(url)) throw createError({ statusCode: 400, statusMessage: '下载地址必须是有效的 http 或 https 地址' })
  const updated = { ...previous, type, name, url, version, description, updatedAt: Date.now() }
  updateDownloadProject(updated)
  return updated
})
