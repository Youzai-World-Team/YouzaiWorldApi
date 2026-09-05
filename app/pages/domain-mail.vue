<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { webAssetUrl } from '#shared/web-assets'

useHead({ title: '域名邮件' })

interface MailAddress { name: string; address: string }

interface MailAttachment {
  id: string
  position: number
  filename: string
  mimeType: string
  disposition: string
  contentId: string
  size: number
  sha256: string
  stored: boolean
}

interface MailReader {
  id: number
  username: string
  avatar: string
  fullName: string
  isOwner: boolean
  isActive: boolean
  readAt: number
}

interface MailSummary {
  id: string
  messageId: string
  mailbox: string
  envelopeTo: string
  envelopeFrom: string
  fromAddress: string
  fromName: string
  subject: string
  sentTime: number | null
  receivedTime: number
  rawSize: number
  spf: string
  dkim: string
  dmarc: string
  truncated: boolean
  hasText: boolean
  hasHtml: boolean
  attachmentCount: number
  attachmentBytes: number
  unread: boolean
}

interface MailDetail extends MailSummary {
  toAddresses: MailAddress[]
  ccAddresses: MailAddress[]
  replyTo: string
  textBody: string
  htmlBody: string
  /** 服务端按允许列表净化后的 HTML，只在沙箱 iframe 里渲染。 */
  htmlSafe: string
  /** 从 <style> 里净化出来的 CSS，放进沙箱文档的 head。 */
  htmlSafeCss: string
  htmlBlockedImages: number
  htmlSafeTruncated: boolean
  attachments: MailAttachment[]
  readers: MailReader[]
}

interface SentAttachment {
  filename: string
  mimeType: string
  size: number
  sha256: string
}

interface SentSummary {
  id: string
  senderAddress: string
  senderName: string
  recipient: string
  subject: string
  sentTime: number
  hasText: boolean
  hasHtml: boolean
  attachmentCount: number
  attachmentBytes: number
  textPreview: string
}

interface SentDetail extends SentSummary {
  textBody: string
  htmlBody: string
  attachments: SentAttachment[]
  htmlSafe: string
  htmlSafeCss: string
  htmlBlockedImages: number
  htmlSafeTruncated: boolean
}

type BodyView = 'html' | 'text' | 'source'
type ReadFilter = 'all' | 'unread'
type MailFolder = 'inbox' | 'sent'

interface ComposePreviewResponse {
  document: string
  blockedImages: number
  truncated: boolean
}

interface ComposeAttachment {
  id: string
  file: File
}

const VERDICT_LABELS: Record<string, string> = {
  pass: '通过',
  fail: '失败',
  softfail: '软失败',
  neutral: '中立',
  none: '未配置',
  temperror: '临时错误',
  permerror: '永久错误',
  policy: '策略拒绝',
}
// 源码视图超过这个长度就截断，避免一封营销邮件把页面卡住。
const HTML_PREVIEW_MAX = 200_000
const ATTACHMENT_MAX_COUNT = 5
const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024
const ATTACHMENTS_TOTAL_MAX_BYTES = 10 * 1024 * 1024

/**
 * 沙箱预览容器的基础样式，排在邮件自己的 CSS 之前，让邮件能覆盖它。
 * 固定白底深字：邮件都是按白底设计的，跟随后台深色主题反而会让大量邮件不可读。
 * 只做「兜底」——不设 border-collapse、不给 td 加 padding，以免覆盖邮件自己的表格排版。
 */
const FRAME_BASE_CSS = `
:root { color-scheme: light; }
html, body { margin: 0; padding: 0; background: #ffffff; }
body {
  padding: 14px 16px;
  color: #191d14;
  font: 14px/1.65 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  overflow-wrap: anywhere;
  word-break: break-word;
}
img:not(.yzw-blocked-img) { max-width: 100%; height: auto; }
blockquote {
  margin: 8px 0; padding: 4px 0 4px 12px;
  border-left: 3px solid #c2c9b4; color: #44483b;
}
`.trim()

/**
 * 我们自己的标记样式，排在邮件 CSS **之后**并带 !important，
 * 避免邮件的 <style> 把链接标记或图片占位改得看不出来。
 */
const FRAME_MARKER_CSS = `
.yzw-link {
  color: #1a56c4 !important;
  text-decoration: underline !important;
  text-decoration-style: dotted !important;
  cursor: pointer !important;
}
.yzw-link:hover { background: #e8f0fe !important; }
.yzw-link:focus { outline: 2px solid #1a56c4 !important; outline-offset: 1px; }
.yzw-link::after {
  content: " \\1F517";
  font-size: 11px;
}
.yzw-link--blocked {
  color: #8a1c14 !important;
  text-decoration-line: line-through !important;
  cursor: not-allowed !important;
}
.yzw-link--blocked::after { content: " (已移除)"; font-size: 11px; }
.yzw-blocked-img {
  box-sizing: border-box !important;
  border: 1px dashed #a8b096 !important;
  background-color: #f4f6ee !important;
}
`.trim()

/**
 * 沙箱里注入的唯一一段脚本：把链接点击回传给父页面。
 * <p>
 * 只读 data-yzw-href 并 postMessage，不碰别的。它靠 CSP nonce 才被允许执行，
 * 邮件里万一漏过来的脚本没有 nonce，一律被 CSP 拦死。
 * </p>
 */
const FRAME_SCRIPT = `
(function () {
  function send(el) {
    var url = el.getAttribute('data-yzw-href');
    parent.postMessage({ source: 'yzw-mail-frame', kind: url ? 'link' : 'blocked', url: url || '' }, '*');
  }
  document.addEventListener('click', function (event) {
    var el = event.target && event.target.closest ? event.target.closest('.yzw-link') : null;
    if (!el) return;
    event.preventDefault();
    send(el);
  }, true);
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var el = event.target && event.target.closest ? event.target.closest('.yzw-link') : null;
    if (!el) return;
    event.preventDefault();
    send(el);
  }, true);
})();
`.trim()

const mails = ref<MailSummary[]>([])
const sentMails = ref<SentSummary[]>([])
const loading = ref(true)
const sentLoading = ref(true)
const activeFolder = ref<MailFolder>('inbox')
const keyword = ref('')
const mailboxFilter = ref('')
const readFilter = ref<ReadFilter>('all')
const sentKeyword = ref('')

const detailOpen = ref(false)
const detail = ref<MailDetail | null>(null)
const detailLoading = ref(false)
const detailDialog = ref<HTMLElement | null>(null)
const detailDialogContent = ref<HTMLElement | null>(null)
const detailSidebar = ref<HTMLElement | null>(null)
const detailMain = ref<HTMLElement | null>(null)
const bodyView = ref<BodyView>('html')

const sentDetailOpen = ref(false)
const sentDetail = ref<SentDetail | null>(null)
const sentDetailContent = ref<HTMLElement | null>(null)
const sentDetailLoading = ref(false)
const sentBodyView = ref<'html' | 'text'>('html')

const deleteTarget = ref<MailSummary | null>(null)
const deleting = ref(false)

// 链接弹窗：沙箱里点了链接，父页面在这里显示完整地址供手动复制
const linkDialog = ref<HTMLElement | null>(null)
const linkOpen = ref(false)
const linkUrl = ref('')
const linkBlocked = ref(false)
const bodyFrame = ref<HTMLIFrameElement | null>(null)

const { showToast } = useToast()
const access = useAdminAccess()
const domainMailUnread = useDomainMailUnread()
const currentUserId = computed(() => access.user.value?.id ?? 0)
const canEditPage = computed(() => access.levelForKey('domain-mail') === 'edit')
const canSendMail = computed(() => canEditPage.value && access.featureLevelForKey('domain-mail-send') === 'edit')
const canDeleteMail = computed(() => canEditPage.value && access.featureLevelForKey('domain-mail-delete') === 'edit')
const { apply: applyDialogAnimation } = useDialogAnimation()

const composeOpen = ref(false)
const composeLoading = ref(false)
const sending = ref(false)
const composeMode = ref<'template' | 'source'>('template')
const composeTo = ref('')
const composeSubject = ref('')
const composeHtml = ref('')
const composeFields = ref<Record<string, string>>({})
const composeFromLocalPart = ref('')
const composeFromName = ref('')
const composeSender = ref({ owner: false, defaultLocalPart: '', defaultAddress: '', defaultName: '' })
const composeFile = ref<HTMLInputElement | null>(null)
const composeFileName = ref('')
const composeAttachmentInput = ref<HTMLInputElement | null>(null)
const composeAttachments = ref<ComposeAttachment[]>([])
const composeDialog = ref<HTMLElement | null>(null)
const composeSourceEditor = ref<{ layout: () => void; focus: () => void } | null>(null)
const composeSourceFullscreen = ref(false)
const composePreviewDocument = ref('')
const composePreviewLoading = ref(false)
const composePreviewError = ref('')
const composePreviewBlockedImages = ref(0)

function focusTab(id: string) {
  void nextTick(() => document.getElementById(id)?.focus())
}

function onComposeTabKeydown(event: KeyboardEvent) {
  const modes = ['template', 'source'] as const
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const current = modes.indexOf(composeMode.value)
  const index = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? modes.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + modes.length) % modes.length
  composeMode.value = modes[index]!
  focusTab(`compose-${composeMode.value}-tab`)
}

function onBodyTabKeydown(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const views: BodyView[] = detail.value?.hasHtml ? ['html', 'text', 'source'] : ['text']
  const current = Math.max(0, views.indexOf(bodyView.value))
  const index = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? views.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + views.length) % views.length
  bodyView.value = views[index]!
  focusTab(`mail-${bodyView.value}-tab`)
}
const composePreviewTruncated = ref(false)
let composePreviewTimer: ReturnType<typeof setTimeout> | null = null
let composePreviewRequest = 0
let composePreviousBodyOverflow = ''

/** 收件前缀下拉：按实际收到过的 mailbox 归集，方便只看某个地址。 */
const mailboxes = computed(() => [...new Set(mails.value.map((mail) => mail.mailbox).filter(Boolean))]
  .sort((a, b) => a.localeCompare(b, 'en')))
const unreadCount = computed(() => domainMailUnread.count.value
  ?? mails.value.filter((mail) => mail.unread).length)
const attachmentCount = computed(() => mails.value.reduce((total, mail) => total + mail.attachmentCount, 0))
const composeAttachmentBytes = computed(() => composeAttachments.value
  .reduce((total, attachment) => total + attachment.file.size, 0))
const composeSourceEditorHeight = computed(() => composeSourceFullscreen.value ? '100%' : '420px')
const todayReceivedCount = computed(() => {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return mails.value.filter((mail) => mail.receivedTime >= start.getTime()).length
})

const filtered = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  return mails.value.filter((mail) => {
    if (mailboxFilter.value && mail.mailbox !== mailboxFilter.value) return false
    if (readFilter.value === 'unread' && !mail.unread) return false
    if (!text) return true
    return mail.subject.toLowerCase().includes(text)
      || mail.fromAddress.includes(text)
      || mail.fromName.toLowerCase().includes(text)
      || mail.envelopeTo.includes(text)
  })
})

const filteredSent = computed(() => {
  const text = sentKeyword.value.trim().toLowerCase()
  if (!text) return sentMails.value
  return sentMails.value.filter((mail) => mail.subject.toLowerCase().includes(text)
    || mail.recipient.toLowerCase().includes(text)
    || mail.senderAddress.toLowerCase().includes(text)
    || mail.senderName.toLowerCase().includes(text)
    || mail.textPreview.toLowerCase().includes(text))
})

const htmlPreview = computed(() => {
  const html = detail.value?.htmlBody || ''
  return html.length > HTML_PREVIEW_MAX ? html.slice(0, HTML_PREVIEW_MAX) : html
})
const htmlTruncated = computed(() => (detail.value?.htmlBody.length || 0) > HTML_PREVIEW_MAX)

