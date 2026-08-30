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

const totalAmount = computed(() => donors.value.reduce((total, donor) => {
  const amount = Number(donor.amount)
  return total + (Number.isFinite(amount) ? amount : 0)
}, 0))
const donorWithLargestAmount = computed(() => donors.value.reduce<Donor | null>((top, donor) => {
  if (!top || Number(donor.amount) > Number(top.amount)) return donor
  return top
}, null))
const donorIntroCount = computed(() => donors.value.filter((donor) => donor.intro).length)

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
    form.append('purpose', 'donor-avatar')
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
  <div class="page page--wide catalog-page donors-page">
    <header class="catalog-header">
      <div class="catalog-title-block">
        <span class="catalog-eyebrow"><md-icon>volunteer_activism</md-icon>社区支持</span>
        <h1 class="page-title">捐赠列表</h1>
        <p>整理支持者展示信息，记录每一份对服务器的帮助。</p>
      </div>
      <div class="catalog-header-actions">
        <md-icon-button :href="endpoint" target="_blank" rel="noopener" aria-label="打开数据 API" title="打开数据 API"><md-icon>link</md-icon></md-icon-button>
        <md-filled-button v-if="canEdit" @click="openAdd"><md-icon slot="icon">add</md-icon>添加捐赠者</md-filled-button>
      </div>
    </header>
    <div class="catalog-summary" aria-label="捐赠列表概览">
      <article class="summary-item summary-item--primary"><span class="summary-icon"><md-icon>groups</md-icon></span><div><strong>{{ donors.length }}</strong><span>支持者</span></div></article>
      <article class="summary-item summary-item--success"><span class="summary-icon"><md-icon>volunteer_activism</md-icon></span><div><strong>{{ formatAmount(totalAmount) }}</strong><span>累计金额</span></div></article>
      <article class="summary-item summary-item--info"><span class="summary-icon"><md-icon>workspace_premium</md-icon></span><div><strong class="summary-value-text">{{ donorWithLargestAmount?.name || '暂无' }}</strong><span>最高金额支持者</span></div></article>
      <article class="summary-item summary-item--neutral"><span class="summary-icon"><md-icon>public</md-icon></span><div><strong>{{ donorIntroCount }}</strong><span>含介绍</span></div></article>
    </div>

    <section class="card catalog-card">
      <div class="card-head">
        <div><span class="section-overline">公开展示目录</span><h2 class="card-title">捐赠者列表</h2></div>
        <span class="card-caption">{{ donors.length }} 位支持者</span>
      </div>

      <div class="table-wrap">
        <table class="donor-table">
        <thead>
          <tr>
            <th>头像</th>
            <th>名称</th>
            <th>金额</th>
            <th>介绍</th>
            <th class="cell-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in donors" :key="d.id">
            <td class="cell-avatar" data-label="头像">
              <div class="avatar">
                <img v-if="d.avatar" :src="d.avatar" alt="" />
                <md-icon v-else>person</md-icon>
              </div>
            </td>
            <td class="cell-name" data-label="名称">{{ d.name }}</td>
            <td class="cell-amount" data-label="金额">{{ formatAmount(d.amount) }}</td>
            <td class="cell-intro" data-label="介绍">{{ d.intro || '—' }}</td>
            <td class="cell-actions" data-label="操作">
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
    </section>

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
.catalog-page { width: min(100%, 1320px); }
.catalog-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 22px; padding-bottom: 20px; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
.catalog-title-block { min-width: 0; }
.catalog-eyebrow, .section-overline { display: inline-flex; align-items: center; gap: 6px; color: var(--md-sys-color-primary); font-size: 11px; font-weight: 700; }
.catalog-eyebrow md-icon { --md-icon-size: 16px; }
.catalog-title-block .page-title { margin: 6px 0 5px; }
.catalog-title-block p { max-width: 620px; margin: 0; color: var(--md-sys-color-on-surface-variant); font-size: 13px; }
.catalog-header-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex: 0 0 auto; }
.catalog-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
.summary-item { min-width: 0; min-height: 76px; display: flex; align-items: center; gap: 12px; padding: 14px 16px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 8px; background: var(--md-sys-color-surface-container); }
.summary-item > div { min-width: 0; display: grid; gap: 3px; }
.summary-item strong { overflow: hidden; font-size: 20px; line-height: 1.1; text-overflow: ellipsis; white-space: nowrap; }
.summary-item span:not(.summary-icon) { color: var(--md-sys-color-on-surface-variant); font-size: 11px; }
.summary-value-text { font-size: 13px !important; }
.summary-icon { width: 36px; height: 36px; display: grid; place-items: center; flex: 0 0 36px; border-radius: 8px; color: var(--md-sys-color-primary); background: var(--md-sys-color-primary-container); }
.summary-icon md-icon { --md-icon-size: 20px; }
.summary-item--danger .summary-icon { color: var(--act-error); background: color-mix(in srgb, var(--act-error) 11%, transparent); }
.summary-item--warning .summary-icon { color: var(--act-warning); background: color-mix(in srgb, var(--act-warning) 11%, transparent); }
.summary-item--info .summary-icon { color: var(--act-info); background: color-mix(in srgb, var(--act-info) 11%, transparent); }
.summary-item--success .summary-icon { color: var(--act-success); background: color-mix(in srgb, var(--act-success) 11%, transparent); }
.summary-item--neutral .summary-icon { color: var(--md-sys-color-on-surface-variant); background: var(--md-sys-color-surface-container-high); }
.catalog-card { padding: 0; overflow: hidden; border: 1px solid var(--md-sys-color-outline-variant); box-shadow: var(--md-sys-elevation-level1); }

