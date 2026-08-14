<script setup lang="ts">
import { ref, onMounted } from 'vue'

useHead({ title: '服务器动态' })

type ActivityType = 'info' | 'success' | 'warning' | 'error'

interface Activity {
  id: string
  type: ActivityType
  date: string
  content: string
}

const typeOptions: { value: ActivityType; label: string }[] = [
  { value: 'info', label: '信息' },
  { value: 'success', label: '完成' },
  { value: 'warning', label: '警报' },
  { value: 'error', label: '错误' },
]

const endpoint = '/api/activities'

const activities = ref<Activity[]>([])
const loading = ref(true)

// 添加 / 编辑 弹窗
const formOpen = ref(false)
const formMode = ref<'add' | 'edit'>('add')
const editingId = ref<string | null>(null)
const formType = ref<ActivityType>('info')
const formDate = ref('')
const formContent = ref('')
const submitting = ref(false)

// 删除 弹窗
const deleteOpen = ref(false)
const deleteTarget = ref<Activity | null>(null)
const deleting = ref(false)

// 弹窗元素引用（用于自定义缩放式淡入淡出动画）
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
    activities.value = await $fetch<Activity[]>(endpoint)
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '加载失败', 'error')
  } finally {
    loading.value = false
  }
}

function typeLabel(type: ActivityType) {
  return typeOptions.find((o) => o.value === type)?.label ?? type
}

function onTypeChange(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  if (v) formType.value = v as ActivityType
}

function openAdd() {
  formMode.value = 'add'
  editingId.value = null
  formType.value = 'info'
  formDate.value = ''
  formContent.value = ''
  formOpen.value = true
}

function openEdit(a: Activity) {
  formMode.value = 'edit'
  editingId.value = a.id
  formType.value = a.type
  formDate.value = a.date
  formContent.value = a.content
  formOpen.value = true
}

function openDelete(a: Activity) {
  deleteTarget.value = a
  deleteOpen.value = true
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

async function submitForm() {
  if (submitting.value) return
  if (!formDate.value) {
    showToast('请选择日期', 'error')
    return
  }
  if (!formContent.value.trim()) {
    showToast('请填写内容', 'error')
    return
  }
  submitting.value = true
  try {
    const payload = {
      type: formType.value,
      date: formDate.value,
      content: formContent.value.trim(),
    }
    if (formMode.value === 'add') {
      const item = await $fetch<Activity>(endpoint, { method: 'POST', body: payload })
      activities.value.unshift(item)
      showToast('已添加')
    } else {
      const updated = await $fetch<Activity>(`${endpoint}/${editingId.value}`, {
        method: 'PATCH',
        body: payload,
      })
      const idx = activities.value.findIndex((a) => a.id === updated.id)
      if (idx !== -1) activities.value[idx] = updated
      showToast('已保存')
    }
    formOpen.value = false
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '操作失败', 'error')
  } finally {
    submitting.value = false
  }
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (deleting.value || !target) return
  deleting.value = true
  try {
    await $fetch(`${endpoint}/${target.id}`, { method: 'DELETE' })
    activities.value = activities.value.filter((a) => a.id !== target.id)
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
    <h1 class="page-title">服务器动态</h1>

    <div class="endpoint">
      <span class="endpoint-label">数据 API：</span>
      <code class="endpoint-url">
        <a :href="endpoint" target="_blank" rel="noopener">GET {{ endpoint }}</a>
      </code>
    </div>

    <div class="card">
      <div class="card-head">
        <h2 class="card-title">动态列表</h2>
        <md-filled-button @click="openAdd">
          <md-icon slot="icon">add</md-icon>
          添加项目
        </md-filled-button>
      </div>

      <table class="activity-table">
        <thead>
          <tr>
            <th>类型</th>
            <th>日期</th>
            <th>内容</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in activities" :key="a.id">
            <td class="cell-type">
              <span class="badge" :class="`badge--${a.type}`">{{ typeLabel(a.type) }}</span>
            </td>
            <td class="cell-date">{{ a.date }}</td>
            <td class="cell-content">{{ a.content }}</td>
            <td class="cell-actions">
              <md-text-button @click="openEdit(a)">
                <md-icon slot="icon">edit</md-icon>
                编辑
              </md-text-button>
              <md-text-button class="delete-btn" @click="openDelete(a)">
                <md-icon slot="icon">delete</md-icon>
                删除
              </md-text-button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!loading && activities.length === 0" class="empty">暂无记录</p>
    </div>

    <md-dialog ref="formDialog" :open="formOpen" @closed="onFormClosed">
      <div slot="headline">{{ formMode === 'add' ? '添加项目' : '编辑项目' }}</div>
      <div slot="content">
        <div class="dialog-form">
          <md-outlined-select label="类型" @change="onTypeChange">
            <md-select-option
              v-for="o in typeOptions"
              :key="o.value"
              :value="o.value"
              :selected="o.value === formType"
            >
              <div slot="headline">{{ o.label }}</div>
            </md-select-option>
          </md-outlined-select>

          <input v-model="formDate" type="date" class="date-input" aria-label="日期" />

          <md-outlined-text-field
            label="内容"
            :value="formContent"
            @input="formContent = ($event.target as HTMLInputElement).value"
          ></md-outlined-text-field>
        </div>
      </div>
      <div slot="actions">
        <md-text-button @click="closeForm">取消</md-text-button>
        <md-filled-button :disabled="submitting" @click="submitForm">
          {{ formMode === 'add' ? '添加' : '保存' }}
        </md-filled-button>
      </div>
    </md-dialog>

    <md-dialog ref="deleteDialog" :open="deleteOpen" @closed="onDeleteClosed">
      <div slot="headline">删除项目</div>
      <div slot="content">
        <p class="delete-text">确定要删除这条记录吗？此操作无法撤销。</p>
        <div v-if="deleteTarget" class="delete-preview">
          <span class="badge" :class="`badge--${deleteTarget.type}`">{{ typeLabel(deleteTarget.type) }}</span>
          <span class="delete-date">{{ deleteTarget.date }}</span>
          <p class="delete-content">{{ deleteTarget.content }}</p>
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

.activity-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.activity-table th,
.activity-table td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  vertical-align: middle;
}

.activity-table th {
  color: var(--md-sys-color-on-surface-variant);
  font-weight: 500;
  font-size: 13px;
}

.cell-type {
  width: 100px;
  white-space: nowrap;
}

.cell-date {
  width: 130px;
  white-space: nowrap;
  color: var(--md-sys-color-on-surface-variant);
}

.cell-content {
  word-break: break-word;
}

.cell-actions {
  width: 200px;
  white-space: nowrap;
}

.delete-btn {
  color: var(--md-sys-color-error);
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.6;
}

.badge--info {
  background: rgba(26, 115, 232, 0.14);
  color: var(--act-info);
}

.badge--success {
  background: rgba(24, 128, 56, 0.14);
  color: var(--act-success);
}

.badge--warning {
  background: rgba(176, 96, 0, 0.16);
  color: var(--act-warning);
}

.badge--error {
  background: rgba(197, 34, 31, 0.14);
  color: var(--act-error);
}

.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 280px;
}

.dialog-form md-outlined-select,
.date-input {
  width: 100%;
}

.date-input {
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

.delete-text {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--md-sys-color-on-surface-variant);
}

.delete-preview {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-radius: 8px;
  background: var(--md-sys-color-surface);
}

.delete-date {
  font-size: 13px;
  color: var(--md-sys-color-on-surface-variant);
}

.delete-content {
  flex-basis: 100%;
  margin: 0;
  font-size: 14px;
  word-break: break-word;
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