/**
 * 沙箱预览文档。
 * <p>
 * 三层防御，互不依赖：
 * 1. 服务端允许列表净化（HTML 与 CSS 都过一遍）；
 * 2. iframe 用 {@code sandbox="allow-scripts"}——**不给** allow-same-origin，
 *    文档处于不透明源，读不到父页面 DOM / Cookie / localStorage；也没有
 *    allow-popups / allow-top-navigation，点击跳不出去；
 * 3. 文档自带 CSP：{@code default-src 'none'} 挡掉一切外呼，脚本只允许带本次
 *    随机 nonce 的那一段（即下面的 FRAME_SCRIPT）。邮件里万一漏过来的脚本
 *    没有 nonce，执行不了。
 * </p>
 */
function buildSafeFrameDocument(item: { htmlSafe: string; htmlSafeCss: string }): string {
  if (!item.htmlSafe) return ''
  // 每次打开都换一个 nonce，邮件正文里即便猜到上一次的值也没用。
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const origin = window.location.origin
  const html = item.htmlSafe.replaceAll(
    webAssetUrl('/images/uzw-tm.png'),
    `${origin}/api/domain-mail-logo`,
  ).replaceAll('/images/uzw-tm.png', `${origin}/api/domain-mail-logo`)
  const csp = `default-src 'none'; img-src data: ${origin} https://mcyzw.top https://assets.mcyzw.top https://*.mcyzw.top; style-src 'unsafe-inline'; `
    + `font-src data:; script-src 'nonce-${nonce}'; form-action 'none'; base-uri 'none'`
  return '<!doctype html><html><head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
    + `<style>${FRAME_BASE_CSS}</style>`
    // 邮件自己的 CSS 夹在中间：能覆盖基础兜底，但覆盖不了后面带 !important 的标记样式
    + (item.htmlSafeCss ? `<style>${item.htmlSafeCss}</style>` : '')
    + `<style>${FRAME_MARKER_CSS}</style>`
    + `</head><body>${html}`
    + `<script nonce="${nonce}">${FRAME_SCRIPT}<\/script>`
    + '</body></html>'
}

function buildFrameDocument(item: MailDetail): string {
  return buildSafeFrameDocument(item)
}

const frameDocument = computed(() => (detail.value ? buildFrameDocument(detail.value) : ''))
const sentFrameDocument = computed(() => (sentDetail.value ? buildSafeFrameDocument(sentDetail.value) : ''))

/**
 * 接收沙箱里的链接点击。
 * <p>
 * 消息一律当不可信数据：先确认来自我们那个 iframe 的 window，再重新校验协议，
 * 最后只以纯文本渲染（Vue 插值自动转义），绝不当 HTML 用、也不做成可点链接。
 * </p>
 */
function onFrameMessage(event: MessageEvent) {
  const frame = bodyFrame.value
  if (!frame || event.source !== frame.contentWindow) return
  const data = event.data
  if (!data || typeof data !== 'object' || (data as any).source !== 'yzw-mail-frame') return

  const kind = String((data as any).kind || '')
  if (kind === 'blocked') {
    linkUrl.value = ''
    linkBlocked.value = true
    linkOpen.value = true
    return
  }
  if (kind !== 'link') return

  const raw = String((data as any).url || '')
  // 父页面独立复核一次协议，不因为服务端净化过就放松
  if (raw.length > 2048 || !/^(?:https?:|mailto:)/i.test(raw)) return
  linkUrl.value = raw
  linkBlocked.value = false
  linkOpen.value = true
}

async function copyLink() {
  if (!linkUrl.value) return
  try {
    await navigator.clipboard.writeText(linkUrl.value)
    showToast('链接已复制，请在浏览器新标签页手动打开')
  } catch {
    showToast('浏览器拒绝了复制，请手动选中上面的地址复制', 'error')
  }
}

function closeLinkDialog() {
  linkOpen.value = false
}

function onLinkDialogClosed() {
  linkOpen.value = false
  linkUrl.value = ''
  linkBlocked.value = false
}

function setComposeSourceFullscreen(value: boolean) {
  const nextValue = Boolean(value && composeOpen.value && composeMode.value === 'source')
  if (nextValue === composeSourceFullscreen.value) return
  if (nextValue) {
    composePreviousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = composePreviousBodyOverflow
    composePreviousBodyOverflow = ''
  }
  composeDialog.value?.toggleAttribute('data-yzw-source-fullscreen', nextValue)
  composeSourceFullscreen.value = nextValue
  void nextTick(() => {
    composeSourceEditor.value?.layout()
    composeSourceEditor.value?.focus()
  })
}

function toggleComposeSourceFullscreen() {
  setComposeSourceFullscreen(!composeSourceFullscreen.value)
}

function onComposeEditorKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !composeSourceFullscreen.value) return
  event.preventDefault()
  event.stopPropagation()
  setComposeSourceFullscreen(false)
}

onMounted(() => {
  refreshMailData()
  applyDialogAnimation(detailDialog.value)
  applyDialogAnimation(linkDialog.value)
  applyDialogAnimation(composeDialog.value)
  window.addEventListener('message', onFrameMessage)
  window.addEventListener('keydown', onComposeEditorKeydown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onFrameMessage)
  window.removeEventListener('keydown', onComposeEditorKeydown, true)
  setComposeSourceFullscreen(false)
  if (composePreviewTimer) clearTimeout(composePreviewTimer)
})

async function openCompose() {
  if (!canSendMail.value || composeLoading.value) return
  composePreviewRequest += 1
  composePreviewLoading.value = false
  if (composePreviewTimer) clearTimeout(composePreviewTimer)
  composeMode.value = 'template'
  composeTo.value = ''
  composeHtml.value = ''
  composeFileName.value = ''
  composeAttachments.value = []
  composePreviewDocument.value = ''
  composePreviewError.value = ''
  composePreviewBlockedImages.value = 0
  composePreviewTruncated.value = false
  if (composeFile.value) composeFile.value.value = ''
  if (composeAttachmentInput.value) composeAttachmentInput.value.value = ''
  composeOpen.value = true
  composeLoading.value = true
  try {
    const data = await $fetch<any>('/api/admin/domain-mails/compose-template')
    composeHtml.value = data.sourceHtml || data.html || ''
    composeFields.value = { ...(data.fields || {}) }
    composeSubject.value = composeFields.value.subject || ''
    composeFromLocalPart.value = data.sender?.defaultLocalPart || ''
    composeFromName.value = data.sender?.defaultName || ''
    composeSender.value = data.sender || composeSender.value
  } catch (error: any) {
    composeOpen.value = false
    showToast(error?.data?.statusMessage || '邮件模板加载失败', 'error')
  } finally {
    composeLoading.value = false
    if (composeOpen.value) scheduleComposePreview(0)
  }
}

function closeCompose() {
  if (!sending.value) {
    setComposeSourceFullscreen(false)
    composeOpen.value = false
    composePreviewRequest += 1
    composePreviewLoading.value = false
    if (composePreviewTimer) clearTimeout(composePreviewTimer)
  }
}

function onComposeClosed() {
  setComposeSourceFullscreen(false)
  composeOpen.value = false
  composePreviewRequest += 1
  composePreviewLoading.value = false
  if (composePreviewTimer) clearTimeout(composePreviewTimer)
}

function onTemplateField(key: string, value: string) {
  composeFields.value = { ...composeFields.value, [key]: value }
  if (key === 'subject') composeSubject.value = value
}

function onComposeHtmlChange(value: string) {
  const changed = value !== composeHtml.value
  composeHtml.value = value
  if (changed) composeFileName.value = ''
}

async function onComposeFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!/\.html?$/i.test(file.name)) {
    showToast('请选择 HTML 文件', 'error')
    input.value = ''
    return
  }
  if (file.size > 512 * 1024) {
    showToast('HTML 文件不能超过 512 KiB', 'error')
    input.value = ''
    return
  }
  composeHtml.value = await file.text()
  composeFileName.value = file.name
}

function onComposeAttachments(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length) return

  const next = [...composeAttachments.value]
  const fingerprints = new Set(next.map(({ file }) => `${file.name}\0${file.size}\0${file.lastModified}`))
  let totalBytes = next.reduce((total, attachment) => total + attachment.file.size, 0)
  const errors = new Set<string>()

  for (const file of files) {
    const fingerprint = `${file.name}\0${file.size}\0${file.lastModified}`
    if (fingerprints.has(fingerprint)) continue
    if (next.length >= ATTACHMENT_MAX_COUNT) {
      errors.add(`附件最多只能选择 ${ATTACHMENT_MAX_COUNT} 个`)
      break
    }
    if (!file.size) {
      errors.add('不能添加空附件')
      continue
    }
    if (new TextEncoder().encode(file.name).length > 200 || /[\u0000-\u001f\u007f/\\]/.test(file.name)) {
      errors.add(`附件文件名不符合要求：${file.name}`)
      continue
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      errors.add('单个附件不能超过 5 MiB')
      continue
    }
    if (totalBytes + file.size > ATTACHMENTS_TOTAL_MAX_BYTES) {
      errors.add('附件总大小不能超过 10 MiB')
      continue
    }
    fingerprints.add(fingerprint)
    totalBytes += file.size
    next.push({ id: crypto.randomUUID(), file })
  }

  composeAttachments.value = next
  if (errors.size) showToast([...errors].join('；'), 'error')
}

function removeComposeAttachment(id: string) {
  composeAttachments.value = composeAttachments.value.filter((attachment) => attachment.id !== id)
}

function composeAttachmentIcon(file: File): string {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type === 'application/pdf') return 'picture_as_pdf'
  if (/zip|rar|7z|tar|gzip/.test(file.type) || /\.(?:zip|rar|7z|tar|gz)$/i.test(file.name)) return 'folder_zip'
  if (file.type.startsWith('text/')) return 'description'
  return 'draft'
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`无法读取附件：${file.name}`))
    reader.onload = () => {
      const result = String(reader.result || '')
      const separator = result.indexOf(',')
      if (separator === -1) reject(new Error(`无法读取附件：${file.name}`))
      else resolve(result.slice(separator + 1))
    }
    reader.readAsDataURL(file)
  })
}

function compositionPayload(): Record<string, any> {
  const payload: Record<string, any> = {
    subject: composeSubject.value,
    mode: composeMode.value,
  }
  if (composeMode.value === 'template') {
    payload.fields = composeFields.value
  } else {
    payload.html = composeHtml.value
  }
  return payload
}

async function refreshComposePreview() {
  if (!composeOpen.value || composeLoading.value) return
  if (composeMode.value === 'source' && !composeHtml.value.trim()) {
    composePreviewRequest += 1
    composePreviewLoading.value = false
    composePreviewDocument.value = ''
    composePreviewError.value = ''
    composePreviewBlockedImages.value = 0
    composePreviewTruncated.value = false
    return
  }

  const request = ++composePreviewRequest
  composePreviewLoading.value = true
  composePreviewError.value = ''
  try {
    const data = await $fetch<ComposePreviewResponse>('/api/admin/domain-mails/preview', {
      method: 'POST',
      body: compositionPayload(),
    })
    if (request !== composePreviewRequest) return
    composePreviewDocument.value = data.document || ''
    composePreviewBlockedImages.value = data.blockedImages || 0
    composePreviewTruncated.value = !!data.truncated
  } catch (error: any) {
    if (request !== composePreviewRequest) return
    composePreviewDocument.value = ''
    composePreviewBlockedImages.value = 0
    composePreviewTruncated.value = false
    composePreviewError.value = error?.data?.statusMessage || '邮件预览生成失败'
  } finally {
    if (request === composePreviewRequest) composePreviewLoading.value = false
  }
}

function scheduleComposePreview(delay = 350) {
  if (composePreviewTimer) clearTimeout(composePreviewTimer)
  composePreviewTimer = setTimeout(() => {
    composePreviewTimer = null
    refreshComposePreview()
  }, delay)
}

watch(
  [composeMode, composeSubject, composeHtml, composeFields],
  () => scheduleComposePreview(),
  { deep: true },
)