.card-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin: 0;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}

.card-head > div { min-width: 0; display: grid; gap: 4px; }
.card-head .card-title { margin: 0; }
.card-caption { color: var(--md-sys-color-on-surface-variant); font-size: 11px; }
.table-wrap { overflow-x: auto; padding: 0 20px 12px; }

.donor-table {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
  font-size: 14px;
}

.donor-table th,
.donor-table td {
  padding: 13px 10px;
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
  min-height: 120px;
  display: grid;
  place-items: center;
  align-content: center;
  margin: 0;
  padding: 28px 20px 32px;
  font-size: 13px;
  color: var(--md-sys-color-on-surface-variant);
  text-align: center;
}

.donor-table tbody tr { transition: background-color 160ms ease; }
.donor-table tbody tr:hover { background: color-mix(in srgb, var(--md-sys-color-primary) 4%, transparent); }

@media (max-width: 640px) {
  .catalog-header { align-items: stretch; flex-direction: column; gap: 16px; }
  .catalog-header-actions { justify-content: flex-start; }
  .catalog-header-actions md-filled-button { flex: 1; }
  .catalog-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .catalog-card .card-head { align-items: flex-start; }
  .table-wrap { overflow: visible; padding: 0 16px 10px; }
  .donor-table, .donor-table tbody, .donor-table tr, .donor-table td { display: block; width: auto; min-width: 0; }
  .donor-table thead { display: none; }
  .donor-table tr { padding: 10px 0; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
  .donor-table tr:last-child { border-bottom: 0; }
  .donor-table td { display: grid; grid-template-columns: minmax(64px, 0.3fr) minmax(0, 1fr); gap: 12px; align-items: center; width: auto; padding: 7px 0; border: 0; }
  .donor-table td::before { content: attr(data-label); color: var(--md-sys-color-on-surface-variant); font-size: 11px; font-weight: 600; }
  .donor-table .cell-actions { display: flex; justify-content: flex-end; gap: 4px; padding-top: 10px; }
  .donor-table .cell-actions::before { content: none; }
  .donor-table .cell-intro { overflow-wrap: anywhere; }
}
</style>
