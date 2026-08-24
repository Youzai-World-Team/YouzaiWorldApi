<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

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
}

type BodyView = 'html' | 'text' | 'source'

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
img { max-width: 100%; height: auto; }
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
  display: inline-block !important; margin: 2px !important; padding: 3px 8px !important;
  border: 1px dashed #a8b096 !important; border-radius: 6px !important;
  background: #f4f6ee !important; color: #5d6350 !important; font-size: 12px !important;
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
const loading = ref(true)
const keyword = ref('')
const mailboxFilter = ref('')

const detailOpen = ref(false)
const detail = ref<MailDetail | null>(null)
const detailLoading = ref(false)
const detailDialog = ref<HTMLElement | null>(null)
const bodyView = ref<BodyView>('html')

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
const canEdit = computed(() => access.levelForKey('domain-mail') === 'edit')
const { apply: applyDialogAnimation } = useDialogAnimation()

/** 收件前缀下拉：按实际收到过的 mailbox 归集，方便只看某个地址。 */
const mailboxes = computed(() => [...new Set(mails.value.map((mail) => mail.mailbox).filter(Boolean))]
  .sort((a, b) => a.localeCompare(b, 'en')))

const filtered = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  return mails.value.filter((mail) => {
    if (mailboxFilter.value && mail.mailbox !== mailboxFilter.value) return false
    if (!text) return true
    return mail.subject.toLowerCase().includes(text)
      || mail.fromAddress.includes(text)
      || mail.fromName.toLowerCase().includes(text)
      || mail.envelopeTo.includes(text)
  })
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
function buildFrameDocument(item: MailDetail): string {
  if (!item.htmlSafe) return ''
  // 每次打开都换一个 nonce，邮件正文里即便猜到上一次的值也没用。
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; "
    + `font-src data:; script-src 'nonce-${nonce}'; form-action 'none'; base-uri 'none'`
  return '<!doctype html><html><head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
    + `<style>${FRAME_BASE_CSS}</style>`
    // 邮件自己的 CSS 夹在中间：能覆盖基础兜底，但覆盖不了后面带 !important 的标记样式
    + (item.htmlSafeCss ? `<style>${item.htmlSafeCss}</style>` : '')
    + `<style>${FRAME_MARKER_CSS}</style>`
    + `</head><body>${item.htmlSafe}`
    + `<script nonce="${nonce}">${FRAME_SCRIPT}<\/script>`
    + '</body></html>'
}

const frameDocument = computed(() => (detail.value ? buildFrameDocument(detail.value) : ''))

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

onMounted(() => {
  load()
  applyDialogAnimation(detailDialog.value)
  applyDialogAnimation(linkDialog.value)
  window.addEventListener('message', onFrameMessage)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onFrameMessage)
})

async function load() {
  loading.value = true
  try {
    mails.value = await $fetch<MailSummary[]>('/api/admin/domain-mails')
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '邮件列表加载失败', 'error')
  } finally {
    loading.value = false
  }
}

