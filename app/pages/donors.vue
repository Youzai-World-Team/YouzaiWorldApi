<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'

useHead({ title: '捐赠列表' })

interface Donor {
  id: string
  avatar: string
  name: string
  intro: string
  amount: number
}

const endpoint = '/api/donors'
const access = useAdminAccess()
const canEdit = computed(() => access.levelForKey('donors') === 'edit')

const donors = ref<Donor[]>([])
const loading = ref(true)

// 添加 / 编辑弹窗
const formOpen = ref(false)
const formMode = ref<'add' | 'edit'>('add')
const editingId = ref<string | null>(null)
const formName = ref('')
const formIntro = ref('')
const formAvatar = ref('')
const formAmount = ref('')
const submitting = ref(false)
const uploadingAvatar = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

// 删除弹窗
const deleteOpen = ref(false)
const deleteTarget = ref<Donor | null>(null)
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
    donors.value = await $fetch<Donor[]>(endpoint)
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '加载失败', 'error')
  } finally {
    loading.value = false
  }
}

function openAdd() {
  formMode.value = 'add'
  editingId.value = null
  formName.value = ''
  formIntro.value = ''
  formAvatar.value = ''
  formAmount.value = ''
  formOpen.value = true
}

function openEdit(d: Donor) {
  formMode.value = 'edit'
  editingId.value = d.id
  formName.value = d.name
  formIntro.value = d.intro
  formAvatar.value = d.avatar
  formAmount.value = d.amount ? String(d.amount) : ''
  formOpen.value = true
}

function formatAmount(v: number | undefined | null): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return '¥0'
  const fixed = n.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
  return '¥' + fixed
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

function pickAvatar() {
  if (uploadingAvatar.value) return
  fileInput.value?.click()
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    input.value = ''
    return
  }
  if (!file.type.startsWith('image/')) {
    showToast('请选择图片文件', 'error')
    input.value = ''
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('图片过大（最大 5MB）', 'error')
    input.value = ''
    return
  }
  uploadingAvatar.value = true
  try {
    const form = new FormData()
    form.append('file', file)
    const res = await $fetch<{ url: string }>('/api/upload', { method: 'POST', body: form })
    formAvatar.value = res.url
    showToast('头像已上传')
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '头像上传失败', 'error')
  } finally {
    uploadingAvatar.value = false
    input.value = ''
  }
}

async function submitForm() {
  if (submitting.value || uploadingAvatar.value) return
  if (!formName.value.trim()) {
    showToast('请填写名称', 'error')
    return
  }
  submitting.value = true
  try {
    const payload = {
      avatar: formAvatar.value,
      name: formName.value.trim(),
      intro: formIntro.value.trim(),
      amount: Number(formAmount.value) || 0,
    }
    if (formMode.value === 'add') {
      const donor = await $fetch<Donor>(endpoint, { method: 'POST', body: payload })
      donors.value.unshift(donor)
      showToast('已添加')
    } else {
      const updated = await $fetch<Donor>(`${endpoint}/${editingId.value}`, { method: 'PATCH', body: payload })
      const idx = donors.value.findIndex((d) => d.id === updated.id)
      if (idx !== -1) donors.value[idx] = updated
      showToast('已保存')
    }
    formOpen.value = false
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '操作失败', 'error')
  } finally {
    submitting.value = false
  }
}

