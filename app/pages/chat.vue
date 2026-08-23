<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'

useHead({ title: '聊天区' })

type ChatRole = 'guest' | 'player' | 'admin'

interface ChatMessage {
  id: string
  name: string
  content: string
  avatar: string
  role: ChatRole
  location: string
  time: number
  ipTag: string
}

interface CurrentUser {
  username: string
  avatar: string
  fullName: string
}

const publicEndpoint = '/api/chat'
const adminEndpoint = '/api/admin/chat'
const CONTENT_MAX = 200

const messages = ref<ChatMessage[]>([])
const loading = ref(true)
const refreshing = ref(false)
const currentUser = ref<CurrentUser | null>(null)

// 发送消息弹窗
const composeOpen = ref(false)
const composeContent = ref('')
const sending = ref(false)

// 删除单条弹窗
const deleteOpen = ref(false)
const deleteTarget = ref<ChatMessage | null>(null)
const deleting = ref(false)

// 清空弹窗
const clearOpen = ref(false)
const clearing = ref(false)

const composeDialog = ref<HTMLElement | null>(null)
const deleteDialog = ref<HTMLElement | null>(null)
const clearDialog = ref<HTMLElement | null>(null)

const { showToast } = useToast()
const { apply: applyDialogAnimation } = useDialogAnimation()
const access = useAdminAccess()
const canEdit = computed(() => access.levelForKey('chat') === 'edit')

const senderCount = computed(() => new Set(messages.value.map((m) => m.ipTag)).size)
const displayName = computed(() => currentUser.value?.fullName || currentUser.value?.username || '账户')
const composeLength = computed(() => composeContent.value.trim().length)
const canSend = computed(() => !sending.value && composeLength.value > 0 && composeLength.value <= CONTENT_MAX)

onMounted(() => {
  load()
  loadCurrentUser()
  applyDialogAnimation(composeDialog.value)
  applyDialogAnimation(deleteDialog.value)
  applyDialogAnimation(clearDialog.value)
})

async function loadCurrentUser() {
  try {
    const result = await $fetch<{ user: CurrentUser }>('/api/auth/me')
    currentUser.value = result.user
  } catch {
    // 布局层已负责未登录跳转，这里静默即可。
  }
}

async function load() {
  refreshing.value = true
  try {
    messages.value = await $fetch<ChatMessage[]>(adminEndpoint)
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '加载失败', 'error')
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

const ROLE_LABELS: Record<ChatRole, string> = {
  admin: '管理员',
  player: '玩家',
  guest: '访客',
}

function formatTime(value: number) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function openCompose() {
  composeContent.value = ''
  composeOpen.value = true
}

function closeCompose() {
  composeOpen.value = false
}

function onComposeClosed() {
  composeOpen.value = false
}

async function submitCompose() {
  if (!canSend.value) return
  sending.value = true
  try {
    // 昵称、头像、IP 归属地全部由服务端按当前会话推导，前端只提交正文。
    await $fetch<Omit<ChatMessage, 'ipTag'>>(adminEndpoint, {
      method: 'POST',
      body: { content: composeContent.value.trim() },
    })
    composeOpen.value = false
    showToast('已发送')
    // 重新拉取，保证列表里的 IP 标识等后台字段与服务端一致。
    await load()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '发送失败', 'error')
  } finally {
    sending.value = false
  }
}

function openDelete(message: ChatMessage) {
  deleteTarget.value = message
  deleteOpen.value = true
}

function closeDelete() {
  deleteOpen.value = false
}

function onDeleteClosed() {
  deleteOpen.value = false
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (deleting.value || !target) return
  deleting.value = true
  try {
    await $fetch(`${adminEndpoint}/${target.id}`, { method: 'DELETE' })
    messages.value = messages.value.filter((m) => m.id !== target.id)
    deleteOpen.value = false
    showToast('已删除')
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '删除失败', 'error')
  } finally {
    deleting.value = false
  }
}

function openClear() {
  clearOpen.value = true
}

function closeClear() {
  clearOpen.value = false
}

function onClearClosed() {
  clearOpen.value = false
}

async function confirmClear() {
  if (clearing.value) return
  clearing.value = true
  try {
    const result = await $fetch<{ removed: number }>(adminEndpoint, { method: 'DELETE' })
    messages.value = []
    clearOpen.value = false
    showToast(`已清空 ${result.removed} 条消息`)
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '清空失败', 'error')
  } finally {
    clearing.value = false
  }
}
</script>

