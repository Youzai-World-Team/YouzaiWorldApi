import { createReadStream } from 'node:fs'
import { createError } from 'h3'

// 与修改版 ElementsPanel 的前端一致，避免旧 /upload 接口的 100 MiB 单文件限制。
export const DAEMON_UPLOAD_PIECE_BYTES = 2 * 1024 * 1024
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000
const CLEANUP_TIMEOUT_MS = 10_000
const UPLOAD_TASK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface UploadControl {
  assertCurrent: () => void
  signal?: AbortSignal
}

export function assertUploadActive(control: UploadControl): void {
  control.assertCurrent()
  if (control.signal?.aborted) {
    throw createError({ statusCode: 499, statusMessage: '上传已取消' })
  }
}

/** 保持有界缓冲，并在发出最后一块前确认来源的实际大小。 */
async function* uploadPieces(source: AsyncIterable<Uint8Array>, size: number): AsyncGenerator<Buffer> {
  let piece = Buffer.allocUnsafe(Math.min(size, DAEMON_UPLOAD_PIECE_BYTES))
  let filled = 0
  let received = 0
  for await (const raw of source) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
    if (received + chunk.length > size) {
      throw createError({ statusCode: 400, statusMessage: '暂存文件大小与上传声明不一致' })
    }
    let cursor = 0
    while (cursor < chunk.length) {
      const length = Math.min(piece.length - filled, chunk.length - cursor)
      chunk.copy(piece, filled, cursor, cursor + length)
      filled += length
      received += length
      cursor += length
      if (filled === piece.length && received < size) {
        yield piece
        piece = Buffer.allocUnsafe(Math.min(size - received, DAEMON_UPLOAD_PIECE_BYTES))
        filled = 0
      }
    }
  }
  if (received !== size) {
    throw createError({ statusCode: 400, statusMessage: '暂存文件大小与上传声明不一致' })
  }
  if (filled) yield piece.subarray(0, filled)
}

/**
 * 按 ElementsPanel 的 upload-new → upload-piece 协议转发。
 * name 必须是本次生成的唯一临时文件名，完整传送后再由调用方发布到目标路径。
 */
export async function forwardFileUpload(
  url: string,
  source: AsyncIterable<Uint8Array>,
  size: number,
  name: string,
  control: UploadControl & { onTaskCompleted?: () => void },
): Promise<void> {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw createError({ statusCode: 400, statusMessage: '分块转发需要非空文件' })
  }
  const initialize = new URL(url)
  const marker = initialize.pathname.lastIndexOf('/upload-new/')
  if (marker < 0) throw createError({ statusCode: 502, statusMessage: '上传票据地址无效' })
  const basePath = initialize.pathname.slice(0, marker)
  const taskUrl = (kind: 'upload-new' | 'upload-piece', id: string) => {
    const target = new URL(initialize.origin)
    target.pathname = `${basePath}/${kind}/${id}`
    return target
  }
  initialize.searchParams.set('filename', name)
  initialize.searchParams.set('size', String(size))
  initialize.searchParams.set('overwrite', 'false')
  const timeout = AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
  const signal = control.signal ? AbortSignal.any([control.signal, timeout]) : timeout
  let taskId = ''
  let complete = false

  const request = async (target: URL, body?: FormData): Promise<Response> => {
    assertUploadActive(control)
    try {
      return await fetch(target, { method: 'POST', body, signal, redirect: 'error' })
    } catch {
      assertUploadActive(control)
      throw createError({ statusCode: 504, statusMessage: '无法连接上传节点或上传超时，请检查节点地址与网络' })
    }
  }

  try {
    const initialized = await request(initialize)
    const payload = await initialized.json().catch(() => null)
    if (!initialized.ok || payload?.status !== 200 || !UPLOAD_TASK_ID_RE.test(payload?.data?.id || '')
      || !Array.isArray(payload?.data?.received)) {
      throw createError({ statusCode: 502, statusMessage: `守护进程未能创建分块上传任务（HTTP ${initialized.status}）` })
    }
    // 不续传来源不明的任务，亦不能 stop 它，否则可能混入或删除别人的文件。
    if (payload.data.received.length) {
      throw createError({ statusCode: 409, statusMessage: '上传临时路径已有其他任务，请重新上传' })
    }
    taskId = payload.data.id
    assertUploadActive(control)
    let offset = 0
    for await (const piece of uploadPieces(source, size)) {
      assertUploadActive(control)
      const target = taskUrl('upload-piece', taskId)
      target.searchParams.set('offset', String(offset))
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(piece)], { type: 'application/octet-stream' }), name)
      const upstream = await request(target, form)
      const reply = (await upstream.text().catch(() => '')).trim()
      if (!upstream.ok || reply !== 'OK') {
        throw createError({ statusCode: 502, statusMessage: `守护进程未确认上传分块（HTTP ${upstream.status}）` })
      }
      offset += piece.length
      complete = offset === size
      if (complete) control.onTaskCompleted?.()
      assertUploadActive(control)
    }
  } finally {
    // 最后一块已确认后绝不再 stop：面板的 stop 会删除文件，且 done 是异步的。
    if (taskId && !complete) {
      const stop = taskUrl('upload-new', taskId)
      stop.searchParams.set('stop', 'true')
      try {
        const response = await fetch(stop, { method: 'POST', signal: AbortSignal.timeout(CLEANUP_TIMEOUT_MS), redirect: 'error' })
        if (!response.ok || (await response.text()).trim() !== 'OK') throw new Error('未确认取消')
      } catch {
        console.warn(`节点未确认取消上传，临时文件可能需要清理：${name}`)
      }
    }
  }
}

/** 惰性打开暂存文件，避免取票据失败时遗留流或发生未监听的文件读取错误。 */
export async function* openStagedUpload(filePath: string, signal?: AbortSignal): AsyncGenerator<Buffer> {
  const source = createReadStream(filePath, { highWaterMark: DAEMON_UPLOAD_PIECE_BYTES, signal })
  try {
    for await (const chunk of source) yield chunk as Buffer
  } finally {
    source.destroy()
  }
}