function openDelete(d: Donor) {
  deleteTarget.value = d
  deleteOpen.value = true
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (deleting.value || !target) return
  deleting.value = true
  try {
    await $fetch(`${endpoint}/${target.id}`, { method: 'DELETE' })
    donors.value = donors.value.filter((d) => d.id !== target.id)
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
    <h1 class="page-title">捐赠列表</h1>

    <div class="endpoint">
      <span class="endpoint-label">数据 API：</span>
      <code class="endpoint-url">
        <a :href="endpoint" target="_blank" rel="noopener">GET {{ endpoint }}</a>
      </code>
    </div>

    <div class="card">
      <div class="card-head">
        <h2 class="card-title">捐赠者列表</h2>
        <md-filled-button v-if="canEdit" @click="openAdd">
          <md-icon slot="icon">add</md-icon>
          添加捐赠者
        </md-filled-button>
      </div>

      <div class="table-wrap">
        <table class="donor-table">
        <thead>
          <tr>
            <th>头像</th>
            <th>名称</th>
            <th>金额</th>
            <th>介绍</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in donors" :key="d.id">
            <td class="cell-avatar">
              <div class="avatar">
                <img v-if="d.avatar" :src="d.avatar" alt="" />
                <md-icon v-else>person</md-icon>
              </div>
            </td>
            <td class="cell-name">{{ d.name }}</td>
            <td class="cell-amount">{{ formatAmount(d.amount) }}</td>
            <td class="cell-intro">{{ d.intro || '—' }}</td>
            <td class="cell-actions">
              <md-text-button v-if="canEdit" @click="openEdit(d)">
                <md-icon slot="icon">edit</md-icon>
                编辑
              </md-text-button>
              <md-text-button v-if="canEdit" class="delete-btn" @click="openDelete(d)">
                <md-icon slot="icon">delete</md-icon>
                删除
              </md-text-button>
            </td>
          </tr>
        </tbody>
        </table>
      </div>
      <p v-if="loading" class="empty">加载中…</p>
      <p v-else-if="donors.length === 0" class="empty">暂无捐赠者</p>
    </div>

    <md-dialog ref="formDialog" :open="formOpen" @closed="onFormClosed">
      <div slot="headline">{{ formMode === 'add' ? '添加捐赠者' : '编辑捐赠者' }}</div>
      <div slot="content">
        <div class="dialog-form">
          <div class="avatar-picker" role="button" tabindex="0" @click="pickAvatar" @keydown.enter="pickAvatar">
            <img v-if="formAvatar" :src="formAvatar" alt="头像" />
            <md-icon v-else>{{ uploadingAvatar ? 'hourglass_empty' : 'add_a_photo' }}</md-icon>
            <span v-if="uploadingAvatar" class="avatar-uploading">上传中…</span>
          </div>
          <md-text-button class="avatar-btn" :disabled="uploadingAvatar" @click="pickAvatar">
            {{ formAvatar ? '重新上传头像' : '上传头像' }}
          </md-text-button>

          <md-outlined-text-field
            label="名称"
            :value="formName"
            @input="formName = ($event.target as HTMLInputElement).value"
          ></md-outlined-text-field>

          <md-outlined-text-field
            type="number"
            label="金额（元）"
            :value="formAmount"
            @input="formAmount = ($event.target as HTMLInputElement).value"
          ></md-outlined-text-field>

          <md-outlined-text-field
            label="介绍（可选）"
            :value="formIntro"
            @input="formIntro = ($event.target as HTMLInputElement).value"
          ></md-outlined-text-field>
        </div>
        <input ref="fileInput" type="file" accept="image/*" class="hidden-input" @change="onFileChange" />
      </div>
      <div slot="actions">
        <md-text-button @click="closeForm">取消</md-text-button>
        <md-filled-button :disabled="submitting || uploadingAvatar" @click="submitForm">
          {{ formMode === 'add' ? (submitting ? '添加中…' : '添加') : (submitting ? '保存中…' : '保存') }}
        </md-filled-button>
      </div>
    </md-dialog>

    <md-dialog ref="deleteDialog" :open="deleteOpen" @closed="onDeleteClosed">
      <div slot="headline">删除捐赠者</div>
      <div slot="content">
        <p class="delete-text">确定要删除这位捐赠者吗？此操作无法撤销。</p>
        <div v-if="deleteTarget" class="delete-preview">
          <div class="avatar">
            <img v-if="deleteTarget.avatar" :src="deleteTarget.avatar" alt="" />
            <md-icon v-else>person</md-icon>
          </div>
          <span class="delete-name">{{ deleteTarget.name }}</span>
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
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 16px;
}

.card-head .card-title {
  margin: 0;
}

.donor-table {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
  font-size: 14px;
}

.donor-table th,
.donor-table td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  vertical-align: middle;
}

.donor-table th {
  color: var(--md-sys-color-on-surface-variant);
  font-weight: 500;
  font-size: 13px;
}

.cell-avatar {
  width: 64px;
}

.cell-name {
  width: 180px;
  font-weight: 500;
  white-space: nowrap;
}

.cell-amount {
  width: 120px;
  white-space: nowrap;
}

.cell-intro {
  word-break: break-word;
  color: var(--md-sys-color-on-surface-variant);
}

.cell-actions {
  width: 200px;
  white-space: nowrap;
}

.delete-btn {
  color: var(--md-sys-color-error);
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
  flex-shrink: 0;
}

.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.delete-btn md-icon {
  --md-icon-size: 18px;
}

.dialog-form {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  min-width: min(300px, calc(100vw - 72px));
}

.dialog-form md-outlined-text-field {
  width: 100%;
}

.avatar-picker {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  border: 2px dashed var(--md-sys-color-outline);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: pointer;
  color: var(--md-sys-color-on-surface-variant);
  position: relative;
  background: var(--md-sys-color-surface-container-high);
}

.avatar-picker:hover {
  border-color: var(--md-sys-color-primary);
}

.avatar-picker md-icon {
  --md-icon-size: 32px;
}

.avatar-picker img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-uploading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  background: var(--md-sys-color-scrim, rgba(0, 0, 0, 0.4));
  color: #fff;
  border-radius: 50%;
}

.hidden-input {
  display: none;
}

.delete-text {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--md-sys-color-on-surface-variant);
}

.delete-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  background: var(--md-sys-color-surface);
}

.delete-name {
  font-size: 15px;
  font-weight: 500;
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

  .card-head md-filled-button {
    width: 100%;
  }

  .donor-table th,
  .donor-table td {
    padding: 10px;
  }
}
</style>
