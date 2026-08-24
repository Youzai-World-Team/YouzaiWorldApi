<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

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
  attachments: MailAttachment[]
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
// HTML 正文只以源码形式展示，超过这个长度就截断，避免一封营销邮件把页面卡住。
const HTML_PREVIEW_MAX = 200_000

const mails = ref<MailSummary[]>([])
const loading = ref(true)
const keyword = ref('')
const mailboxFilter = ref('')

const detailOpen = ref(false)
const detail = ref<MailDetail | null>(null)
const detailLoading = ref(false)
const detailDialog = ref<HTMLElement | null>(null)
const showHtmlSource = ref(false)

const deleteTarget = ref<MailSummary | null>(null)
const deleting = ref(false)

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

onMounted(() => {
  load()
  applyDialogAnimation(detailDialog.value)
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
  showHtmlSource.value = false
  detailOpen.value = true
  detailLoading.value = true
  try {
    detail.value = await $fetch<MailDetail>(`/api/admin/domain-mails/${mail.id}`)
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
  showHtmlSource.value = false
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
          HTML 正文只以源码展示、附件一律作二进制下载，避免陌生来信在后台域名下执行脚本。
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

          <h3 class="section-title">正文</h3>
          <p class="body-text">{{ detail.textBody || (detail.hasHtml ? '（这封信只有 HTML 正文，见下方源码）' : '（无正文）') }}</p>

          <template v-if="detail.hasHtml">
            <h3 class="section-title">HTML 正文源码</h3>
            <p class="form-hint">
              出于安全考虑只展示源码，不在后台渲染：陌生来信里的脚本或远程图片一旦渲染，
              就能在 api.mcyzw.top 下执行并回传后台会话。
            </p>
            <md-text-button v-if="!showHtmlSource" @click="showHtmlSource = true">
              <md-icon slot="icon">code</md-icon>
              展开源码（{{ detail.htmlBody.length }} 个字符）
            </md-text-button>
            <template v-else>
              <pre class="html-source">{{ htmlPreview }}</pre>
              <p v-if="htmlTruncated" class="form-hint">源码过长，仅显示前 {{ HTML_PREVIEW_MAX }} 个字符。</p>
            </template>
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
