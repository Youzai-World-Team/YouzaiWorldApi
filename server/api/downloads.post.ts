import { insertDownloadProject, type DownloadProjectType, requirePagePermission } from '../utils/db'

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
  const body = await readBody<Record<string, unknown>>(event)
  const typeValue = typeof body.type === 'string' ? body.type.trim() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  const version = typeof body.version === 'string' ? body.version.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const type = TYPES.find((item) => item === typeValue)
  if (!type) throw createError({ statusCode: 400, statusMessage: '项目类型只能是整合包或模组' })
  if (!name || !url || !version || !description) throw createError({ statusCode: 400, statusMessage: '名称、下载地址、版本和描述均不能为空' })
  if (!isDownloadUrl(url)) throw createError({ statusCode: 400, statusMessage: '下载地址必须是有效的 http 或 https 地址' })
  const now = Date.now()
  const item = { id: `download_${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`, type, name, url, version, description, createdAt: now, updatedAt: now }
  insertDownloadProject(item)
  return item
})
