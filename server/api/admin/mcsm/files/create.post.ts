import { recordAudit, requirePagePermission } from '../../../../utils/db'
import { assertInstanceAllowed } from '../../../../utils/mcsm'
import { createEmptyFile, makeDirectory } from '../../../../utils/mcsm-files'

/** 新建目录或空文件。kind 决定走 mkdir 还是 touch。 */
export default defineEventHandler(async (event) => {
  const user = requirePagePermission(event, 'server-files', 'edit')
  const body = await readBody<{ uuid?: string; daemonId?: string; path?: string; name?: string; kind?: string }>(event)

  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const instance = await assertInstanceAllowed(uuid, daemonId)

  const kind = String(body?.kind || 'directory')
  if (kind !== 'directory' && kind !== 'file') {
    throw createError({ statusCode: 400, statusMessage: '只能新建目录或文件' })
  }

  const target = kind === 'directory'
    ? await makeDirectory(uuid, daemonId, body?.path, body?.name)
    : await createEmptyFile(uuid, daemonId, body?.path, body?.name)

  recordAudit(
    event,
    user,
    `在实例「${instance.nickname || uuid}」新建${kind === 'directory' ? '目录' : '文件'} ${target}`,
  )
  return { ok: true, path: target }
})
