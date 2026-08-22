<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

useHead({ title: '服内邮件' })

interface MailTargetSpec { scope: number; args: string[] }
interface MailAttachment { type: string; data: string; amount: number; itemNbt: string | null }
interface MailRecipient { uuid: string; username: string | null; read: boolean; starred: boolean; claimed: boolean }

interface MailSummary {
  id: string
  type: string
  sender: string
  title: string
  scopeSummary: string
  createdTime: number
  expireTime: number | null
  expired: boolean
  claimed: boolean
  hidden: boolean
  attachmentCount: number
  recipientCount: number
  readCount: number
  starredCount: number
  claimedCount: number
}

interface MailDetail extends MailSummary {
  body: string
  targets: MailTargetSpec[]
  attachments: MailAttachment[]
  recipients: MailRecipient[]
}

const TYPE_LABELS: Record<string, string> = {
  ANNOUNCEMENT: '公告',
  NOTICE: '通知',
  REWARD: '奖励',
}
const ATTACHMENT_LABELS: Record<string, string> = {
  ITEM: '物品',
  COMMAND: '命令',
  VANILLA_EXP: '原版经验',
  VANILLA_LEVEL: '原版等级',
  ADVENTURE_EXP: '冒险经验',
  ADVENTURE_LEVEL: '冒险等级',
}
const SCOPE_LABELS: Record<number, string> = {
  0: '全体成员',
  1: '全体非管理（旧版）',
  2: '指定玩家',
  3: '角色组（旧版）',
}

const mails = ref<MailSummary[]>([])
const loading = ref(true)
const keyword = ref('')

const detailOpen = ref(false)
const detail = ref<MailDetail | null>(null)
const detailLoading = ref(false)
const detailDialog = ref<HTMLElement | null>(null)

// 发布公告 / 通知：后台只开放这两种无附件类型，奖励邮件仍需在游戏内发布。
const EXPIRE_OPTIONS = [
  { value: 0, label: '1 天' },
  { value: 1, label: '7 天' },
  { value: 2, label: '30 天' },
  { value: 3, label: '永久' },
]

const composeOpen = ref(false)
const composeDialog = ref<HTMLElement | null>(null)
const composeType = ref<'ANNOUNCEMENT' | 'NOTICE'>('ANNOUNCEMENT')
const composeTitle = ref('')
const composeBody = ref('')
const composeExpire = ref(2)
const composeScope = ref<'all' | 'players'>('all')
const composePlayers = ref<string[]>([])
const playerKeyword = ref('')
const accounts = ref<string[]>([])
const accountsLoading = ref(false)
const submitting = ref(false)

const { showToast } = useToast()
const { apply: applyDialogAnimation } = useDialogAnimation()

const filtered = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return mails.value
  return mails.value.filter((mail) => mail.title.toLowerCase().includes(text)
    || mail.sender.toLowerCase().includes(text)
    || mail.scopeSummary.toLowerCase().includes(text))
})

const filteredAccounts = computed(() => {
  const text = playerKeyword.value.trim().toLowerCase()
  if (!text) return accounts.value
  return accounts.value.filter((name) => name.toLowerCase().includes(text))
})

onMounted(() => {
  load()
  applyDialogAnimation(detailDialog.value)
  applyDialogAnimation(composeDialog.value)
})

async function load() {
  loading.value = true
  try {
    mails.value = await $fetch<MailSummary[]>('/api/admin/mails')
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '邮件列表加载失败', 'error')
  } finally {
    loading.value = false
  }
}

async function openDetail(mail: MailSummary) {
  detail.value = null
  detailOpen.value = true
  detailLoading.value = true
  try {
    detail.value = await $fetch<MailDetail>(`/api/admin/mails/${mail.id}`)
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
}

async function loadAccounts() {
  if (accounts.value.length || accountsLoading.value) return
  accountsLoading.value = true
  try {
    const list = await $fetch<{ username: string }[]>('/api/admin/game-accounts')
    accounts.value = list
      .map((account) => account.username)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'en'))
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '玩家名单加载失败', 'error')
  } finally {
    accountsLoading.value = false
  }
}

function openCompose() {
  composeType.value = 'ANNOUNCEMENT'
  composeTitle.value = ''
  composeBody.value = ''
  composeExpire.value = 2
  composeScope.value = 'all'
  composePlayers.value = []
  playerKeyword.value = ''
  composeOpen.value = true
  loadAccounts()
}

function closeCompose() {
  composeOpen.value = false
}

function onComposeClosed() {
  composeOpen.value = false
}

function onComposeTypeChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'ANNOUNCEMENT' || value === 'NOTICE') composeType.value = value
}

function onComposeExpireChange(event: Event) {
  const value = Number((event.target as HTMLSelectElement).value)
  if (Number.isInteger(value)) composeExpire.value = value
}

