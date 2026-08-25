import { recordAudit, requirePagePermission } from '../../../../utils/db'
import { assertInstanceAllowed } from '../../../../utils/mcsm'
import { compressEntries, extractArchive } from '../../../../utils/mcsm-files'

/**
 * 压缩选中项为 zip，或把 zip 解压到指定目录。
 * <p>
 * 面板的压缩接口是同步返回的，大目录会占满整个请求；超时后面板侧仍在继续，
 * 刷新目录就能看到结果。运行中的服务器会占着部分文件句柄（比如 mods 里的 jar），
 * 那些目录压缩会失败——这一点由页面提示。
 * </p>
 */
export default defineEventHandler(async (event) => {
  const user = requirePagePermission(event, 'server-files', 'edit')
  const body = await readBody<{
    uuid?: string
    daemonId?: string
    mode?: string
    paths?: unknown
    path?: string
    dir?: string
    name?: string
    createFolder?: boolean
    folderName?: string
  }>(event)

  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const instance = await assertInstanceAllowed(uuid, daemonId)
  const label = instance.nickname || uuid

  if (String(body?.mode) === 'extract') {
    await extractArchive(uuid, daemonId, body?.path, body?.dir, body?.createFolder, body?.folderName)
    const targetDesc = body?.createFolder && body?.folderName
      ? `${String(body?.dir || '/')}/${body.folderName}`
      : String(body?.dir || '/')
    recordAudit(event, user, `解压实例「${label}」的 ${String(body?.path || '')} 到 ${targetDesc}`)
    return { ok: true }
  }

  if (String(body?.mode) === 'compress') {
    const source = await compressEntries(uuid, daemonId, body?.paths, body?.dir, body?.name)
    recordAudit(event, user, `压缩实例「${label}」的选中项为 ${source}`)
    return { ok: true, path: source }
  }

  throw createError({ statusCode: 400, statusMessage: '操作类型只能是 compress 或 extract' })
})
