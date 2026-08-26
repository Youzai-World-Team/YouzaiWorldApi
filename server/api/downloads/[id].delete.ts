import { deleteDownloadProject, listDownloadProjects, requirePagePermission } from '../../utils/db'

export default defineEventHandler((event) => {
  requirePagePermission(event, 'downloads', 'edit')
  const id = getRouterParam(event, 'id')
  if (!listDownloadProjects().some((item) => item.id === id)) throw createError({ statusCode: 404, statusMessage: '下载项目不存在' })
  deleteDownloadProject(id!)
  return { ok: true }
})