async function sendCompose() {
  if (!canSendMail.value || sending.value) return
  sending.value = true
  try {
    const payload: Record<string, any> = { ...compositionPayload(), to: composeTo.value }
    if (composeAttachments.value.length) {
      payload.attachments = await Promise.all(composeAttachments.value.map(async ({ file }) => ({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        contentBase64: await fileToBase64(file),
      })))
    }
    if (composeSender.value.owner) {
      payload.fromLocalPart = composeFromLocalPart.value
      payload.fromName = composeFromName.value
    }
    await $fetch('/api/admin/domain-mails/send', { method: 'POST', body: payload })
    showToast('邮件已发送')
    setComposeSourceFullscreen(false)
    composeOpen.value = false
    await loadSent()
  } catch (error: any) {
    showToast(error?.data?.statusMessage || error?.message || '邮件发送失败', 'error')
  } finally {
    sending.value = false
  }
}

async function load() {
  loading.value = true
  try {
    mails.value = await $fetch<MailSummary[]>('/api/admin/domain-mails')
    domainMailUnread.setCount(mails.value.filter((mail) => mail.unread).length)
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '邮件列表加载失败', 'error')
  } finally {
    loading.value = false
  }
}

async function loadSent() {
  sentLoading.value = true
  try {
    sentMails.value = await $fetch<SentSummary[]>('/api/admin/domain-mails/sent')
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '已发送邮件加载失败', 'error')
  } finally {
    sentLoading.value = false
  }
}

async function refreshMailData() {
  await Promise.all([load(), loadSent()])
}

async function openDetail(mail: MailSummary) {
  detail.value = null
  bodyView.value = 'html'
  detailOpen.value = true
  detailLoading.value = true
  try {
    detail.value = await $fetch<MailDetail>(`/api/admin/domain-mails/${mail.id}`)
    markMailRead(mail.id)
    // 只有纯文本的邮件直接落到文本视图，省一次点击。
    if (!detail.value.hasHtml) bodyView.value = 'text'
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '邮件详情加载失败', 'error')
    detailOpen.value = false
  } finally {
    detailLoading.value = false
  }
}

async function openSentDetail(mail: SentSummary) {
  sentDetail.value = null
  sentBodyView.value = mail.hasHtml ? 'html' : 'text'
  sentDetailOpen.value = true
  sentDetailLoading.value = true
  try {
    sentDetail.value = await $fetch<SentDetail>(`/api/admin/domain-mails/sent/${mail.id}`)
    if (!sentDetail.value.hasHtml) sentBodyView.value = 'text'
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '已发送邮件详情加载失败', 'error')
    sentDetailOpen.value = false
  } finally {
    sentDetailLoading.value = false
  }
}

function closeDetail() {
  detailOpen.value = false
}

function onDetailClosed() {
  detailOpen.value = false
  detail.value = null
  bodyView.value = 'html'
}

function onSentDetailClosed() {
  sentDetailOpen.value = false
  sentDetail.value = null
  sentBodyView.value = 'html'
}

/** 详情里点删除：先收起详情弹窗，避免两个 md-dialog 叠在一起抢焦点。 */
function requestDeleteFromDetail() {
  if (!canDeleteMail.value || !detail.value) return
  deleteTarget.value = detail.value
  detailOpen.value = false
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (!canDeleteMail.value || !target || deleting.value) return
  deleting.value = true
  try {
    await $fetch(`/api/admin/domain-mails/${target.id}`, { method: 'DELETE' })
    showToast('邮件已删除')
    deleteTarget.value = null
    if (detail.value?.id === target.id) detailOpen.value = false
    await load()
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '删除失败', 'error')
  } finally {
    deleting.value = false
  }
}

function onMailboxChange(event: Event) {
  mailboxFilter.value = (event.target as HTMLSelectElement).value
}

function formatDate(value: number) {
  return new Date(value).toLocaleString('zh-CN')
}