<template>
  <div class="page">
    <h1 class="page-title">聊天区</h1>

    <div class="endpoint">
      <span class="endpoint-label">数据 API：</span>
      <code class="endpoint-url">
        <a :href="publicEndpoint" target="_blank" rel="noopener">GET {{ publicEndpoint }}</a>
      </code>
    </div>

    <div class="card">
      <div class="card-head">
        <h2 class="card-title">
          留言记录
          <span v-if="!loading" class="card-meta">共 {{ messages.length }} 条 · {{ senderCount }} 位发送者</span>
        </h2>
        <div class="head-actions">
          <md-icon-button aria-label="刷新留言记录" title="刷新留言记录" :disabled="refreshing" @click="load">
            <md-icon :class="{ 'refresh-icon--loading': refreshing }">refresh</md-icon>
          </md-icon-button>
          <md-filled-button v-if="canEdit" @click="openCompose">
            <md-icon slot="icon">add</md-icon>
            新增消息
          </md-filled-button>
          <md-filled-button
            v-if="canEdit"
            class="clear-btn"
            :disabled="messages.length === 0"
            @click="openClear"
          >
            <md-icon slot="icon">delete_sweep</md-icon>
            清空聊天区
          </md-filled-button>
        </div>
      </div>

      <div class="table-wrap">
        <table class="chat-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>发送者</th>
              <th>内容</th>
              <th>IP 归属地</th>
              <th>IP 标识</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in messages" :key="m.id">
              <td class="cell-time">{{ formatTime(m.time) }}</td>
              <td class="cell-name">
                <span class="sender">
                  <img v-if="m.avatar" class="sender-avatar" :src="m.avatar" :alt="m.name">
                  <span>{{ m.name }}</span>
                  <span v-if="m.role !== 'guest'" class="sender-badge" :class="`sender-badge--${m.role}`">
                    {{ ROLE_LABELS[m.role] }}
                  </span>
                </span>
              </td>
              <td class="cell-content">{{ m.content }}</td>
              <td class="cell-location">{{ m.location }}</td>
              <td class="cell-ip"><code>{{ m.ipTag }}</code></td>
              <td class="cell-actions">
                <md-text-button v-if="canEdit" class="delete-btn" @click="openDelete(m)">
                  <md-icon slot="icon">delete</md-icon>
                  删除
                </md-text-button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="loading" class="empty">加载中…</p>
      <p v-else-if="messages.length === 0" class="empty">暂无留言记录</p>
    </div>

    <md-dialog ref="composeDialog" :open="composeOpen" @closed="onComposeClosed">
      <div slot="headline">新增消息</div>
      <div slot="content">
        <div class="compose-form">
          <div class="compose-identity">
            <img v-if="currentUser?.avatar" class="compose-avatar" :src="currentUser.avatar" alt="">
            <md-icon v-else class="compose-avatar-fallback">account_circle</md-icon>
            <div class="compose-identity-text">
              <span class="compose-identity-name">{{ displayName }}</span>
              <span class="compose-identity-hint">将以该身份与本次请求的 IP 归属地发布</span>
            </div>
          </div>

          <label class="compose-field">
            <span class="compose-label">
              消息内容
              <span class="compose-counter">{{ composeLength }}/{{ CONTENT_MAX }}</span>
            </span>
            <textarea
              v-model="composeContent"
              class="compose-textarea"
              :maxlength="CONTENT_MAX"
              rows="4"
              placeholder="输入要发布到官网聊天区的内容……"
            />
          </label>
        </div>
      </div>
      <div slot="actions">
        <md-text-button @click="closeCompose">取消</md-text-button>
        <md-filled-button :disabled="!canSend" @click="submitCompose">
          {{ sending ? '发送中…' : '发送' }}
        </md-filled-button>
      </div>
    </md-dialog>

    <md-dialog ref="deleteDialog" :open="deleteOpen" @closed="onDeleteClosed">
      <div slot="headline">删除聊天消息</div>
      <div slot="content">
        <p class="delete-text">确定要删除这条消息吗？此操作无法撤销。</p>
        <div v-if="deleteTarget" class="delete-preview">
          <span class="delete-name">{{ deleteTarget.name }}</span>
          <span class="delete-sub">{{ formatTime(deleteTarget.time) }} · {{ deleteTarget.location }}</span>
          <span class="delete-body">{{ deleteTarget.content }}</span>
        </div>
      </div>
      <div slot="actions">
        <md-text-button @click="closeDelete">取消</md-text-button>
        <md-text-button class="delete-confirm" :disabled="deleting" @click="confirmDelete">
          {{ deleting ? '删除中…' : '删除' }}
        </md-text-button>
      </div>
    </md-dialog>

    <md-dialog ref="clearDialog" :open="clearOpen" @closed="onClearClosed">
      <div slot="headline">清空聊天区</div>
      <div slot="content">
        <p class="delete-text">
          确定要删除全部 {{ messages.length }} 条消息吗？此操作无法撤销。
        </p>
      </div>
      <div slot="actions">
        <md-text-button @click="closeClear">取消</md-text-button>
        <md-text-button class="delete-confirm" :disabled="clearing" @click="confirmClear">
          {{ clearing ? '清空中…' : '全部删除' }}
        </md-text-button>
      </div>
    </md-dialog>
  </div>
