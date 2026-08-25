import { requirePagePermission } from '../../../../utils/db'
import { assertInstanceAllowed } from '../../../../utils/mcsm'
import {
  fileDownloadUrl,
  INLINE_PREVIEW_MAX_BYTES,
  inlineContentType,
  requireInstancePath,
} from '../../../../utils/mcsm-files'

/**
 * 把实例里的文件流式转发给浏览器，用于预览和下载。
 * <p>
 * 面板给的下载地址直连守护进程，是明文 {@code http://} 的第三方节点：HTTPS 后台页面
 * 既过不了混合内容拦截，也过不了页面 CSP 的 {@code img-src 'self'} / {@code default-src 'self'}。
 * 所以这里由服务端取回再同源下发——图片、音视频就能直接在页面里预览。
 * </p>
 * <p>
 * 内联下发的 MIME 走白名单（见 {@code inlineContentType}），刻意排除 svg / html / xml：
 * 它们能携带脚本，同源内联等于把任意脚本放进后台源里执行。白名单外的一律
 * {@code application/octet-stream} + {@code attachment}，并且始终带 {@code nosniff}。
 * </p>
 * <p>
 * 守护进程不声明 {@code Accept-Ranges}，因此音视频只能顺序播放，拖动进度条大概率无效。
 * </p>
 */
export default defineEventHandler(async (event) => {
  requirePagePermission(event, 'server-files', 'view')
  const query = getQuery(event)
  const uuid = String(query.uuid || '')
  const daemonId = String(query.daemonId || '')
  await assertInstanceAllowed(uuid, daemonId)

  const path = requireInstancePath(query.path, { allowRoot: false })
  const name = path.split('/').filter(Boolean).pop() || 'download'
  const wantsDownload = String(query.download || '') === '1'
  const inlineType = inlineContentType(name)

  const { url } = await fileDownloadUrl(uuid, daemonId, path)

  let upstream: Response
  try {
    upstream = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  } catch {
    throw createError({ statusCode: 504, statusMessage: '无法从守护进程取回文件' })
  }
  if (!upstream.ok || !upstream.body) {
    throw createError({ statusCode: 502, statusMessage: `守护进程返回异常状态 ${upstream.status}` })
  }

  const length = Number(upstream.headers.get('content-length'))
  // 内联预览要整块塞进页面，超大文件只能走下载；下载本身不限体积（流式转发）。
  if (!wantsDownload && inlineType && Number.isFinite(length) && length > INLINE_PREVIEW_MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: '文件过大，无法在页面内预览，请改用下载' })
  }

  const inline = !wantsDownload && Boolean(inlineType)
  setResponseHeader(event, 'Content-Type', inline ? inlineType! : 'application/octet-stream')
  // 文件名可能含非 ASCII，按 RFC 5987 同时给 filename 和 filename*。
  const asciiName = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  setResponseHeader(
    event,
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`,
  )
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  if (Number.isFinite(length) && length >= 0) setResponseHeader(event, 'Content-Length', String(length))

  return upstream.body
})