function formatListDate(value: number) {
  const date = new Date(value)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

/** 发送时间取邮件头 Date；缺失或畸形时回退到接收时间并标注。 */
function sentLabel(mail: MailSummary) {
  return mail.sentTime === null ? `${formatDate(mail.receivedTime)}（按接收）` : formatDate(mail.sentTime)
}

function senderLabel(mail: MailSummary) {
  if (mail.fromName && mail.fromAddress) return `${mail.fromName} <${mail.fromAddress}>`
  return mail.fromAddress || mail.envelopeFrom || '未知发件人'
}

function senderName(mail: MailSummary) {
  return mail.fromName || mail.fromAddress || mail.envelopeFrom || '未知发件人'
}

function senderAddress(mail: MailSummary) {
  if (mail.fromName && mail.fromAddress) return mail.fromAddress
  return mail.envelopeFrom && mail.envelopeFrom !== mail.fromAddress ? mail.envelopeFrom : ''
}

function senderInitial(mail: MailSummary) {
  return senderName(mail).trim().slice(0, 1).toLocaleUpperCase('zh-CN') || '?'
}

function addressListLabel(list: MailAddress[]) {
  if (!list.length) return '—'
  return list.map((item) => (item.name ? `${item.name} <${item.address}>` : item.address)).join('、')
}

function verdictLabel(verdict: string) {
  if (!verdict) return '—'
  return VERDICT_LABELS[verdict] || verdict
}

function verdictClass(verdict: string) {
  if (verdict === 'pass') return 'badge-pass'
  if (verdict === 'fail' || verdict === 'permerror') return 'badge-fail'
  if (!verdict || verdict === 'none') return ''
  return 'badge-warn'
}

function formatBytes(value: number) {
  if (!value) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / 1024 / 1024).toFixed(2)} MiB`
}

function attachmentHref(mailId: string, attachmentId: string) {
  return `/api/admin/domain-mails/attachment?mail=${mailId}&id=${attachmentId}`
}

/** .eml 下载地址。md-*-button 带 href 时会渲染成 <a>，配合响应头的 attachment 直接下载。 */
function downloadHref(mailId: string) {
  return `/api/admin/domain-mails/download?mail=${mailId}`
}

function htmlViewHref(mailId: string) {
  return `/api/admin/domain-mails/view?mail=${mailId}`
}

function openHtmlView(mailId: string) {
  markMailRead(mailId)
  window.open(htmlViewHref(mailId), '_blank', 'noopener,noreferrer')
}

function htmlSourceHref(mailId: string) {
  return `/api/admin/domain-mails/html?mail=${mailId}`
}

function markMailRead(mailId: string) {
  const mail = mails.value.find((item) => item.id === mailId)
  if (!mail?.unread) return
  mail.unread = false
  domainMailUnread.markRead(true)
}

function readerInitial(reader: MailReader) {
  return (reader.fullName || reader.username || '?').trim().slice(0, 1).toLocaleUpperCase('zh-CN')
}
</script>

<template>
  <div class="page domain-mail-page api-redesign-page">
    <div class="page-heading">
      <div class="page-heading-copy">
        <div class="page-title-row">
          <h1 class="page-title">域名邮件</h1>
          <span v-if="unreadCount" class="unread-count-badge">{{ unreadCount }} 未读</span>
        </div>
      </div>
      <div class="heading-actions">
        <md-filled-button v-if="canSendMail" @click="openCompose">
          <md-icon slot="icon">send</md-icon>
          写信
        </md-filled-button>
        <md-icon-button aria-label="刷新" title="刷新" :disabled="loading || sentLoading" @click="refreshMailData">
          <md-icon>refresh</md-icon>
        </md-icon-button>
      </div>
    </div>

    <nav class="mail-folder-tabs" role="tablist" aria-label="邮件文件夹">
      <button
        type="button"
        role="tab"
        :aria-selected="activeFolder === 'inbox'"
        :class="{ 'mail-folder-tab--active': activeFolder === 'inbox' }"
        @click="activeFolder = 'inbox'"
      >
        <md-icon>inbox</md-icon>
        <span>收件箱</span>
        <b>{{ mails.length }}</b>
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="activeFolder === 'sent'"
        :class="{ 'mail-folder-tab--active': activeFolder === 'sent' }"
        @click="activeFolder = 'sent'"
      >
        <md-icon>send</md-icon>
        <span>已发送</span>
        <b>{{ sentMails.length }}</b>
      </button>
    </nav>

    <template v-if="activeFolder === 'inbox'">
    <section class="mail-overview" aria-label="邮件概览">
      <div class="overview-item">
        <span class="overview-icon overview-icon--total"><md-icon>alternate_email</md-icon></span>
        <div><strong>{{ mails.length }}</strong><span>全部邮件</span></div>
      </div>
      <div class="overview-item">
        <span class="overview-icon overview-icon--unread"><md-icon>mark_email_unread</md-icon></span>
        <div><strong>{{ unreadCount }}</strong><span>未读邮件</span></div>
      </div>
      <div class="overview-item">
        <span class="overview-icon overview-icon--today"><md-icon>today</md-icon></span>
        <div><strong>{{ todayReceivedCount }}</strong><span>今日收件</span></div>
      </div>
      <div class="overview-item">
        <span class="overview-icon overview-icon--attachment"><md-icon>attachment</md-icon></span>
        <div><strong>{{ attachmentCount }}</strong><span>附件总数</span></div>
      </div>
    </section>

    <section class="mail-workspace">
      <div
        class="mail-toolbar"
        :class="mailboxes.length ? 'mail-toolbar--with-mailbox' : 'mail-toolbar--without-mailbox'"
      >
        <md-outlined-text-field
          class="search"
          label="搜索邮件"
          :value="keyword"
          @input="keyword = ($event.target as HTMLInputElement).value"
        >
          <md-icon slot="leading-icon">search</md-icon>
        </md-outlined-text-field>
        <md-outlined-select v-if="mailboxes.length" class="mailbox-select" label="收件地址" @change="onMailboxChange">
          <md-select-option value="" :selected="mailboxFilter === ''"><div slot="headline">全部地址</div></md-select-option>
          <md-select-option v-for="box in mailboxes" :key="box" :value="box" :selected="mailboxFilter === box">
            <div slot="headline">{{ box }}@</div>
          </md-select-option>
        </md-outlined-select>
        <div class="read-filter" role="group" aria-label="阅读状态">
          <button type="button" :aria-pressed="readFilter === 'all'" :class="{ 'read-filter--active': readFilter === 'all' }" @click="readFilter = 'all'">全部</button>
          <button type="button" :aria-pressed="readFilter === 'unread'" :class="{ 'read-filter--active': readFilter === 'unread' }" @click="readFilter = 'unread'">
            未读<span v-if="unreadCount">{{ unreadCount }}</span>
          </button>
        </div>
        <span class="result-count">{{ filtered.length }} 封</span>
      </div>

      <div class="mail-list-heading" aria-hidden="true">
        <span>发件人与主题</span><span>收件地址</span><span>接收时间</span><span></span>
      </div>
      <div v-if="loading" class="mail-state"><md-circular-progress indeterminate></md-circular-progress></div>
      <div v-else-if="filtered.length" class="mail-list">
        <article
          v-for="mail in filtered"
          :key="mail.id"
          class="mail-row"
          :class="{ 'mail-row--unread': mail.unread }"
          tabindex="0"
          :aria-label="`查看邮件：${mail.subject || '无主题'}`"
          @click="openDetail(mail)"
          @keydown.enter.self="openDetail(mail)"
        >
          <div class="mail-primary">
            <span class="sender-avatar" :class="{ 'sender-avatar--unread': mail.unread }">{{ senderInitial(mail) }}</span>
            <div class="mail-copy">
              <div class="sender-line">
                <strong :title="senderLabel(mail)">{{ senderName(mail) }}</strong>
                <span v-if="senderAddress(mail)">{{ senderAddress(mail) }}</span>
              </div>
              <div class="subject-line">
                <i v-if="mail.unread" class="mail-unread-dot" title="未读邮件"></i>
                <span :title="mail.subject">{{ mail.subject || '(无主题)' }}</span>
                <span v-if="mail.truncated" class="status-tag status-tag--warning">已截断</span>
              </div>
              <div class="mail-mobile-meta">
                <span>{{ mail.envelopeTo }}</span><time>{{ formatListDate(mail.receivedTime) }}</time>
              </div>
            </div>
          </div>
          <div class="mail-destination" :title="mail.envelopeTo">
            <md-icon>alternate_email</md-icon><span>{{ mail.envelopeTo }}</span>
          </div>
          <div class="mail-time">
            <time :title="formatDate(mail.receivedTime)">{{ formatListDate(mail.receivedTime) }}</time>
            <span>{{ formatBytes(mail.rawSize) }}</span>
          </div>
          <div class="mail-row-actions" @click.stop>
            <span v-if="mail.attachmentCount" class="attachment-count" :title="`${mail.attachmentCount} 个附件`">
              <md-icon>attachment</md-icon>{{ mail.attachmentCount }}
            </span>
            <span class="content-kind" :title="mail.hasHtml ? 'HTML 邮件' : '纯文本邮件'">
              <md-icon>{{ mail.hasHtml ? 'code' : 'notes' }}</md-icon>
            </span>
            <md-icon-button v-if="mail.hasHtml" aria-label="在新标签页阅读" title="在新标签页阅读" @click="openHtmlView(mail.id)">
              <md-icon>open_in_new</md-icon>
            </md-icon-button>
            <md-icon-button aria-label="下载 .eml" title="下载 .eml" :href="downloadHref(mail.id)">
              <md-icon>download</md-icon>
            </md-icon-button>
            <md-icon-button v-if="canDeleteMail" aria-label="删除" title="删除" @click="deleteTarget = mail">
              <md-icon>delete</md-icon>
            </md-icon-button>
          </div>
        </article>
      </div>
      <EmptyState v-else-if="mails.length === 0" class="mail-state" image="/images/empty-personal-notes.svg">
        暂无域名邮件
      </EmptyState>
      <div v-else class="mail-state mail-filter-empty">
        <EmptyState image="/images/empty-looking-for-answers.svg">
          <template #title>没有匹配的邮件</template>
          请尝试调整筛选条件
        </EmptyState>
        <md-text-button @click="keyword = ''; mailboxFilter = ''; readFilter = 'all'">清除筛选</md-text-button>
      </div>
    </section>
    </template>

    <section v-else class="mail-workspace sent-mail-workspace">
      <div class="sent-mail-toolbar">
        <md-outlined-text-field
          class="search"
          label="搜索已发送邮件"
          :value="sentKeyword"
          @input="sentKeyword = ($event.target as HTMLInputElement).value"
        >
          <md-icon slot="leading-icon">search</md-icon>
        </md-outlined-text-field>
        <span class="result-count">{{ filteredSent.length }} 封</span>
      </div>
      <div v-if="sentLoading" class="mail-state"><md-circular-progress indeterminate></md-circular-progress></div>
      <div v-else-if="filteredSent.length" class="sent-mail-list">
        <article
          v-for="mail in filteredSent"
          :key="mail.id"
          class="sent-mail-row"
          tabindex="0"
          :aria-label="`查看已发送邮件：${mail.subject || '无主题'}`"
          @click="openSentDetail(mail)"
          @keydown.enter.self="openSentDetail(mail)"
        >
          <span class="sent-mail-icon"><md-icon>send</md-icon></span>
          <div class="sent-mail-copy">
            <div class="sent-mail-subject-line">
              <strong>{{ mail.subject || '(无主题)' }}</strong>
              <span v-if="mail.attachmentCount"><md-icon>attachment</md-icon>{{ mail.attachmentCount }}</span>
            </div>
            <div class="sent-mail-recipient">收件人：{{ mail.recipient }}</div>
            <p v-if="mail.textPreview">{{ mail.textPreview }}</p>
          </div>
          <time :datetime="new Date(mail.sentTime).toISOString()" :title="formatDate(mail.sentTime)">{{ formatListDate(mail.sentTime) }}</time>
        </article>
      </div>
      <EmptyState v-else-if="sentMails.length === 0" class="mail-state" image="/images/empty-personal-notes.svg">
        暂无已发送邮件
      </EmptyState>
      <div v-else class="mail-state mail-filter-empty">
        <EmptyState image="/images/empty-looking-for-answers.svg">
          <template #title>没有匹配的已发送邮件</template>
          请尝试调整搜索条件
        </EmptyState>
        <md-text-button @click="sentKeyword = ''">清除筛选</md-text-button>
      </div>
    </section>

    <md-dialog ref="composeDialog" class="compose-mail-dialog" :open="composeOpen" @closed="onComposeClosed">
      <div slot="headline">发送域名邮件</div>
      <div slot="content" class="compose-dialog">
        <div class="compose-grid">
          <md-outlined-text-field
            label="收件人"
            :value="composeTo"
            @input="composeTo = ($event.target as HTMLInputElement).value"
          />
          <md-outlined-text-field
            label="主题"
            :value="composeSubject"
            @input="composeSubject = ($event.target as HTMLInputElement).value; onTemplateField('subject', composeSubject)"
          />
        </div>
        <div
          class="compose-sender-grid"
          :class="{
            'compose-sender-grid--owner': composeSender.owner,
            'compose-sender-grid--template': composeMode === 'template',
          }"
        >
          <div v-if="composeSender.owner" class="compose-sender-fields">
            <md-outlined-text-field
              label="发件人名称"
              :value="composeFromName"
              @input="composeFromName = ($event.target as HTMLInputElement).value"
            />
            <md-outlined-text-field
              label="发件地址"
              suffix-text="@mcyzw.top"
              spellcheck="false"
              :value="composeFromLocalPart"
              @input="composeFromLocalPart = ($event.target as HTMLInputElement).value"
            />
          </div>
          <p v-else class="form-hint compose-sender-summary">
            发件人：{{ composeSender.defaultName }} &lt;{{ composeSender.defaultAddress }}&gt;
          </p>
          <md-outlined-text-field
            v-if="composeMode === 'template'"
            label="预览摘要"
            :value="composeFields.preheader"
            @input="onTemplateField('preheader', ($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="compose-workspace">
          <section class="compose-editor">
            <div class="compose-mode" role="tablist" aria-label="邮件编辑方式">
              <button id="compose-template-tab" type="button" role="tab" aria-controls="compose-template-panel" :aria-selected="composeMode === 'template'" :tabindex="composeMode === 'template' ? 0 : -1" class="view-tab" :class="{ 'view-tab--active': composeMode === 'template' }" @click="composeMode = 'template'" @keydown="onComposeTabKeydown">从模板创建邮件</button>
              <button id="compose-source-tab" type="button" role="tab" aria-controls="compose-source-panel" :aria-selected="composeMode === 'source'" :tabindex="composeMode === 'source' ? 0 : -1" class="view-tab" :class="{ 'view-tab--active': composeMode === 'source' }" @click="composeMode = 'source'" @keydown="onComposeTabKeydown">自定义邮件</button>
            </div>
            <div v-if="composeMode === 'template'" id="compose-template-panel" class="compose-mode-panel" role="tabpanel" aria-labelledby="compose-template-tab">
              <div class="compose-template-heading-fields">
                <md-outlined-text-field label="眉题" :value="composeFields.eyebrow" @input="onTemplateField('eyebrow', ($event.target as HTMLInputElement).value)" />
                <md-outlined-text-field label="标题" :value="composeFields.heading" @input="onTemplateField('heading', ($event.target as HTMLInputElement).value)" />
                <md-outlined-text-field label="问候语" :value="composeFields.greeting" @input="onTemplateField('greeting', ($event.target as HTMLInputElement).value)" />
              </div>
              <md-outlined-text-field class="compose-body" label="正文" type="textarea" rows="8" :value="composeFields.body" @input="onTemplateField('body', ($event.target as HTMLTextAreaElement).value)" />
              <div class="compose-grid">
                <md-outlined-text-field label="署名" :value="composeFields.senderName" @input="onTemplateField('senderName', ($event.target as HTMLInputElement).value)" />
                <md-outlined-text-field label="署名职位" :value="composeFields.senderRole" @input="onTemplateField('senderRole', ($event.target as HTMLInputElement).value)" />
              </div>
            </div>
            <section v-else id="compose-source-panel" class="compose-source-panel" role="tabpanel" aria-labelledby="compose-source-tab" :class="{ 'compose-source-panel--fullscreen': composeSourceFullscreen }">
                <div class="compose-source-toolbar">
                  <div>
                    <md-icon>code</md-icon>
                    <strong>HTML 源码</strong>
                    <span>{{ composeHtml.length.toLocaleString() }} 字符</span>
                  </div>
                  <md-icon-button
                    :aria-label="composeSourceFullscreen ? '退出网页全屏编辑' : '网页全屏编辑'"
                    :title="composeSourceFullscreen ? '退出网页全屏编辑' : '网页全屏编辑'"
                    @click="toggleComposeSourceFullscreen"
                  >
                    <md-icon>{{ composeSourceFullscreen ? 'fullscreen_exit' : 'fullscreen' }}</md-icon>
                  </md-icon-button>
                </div>
                <CodeEditor
                  ref="composeSourceEditor"
                  class="compose-source"
                  :model-value="composeHtml"
                  language="html"
                  :height="composeSourceEditorHeight"
                  aria-label="邮件 HTML 源码"
                  @update:model-value="onComposeHtmlChange"
                />
                <div class="compose-file-row">
                  <input ref="composeFile" class="compose-file-input" type="file" accept=".html,.htm,text/html" @change="onComposeFile">
                  <md-outlined-button @click="composeFile?.click()">
                    <md-icon slot="icon">upload_file</md-icon>
                    上传 HTML
                  </md-outlined-button>
                  <span v-if="composeFileName" class="compose-file-name">{{ composeFileName }}</span>
                </div>
            </section>

            <section class="compose-attachments" aria-labelledby="compose-attachments-title">
              <div class="compose-attachments-heading">
                <div>
                  <md-icon>attach_file</md-icon>
                  <strong id="compose-attachments-title">附件</strong>
                  <span v-if="composeAttachments.length">{{ composeAttachments.length }} 个 · {{ formatBytes(composeAttachmentBytes) }}</span>
                </div>
                <input ref="composeAttachmentInput" class="compose-file-input" type="file" multiple @change="onComposeAttachments">
                <md-outlined-button :disabled="sending || composeAttachments.length >= ATTACHMENT_MAX_COUNT" @click="composeAttachmentInput?.click()">
                  <md-icon slot="icon">add</md-icon>
                  添加附件
                </md-outlined-button>
              </div>
              <div v-if="composeAttachments.length" class="compose-attachment-list">
                <div v-for="attachment in composeAttachments" :key="attachment.id" class="compose-attachment-item">
                  <span class="compose-attachment-icon"><md-icon>{{ composeAttachmentIcon(attachment.file) }}</md-icon></span>
                  <div>
                    <strong :title="attachment.file.name">{{ attachment.file.name }}</strong>
                    <span>{{ attachment.file.type || 'application/octet-stream' }} · {{ formatBytes(attachment.file.size) }}</span>
                  </div>
                  <md-icon-button :aria-label="`移除附件 ${attachment.file.name}`" title="移除附件" :disabled="sending" @click="removeComposeAttachment(attachment.id)">
                    <md-icon>close</md-icon>
                  </md-icon-button>
                </div>
              </div>
              <p v-else class="compose-attachment-empty">最多 5 个附件，单个不超过 5 MiB，合计不超过 10 MiB。</p>
            </section>
          </section>

          <section class="compose-preview" aria-label="邮件预览">
            <header class="compose-preview-header">
              <div class="compose-preview-title">
                <md-icon>preview</md-icon>
                <strong>邮件预览</strong>
                <md-icon class="compose-preview-sandbox" title="严格沙箱预览">shield</md-icon>
              </div>
              <div class="compose-preview-actions">
                <md-circular-progress v-if="composePreviewLoading" indeterminate></md-circular-progress>
                <md-icon-button
                  aria-label="刷新邮件预览"
                  title="刷新邮件预览"
                  :disabled="composePreviewLoading || composeLoading"
                  @click="refreshComposePreview"
                >
                  <md-icon>refresh</md-icon>
                </md-icon-button>
              </div>
            </header>
            <div class="compose-preview-body">
              <iframe
                v-if="composePreviewDocument"
                class="compose-preview-frame"
                title="邮件内容预览"
                sandbox=""
                referrerpolicy="no-referrer"
                :srcdoc="composePreviewDocument"
              ></iframe>
              <div v-else class="compose-preview-empty" :class="{ 'compose-preview-empty--error': composePreviewError }">
                <md-circular-progress v-if="composePreviewLoading" indeterminate></md-circular-progress>
                <img v-else-if="!composePreviewError" class="compose-preview-empty-image" :src="webAssetUrl('images/empty-personal-notes.svg')" alt="" aria-hidden="true" />
                <md-icon v-else>error</md-icon>
                <span>{{ composePreviewLoading ? '正在生成预览…' : (composePreviewError || '暂无可预览内容') }}</span>
              </div>
            </div>
            <footer v-if="composePreviewBlockedImages || composePreviewTruncated" class="compose-preview-status">
              <span v-if="composePreviewBlockedImages"><md-icon>hide_image</md-icon>已拦截 {{ composePreviewBlockedImages }} 张图片</span>
              <span v-if="composePreviewTruncated"><md-icon>warning</md-icon>预览内容已截断</span>
            </footer>
          </section>
        </div>
      </div>
      <div slot="actions">
        <md-text-button @click="closeCompose">取消</md-text-button>
        <md-filled-button :disabled="sending || composeLoading" @click="sendCompose">
          <md-icon slot="icon">send</md-icon>
          {{ sending ? '发送中…' : '发送' }}
        </md-filled-button>
      </div>
    </md-dialog>

    <md-dialog ref="detailDialog" class="mail-detail-dialog" :open="detailOpen" @closed="onDetailClosed">
      <div slot="headline" class="detail-dialog-title">
        <span>邮件阅读器</span>
        <strong>{{ detail?.subject || '邮件详情' }}</strong>
      </div>
      <div ref="detailDialogContent" slot="content" class="detail-dialog-content">
        <div v-if="detailLoading" class="detail-loading"><md-circular-progress indeterminate></md-circular-progress></div>
        <div v-else-if="detail" class="detail-reader">
          <header class="detail-message-header">
            <span class="detail-sender-avatar">{{ senderInitial(detail) }}</span>
            <div class="detail-message-copy">
              <div><strong>{{ senderName(detail) }}</strong><span v-if="senderAddress(detail)">{{ senderAddress(detail) }}</span></div>
              <p>发送至 {{ detail.envelopeTo }} · {{ sentLabel(detail) }}</p>
            </div>
            <div class="auth-status" aria-label="邮件身份验证">
              <span :class="verdictClass(detail.spf)"><b>SPF</b>{{ verdictLabel(detail.spf) }}</span>
              <span :class="verdictClass(detail.dkim)"><b>DKIM</b>{{ verdictLabel(detail.dkim) }}</span>
              <span :class="verdictClass(detail.dmarc)"><b>DMARC</b>{{ verdictLabel(detail.dmarc) }}</span>
            </div>
          </header>

          <div class="detail-workspace">
            <aside ref="detailSidebar" class="detail-sidebar">
              <section class="detail-sidebar-section">
                <h3><md-icon>info</md-icon>邮件信息</h3>
                <dl class="detail-meta-list">
                  <div><dt>接收时间</dt><dd>{{ formatDate(detail.receivedTime) }}</dd></div>
                  <div><dt>收件人</dt><dd>{{ addressListLabel(detail.toAddresses) }}</dd></div>
                  <div v-if="detail.ccAddresses.length"><dt>抄送</dt><dd>{{ addressListLabel(detail.ccAddresses) }}</dd></div>
                  <div><dt>回复地址</dt><dd>{{ detail.replyTo || '—' }}</dd></div>
                  <div><dt>信封发件人</dt><dd>{{ detail.envelopeFrom || '—' }}</dd></div>
                  <div><dt>邮件大小</dt><dd>{{ formatBytes(detail.rawSize) }}</dd></div>
                  <div><dt>Message-ID</dt><dd class="mono">{{ detail.messageId || '—' }}</dd></div>
                  <div><dt>本地 ID</dt><dd class="mono">{{ detail.id }}</dd></div>
                </dl>
              </section>

              <section class="detail-sidebar-section reader-section" aria-labelledby="domain-mail-readers-title">
                <div class="sidebar-section-heading">
                  <h3 id="domain-mail-readers-title"><md-icon>group</md-icon>阅读记录</h3>
                  <span>{{ detail.readers.length }}</span>
                </div>
                <div class="reader-list">
                  <div v-for="reader in detail.readers" :key="reader.id" class="reader-item">
                    <img v-if="reader.avatar" class="reader-avatar" :src="reader.avatar" alt="" />
                    <span v-else class="reader-avatar reader-avatar--fallback">{{ readerInitial(reader) }}</span>
                    <div class="reader-identity">
                      <strong>{{ reader.fullName || reader.username }}</strong>
                      <span>
                        <template v-if="reader.fullName">@{{ reader.username }} · </template>
                        {{ reader.id === currentUserId ? '当前用户' : reader.isOwner ? '所有者' : '管理员' }}
                        <template v-if="!reader.isActive"> · 已停用</template>
                      </span>
                    </div>
                    <time :datetime="new Date(reader.readAt).toISOString()" :title="formatDate(reader.readAt)">
                      {{ formatListDate(reader.readAt) }}
                    </time>
                  </div>
                </div>
              </section>
            </aside>

            <main ref="detailMain" class="detail-main">
              <div class="reader-toolbar">
                <div class="view-switch" role="tablist" aria-label="正文视图">
                  <button v-if="detail.hasHtml" id="mail-html-tab" type="button" role="tab" aria-controls="mail-html-panel" :aria-selected="bodyView === 'html'" :tabindex="bodyView === 'html' ? 0 : -1" :class="{ 'view-tab--active': bodyView === 'html' }" @click="bodyView = 'html'" @keydown="onBodyTabKeydown">
                    <md-icon>visibility</md-icon>预览
                  </button>
                  <button id="mail-text-tab" type="button" role="tab" aria-controls="mail-text-panel" :aria-selected="bodyView === 'text'" :tabindex="bodyView === 'text' ? 0 : -1" :class="{ 'view-tab--active': bodyView === 'text' }" @click="bodyView = 'text'" @keydown="onBodyTabKeydown">
                    <md-icon>notes</md-icon>纯文本
                  </button>
                  <button v-if="detail.hasHtml" id="mail-source-tab" type="button" role="tab" aria-controls="mail-source-panel" :aria-selected="bodyView === 'source'" :tabindex="bodyView === 'source' ? 0 : -1" :class="{ 'view-tab--active': bodyView === 'source' }" @click="bodyView = 'source'" @keydown="onBodyTabKeydown">
                    <md-icon>code</md-icon>源码
                  </button>
                </div>
                <div class="reader-actions">
                  <md-icon-button v-if="detail.hasHtml" aria-label="在新标签页阅读" title="在新标签页阅读" @click="openHtmlView(detail.id)">
                    <md-icon>open_in_new</md-icon>
                  </md-icon-button>
                  <md-icon-button v-if="detail.hasHtml" aria-label="下载 HTML 源码" title="下载 HTML 源码" :href="htmlSourceHref(detail.id)">
                    <md-icon>download</md-icon>
                  </md-icon-button>
                  <md-icon-button aria-label="下载 .eml" title="下载 .eml" :href="downloadHref(detail.id)">
                    <md-icon>mail</md-icon>
                  </md-icon-button>
                </div>
              </div>

              <p v-if="detail.truncated" class="notice">邮件在投递时超出保存上限，内容可能不完整。</p>
              <p v-if="bodyView === 'html' && (detail.htmlBlockedImages || detail.htmlSafeTruncated)" class="preview-status">
                <span v-if="detail.htmlBlockedImages"><md-icon>image_not_supported</md-icon>{{ detail.htmlBlockedImages }} 张图片已拦截</span>
                <span v-if="detail.htmlSafeTruncated"><md-icon>content_cut</md-icon>预览已截断</span>
              </p>

              <div :id="`mail-${bodyView}-panel`" class="mail-body-viewer" role="tabpanel" :aria-labelledby="`mail-${bodyView}-tab`">
                <iframe
                  v-if="bodyView === 'html' && detail.hasHtml"
                  ref="bodyFrame"
                  class="html-frame"
                  sandbox="allow-scripts"
                  referrerpolicy="no-referrer"
                  title="邮件正文沙箱预览"
                  :srcdoc="frameDocument"
                ></iframe>
                <p v-else-if="bodyView === 'text'" class="body-text">{{ detail.textBody || (detail.hasHtml ? '（这封邮件没有纯文本正文）' : '（无正文）') }}</p>
                <div v-else-if="bodyView === 'source'" class="source-viewer">
                  <CodeEditor :model-value="htmlPreview" language="html" readonly height="min(52vh, 560px)" />
                  <p v-if="htmlTruncated" class="form-hint">源码过长，仅显示前 {{ HTML_PREVIEW_MAX }} 个字符。</p>
                </div>
              </div>

              <section class="attachment-section">
                <div class="attachment-heading">
                  <h3><md-icon>attachment</md-icon>附件</h3><span>{{ detail.attachments.length }}</span>
                </div>
                <div v-if="detail.attachments.length" class="attachment-list">
                  <div v-for="attachment in detail.attachments" :key="attachment.id" class="attachment-item">
                    <span class="attachment-icon"><md-icon>{{ attachment.disposition === 'inline' ? 'image' : 'draft' }}</md-icon></span>
                    <div><strong>{{ attachment.filename || '(未命名)' }}</strong><span>{{ attachment.mimeType || '未知类型' }} · {{ formatBytes(attachment.size) }}</span></div>
                    <md-icon-button v-if="attachment.stored" aria-label="下载附件" title="下载附件" :href="attachmentHref(detail.id, attachment.id)">
                      <md-icon>download</md-icon>
                    </md-icon-button>
                    <span v-else class="unstored" title="投递时只保存了附件元信息">未保存</span>
                  </div>
                </div>
                <p v-else class="attachment-empty">无附件</p>
              </section>
            </main>
            <AppScrollbar :target="detailSidebar" label="域名邮件侧栏滚动条" />
            <AppScrollbar :target="detailSidebar" axis="horizontal" label="域名邮件侧栏横向滚动条" />
            <AppScrollbar :target="detailMain" label="域名邮件正文滚动条" />
            <AppScrollbar :target="detailMain" axis="horizontal" label="域名邮件正文横向滚动条" />
          </div>
        </div>
      </div>
      <AppScrollbar :target="detailDialogContent" label="域名邮件详情滚动条" />
      <AppScrollbar :target="detailDialogContent" axis="horizontal" label="域名邮件详情横向滚动条" />
      <div slot="actions">
        <md-text-button
          v-if="canDeleteMail && detail"
          class="delete-confirm"
          @click="requestDeleteFromDetail"
        >删除</md-text-button>
        <md-text-button @click="closeDetail">关闭</md-text-button>
      </div>
    </md-dialog>

    <md-dialog class="sent-detail-dialog" :open="sentDetailOpen" @closed="onSentDetailClosed">
      <div slot="headline" class="detail-dialog-title">
        <span>已发送邮件</span>
        <strong>{{ sentDetail?.subject || '邮件详情' }}</strong>
      </div>
      <div ref="sentDetailContent" slot="content" class="sent-detail-content">
        <div v-if="sentDetailLoading" class="detail-loading"><md-circular-progress indeterminate></md-circular-progress></div>
        <div v-else-if="sentDetail" class="sent-detail-reader">
          <header class="sent-detail-header">
            <span class="sent-mail-icon"><md-icon>send</md-icon></span>
            <div class="detail-message-copy">
              <div><strong>{{ sentDetail.senderName || sentDetail.senderAddress }}</strong><span>{{ sentDetail.senderAddress }}</span></div>
              <p>发送至 {{ sentDetail.recipient }} · {{ formatDate(sentDetail.sentTime) }}</p>
            </div>
          </header>
          <div class="sent-detail-meta">
            <span v-if="sentDetail.attachmentCount"><md-icon>attachment</md-icon>{{ sentDetail.attachmentCount }} 个附件（{{ formatBytes(sentDetail.attachmentBytes) }}）</span>
            <span v-if="sentDetail.htmlBlockedImages"><md-icon>image_not_supported</md-icon>{{ sentDetail.htmlBlockedImages }} 张图片已拦截</span>
            <span v-if="sentDetail.htmlSafeTruncated"><md-icon>content_cut</md-icon>预览已截断</span>
          </div>
          <div class="reader-toolbar">
            <div class="view-switch" role="tablist" aria-label="已发送邮件正文视图">
              <button v-if="sentDetail.hasHtml" type="button" role="tab" :aria-selected="sentBodyView === 'html'" :class="{ 'view-tab--active': sentBodyView === 'html' }" @click="sentBodyView = 'html'"><md-icon>visibility</md-icon>预览</button>
              <button type="button" role="tab" :aria-selected="sentBodyView === 'text'" :class="{ 'view-tab--active': sentBodyView === 'text' }" @click="sentBodyView = 'text'"><md-icon>notes</md-icon>纯文本</button>
            </div>
          </div>
          <div class="mail-body-viewer">
            <iframe
              v-if="sentBodyView === 'html' && sentDetail.hasHtml"
              class="html-frame"
              sandbox="allow-scripts"
              referrerpolicy="no-referrer"
              title="已发送邮件正文预览"
              :srcdoc="sentFrameDocument"
            ></iframe>
            <p v-else class="body-text">{{ sentDetail.textBody || '（无正文）' }}</p>
          </div>
          <section v-if="sentDetail.attachments.length" class="attachment-section">
            <div class="attachment-heading"><h3><md-icon>attachment</md-icon>附件</h3><span>{{ sentDetail.attachments.length }}</span></div>
            <div class="attachment-list">
              <div v-for="attachment in sentDetail.attachments" :key="attachment.sha256 + attachment.filename" class="attachment-item">
                <span class="attachment-icon"><md-icon>draft</md-icon></span>
                <div><strong>{{ attachment.filename || '(未命名)' }}</strong><span>{{ attachment.mimeType || '未知类型' }} · {{ formatBytes(attachment.size) }}</span></div>
              </div>
            </div>
          </section>
        </div>
      </div>
      <AppScrollbar :target="sentDetailContent" label="已发送邮件详情滚动条" />
      <AppScrollbar :target="sentDetailContent" axis="horizontal" label="已发送邮件详情横向滚动条" />
      <div slot="actions">
        <md-text-button @click="sentDetailOpen = false">关闭</md-text-button>
      </div>
    </md-dialog>

    <md-dialog ref="linkDialog" :open="linkOpen" @closed="onLinkDialogClosed">
      <md-icon slot="icon" class="link-dialog-icon">{{ linkBlocked ? 'link_off' : 'link' }}</md-icon>
      <div slot="headline">{{ linkBlocked ? '该链接已被移除' : '邮件里的链接' }}</div>
      <div slot="content" class="link-dialog">
        <template v-if="linkBlocked">
          <p class="link-warning">
            链接使用了不安全的协议，已被移除。
          </p>
        </template>
        <template v-else>
          <div class="link-url">{{ linkUrl }}</div>
          <p class="link-warning">
            <md-icon>warning</md-icon>
            <span>核对域名后再复制打开；陌生链接可能是钓鱼页面。</span>
          </p>
        </template>
      </div>
      <div slot="actions">
        <md-text-button @click="closeLinkDialog">关闭</md-text-button>
        <md-filled-button v-if="!linkBlocked" @click="copyLink">
          <md-icon slot="icon">content_copy</md-icon>
          复制链接
        </md-filled-button>
      </div>
    </md-dialog>

    <ConfirmDialog
      :open="!!deleteTarget"
      title="删除域名邮件"
      :message="`确定要删除「${deleteTarget?.subject || '(无主题)'}」吗？该邮件的附件也会一并删除，且无法恢复。`"
      icon="delete"
      confirm-label="删除"
      pending-label="删除中…"
      destructive
      :pending="deleting"
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
      @closed="deleteTarget = null"
    >
      <div v-if="deleteTarget" class="delete-preview">
        <md-icon>alternate_email</md-icon>
        <span>{{ senderLabel(deleteTarget) }}</span>
      </div>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.domain-mail-page { width: min(100%, 1320px); }
.page-heading { min-height: 52px; display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.page-heading-copy { min-width: 0; }
.page-title-row { display: flex; align-items: center; gap: 10px; }
.page-title { margin: 0; }
.unread-count-badge { padding: 3px 7px; border-radius: 4px; color: var(--md-sys-color-on-error); background: var(--md-sys-color-error); font-size: 10px; font-weight: 700; }
.heading-actions { display: flex; align-items: center; gap: 7px; flex-shrink: 0; }

.mail-folder-tabs { min-width: 0; display: flex; gap: 3px; margin: 16px 0 14px; padding: 3px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 7px; background: var(--md-sys-color-surface-container); }
.mail-folder-tabs button { min-height: 36px; display: inline-flex; align-items: center; gap: 7px; border: 0; border-radius: 5px; padding: 0 14px; color: var(--md-sys-color-on-surface-variant); background: transparent; font: inherit; font-size: 11px; font-weight: 600; cursor: pointer; }
.mail-folder-tabs button:hover { color: var(--md-sys-color-on-surface); background: color-mix(in srgb, var(--md-sys-color-on-surface) var(--md-sys-state-hover-state-layer-opacity), transparent); }
.mail-folder-tabs button.mail-folder-tab--active { color: var(--md-sys-color-on-primary-container); background: var(--md-sys-color-primary-container); }
.mail-folder-tabs button md-icon { --md-icon-size: 17px; }
.mail-folder-tabs button b { min-width: 18px; padding: 2px 5px; border-radius: 4px; color: var(--md-sys-color-on-surface-variant); background: var(--md-sys-color-surface-container-high); font-size: 10px; text-align: center; }
.mail-folder-tabs button.mail-folder-tab--active b { color: var(--md-sys-color-on-primary-container); background: color-mix(in srgb, var(--md-sys-color-on-primary-container) 12%, transparent); }

.mail-overview { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 16px 0 14px; }
.overview-item { min-width: 0; min-height: 72px; display: flex; align-items: center; gap: 12px; padding: 13px 15px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 8px; background: var(--md-sys-color-surface-container); }
.overview-icon { width: 36px; height: 36px; display: grid; place-items: center; flex: 0 0 36px; border-radius: 7px; }
.overview-icon md-icon { --md-icon-size: 19px; }
.overview-icon--total { color: var(--md-sys-color-primary); background: var(--md-sys-color-primary-container); }
.overview-icon--unread { color: var(--act-error); background: color-mix(in srgb, var(--act-error) 10%, transparent); }
.overview-icon--today { color: var(--act-info); background: color-mix(in srgb, var(--act-info) 10%, transparent); }
.overview-icon--attachment { color: var(--act-warning); background: color-mix(in srgb, var(--act-warning) 10%, transparent); }
.overview-item > div { min-width: 0; display: grid; gap: 3px; }
.overview-item strong { font-size: 21px; line-height: 1; }
.overview-item span:last-child { color: var(--md-sys-color-on-surface-variant); font-size: 10px; }

.mail-workspace { min-width: 0; overflow: hidden; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 8px; background: var(--md-sys-color-surface-container); }
.mail-toolbar { min-width: 0; display: grid; grid-template-columns: minmax(220px, 1fr) max-content max-content; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
.mail-toolbar--with-mailbox { grid-template-columns: minmax(220px, 1fr) 180px max-content max-content; }
.search, .mailbox-select { width: 100%; min-width: 0; }
.sent-mail-toolbar { min-width: 0; display: grid; grid-template-columns: minmax(220px, 1fr) max-content; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
.sent-mail-list { min-width: 0; }
.sent-mail-row { min-width: 0; min-height: 76px; display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; align-items: center; gap: 11px; padding: 10px 16px; border-bottom: 1px solid color-mix(in srgb, var(--md-sys-color-outline-variant) 78%, transparent); outline: none; cursor: pointer; transition: background-color 140ms ease, box-shadow 140ms ease; }
.sent-mail-row:last-child { border-bottom: 0; }
.sent-mail-row:hover, .sent-mail-row:focus-visible { background: color-mix(in srgb, var(--md-sys-color-primary) 7%, transparent); }
.sent-mail-row:focus-visible { box-shadow: inset 3px 0 var(--md-sys-color-primary); }
.sent-mail-icon { width: 38px; height: 38px; display: grid; place-items: center; flex: 0 0 38px; border-radius: 50%; color: var(--md-sys-color-on-primary-container); background: var(--md-sys-color-primary-container); }
.sent-mail-icon md-icon { --md-icon-size: 18px; }
.sent-mail-copy { min-width: 0; display: grid; gap: 4px; }
.sent-mail-subject-line { min-width: 0; display: flex; align-items: center; gap: 8px; }
.sent-mail-subject-line strong, .sent-mail-recipient, .sent-mail-copy p { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sent-mail-subject-line strong { color: var(--md-sys-color-on-surface); font-size: 12px; }
.sent-mail-subject-line > span { display: inline-flex; align-items: center; gap: 3px; flex: 0 0 auto; color: var(--md-sys-color-on-surface-variant); font-size: 10px; }
.sent-mail-subject-line > span md-icon { --md-icon-size: 14px; }
.sent-mail-recipient { color: var(--md-sys-color-on-surface-variant); font-size: 10px; }
.sent-mail-copy p { margin: 0; color: var(--md-sys-color-on-surface-variant); font-size: 10px; }
.sent-mail-row > time { color: var(--md-sys-color-on-surface-variant); font-size: 10px; white-space: nowrap; }
.sent-detail-dialog { --md-dialog-container-width: min(900px, calc(100vw - 32px)); --md-dialog-container-max-width: min(900px, calc(100vw - 32px)); }
.sent-detail-content { width: min(820px, calc(100vw - 88px)); min-height: 0; max-height: min(72vh, 720px); overflow: auto; }
.sent-detail-reader { min-width: 0; overflow: hidden; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 8px; background: var(--md-sys-color-surface); }
.sent-detail-header { min-width: 0; display: grid; grid-template-columns: 38px minmax(0, 1fr); align-items: center; gap: 11px; padding: 14px 16px; border-bottom: 1px solid var(--md-sys-color-outline-variant); background: var(--md-sys-color-surface-container); }
.sent-detail-meta { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px 0; }
.sent-detail-meta span { min-height: 26px; display: inline-flex; align-items: center; gap: 4px; padding: 0 7px; border-radius: 5px; color: var(--md-sys-color-on-surface-variant); background: var(--md-sys-color-surface-container-high); font-size: 10px; }
.sent-detail-meta md-icon { --md-icon-size: 14px; }
.read-filter { height: var(--app-control-height); width: max-content; justify-self: start; display: inline-grid; grid-auto-flow: column; grid-auto-columns: max-content; align-items: center; padding: 3px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 7px; background: var(--md-sys-color-surface); }
.read-filter button { height: 32px; display: inline-flex; align-items: center; gap: 6px; padding: 0 11px; border: 0; border-radius: 5px; color: var(--md-sys-color-on-surface-variant); background: transparent; font-family: inherit; font-size: 11px; font-weight: 500; cursor: pointer; }
.read-filter button:hover { color: var(--md-sys-color-on-surface); background: color-mix(in srgb, var(--md-sys-color-on-surface) var(--md-sys-state-hover-state-layer-opacity), transparent); }
.read-filter button.read-filter--active { color: var(--md-sys-color-on-primary-container); background: var(--md-sys-color-primary-container); }
.read-filter button span { min-width: 17px; padding: 1px 4px; border-radius: 4px; color: var(--md-sys-color-on-error); background: var(--md-sys-color-error); font-size: 10px; text-align: center; }
.result-count { color: var(--md-sys-color-on-surface-variant); font-size: 11px; white-space: nowrap; }
.mail-list-heading { min-height: 36px; display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(170px, .65fr) 90px 214px; gap: 14px; align-items: center; padding: 0 16px; border-bottom: 1px solid var(--md-sys-color-outline-variant); color: var(--md-sys-color-on-surface-variant); background: color-mix(in srgb, var(--md-sys-color-surface) 54%, transparent); font-size: 10px; font-weight: 700; }
.mail-list { min-width: 0; }
.mail-row { position: relative; min-width: 0; min-height: 76px; display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(170px, .65fr) 90px 214px; gap: 14px; align-items: center; padding: 10px 16px; border-bottom: 1px solid color-mix(in srgb, var(--md-sys-color-outline-variant) 78%, transparent); outline: none; cursor: pointer; transition: background-color 140ms ease, box-shadow 140ms ease; }
.mail-row:last-child { border-bottom: 0; }
.mail-row:hover { background: color-mix(in srgb, var(--md-sys-color-primary) 6%, transparent); }
.mail-row:focus-visible { box-shadow: inset 3px 0 var(--md-sys-color-primary); background: color-mix(in srgb, var(--md-sys-color-primary) 8%, transparent); }
.mail-row--unread { background: color-mix(in srgb, var(--act-error) 3%, var(--md-sys-color-surface-container)); }
.mail-row--unread::before { content: ''; position: absolute; inset: 10px auto 10px 0; width: 3px; border-radius: 0 3px 3px 0; background: var(--md-sys-color-error); }
.mail-primary { min-width: 0; display: flex; align-items: center; gap: 11px; }
.sender-avatar, .detail-sender-avatar { width: 38px; height: 38px; display: grid; place-items: center; flex: 0 0 38px; border-radius: 50%; color: var(--md-sys-color-on-surface-variant); background: var(--md-sys-color-surface-container-high); font-size: 12px; font-weight: 700; }
.sender-avatar--unread { color: var(--md-sys-color-on-primary-container); background: var(--md-sys-color-primary-container); }
.mail-copy { min-width: 0; display: grid; gap: 5px; }
.sender-line, .subject-line { min-width: 0; display: flex; align-items: center; gap: 7px; }
.sender-line strong, .subject-line > span:first-of-type { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sender-line strong { font-size: 12px; font-weight: 600; }
.mail-row--unread .sender-line strong, .mail-row--unread .subject-line > span:first-of-type { font-weight: 750; }
.sender-line > span { min-width: 0; overflow: hidden; color: var(--md-sys-color-on-surface-variant); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.subject-line > span:first-of-type { color: var(--md-sys-color-on-surface); font-size: 12px; }
.mail-unread-dot { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: var(--md-sys-color-error); }
.status-tag { flex: 0 0 auto; padding: 2px 5px; border-radius: 3px; font-size: 10px; font-weight: 700; }
.status-tag--warning { color: var(--act-warning); background: color-mix(in srgb, var(--act-warning) 10%, transparent); }
.mail-mobile-meta { display: none; }
.mail-destination { min-width: 0; display: flex; align-items: center; gap: 5px; color: var(--md-sys-color-on-surface-variant); }
.mail-destination md-icon { --md-icon-size: 15px; flex: 0 0 auto; }
.mail-destination span { min-width: 0; overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.mail-time { display: grid; justify-items: start; gap: 4px; }
.mail-time time { font-size: 11px; font-weight: 600; white-space: nowrap; }
.mail-time span { color: var(--md-sys-color-on-surface-variant); font-size: 10px; }
.mail-row-actions { display: flex; align-items: center; justify-content: flex-end; gap: 1px; }
.mail-row-actions md-icon-button { flex: 0 0 auto; }
.attachment-count, .content-kind { height: 28px; display: inline-flex; align-items: center; gap: 3px; padding: 0 7px; color: var(--md-sys-color-on-surface-variant); font-size: 10px; white-space: nowrap; }
.attachment-count md-icon, .content-kind md-icon { --md-icon-size: 15px; }
.mail-state { min-height: 240px; display: grid; place-items: center; align-content: center; gap: 10px; color: var(--md-sys-color-on-surface-variant); }
.mail-state > md-icon { --md-icon-size: 34px; }
.mail-state strong { font-size: 12px; }

.mail-detail-dialog { --md-dialog-container-width: min(1240px, calc(100vw - 32px)); --md-dialog-container-max-width: min(1240px, calc(100vw - 32px)); }
.detail-dialog-title { min-width: 0; display: grid; gap: 3px; }
.detail-dialog-title > span { color: var(--md-sys-color-on-surface-variant); font-size: 10px; font-weight: 500; }
.detail-dialog-title > strong { max-width: min(900px, calc(100vw - 160px)); overflow: hidden; font-size: 17px; text-overflow: ellipsis; white-space: nowrap; }
.detail-dialog-content { width: min(1160px, calc(100vw - 88px)); height: min(72vh, 720px); min-height: 440px; overflow: hidden; }
.detail-loading { height: 100%; display: grid; place-items: center; }
.detail-reader { height: 100%; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); overflow: hidden; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 8px; }
.detail-message-header { min-width: 0; display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--md-sys-color-outline-variant); background: var(--md-sys-color-surface-container); }
.detail-sender-avatar { width: 42px; height: 42px; flex-basis: 42px; color: var(--md-sys-color-on-primary-container); background: var(--md-sys-color-primary-container); font-size: 14px; }
.detail-message-copy { min-width: 0; display: grid; gap: 4px; }
.detail-message-copy > div { min-width: 0; display: flex; align-items: baseline; gap: 8px; }
.detail-message-copy strong, .detail-message-copy span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.detail-message-copy strong { font-size: 13px; }
.detail-message-copy span, .detail-message-copy p { color: var(--md-sys-color-on-surface-variant); font-size: 10px; }
.detail-message-copy p { margin: 0; }
.auth-status { display: flex; align-items: center; gap: 5px; }
.auth-status > span { display: grid; gap: 2px; min-width: 62px; padding: 5px 7px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 5px; color: var(--md-sys-color-on-surface-variant); font-size: 10px; line-height: 1.25; text-align: center; }
.auth-status b { font-size: 10px; }
.auth-status .badge-pass { border-color: color-mix(in srgb, var(--act-success) 38%, transparent); color: var(--act-success); background: color-mix(in srgb, var(--act-success) 7%, transparent); }
.auth-status .badge-fail { border-color: color-mix(in srgb, var(--act-error) 38%, transparent); color: var(--act-error); background: color-mix(in srgb, var(--act-error) 7%, transparent); }
.auth-status .badge-warn { border-color: color-mix(in srgb, var(--act-warning) 38%, transparent); color: var(--act-warning); background: color-mix(in srgb, var(--act-warning) 7%, transparent); }
.detail-workspace { min-height: 0; display: grid; grid-template-columns: 280px minmax(0, 1fr); }
.detail-sidebar { min-height: 0; overflow: auto; border-right: 1px solid var(--md-sys-color-outline-variant); background: color-mix(in srgb, var(--md-sys-color-surface-container) 72%, var(--md-sys-color-surface)); }
.detail-sidebar-section { padding: 15px; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
.detail-sidebar-section:last-child { border-bottom: 0; }
.detail-sidebar-section h3, .attachment-heading h3 { margin: 0; display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; }
.detail-sidebar-section h3 md-icon, .attachment-heading h3 md-icon { --md-icon-size: 16px; color: var(--md-sys-color-on-surface-variant); }
.detail-meta-list { margin: 12px 0 0; display: grid; gap: 11px; }
.detail-meta-list div { min-width: 0; display: grid; gap: 3px; }
.detail-meta-list dt { color: var(--md-sys-color-on-surface-variant); font-size: 10px; font-weight: 700; }
.detail-meta-list dd { margin: 0; overflow-wrap: anywhere; color: var(--md-sys-color-on-surface); font-size: 11px; line-height: 1.45; }
.mono { font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; }
.sidebar-section-heading, .attachment-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.sidebar-section-heading > span, .attachment-heading > span { min-width: 23px; padding: 2px 5px; border-radius: 4px; color: var(--md-sys-color-on-surface-variant); background: var(--md-sys-color-surface-container-high); font-size: 10px; text-align: center; }
.reader-list { margin-top: 8px; }
.reader-item { min-width: 0; display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid color-mix(in srgb, var(--md-sys-color-outline-variant) 65%, transparent); }
.reader-item:last-child { border-bottom: 0; }
.reader-avatar { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; object-fit: cover; }
.reader-avatar--fallback { color: var(--md-sys-color-on-primary-container); background: var(--md-sys-color-primary-container); font-size: 10px; font-weight: 700; }
.reader-identity { min-width: 0; display: grid; gap: 2px; }
.reader-identity strong, .reader-identity span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reader-identity strong { font-size: 11px; }
.reader-identity span, .reader-item time { color: var(--md-sys-color-on-surface-variant); font-size: 10px; }
.reader-item time { white-space: nowrap; }
.detail-main { min-width: 0; min-height: 0; overflow: auto; background: var(--md-sys-color-surface); }
.reader-toolbar { position: sticky; top: 0; z-index: 2; min-height: 50px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 12px; border-bottom: 1px solid var(--md-sys-color-outline-variant); background: color-mix(in srgb, var(--md-sys-color-surface) 92%, transparent); backdrop-filter: blur(8px); }
.view-switch { display: inline-grid; grid-auto-flow: column; grid-auto-columns: max-content; padding: 3px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 7px; background: var(--md-sys-color-surface-container); }
.view-switch button, .compose-mode .view-tab { min-height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 0 10px; border: 0; border-radius: 5px; color: var(--md-sys-color-on-surface-variant); background: transparent; font-family: inherit; font-size: 10px; font-weight: 500; cursor: pointer; }
.view-switch button md-icon { --md-icon-size: 15px; }
.view-switch button:hover, .compose-mode .view-tab:hover { color: var(--md-sys-color-on-surface); background: color-mix(in srgb, var(--md-sys-color-on-surface) var(--md-sys-state-hover-state-layer-opacity), transparent); }
.view-switch button.view-tab--active, .compose-mode .view-tab--active { color: var(--md-sys-color-on-primary-container); background: var(--md-sys-color-primary-container); font-weight: 700; }
.reader-actions { display: flex; align-items: center; gap: 2px; }
.preview-status { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 12px 0; }
.preview-status span { min-height: 28px; display: inline-flex; align-items: center; gap: 5px; padding: 0 8px; border-radius: 5px; color: var(--act-warning); background: color-mix(in srgb, var(--act-warning) 8%, transparent); font-size: 10px; }
.preview-status md-icon { --md-icon-size: 14px; }
.mail-body-viewer { min-width: 0; padding: 12px; }
.html-frame { display: block; width: 100%; height: min(52vh, 560px); border: 1px solid var(--md-sys-color-outline-variant); border-radius: 6px; background: #ffffff; }
.body-text { min-height: 260px; margin: 0; padding: 18px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 6px; background: #ffffff; color: #191d14; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.65; }
.source-viewer { min-width: 0; display: grid; gap: 8px; }
.notice { margin: 10px 12px 0; padding: 8px 10px; border-left: 3px solid var(--act-warning); border-radius: 4px; color: var(--act-warning); background: color-mix(in srgb, var(--act-warning) 8%, transparent); font-size: 10px; }
.form-hint { margin: 0; color: var(--md-sys-color-on-surface-variant); font-size: 10px; }
.attachment-section { margin: 0 12px 12px; padding-top: 12px; border-top: 1px solid var(--md-sys-color-outline-variant); }
.attachment-list { margin-top: 8px; display: grid; gap: 6px; }
.attachment-item { min-width: 0; min-height: 50px; display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; align-items: center; gap: 9px; padding: 7px 9px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 6px; background: var(--md-sys-color-surface-container); }
.attachment-icon { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 6px; color: var(--act-info); background: color-mix(in srgb, var(--act-info) 9%, transparent); }
.attachment-icon md-icon { --md-icon-size: 17px; }
.attachment-item > div { min-width: 0; display: grid; gap: 3px; }
.attachment-item strong, .attachment-item > div span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attachment-item strong { font-size: 11px; }
.attachment-item > div span, .attachment-empty, .unstored { color: var(--md-sys-color-on-surface-variant); font-size: 10px; }
.attachment-empty { margin: 10px 0 0; }
.link-dialog-icon { color: var(--md-sys-color-primary); }
.link-dialog { min-width: min(440px, 76vw); display: flex; flex-direction: column; gap: 12px; }
.link-url {
  padding: 10px 12px; border-radius: 8px;
  background: var(--md-sys-color-surface-variant); color: var(--md-sys-color-on-surface);
  font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px;
  word-break: break-all; user-select: all;
}
.link-warning {
  display: flex; align-items: flex-start; gap: 8px; margin: 0;
  font-size: 13px; line-height: 1.6; color: var(--md-sys-color-on-surface-variant);
}
.link-warning md-icon { flex-shrink: 0; --md-icon-size: 20px; color: var(--md-sys-color-error); }
.link-warning code {
  padding: 1px 5px; border-radius: 4px; background: var(--md-sys-color-surface-variant);
  font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
}
.delete-confirm { color: var(--md-sys-color-error); }
.delete-preview { display: flex; align-items: center; gap: 8px; font-size: 14px; word-break: break-all; }
.compose-mail-dialog { --md-dialog-container-width: min(1320px, calc(100vw - 32px)); --md-dialog-container-max-width: min(1320px, calc(100vw - 32px)); }
.compose-dialog { width: min(1240px, calc(100vw - 88px)); min-width: 0; display: flex; flex-direction: column; gap: 14px; }
.compose-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.compose-sender-grid { min-width: 0; display: grid; gap: 12px; }
.compose-sender-grid--owner, .compose-sender-grid--template { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.compose-sender-fields { min-width: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.compose-sender-summary { min-width: 0; min-height: 56px; margin: 0; display: flex; align-items: center; overflow-wrap: anywhere; }
.compose-template-heading-fields { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
.compose-body { width: 100%; }
.compose-workspace { min-width: 0; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(380px, .95fr); gap: 14px; align-items: start; }
.compose-editor { min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.compose-mode { width: fit-content; display: flex; gap: 2px; padding: 3px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 7px; background: var(--md-sys-color-surface); }
.compose-mode-panel { min-width: 0; display: grid; gap: 12px; }
.compose-source-panel { min-width: 0; display: grid; grid-template-rows: auto minmax(0, auto) auto; gap: 10px; }
.compose-source-toolbar { min-width: 0; min-height: 42px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 2px 4px 2px 10px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 7px; background: var(--md-sys-color-surface-container); }
.compose-source-toolbar > div { min-width: 0; display: flex; align-items: center; gap: 7px; }
.compose-source-toolbar md-icon { --md-icon-size: 17px; color: var(--md-sys-color-primary); }
.compose-source-toolbar strong { font-size: 11px; }
.compose-source-toolbar span { overflow: hidden; color: var(--md-sys-color-on-surface-variant); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.compose-source-panel--fullscreen { position: fixed; inset: 0; z-index: 1000; width: 100vw; height: 100vh; height: 100dvh; box-sizing: border-box; grid-template-rows: auto minmax(0, 1fr) auto; padding: 12px; overflow: hidden; background: var(--md-sys-color-surface); }
.compose-source-panel--fullscreen .compose-source { min-height: 0; }
.compose-file-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
.compose-file-input { display: none; }
.compose-file-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--md-sys-color-on-surface-variant); font-size: 13px; }
.compose-attachments { min-width: 0; padding-top: 12px; border-top: 1px solid var(--md-sys-color-outline-variant); }
.compose-attachments-heading { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.compose-attachments-heading > div { min-width: 0; display: flex; align-items: center; gap: 6px; }
.compose-attachments-heading md-icon { --md-icon-size: 17px; color: var(--md-sys-color-on-surface-variant); }
.compose-attachments-heading strong { font-size: 11px; }
.compose-attachments-heading span { min-width: 0; overflow: hidden; color: var(--md-sys-color-on-surface-variant); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.compose-attachment-list { margin-top: 9px; display: grid; gap: 6px; }
.compose-attachment-item { min-width: 0; min-height: 48px; display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 6px 7px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 6px; background: var(--md-sys-color-surface-container); }
.compose-attachment-icon { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 6px; color: var(--act-info); background: color-mix(in srgb, var(--act-info) 9%, transparent); }
.compose-attachment-icon md-icon { --md-icon-size: 17px; }
.compose-attachment-item > div { min-width: 0; display: grid; gap: 3px; }
.compose-attachment-item strong, .compose-attachment-item span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.compose-attachment-item strong { font-size: 10px; }
.compose-attachment-item span, .compose-attachment-empty { color: var(--md-sys-color-on-surface-variant); font-size: 10px; }
.compose-attachment-empty { margin: 8px 0 0; line-height: 1.5; }
.compose-preview { min-width: 0; overflow: hidden; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 8px; background: var(--md-sys-color-surface); }
.compose-preview-header { min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 5px 7px 5px 12px; border-bottom: 1px solid var(--md-sys-color-outline-variant); background: var(--md-sys-color-surface-container); }
.compose-preview-title, .compose-preview-actions { display: flex; align-items: center; gap: 7px; }
.compose-preview-title > md-icon { --md-icon-size: 18px; color: var(--md-sys-color-primary); }
.compose-preview-title strong { font-size: 11px; }
.compose-preview-title .compose-preview-sandbox { --md-icon-size: 14px; color: var(--act-success); }
.compose-preview-actions md-circular-progress, .compose-preview-empty md-circular-progress { width: 22px; height: 22px; }
.compose-preview-body { min-width: 0; min-height: 500px; background: #ffffff; }
.compose-preview-frame { display: block; width: 100%; height: 100%; min-height: 500px; border: 0; background: #ffffff; }
.compose-preview-empty { min-height: 500px; display: grid; place-items: center; align-content: center; gap: 9px; padding: 24px; color: var(--md-sys-color-on-surface-variant); text-align: center; }
.compose-preview-empty > md-icon { --md-icon-size: 28px; }
.compose-preview-empty-image { width: min(190px, 58%); height: 150px; object-fit: contain; }
.compose-preview-empty span { max-width: 360px; overflow-wrap: anywhere; font-size: 10px; line-height: 1.5; }
.compose-preview-empty--error { color: var(--act-error); }
.compose-preview-status { min-height: 34px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 5px 8px; border-top: 1px solid var(--md-sys-color-outline-variant); background: var(--md-sys-color-surface-container); }
.compose-preview-status span { min-height: 26px; display: inline-flex; align-items: center; gap: 4px; padding: 0 7px; border-radius: 5px; color: var(--act-warning); background: color-mix(in srgb, var(--act-warning) 8%, transparent); font-size: 10px; }
.compose-preview-status md-icon { --md-icon-size: 13px; }

@media (max-width: 1100px) {
  .mail-list-heading, .mail-row { grid-template-columns: minmax(0, 1fr) minmax(150px, .55fr) 80px 154px; gap: 10px; }
  .content-kind { display: none; }
  .detail-dialog-content { height: auto; max-height: calc(100vh - 2 * (var(--app-bar-height) + 48px)); max-height: calc(100dvh - 2 * (var(--app-bar-height) + 48px)); overflow: auto; }
  .detail-reader { height: auto; overflow: visible; }
  .detail-workspace { grid-template-columns: minmax(0, 1fr); }
  .detail-sidebar { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); overflow: visible; border-right: 0; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
  .detail-sidebar-section { border-right: 1px solid var(--md-sys-color-outline-variant); border-bottom: 0; }
  .detail-sidebar-section:last-child { border-right: 0; }
  .detail-main { overflow: visible; }
  .reader-toolbar { position: static; }
  .compose-workspace { grid-template-columns: minmax(0, 1fr); }
  .compose-preview-body, .compose-preview-frame, .compose-preview-empty { min-height: 420px; }
}
@media (max-width: 820px) {
  .mail-overview { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sent-mail-row { grid-template-columns: 34px minmax(0, 1fr); }
  .sent-mail-icon { width: 34px; height: 34px; flex-basis: 34px; }
  .sent-mail-row > time { grid-column: 2; }
  .mail-toolbar { grid-template-columns: minmax(0, 1fr) max-content; }
  .mail-toolbar--with-mailbox { grid-template-columns: minmax(0, 1fr) 170px; }
  .mail-toolbar--without-mailbox .result-count { grid-column: 2; }
  .read-filter { justify-self: start; }
  .result-count { justify-self: end; }
  .mail-list-heading { display: none; }
  .mail-row { grid-template-columns: minmax(0, 1fr) auto; min-height: 86px; }
  .mail-destination, .mail-time { display: none; }
  .mail-mobile-meta { min-width: 0; display: flex; align-items: center; gap: 8px; color: var(--md-sys-color-on-surface-variant); font-size: 10px; }
  .mail-mobile-meta span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mail-mobile-meta time { flex: 0 0 auto; }
  .detail-message-header { grid-template-columns: 42px minmax(0, 1fr); }
  .auth-status { grid-column: 1 / -1; padding-top: 10px; border-top: 1px solid var(--md-sys-color-outline-variant); }
  .auth-status > span { flex: 1; }
}
@media (max-width: 680px) {
  .page-heading { align-items: stretch; flex-direction: column; }
  .heading-actions { width: 100%; }
  .heading-actions md-filled-button { flex: 1; }
  .mail-folder-tabs { margin-top: 12px; }
  .mail-folder-tabs button { flex: 1; justify-content: center; }
  .sent-mail-toolbar { grid-template-columns: minmax(0, 1fr); }
  .sent-mail-toolbar .result-count { justify-self: end; }
  .mail-toolbar { grid-template-columns: minmax(0, 1fr); }
  .read-filter, .result-count { justify-self: stretch; }
  .read-filter { width: auto; grid-auto-columns: 1fr; }
  .result-count { text-align: right; }
  .detail-dialog-content { width: 100%; min-height: 0; }
  .detail-sidebar { grid-template-columns: minmax(0, 1fr); }
  .detail-sidebar-section { border-right: 0; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
  .detail-sidebar-section:last-child { border-bottom: 0; }
  .reader-toolbar { align-items: stretch; flex-direction: column; }
  .view-switch { width: 100%; grid-auto-columns: 1fr; }
  .reader-actions { justify-content: flex-end; }
  .detail-dialog-title > strong { max-width: calc(100vw - 100px); }
  .compose-dialog { width: 100%; }
  .compose-grid { grid-template-columns: 1fr; }
  .compose-sender-grid--owner, .compose-sender-grid--template, .compose-sender-fields { grid-template-columns: 1fr; }
  .compose-attachments-heading { align-items: flex-start; }
  .compose-attachments-heading > div { padding-top: 9px; }
  .compose-preview-body, .compose-preview-frame, .compose-preview-empty { min-height: 360px; }
}
@media (max-width: 520px) {
  .mail-overview { grid-template-columns: minmax(0, 1fr); }
  .overview-item { min-height: 62px; }
  .mail-row { grid-template-columns: minmax(0, 1fr); padding: 11px 13px; }
  .mail-row-actions { justify-content: flex-start; padding-left: 49px; }
  .mail-row--unread::before { inset-block: 8px; }
  .sender-line > span { display: none; }
  .attachment-count, .content-kind { display: inline-flex; }
  .detail-message-header { grid-template-columns: 38px minmax(0, 1fr); padding: 12px; }
  .detail-sender-avatar { width: 38px; height: 38px; flex-basis: 38px; }
  .detail-message-copy > div { display: grid; gap: 2px; }
  .auth-status { gap: 3px; }
  .auth-status > span { min-width: 0; padding-inline: 3px; }
  .mail-body-viewer { padding: 8px; }
  .attachment-section { margin-inline: 8px; }
  .reader-item { grid-template-columns: 30px minmax(0, 1fr); }
  .reader-item time { grid-column: 2; }
}
</style>
