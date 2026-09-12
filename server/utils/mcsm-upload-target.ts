import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createError } from 'h3'
import { getMcsmConfig } from './db'
import { callPanel } from './mcsm'
import { fileUploadUrl, joinPath, makeDirectory, requireFileName, requireInstancePath } from './mcsm-files'
import { assertUploadActive, forwardFileUpload, openStagedUpload, type UploadControl } from './mcsm-upload'

const DIRECTORY_PAGE_SIZE = 100
const MAX_DIRECTORY_PAGES = 100
const EMPTY_FILE_CHECKS = 20
const activeTargets = new Set<string>()

interface UploadTargetEntry {
  name: string
  type: number
  size: number
}

/** 查询真实目录（含分页和大小写冲突），不依赖浏览器当前已加载的文件列表。 */
export async function inspectUploadTarget(
  uuid: string,
  daemonId: string,
  dirValue: unknown,
  nameValue: unknown,
  control: UploadControl,
): Promise<{ name: string; path: string; existing: UploadTargetEntry | null }> {
  const dir = requireInstancePath(dirValue)
  const name = requireFileName(nameValue)
  let caseInsensitiveMatch: UploadTargetEntry | null = null
  const result = (existing: UploadTargetEntry | null) => ({ name, path: joinPath(dir, name), existing })
  const mapEntry = (entry: any): UploadTargetEntry => ({
    name: String(entry.name), type: Number(entry.type), size: Number(entry.size),
  })
  for (let page = 0; page < MAX_DIRECTORY_PAGES; page++) {
    assertUploadActive(control)
    const data = await callPanel<any>('/api/files/list', {
      query: { uuid, daemonId, target: dir, page, page_size: DIRECTORY_PAGE_SIZE, file_name: name },
    })
    assertUploadActive(control)
    if (!Array.isArray(data?.items) || !Number.isSafeInteger(data?.total) || data.total < 0) {
      throw createError({ statusCode: 502, statusMessage: '无法核对上传目标目录' })
    }
    const exact = data.items.find((entry: any) => entry?.name === name)
    if (exact) return result(mapEntry(exact))
    const folded = data.items.find((entry: any) => String(entry?.name).toLowerCase() === name.toLowerCase())
    if (folded && !caseInsensitiveMatch) caseInsensitiveMatch = mapEntry(folded)
    const pageSize = Number(data.pageSize) || DIRECTORY_PAGE_SIZE
    if ((page + 1) * pageSize >= data.total) return result(caseInsensitiveMatch)
  }
  throw createError({ statusCode: 502, statusMessage: '目录查询结果过多，无法安全核对上传目标' })
}

/** 逐级准备上传目录；同名目录复用，同名文件绝不覆盖。 */
export async function ensureUploadDirectory(
  uuid: string, daemonId: string, dirValue: unknown, nameValue: unknown, control: UploadControl,
): Promise<{ name: string; path: string; created: boolean }> {
  const dir = requireInstancePath(dirValue)
  const name = requireFileName(nameValue)
  requireInstancePath(joinPath(dir, name), { allowRoot: false })
  const directoryResult = (entry: UploadTargetEntry, created: boolean) => {
    if (entry.type !== 0) {
      throw createError({ statusCode: 409, statusMessage: `「${entry.name}」已被文件占用，无法上传同名文件夹` })
    }
    return { name: entry.name, path: joinPath(dir, entry.name), created }
  }
  const checked = await inspectUploadTarget(uuid, daemonId, dir, name, control)
  if (checked.existing) return directoryResult(checked.existing, false)
  assertUploadActive(control)
  try {
    await makeDirectory(uuid, daemonId, dir, name)
  } catch (error) {
    // 其他请求可能刚刚创建了同名目录，核实后即可继续。
    const raced = await inspectUploadTarget(uuid, daemonId, dir, name, control)
    if (raced.existing) return directoryResult(raced.existing, false)
    throw error
  }
  const confirmed = await inspectUploadTarget(uuid, daemonId, dir, name, control)
  if (!confirmed.existing) {
    throw createError({ statusCode: 502, statusMessage: '服务器尚未确认文件夹创建成功，请刷新目录后重试' })
  }
  return directoryResult(confirmed.existing, true)
}

function uploadConflict(existing: UploadTargetEntry): never {
  throw createError({
    statusCode: 409,
    statusMessage: existing.type === 1 ? '已存在同名文件，请选择替换或改名' : '目标名称已被目录占用，请改名上传',
    data: { code: 'MCSM_UPLOAD_CONFLICT' },
  })
}

