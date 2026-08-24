import { getMcsmConfig, recordAudit, requireFeaturePermission } from '../../../utils/db'
import { assertInstanceAllowed, createBackup, listRootDirectories } from '../../../utils/mcsm'

const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/

/** 备份文件名里的时间戳用服务器本地时间，方便和控制台日志对得上。 */
function timestamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/**
 * 创建备份：把实例根目录下选中的几个目录压缩成备份目录里的一个 zip。
 * <p>
 * 打包目标必须是面板真实列出来的一级目录——不接受调用方自己拼的路径，
 * 否则这个接口就成了「用面板 ApiKey 压缩任意路径」的工具。备份目录自身也排除掉，
 * 免得把历史备份一层层套进新备份里。
 * </p>
 * <p>
 * 面板的压缩接口是同步返回的，大世界会占满整个请求；超时后面板侧的压缩任务仍在跑，
 * 页面刷新备份列表就能看到结果。
 * </p>
 */
export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-manage-backup', 'edit')
  const body = await readBody<{ uuid?: string; daemonId?: string; targets?: unknown; label?: string }>(event)

  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const instance = await assertInstanceAllowed(uuid, daemonId)

  const requested = Array.isArray(body?.targets) ? body.targets.map((item) => String(item ?? '')) : []
  if (requested.length === 0) {
    throw createError({ statusCode: 400, statusMessage: '请至少选择一个要备份的目录' })
  }
  if (requested.length > 20) {
    throw createError({ statusCode: 400, statusMessage: '一次最多备份 20 个目录' })
  }

  const { backupDir } = getMcsmConfig()
  const backupDirRoot = backupDir.split('/').filter(Boolean)[0] || ''
  const available = new Set(await listRootDirectories(uuid, daemonId))
  const targets: string[] = []
  for (const name of requested) {
    if (!available.has(name)) {
      throw createError({ statusCode: 400, statusMessage: `实例根目录下没有名为「${name}」的目录` })
    }
    if (name === backupDirRoot) {
      throw createError({ statusCode: 400, statusMessage: '备份目录本身不能作为备份目标' })
    }
    targets.push(`/${name}`)
  }

  const rawLabel = String(body?.label || '').trim()
  if (rawLabel && !LABEL_RE.test(rawLabel)) {
    throw createError({
      statusCode: 400,
      statusMessage: '备份标签只能包含字母、数字、点、下划线和短横线，且不超过 41 个字符',
    })
  }
  const name = `${rawLabel || 'backup'}-${timestamp()}.zip`

  await createBackup(uuid, daemonId, backupDir, name, targets)
  recordAudit(
    event,
    user,
    `为实例「${instance.nickname || uuid}」创建备份 ${name}（${targets.join('、')}）`,
  )
  return { ok: true, name }
})