async function openDetail(mail: MailSummary) {
  detail.value = null
  bodyView.value = 'html'
  detailOpen.value = true
  detailLoading.value = true
  try {
    detail.value = await $fetch<MailDetail>(`/api/admin/domain-mails/${mail.id}`)
    // 只有纯文本的邮件直接落到文本视图，省一次点击。
    if (!detail.value.hasHtml) bodyView.value = 'text'
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '邮件详情加载失败', 'error')
    detailOpen.value = false
  } finally {
    detailLoading.value = false
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

/** 详情里点删除：先收起详情弹窗，避免两个 md-dialog 叠在一起抢焦点。 */
function requestDeleteFromDetail() {
  if (!detail.value) return
  deleteTarget.value = detail.value
  detailOpen.value = false
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (!target || deleting.value) return
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

/** 发送时间取邮件头 Date；缺失或畸形时回退到接收时间并标注。 */
function sentLabel(mail: MailSummary) {
  return mail.sentTime === null ? `${formatDate(mail.receivedTime)}（按接收）` : formatDate(mail.sentTime)
}

function senderLabel(mail: MailSummary) {
  if (mail.fromName && mail.fromAddress) return `${mail.fromName} <${mail.fromAddress}>`
  return mail.fromAddress || mail.envelopeFrom || '未知发件人'
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
</script>

<template>
  <div class="page">
    <div class="page-heading">
      <div>
        <h1 class="page-title">域名邮件</h1>
        <p class="page-subtitle">
          Cloudflare Email Worker 以 catch-all 收下的 @mcyzw.top 来信，投递到本服务端保存。
          可以查看发送时间、发件人与正文并删除；转发与发信暂未开放。
          HTML 正文经服务端净化后在无权限沙箱中预览，附件一律作二进制下载，避免陌生来信在后台域名下执行脚本或外呼。
        </p>
      </div>
      <div class="heading-actions">
        <md-icon-button aria-label="刷新" title="刷新" :disabled="loading" @click="load">
          <md-icon>refresh</md-icon>
        </md-icon-button>
      </div>
    </div>

    <section class="card">
      <div class="toolbar">
        <md-outlined-text-field
          class="search"
          label="搜索主题 / 发件人 / 收件地址"
          :value="keyword"
          @input="keyword = ($event.target as HTMLInputElement).value"
        >
          <md-icon slot="leading-icon">search</md-icon>
        </md-outlined-text-field>
        <md-outlined-select v-if="mailboxes.length" class="mailbox-select" label="收件前缀" @change="onMailboxChange">
          <md-select-option value="" :selected="mailboxFilter === ''">
            <div slot="headline">全部</div>
          </md-select-option>
          <md-select-option
            v-for="box in mailboxes"
            :key="box"
            :value="box"
            :selected="mailboxFilter === box"
          >
            <div slot="headline">{{ box }}@</div>
          </md-select-option>
        </md-outlined-select>
        <span class="count">共 {{ filtered.length }} 封</span>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>主题</th>
              <th>发件人</th>
              <th>收件地址</th>
              <th>发送时间</th>
              <th>接收时间</th>
              <th>附件</th>
              <th>大小</th>
              <th>SPF / DKIM / DMARC</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="mail in filtered" :key="mail.id">
              <td class="primary-cell subject-cell" :title="mail.subject">
                {{ mail.subject || '(无主题)' }}
                <span v-if="mail.truncated" class="badge badge-warn" title="原信超出保存上限，正文或附件被截断">已截断</span>
              </td>
              <td class="address-cell" :title="senderLabel(mail)">{{ senderLabel(mail) }}</td>
              <td class="address-cell" :title="mail.envelopeTo">{{ mail.envelopeTo }}</td>
              <td>{{ sentLabel(mail) }}</td>
              <td>{{ formatDate(mail.receivedTime) }}</td>
              <td>{{ mail.attachmentCount || '—' }}</td>
              <td>{{ formatBytes(mail.rawSize) }}</td>
              <td class="verdict-cell">
                <span class="badge" :class="verdictClass(mail.spf)">{{ verdictLabel(mail.spf) }}</span>
                <span class="badge" :class="verdictClass(mail.dkim)">{{ verdictLabel(mail.dkim) }}</span>
                <span class="badge" :class="verdictClass(mail.dmarc)">{{ verdictLabel(mail.dmarc) }}</span>
              </td>
              <td class="cell-actions">
                <md-text-button @click="openDetail(mail)">
                  <md-icon slot="icon">visibility</md-icon>
                  查看
                </md-text-button>
                <md-icon-button
                  v-if="canEdit"
                  aria-label="删除"
                  title="删除"
                  @click="deleteTarget = mail"
                >
                  <md-icon>delete</md-icon>
                </md-icon-button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="loading" class="empty">加载中…</p>
        <p v-else-if="mails.length === 0" class="empty">还没有收到邮件</p>
        <p v-else-if="filtered.length === 0" class="empty">没有匹配的邮件</p>
      </div>
    </section>

    <md-dialog ref="detailDialog" :open="detailOpen" @closed="onDetailClosed">
      <div slot="headline">{{ detail?.subject || '邮件详情' }}</div>
      <div slot="content">
        <p v-if="detailLoading" class="empty">加载中…</p>
        <div v-else-if="detail" class="detail">
          <dl class="meta">
            <div><dt>发件人</dt><dd>{{ senderLabel(detail) }}</dd></div>
            <div><dt>发送时间</dt><dd>{{ sentLabel(detail) }}</dd></div>
            <div><dt>接收时间</dt><dd>{{ formatDate(detail.receivedTime) }}</dd></div>
            <div><dt>收件地址</dt><dd>{{ detail.envelopeTo }}</dd></div>
            <div><dt>信封发件人</dt><dd>{{ detail.envelopeFrom || '—' }}</dd></div>
            <div><dt>回复地址</dt><dd>{{ detail.replyTo || '—' }}</dd></div>
            <div><dt>收件人</dt><dd>{{ addressListLabel(detail.toAddresses) }}</dd></div>
            <div><dt>抄送</dt><dd>{{ addressListLabel(detail.ccAddresses) }}</dd></div>
            <div><dt>原信大小</dt><dd>{{ formatBytes(detail.rawSize) }}</dd></div>
            <div>
              <dt>身份验证</dt>
              <dd>
                SPF {{ verdictLabel(detail.spf) }} / DKIM {{ verdictLabel(detail.dkim) }} /
                DMARC {{ verdictLabel(detail.dmarc) }}
              </dd>
            </div>
            <div><dt>Message-ID</dt><dd class="mono">{{ detail.messageId || '—' }}</dd></div>
            <div><dt>本地 ID</dt><dd class="mono">{{ detail.id }}</dd></div>
          </dl>

          <p v-if="detail.truncated" class="notice">
            这封信超出了保存上限，正文或附件在投递时被截断，内容不完整。
          </p>

          <div class="body-heading">
            <h3 class="section-title">正文</h3>
            <div class="view-switch">
              <button
                v-if="detail.hasHtml"
                type="button"
                class="view-tab"
                :class="{ 'view-tab--active': bodyView === 'html' }"
                @click="bodyView = 'html'"
              >沙箱预览</button>
              <button
                type="button"
                class="view-tab"
                :class="{ 'view-tab--active': bodyView === 'text' }"
                @click="bodyView = 'text'"
              >纯文本</button>
              <button
                v-if="detail.hasHtml"
                type="button"
                class="view-tab"
                :class="{ 'view-tab--active': bodyView === 'source' }"
                @click="bodyView = 'source'"
              >HTML 源码</button>
            </div>
          </div>

          <template v-if="bodyView === 'html' && detail.hasHtml">
            <p class="form-hint">
              正文在沙箱里渲染：脚本、远程图片与表单都被拦掉。点击邮件里的链接不会跳转，
              而是弹窗显示完整地址，供你确认后手动复制打开。
              <span v-if="detail.htmlBlockedImages">已拦截 {{ detail.htmlBlockedImages }} 张图片（远程图片或内联附件），内联图片可在下方附件里下载查看。</span>
              <span v-if="detail.htmlSafeTruncated">正文过长，预览已截断。</span>
            </p>
            <iframe
              ref="bodyFrame"
              class="html-frame"
              sandbox="allow-scripts"
              referrerpolicy="no-referrer"
              title="邮件正文沙箱预览"
              :srcdoc="frameDocument"
            ></iframe>
          </template>

          <p v-else-if="bodyView === 'text'" class="body-text">{{ detail.textBody || (detail.hasHtml ? '（这封信只有 HTML 正文，请切换到沙箱预览或源码）' : '（无正文）') }}</p>

          <template v-else-if="bodyView === 'source'">
            <p class="form-hint">原始 HTML，未经净化，仅作排查用途——此处只是转义后的文本，不会被解析执行。</p>
            <pre class="html-source">{{ htmlPreview }}</pre>
            <p v-if="htmlTruncated" class="form-hint">源码过长，仅显示前 {{ HTML_PREVIEW_MAX }} 个字符。</p>
          </template>

          <h3 class="section-title">附件（{{ detail.attachments.length }}）</h3>
          <table v-if="detail.attachments.length" class="data-table inner-table">
            <thead><tr><th>文件名</th><th>类型</th><th>大小</th><th></th></tr></thead>
            <tbody>
              <tr v-for="attachment in detail.attachments" :key="attachment.id">
                <td class="primary-cell">
                  {{ attachment.filename || '(未命名)' }}
                  <span v-if="attachment.disposition === 'inline'" class="badge">内联</span>
                </td>
                <td class="mono">{{ attachment.mimeType || '—' }}</td>
                <td>{{ formatBytes(attachment.size) }}</td>
                <td class="cell-actions">
                  <a
                    v-if="attachment.stored"
                    class="attachment-link"
                    :href="attachmentHref(detail.id, attachment.id)"
                  >下载</a>
                  <span v-else class="unstored" title="投递时超出体积预算，只记录了元信息">未保存</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="empty inner-empty">无附件</p>
        </div>
      </div>
      <div slot="actions">
        <md-text-button
          v-if="canEdit && detail"
          class="delete-confirm"
          @click="requestDeleteFromDetail"
        >删除</md-text-button>
        <md-text-button @click="closeDetail">关闭</md-text-button>
      </div>
    </md-dialog>

    <md-dialog ref="linkDialog" :open="linkOpen" @closed="onLinkDialogClosed">
      <md-icon slot="icon" class="link-dialog-icon">{{ linkBlocked ? 'link_off' : 'link' }}</md-icon>
      <div slot="headline">{{ linkBlocked ? '该链接已被移除' : '邮件里的链接' }}</div>
      <div slot="content" class="link-dialog">
        <template v-if="linkBlocked">
          <p class="link-warning">
            这个链接使用了不安全的协议（例如 <code>javascript:</code> 或 <code>data:</code>），
            已在净化时移除，无法查看目标地址。这类链接几乎只出现在恶意邮件里。
          </p>
        </template>
        <template v-else>
          <p class="link-note">
            出于安全考虑，后台不会替你打开这个地址。请确认无误后复制，
            <strong>在浏览器新标签页手动打开</strong>。
          </p>
          <div class="link-url">{{ linkUrl }}</div>
          <p class="link-warning">
            <md-icon>warning</md-icon>
            <span>陌生来信的链接可能是钓鱼页面。注意核对域名，不要在上面填写任何账号或密码。</span>
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
.page-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.page-subtitle { margin: -12px 0 20px; color: var(--md-sys-color-on-surface-variant); font-size: 13px; max-width: 760px; }
.heading-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.search { min-width: 260px; flex: 1 1 260px; }
.mailbox-select { min-width: 160px; }
.count { color: var(--md-sys-color-on-surface-variant); font-size: 13px; }
.table-wrap { overflow-x: auto; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { padding: 12px 10px; border-bottom: 1px solid var(--md-sys-color-outline-variant); text-align: left; white-space: nowrap; }
.data-table th { color: var(--md-sys-color-on-surface-variant); font-size: 12px; font-weight: 500; }
.primary-cell { font-weight: 600; }
.subject-cell { max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
.address-cell { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.verdict-cell { display: flex; gap: 4px; }
.cell-actions { text-align: right; white-space: nowrap; }
.mono { font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.empty { padding: 16px 0; color: var(--md-sys-color-on-surface-variant); }
.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; line-height: 18px; background: var(--md-sys-color-surface-variant); color: var(--md-sys-color-on-surface-variant); }
.badge-pass { background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); }
.badge-fail { background: var(--md-sys-color-error-container); color: var(--md-sys-color-on-error-container); }
.badge-warn { background: var(--md-sys-color-tertiary-container); color: var(--md-sys-color-on-tertiary-container); }
.detail { display: flex; flex-direction: column; gap: 4px; min-width: min(680px, 76vw); }
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px 20px; margin: 0 0 8px; }
.meta dt { color: var(--md-sys-color-on-surface-variant); font-size: 12px; }
.meta dd { margin: 2px 0 0; font-size: 14px; word-break: break-all; }
.section-title { margin: 18px 0 8px; font-size: 13px; font-weight: 600; color: var(--md-sys-color-on-surface-variant); }
.body-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.view-switch { display: flex; gap: 2px; padding: 2px; border-radius: 999px; background: var(--md-sys-color-surface-variant); }
.view-tab {
  padding: 4px 12px; border: none; border-radius: 999px; cursor: pointer;
  background: transparent; color: var(--md-sys-color-on-surface-variant);
  font: inherit; font-size: 12px; line-height: 20px;
  transition: background 140ms ease, color 140ms ease;
}
.view-tab:hover { background: color-mix(in srgb, var(--md-sys-color-primary) 12%, transparent); }
.view-tab--active {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
  font-weight: 600;
}
.html-frame {
  display: block; width: 100%; height: min(52vh, 460px);
  margin: 8px 0 0; border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 8px; background: #ffffff;
}
.link-dialog-icon { color: var(--md-sys-color-primary); }
.link-dialog { min-width: min(440px, 76vw); display: flex; flex-direction: column; gap: 12px; }
.link-note { margin: 0; font-size: 14px; line-height: 1.6; color: var(--md-sys-color-on-surface-variant); }
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
.body-text { margin: 0; padding: 12px; border-radius: 8px; background: var(--md-sys-color-surface-variant); white-space: pre-wrap; word-break: break-word; font-size: 14px; }
.html-source { margin: 8px 0 0; padding: 12px; border-radius: 8px; background: var(--md-sys-color-surface-variant); max-height: 320px; overflow: auto; white-space: pre-wrap; word-break: break-all; font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.notice { margin: 8px 0 0; padding: 10px 12px; border-radius: 8px; background: var(--md-sys-color-error-container); color: var(--md-sys-color-on-error-container); font-size: 13px; }
.form-hint { margin: 0; font-size: 12px; color: var(--md-sys-color-on-surface-variant); }
.inner-table th, .inner-table td { padding: 8px; font-size: 13px; }
.inner-empty { padding: 8px 0; font-size: 13px; }
.attachment-link { color: var(--md-sys-color-primary); font-size: 13px; text-decoration: none; }
.attachment-link:hover { text-decoration: underline; }
.unstored { color: var(--md-sys-color-on-surface-variant); font-size: 12px; }
.delete-confirm { color: var(--md-sys-color-error); }
.delete-preview { display: flex; align-items: center; gap: 8px; font-size: 14px; word-break: break-all; }
</style>
