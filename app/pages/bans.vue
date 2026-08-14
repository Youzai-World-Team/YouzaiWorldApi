<script setup lang="ts">
import { ref, onMounted } from 'vue'

useHead({ title: '封禁列表' })

interface Ban {
  id: string
  player: string
  banTime: string
  unbanTime: string // 'permanent' 表示永久封禁
  reason: string
}

const endpoint = '/api/bans'

const bans = ref<Ban[]>([])
const loading = ref(true)

// 添加 / 编辑弹窗
const formOpen = ref(false)
const formMode = ref<'add' | 'edit'>('add')
const editingId = ref<string | null>(null)
const formPlayer = ref('')
const formBanTime = ref('')
const formPermanent = ref(false)
const formUnbanTime = ref('')
const formReason = ref('')
const submitting = ref(false)

// 删除弹窗
const deleteOpen = ref(false)
const deleteTarget = ref<Ban | null>(null)
const deleting = ref(false)

// 弹窗元素引用（缩放式淡入淡出动画）
const formDialog = ref<HTMLElement | null>(null)
const deleteDialog = ref<HTMLElement | null>(null)

const { showToast } = useToast()
const { apply: applyDialogAnimation } = useDialogAnimation()

onMounted(() => {
  load()
  applyDialogAnimation(formDialog.value)
  applyDialogAnimation(deleteDialog.value)
})

async function load() {
  loading.value = true
  try {
    bans.value = await $fetch<Ban[]>(endpoint)
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '加载失败', 'error')
  } finally {
    loading.value = false
  }
}

function openAdd() {
  formMode.value = 'add'
  editingId.value = null
  formPlayer.value = ''
  formBanTime.value = ''
  formPermanent.value = false
  formUnbanTime.value = ''
  formReason.value = ''
  formOpen.value = true
}

function openEdit(b: Ban) {
  formMode.value = 'edit'
  editingId.value = b.id
  formPlayer.value = b.player
  formBanTime.value = b.banTime
  if (b.unbanTime === 'permanent') {
    formPermanent.value = true
    formUnbanTime.value = ''
  } else {
    formPermanent.value = false
    formUnbanTime.value = b.unbanTime
  }
  formReason.value = b.reason
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
}

function closeDelete() {
  deleteOpen.value = false
}

function onFormClosed() {
  formOpen.value = false
}

function onDeleteClosed() {
  deleteOpen.value = false
}

function onPermanentChange(e: Event) {
  formPermanent.value = (e.target as any).checked
}

function unbanLabel(b: Ban) {
  return b.unbanTime === 'permanent' ? '永久' : b.unbanTime
}

async function submitForm() {
  if (submitting.value) return
  if (!formPlayer.value.trim()) {
    showToast('请填写玩家名', 'error')
    return
  }
  if (!formBanTime.value) {
    showToast('请选择封禁时间', 'error')
    return
  }
  if (!formPermanent.value && !formUnbanTime.value) {
    showToast('请选择解封时间', 'error')
    return
  }
  submitting.value = true
  try {
    const unbanTime = formPermanent.value ? 'permanent' : formUnbanTime.value
    const payload = {
      player: formPlayer.value.trim(),
      banTime: formBanTime.value,
      unbanTime,
      reason: formReason.value.trim(),
    }
    if (formMode.value === 'add') {
      const ban = await $fetch<Ban>(endpoint, { method: 'POST', body: payload })
      bans.value.unshift(ban)
      showToast('已添加')
    } else {
      const updated = await $fetch<Ban>(`${endpoint}/${editingId.value}`, { method: 'PATCH', body: payload })
      const idx = bans.value.findIndex((b) => b.id === updated.id)
      if (idx !== -1) bans.value[idx] = updated
      showToast('已保存')
    }
    formOpen.value = false
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '操作失败', 'error')
  } finally {
    submitting.value = false
  }
}