function togglePlayer(name: string) {
  const index = composePlayers.value.indexOf(name)
  if (index === -1) composePlayers.value.push(name)
  else composePlayers.value.splice(index, 1)
}

async function submitCompose() {
  if (!composeTitle.value.trim()) {
    showToast('主题不能为空', 'error')
    return
  }
  if (composeScope.value === 'players' && composePlayers.value.length === 0) {
    showToast('请至少选择一个收件玩家', 'error')
    return
  }
  submitting.value = true
  try {
    const result = await $fetch<{ recipientCount: number }>('/api/admin/mails', {
      method: 'POST',
      body: {
        type: composeType.value,
        title: composeTitle.value,
        body: composeBody.value,
        expireOption: composeExpire.value,
        scope: composeScope.value,
        players: composeScope.value === 'players' ? composePlayers.value : [],
      },
    })
    showToast(`已发布，投递给 ${result.recipientCount} 位玩家`)
    composeOpen.value = false
    await load()
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '发布失败', 'error')
  } finally {
    submitting.value = false
  }
}

function typeLabel(type: string) {
  return TYPE_LABELS[type] || type
}

function attachmentLabel(type: string) {
  return ATTACHMENT_LABELS[type] || type
}

function scopeLabel(scope: number) {
  return SCOPE_LABELS[scope] ?? `未知（${scope}）`
}

function formatDate(value: number) {
  return new Date(value).toLocaleString('zh-CN')
}

function expireLabel(mail: MailSummary) {
  return mail.expireTime === null ? '永久' : formatDate(mail.expireTime)
}

/** 物品附件的数值放在 amount，命令附件的内容放在 data。 */
function attachmentDetail(attachment: MailAttachment) {
  if (attachment.type === 'COMMAND') return attachment.data || '—'
  if (attachment.type === 'ITEM') return attachment.itemNbt || '—'
  return String(attachment.amount)
}
</script>