/** 只传送到唯一临时文件；成功后才替换目标，失败时保留或还原旧文件。 */
export async function uploadStagedFile(
  uuid: string,
  daemonId: string,
  dirValue: string,
  nameValue: string,
  stagedFile: string,
  size: number,
  control: UploadControl & { overwrite?: boolean },
): Promise<{ path: string; warning?: string }> {
  const dir = requireInstancePath(dirValue)
  const name = requireFileName(nameValue)
  const destination = joinPath(dir, name)
  const connection = getMcsmConfig()
  const scope = createHash('sha256').update(JSON.stringify([
    connection.baseUrl, uuid.toLowerCase(), daemonId.toLowerCase(), destination.toLowerCase(),
  ])).digest('hex')
  if (activeTargets.has(scope)) {
    throw createError({ statusCode: 409, statusMessage: '该路径已有上传正在处理，请稍后重试' })
  }
  assertUploadActive(control)
  activeTargets.add(scope)

  const unique = randomUUID()
  const temporaryName = `.yzw-upload-${unique}.part`
  const temporary = joinPath(dir, temporaryName)
  const backup = joinPath(dir, `.yzw-upload-${unique}.previous`)
  let remoteReady = false
  let backupAttempted = false
  let published = false

  const write = async (endpoint: string, method: string, body: unknown, recovery = false) => {
    // 恢复、清理可以忽略浏览器断开，但绝不能把旧路径操作发往新绑定或新面板。
    if (recovery) control.assertCurrent()
    else assertUploadActive(control)
    const result = await callPanel<unknown>(endpoint, { method, query: { uuid, daemonId }, body })
    if (result !== true) {
      throw createError({ statusCode: 502, statusMessage: '面板未确认上传文件操作完成' })
    }
  }
  const move = (from: string, to: string, recovery = false) =>
    write('/api/files/move', 'PUT', { targets: [[from, to]] }, recovery)
  const remove = async (target: string) => {
    // 面板的 delete 是异步的，且删除不存在的文件可能触发未处理的拒绝；先确认存在。
    const fileName = target.slice(target.lastIndexOf('/') + 1)
    const existing = await findEntry(fileName, true)
    if (existing) {
      if (existing.name !== fileName || existing.type !== 1) {
        throw createError({ statusCode: 409, statusMessage: '上传临时路径已变更，已停止自动清理' })
      }
      await write('/api/files/', 'DELETE', { targets: [target] }, true)
    }
  }

  const findEntry = async (fileName: string, recovery = false) => {
    const { existing } = await inspectUploadTarget(uuid, daemonId, dir, fileName,
      recovery ? { assertCurrent: control.assertCurrent } : control)
    return existing
  }
  const assertReplacementAllowed = (existing: UploadTargetEntry | null) => {
    if (existing && (control.overwrite !== true || existing.type !== 1 || existing.name !== name)) {
      uploadConflict(existing)
    }
  }

  try {
    // 默认不覆盖；确认信息必须随当前文件传入，不能从上一份文件继承。
    assertReplacementAllowed(await findEntry(name))
    if (size === 0) {
      // 修改版面板的零字节分块任务不能自行结束，改用新建文件并核对落盘结果。
      await write('/api/files/touch', 'POST', { target: temporary })
      let created = false
      for (let attempt = 0; attempt < EMPTY_FILE_CHECKS; attempt++) {
        const entry = await findEntry(temporaryName)
        if (entry?.type === 1 && entry.size === 0) { created = true; break }
        await delay(100)
      }
      if (!created) throw createError({ statusCode: 502, statusMessage: '面板尚未完成空文件创建，请重试' })
      remoteReady = true
    } else {
      const { url } = await fileUploadUrl(uuid, daemonId, dir)
      assertUploadActive(control)
      await forwardFileUpload(url, openStagedUpload(stagedFile, control.signal), size, temporaryName, {
        ...control, onTaskCompleted: () => { remoteReady = true },
      })
    }

    const uploaded = await findEntry(temporaryName)
    if (uploaded?.type !== 1 || uploaded.name !== temporaryName || uploaded.size !== size) {
      throw createError({ statusCode: 502, statusMessage: '守护进程中的上传文件大小校验失败' })
    }
    const existing = await findEntry(name)
    // 初次检查后可能有其他上传落盘，正式发布之前仍须复核。
    assertReplacementAllowed(existing)

    // ElementsPanel 的 move 不支持 overwrite。先移开旧文件，发布失败再尝试恢复；
    // 不采用先删除旧文件或异步 copy 的方式，避免失败后丢失原内容。
    try {
      if (existing) {
        backupAttempted = true
        await move(destination, backup)
      }
      await move(temporary, destination)
      published = true
    } catch (error: any) {
      if (backupAttempted) {
        try {
          // move 拒绝覆盖已存在的目标，响应丢失时也不会破坏已经发布的新文件。
          await move(backup, destination, true)
        } catch {
          throw createError({
            statusCode: error?.statusCode || 502,
            statusMessage: `上传替换未能确认完成，原文件备份可能位于 ${backup}，请检查后再重试`,
          })
        }
      } else {
        // 最终 move 也不覆盖；检查与移动之间出现的新文件交回前端重新确认。
        const racedEntry = await findEntry(name)
        if (racedEntry) uploadConflict(racedEntry)
      }
      throw error
    }

    if (backupAttempted) {
      try { await remove(backup) } catch {
        return { path: destination, warning: `文件已上传，旧文件备份未能清理：${backup}` }
      }
    }
    return { path: destination }
  } finally {
    // 未完成的任务只由转发层 stop 一次，避免重复删除导致面板报错或发生关闭竞态。
    if (remoteReady && !published) {
      try { await remove(temporary) } catch {
        // 仅记录本次随机临时路径，不记录上传票据或面板密钥。
        console.warn(`上传未完成，临时文件可能需要清理：${temporary}`)
      }
    }
    activeTargets.delete(scope)
  }
}