function openDelete(b: Ban) {
  deleteTarget.value = b
  deleteOpen.value = true
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (deleting.value || !target) return
  deleting.value = true
  try {
    await $fetch(`${endpoint}/${target.id}`, { method: 'DELETE' })
    bans.value = bans.value.filter((b) => b.id !== target.id)
    deleteOpen.value = false
    showToast('已删除')
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '删除失败', 'error')
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="page">
    <h1 class="page-title">封禁列表</h1>

    <div class="endpoint">
      <span class="endpoint-label">数据 API：</span>
      <code class="endpoint-url">
        <a :href="endpoint" target="_blank" rel="noopener">GET {{ endpoint }}</a>
      </code>
    </div>

    <div class="card">
      <div class="card-head">
        <h2 class="card-title">封禁记录</h2>
        <md-filled-button @click="openAdd">
          <md-icon slot="icon">add</md-icon>
          添加封禁
        </md-filled-button>
      </div>

      <table class="ban-table">
        <thead>
          <tr>
            <th>玩家名</th>
            <th>封禁时间</th>
            <th>解封时间</th>
            <th>原因</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in bans" :key="b.id">
            <td class="cell-player">{{ b.player }}</td>
            <td class="cell-ban">{{ b.banTime }}</td>
            <td class="cell-unban">
              <span v-if="b.unbanTime === 'permanent'" class="permanent-badge">永久</span>
              <span v-else>{{ b.unbanTime }}</span>
            </td>
            <td class="cell-reason">{{ b.reason || '—' }}</td>
            <td class="cell-actions">
              <md-text-button @click="openEdit(b)">
                <md-icon slot="icon">edit</md-icon>
                编辑
              </md-text-button>
              <md-text-button class="delete-btn" @click="openDelete(b)">
                <md-icon slot="icon">delete</md-icon>
                删除
              </md-text-button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!loading && bans.length === 0" class="empty">暂无封禁记录</p>
    </div>

    <md-dialog ref="formDialog" :open="formOpen" @closed="onFormClosed">
      <div slot="headline">{{ formMode === 'add' ? '添加封禁' : '编辑封禁' }}</div>
      <div slot="content">
        <div class="dialog-form">
          <md-outlined-text-field
            label="玩家名"
            :value="formPlayer"
            @input="formPlayer = ($event.target as HTMLInputElement).value"
          ></md-outlined-text-field>

          <div class="field-group">
            <label class="field-label">封禁时间</label>
            <input v-model="formBanTime" type="date" class="date-input" />
          </div>

          <label class="permanent-row">
            <md-checkbox :checked="formPermanent" @change="onPermanentChange"></md-checkbox>
            <span>永久封禁</span>
          </label>

          <div v-if="!formPermanent" class="field-group">
            <label class="field-label">解封时间</label>
            <input v-model="formUnbanTime" type="date" class="date-input" />
          </div>

          <md-outlined-text-field
            label="原因（可选）"
            :value="formReason"
            @input="formReason = ($event.target as HTMLInputElement).value"
          ></md-outlined-text-field>
        </div>
      </div>
      <div slot="actions">
        <md-text-button @click="closeForm">取消</md-text-button>
        <md-filled-button :disabled="submitting" @click="submitForm">
          {{ formMode === 'add' ? (submitting ? '添加中…' : '添加') : (submitting ? '保存中…' : '保存') }}
        </md-filled-button>
      </div>
    </md-dialog>

    <md-dialog ref="deleteDialog" :open="deleteOpen" @closed="onDeleteClosed">
      <div slot="headline">删除封禁记录</div>
      <div slot="content">
        <p class="delete-text">确定要删除这条封禁记录吗？此操作无法撤销。</p>
        <div v-if="deleteTarget" class="delete-preview">
          <span class="delete-name">{{ deleteTarget.player }}</span>
          <span class="delete-sub">{{ deleteTarget.banTime }} → {{ unbanLabel(deleteTarget) }}</span>
        </div>
      </div>
      <div slot="actions">
        <md-text-button @click="closeDelete">取消</md-text-button>
        <md-text-button class="delete-confirm" :disabled="deleting" @click="confirmDelete">
          {{ deleting ? '删除中…' : '删除' }}
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
  gap: 16px;
  margin-bottom: 16px;
}

.card-head .card-title {
  margin: 0;
}

.ban-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.ban-table th,
.ban-table td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  vertical-align: middle;
}

.ban-table th {
  color: var(--md-sys-color-on-surface-variant);
  font-weight: 500;
  font-size: 13px;
}

.cell-player {
  width: 200px;
  font-weight: 500;
  white-space: nowrap;
}

.cell-ban {
  width: 150px;
  white-space: nowrap;
  color: var(--md-sys-color-on-surface-variant);
}

.cell-unban {
  width: 140px;
  white-space: nowrap;
}

.cell-reason {
  word-break: break-word;
  color: var(--md-sys-color-on-surface-variant);
}

.cell-actions {
  width: 200px;
  white-space: nowrap;
}

.permanent-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  background: rgba(197, 34, 31, 0.14);
  color: var(--act-error);
}

.delete-btn {
  color: var(--md-sys-color-error);
}

.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 300px;
}

.dialog-form md-outlined-text-field {
  width: 100%;
}

.field-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
}

.field-label {
  font-size: 13px;
  color: var(--md-sys-color-on-surface-variant);
}

.date-input {
  width: 100%;
  height: 56px;
  padding: 0 12px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 4px;
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font: inherit;
  font-size: 15px;
  box-sizing: border-box;
}

.date-input:focus {
  outline: none;
  border-color: var(--md-sys-color-primary);
  border-width: 2px;
}

.permanent-row {
  display: flex;
  align-items: center;
  gap: 8px;
  align-self: flex-start;
  font-size: 14px;
  color: var(--md-sys-color-on-surface);
  cursor: pointer;
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
}

.delete-name {
  font-size: 15px;
  font-weight: 500;
}

.delete-sub {
  font-size: 13px;
  color: var(--md-sys-color-on-surface-variant);
}

.delete-confirm {
  color: var(--md-sys-color-error);
}

.empty {
  margin: 16px 0 0;
  font-size: 14px;
  color: var(--md-sys-color-on-surface-variant);
}
</style>