<template>
  <div class="page">
    <div class="page-heading">
      <div>
        <h1 class="page-title">服内邮件</h1>
        <p class="page-subtitle">查看游戏内已发布的服务器邮件与每位收件人的阅读、领取状态。后台可发布公告与通知；奖励邮件、编辑与撤回仍在游戏内进行。</p>
      </div>
      <div class="heading-actions">
        <md-filled-button @click="openCompose">
          <md-icon slot="icon">edit_note</md-icon>
          发布公告 / 通知
        </md-filled-button>
        <md-icon-button aria-label="刷新" title="刷新" :disabled="loading" @click="load">
          <md-icon>refresh</md-icon>
        </md-icon-button>
      </div>
    </div>

    <section class="card">
      <div class="toolbar">
        <md-outlined-text-field
          class="search"
          label="搜索主题 / 发件人 / 接收范围"
          :value="keyword"
          @input="keyword = ($event.target as HTMLInputElement).value"
        >
          <md-icon slot="leading-icon">search</md-icon>
        </md-outlined-text-field>
        <span class="count">共 {{ filtered.length }} 封</span>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>主题</th>
              <th>类型</th>
              <th>发件人</th>
              <th>接收范围</th>
              <th>收件人</th>
              <th>已读</th>
              <th>已领取</th>
              <th>发送时间</th>
              <th>有效期</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="mail in filtered" :key="mail.id">
              <td class="primary-cell">
                {{ mail.title }}
                <span v-if="mail.hidden" class="badge badge-hidden" title="管理员正在游戏内编辑，收件人暂时看不到">编辑中</span>
                <span v-if="mail.expired" class="badge badge-expired">已过期</span>
              </td>
              <td><span class="badge" :class="`badge-${mail.type.toLowerCase()}`">{{ typeLabel(mail.type) }}</span></td>
              <td>{{ mail.sender }}</td>
              <td class="scope-cell">{{ mail.scopeSummary || '—' }}</td>
              <td>{{ mail.recipientCount }}</td>
              <td>{{ mail.readCount }} / {{ mail.recipientCount }}</td>
              <td>{{ mail.attachmentCount === 0 ? '—' : `${mail.claimedCount} / ${mail.recipientCount}` }}</td>
              <td>{{ formatDate(mail.createdTime) }}</td>
              <td>{{ expireLabel(mail) }}</td>
              <td class="cell-actions">
                <md-text-button @click="openDetail(mail)">
                  <md-icon slot="icon">visibility</md-icon>
                  查看
                </md-text-button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="loading" class="empty">加载中…</p>
        <p v-else-if="mails.length === 0" class="empty">暂无邮件</p>
        <p v-else-if="filtered.length === 0" class="empty">没有匹配的邮件</p>
      </div>
    </section>

    <md-dialog ref="detailDialog" :open="detailOpen" @closed="onDetailClosed">
      <div slot="headline">{{ detail?.title || '邮件详情' }}</div>
      <div slot="content">
        <p v-if="detailLoading" class="empty">加载中…</p>
        <div v-else-if="detail" class="detail">
          <dl class="meta">
            <div><dt>类型</dt><dd>{{ typeLabel(detail.type) }}</dd></div>
            <div><dt>发件人</dt><dd>{{ detail.sender }}</dd></div>
            <div><dt>发送时间</dt><dd>{{ formatDate(detail.createdTime) }}</dd></div>
            <div><dt>有效期</dt><dd>{{ expireLabel(detail) }}{{ detail.expired ? '（已过期）' : '' }}</dd></div>
            <div><dt>接收范围</dt><dd>{{ detail.scopeSummary || '—' }}</dd></div>
            <div><dt>邮件 ID</dt><dd class="mono">{{ detail.id }}</dd></div>
          </dl>

          <h3 class="section-title">正文</h3>
          <p class="body-text">{{ detail.body || '（无正文）' }}</p>

          <h3 class="section-title">接收范围明细</h3>
          <ul class="target-list">
            <li v-for="(target, index) in detail.targets" :key="index">
              {{ scopeLabel(target.scope) }}
              <span v-if="target.args.length" class="target-args">：{{ target.args.join('、') }}</span>
            </li>
            <li v-if="detail.targets.length === 0">—</li>
          </ul>

          <h3 class="section-title">附件（{{ detail.attachments.length }}）</h3>
          <table v-if="detail.attachments.length" class="data-table inner-table">
            <thead><tr><th>类型</th><th>数量</th><th>内容</th></tr></thead>
            <tbody>
              <tr v-for="(attachment, index) in detail.attachments" :key="index">
                <td>{{ attachmentLabel(attachment.type) }}</td>
                <td>{{ attachment.amount }}</td>
                <td class="mono nbt-cell" :title="attachmentDetail(attachment)">{{ attachmentDetail(attachment) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="empty inner-empty">无附件</p>

          <h3 class="section-title">收件人（{{ detail.recipients.length }}）</h3>
          <div class="recipient-wrap">
            <table class="data-table inner-table">
              <thead><tr><th>玩家</th><th>已读</th><th>收藏</th><th>已领取</th></tr></thead>
              <tbody>
                <tr v-for="recipient in detail.recipients" :key="recipient.uuid">
                  <td>
                    <span v-if="recipient.username" class="primary-cell">{{ recipient.username }}</span>
                    <span v-else class="mono">{{ recipient.uuid }}</span>
                  </td>
                  <td>{{ recipient.read ? '是' : '否' }}</td>
                  <td>{{ recipient.starred ? '是' : '否' }}</td>
                  <td>{{ detail.attachmentCount === 0 ? '—' : (recipient.claimed ? '是' : '否') }}</td>
                </tr>
              </tbody>
            </table>
            <p v-if="detail.recipients.length === 0" class="empty inner-empty">没有收件人</p>
          </div>
        </div>
      </div>
      <div slot="actions">
        <md-text-button @click="closeDetail">关闭</md-text-button>
      </div>
    </md-dialog>

    <md-dialog ref="composeDialog" :open="composeOpen" @closed="onComposeClosed">
      <div slot="headline">发布公告 / 通知</div>
      <div slot="content">
        <div class="dialog-form">
          <p class="form-hint">发件人取当前后台账户。收件人打开信箱即可看到；未读红点由服务端周期刷新（约 2.5 分钟内）点亮。</p>

          <md-outlined-select label="类型" @change="onComposeTypeChange">
            <md-select-option value="ANNOUNCEMENT" :selected="composeType === 'ANNOUNCEMENT'">
              <div slot="headline">公告</div>
            </md-select-option>
            <md-select-option value="NOTICE" :selected="composeType === 'NOTICE'">
              <div slot="headline">通知</div>
            </md-select-option>
          </md-outlined-select>

          <md-outlined-text-field
            label="主题"
            :value="composeTitle"
            @input="composeTitle = ($event.target as HTMLInputElement).value"
          ></md-outlined-text-field>

          <md-outlined-text-field
            label="正文"
            type="textarea"
            rows="6"
            :value="composeBody"
            @input="composeBody = ($event.target as HTMLTextAreaElement).value"
          ></md-outlined-text-field>

          <md-outlined-select label="有效期" @change="onComposeExpireChange">
            <md-select-option
              v-for="option in EXPIRE_OPTIONS"
              :key="option.value"
              :value="String(option.value)"
              :selected="option.value === composeExpire"
            >
              <div slot="headline">{{ option.label }}</div>
            </md-select-option>
          </md-outlined-select>

          <div class="field-group">
            <span class="field-label">接收范围</span>
            <label class="scope-row">
              <md-radio name="mail-scope" value="all" :checked="composeScope === 'all'" @change="composeScope = 'all'"></md-radio>
              <span>全体成员</span>
            </label>
            <label class="scope-row">
              <md-radio name="mail-scope" value="players" :checked="composeScope === 'players'" @change="composeScope = 'players'"></md-radio>
              <span>指定玩家</span>
            </label>
          </div>

          <div v-if="composeScope === 'players'" class="picker">
            <md-outlined-text-field
              class="picker-search"
              label="搜索玩家"
              :value="playerKeyword"
              @input="playerKeyword = ($event.target as HTMLInputElement).value"
            >
              <md-icon slot="leading-icon">search</md-icon>
            </md-outlined-text-field>
            <p class="picker-count">已选 {{ composePlayers.length }} 人</p>
            <div class="picker-list">
              <p v-if="accountsLoading" class="empty inner-empty">加载中…</p>
              <p v-else-if="filteredAccounts.length === 0" class="empty inner-empty">没有匹配的玩家</p>
              <label v-for="name in filteredAccounts" :key="name" class="picker-row">
                <md-checkbox :checked="composePlayers.includes(name)" @change="togglePlayer(name)"></md-checkbox>
                <span>{{ name }}</span>
              </label>
            </div>
          </div>
        </div>
      </div>
      <div slot="actions">
        <md-text-button @click="closeCompose">取消</md-text-button>
        <md-filled-button :disabled="submitting" @click="submitCompose">
          {{ submitting ? '发布中…' : '发布' }}
        </md-filled-button>
      </div>
    </md-dialog>
  </div>
</template>

<style scoped>
.page-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.page-subtitle { margin: -12px 0 20px; color: var(--md-sys-color-on-surface-variant); font-size: 13px; max-width: 720px; }
.toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.search { min-width: 280px; flex: 1 1 280px; }
.count { color: var(--md-sys-color-on-surface-variant); font-size: 13px; }
.table-wrap { overflow-x: auto; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { padding: 12px 10px; border-bottom: 1px solid var(--md-sys-color-outline-variant); text-align: left; white-space: nowrap; }
.data-table th { color: var(--md-sys-color-on-surface-variant); font-size: 12px; font-weight: 500; }
.primary-cell { font-weight: 600; }
.scope-cell { max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
.cell-actions { text-align: right; }
.mono { font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.empty { padding: 16px 0; color: var(--md-sys-color-on-surface-variant); }
.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; line-height: 18px; background: var(--md-sys-color-surface-variant); color: var(--md-sys-color-on-surface-variant); }
.badge-reward { background: var(--md-sys-color-tertiary-container); color: var(--md-sys-color-on-tertiary-container); }
.badge-announcement { background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); }
.badge-expired { margin-left: 6px; background: var(--md-sys-color-error-container); color: var(--md-sys-color-on-error-container); }
.badge-hidden { margin-left: 6px; }
.detail { display: flex; flex-direction: column; gap: 4px; min-width: min(680px, 76vw); }
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px 20px; margin: 0 0 8px; }
.meta dt { color: var(--md-sys-color-on-surface-variant); font-size: 12px; }
.meta dd { margin: 2px 0 0; font-size: 14px; word-break: break-all; }
.section-title { margin: 18px 0 8px; font-size: 13px; font-weight: 600; color: var(--md-sys-color-on-surface-variant); }
.body-text { margin: 0; padding: 12px; border-radius: 8px; background: var(--md-sys-color-surface-variant); white-space: pre-wrap; word-break: break-word; font-size: 14px; }
.target-list { margin: 0; padding-left: 20px; font-size: 14px; }
.target-args { word-break: break-all; }
.inner-table th, .inner-table td { padding: 8px; font-size: 13px; }
.inner-empty { padding: 8px 0; font-size: 13px; }
.nbt-cell { max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
.recipient-wrap { max-height: 320px; overflow: auto; }
.heading-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.dialog-form { display: flex; flex-direction: column; gap: 16px; min-width: min(520px, 74vw); }
.dialog-form md-outlined-select, .dialog-form md-outlined-text-field { width: 100%; }
.form-hint { margin: 0; font-size: 12px; color: var(--md-sys-color-on-surface-variant); }
.field-group { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 12px; color: var(--md-sys-color-on-surface-variant); }
.scope-row, .picker-row { display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; }
.picker { display: flex; flex-direction: column; gap: 8px; }
.picker-count { margin: 0; font-size: 12px; color: var(--md-sys-color-on-surface-variant); }
.picker-list { max-height: 220px; overflow: auto; padding: 4px 8px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 8px; }
.picker-row { padding: 2px 0; }
</style>