</template>

<style scoped>
.endpoint {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: -6px 0 20px;
  font-size: 14px;
  color: var(--md-sys-color-on-surface-variant);
}

.endpoint-url {
  font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
}

.endpoint-url a {
  color: var(--md-sys-color-primary);
  text-decoration: none;
  border-bottom: 1px dashed currentColor;
}

.endpoint-url a:hover {
  opacity: 0.8;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 16px;
}

.card-head .card-title {
  margin: 0;
}

.card-meta {
  margin-left: 10px;
  font-size: 13px;
  font-weight: 400;
  color: var(--md-sys-color-on-surface-variant);
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.refresh-icon--loading {
  animation: chat-refresh-spin 800ms linear infinite;
}

@keyframes chat-refresh-spin {
  to { transform: rotate(360deg); }
}

.clear-btn {
  --md-filled-button-container-color: var(--md-sys-color-error);
  --md-filled-button-label-text-color: var(--md-sys-color-on-error);
  --md-filled-button-with-icon-icon-color: var(--md-sys-color-on-error);
}

.chat-table {
  width: 100%;
  min-width: 900px;
  border-collapse: collapse;
  font-size: 14px;
}

.chat-table th,
.chat-table td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  vertical-align: top;
}

.chat-table th {
  color: var(--md-sys-color-on-surface-variant);
  font-weight: 500;
  font-size: 13px;
}

.cell-time {
  width: 170px;
  white-space: nowrap;
  color: var(--md-sys-color-on-surface-variant);
}

.cell-name {
  width: 160px;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.sender {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.sender-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.sender-badge--admin {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

.sender-badge--player {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.sender-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.compose-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: min(360px, calc(100vw - 72px));
}

.compose-identity {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  background: var(--md-sys-color-surface);
}

.compose-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.compose-avatar-fallback {
  --md-icon-size: 40px;
  color: var(--md-sys-color-on-surface-variant);
  flex-shrink: 0;
}

.compose-identity-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.compose-identity-name {
  font-size: 15px;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.compose-identity-hint {
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
}

.compose-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.compose-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
  color: var(--md-sys-color-on-surface-variant);
}

.compose-counter {
  font-size: 12px;
}

.compose-textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 4px;
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font: inherit;
  font-size: 15px;
  line-height: 1.5;
  resize: vertical;
  box-sizing: border-box;
}

.compose-textarea:focus {
  outline: none;
  border-color: var(--md-sys-color-primary);
  border-width: 2px;
}

.cell-content {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.cell-location {
  width: 150px;
  color: var(--md-sys-color-on-surface-variant);
  overflow-wrap: anywhere;
}

.cell-ip {
  width: 130px;
  white-space: nowrap;
}

.cell-ip code {
  font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
}

.cell-actions {
  width: 110px;
  white-space: nowrap;
}

.delete-btn {
  color: var(--md-sys-color-error);
}

.delete-text {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--md-sys-color-on-surface-variant);
}

.delete-preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border-radius: 8px;
  background: var(--md-sys-color-surface);
  min-width: min(300px, calc(100vw - 72px));
}

.delete-name {
  font-size: 15px;
  font-weight: 500;
}

.delete-sub {
  font-size: 13px;
  color: var(--md-sys-color-on-surface-variant);
}

.delete-body {
  margin-top: 4px;
  font-size: 14px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.delete-confirm {
  color: var(--md-sys-color-error);
}

.empty {
  margin: 16px 0 0;
  font-size: 14px;
  color: var(--md-sys-color-on-surface-variant);
}

@media (max-width: 640px) {
  .endpoint {
    align-items: flex-start;
    margin-bottom: 16px;
  }

  .endpoint-url {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .card-head {
    align-items: stretch;
    gap: 12px;
  }

  .head-actions {
    justify-content: space-between;
  }

  .head-actions .clear-btn {
    flex: 1;
    margin-left: 8px;
  }

  .chat-table th,
  .chat-table td {
    padding: 10px;
  }
}
</style>
