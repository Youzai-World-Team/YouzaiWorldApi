<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'

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
const access = useAdminAccess()
const canEdit = computed(() => access.levelForKey('activity') === 'edit')

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

const completedCount = computed(() => activities.value.filter((activity) => activity.type === 'success').length)
const alertCount = computed(() => activities.value.filter((activity) => activity.type === 'warning' || activity.type === 'error').length)
const latestActivityDate = computed(() => activities.value[0]?.date || '暂无日期')

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
  <div class="page page--wide catalog-page activity-page">
    <header class="catalog-header">
      <div class="catalog-title-block">
        <span class="catalog-eyebrow"><md-icon>campaign</md-icon>内容发布</span>
        <h1 class="page-title">服务器动态</h1>
        <p>发布服务器公告、活动进展和需要玩家关注的最新消息。</p>
      </div>
      <div class="catalog-header-actions">
        <md-icon-button :href="endpoint" target="_blank" rel="noopener" aria-label="打开数据 API" title="打开数据 API"><md-icon>link</md-icon></md-icon-button>
        <md-filled-button v-if="canEdit" @click="openAdd"><md-icon slot="icon">add</md-icon>添加动态</md-filled-button>
      </div>
    </header>
    <div class="catalog-summary" aria-label="服务器动态概览">
      <article class="summary-item summary-item--primary"><span class="summary-icon"><md-icon>campaign</md-icon></span><div><strong>{{ activities.length }}</strong><span>动态总数</span></div></article>
      <article class="summary-item summary-item--success"><span class="summary-icon"><md-icon>task_alt</md-icon></span><div><strong>{{ completedCount }}</strong><span>完成消息</span></div></article>
      <article class="summary-item summary-item--warning"><span class="summary-icon"><md-icon>notifications_active</md-icon></span><div><strong>{{ alertCount }}</strong><span>提醒消息</span></div></article>
      <article class="summary-item summary-item--neutral"><span class="summary-icon"><md-icon>event</md-icon></span><div><strong>{{ latestActivityDate }}</strong><span>最近发布日期</span></div></article>
    </div>

    <section class="card catalog-card">
      <div class="card-head">
        <div><span class="section-overline">官网内容</span><h2 class="card-title">动态列表</h2></div>
        <span class="card-caption">{{ activities.length }} 条动态</span>
      </div>

      <div class="table-wrap">
        <table class="activity-table">
        <thead>
          <tr>
            <th>类型</th>
            <th>日期</th>
            <th>内容</th>
            <th class="cell-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in activities" :key="a.id">
            <td class="cell-type" data-label="类型">
              <span class="badge" :class="`badge--${a.type}`">{{ typeLabel(a.type) }}</span>
            </td>
            <td class="cell-date" data-label="日期">{{ a.date }}</td>
            <td class="cell-content" data-label="内容">{{ a.content }}</td>
            <td class="cell-actions" data-label="操作">
              <md-text-button v-if="canEdit" @click="openEdit(a)">
                <md-icon slot="icon">edit</md-icon>
                编辑
              </md-text-button>
              <md-text-button v-if="canEdit" class="delete-btn" @click="openDelete(a)">
                <md-icon slot="icon">delete</md-icon>
                删除
              </md-text-button>
            </td>
          </tr>
        </tbody>
        </table>
      </div>
      <EmptyState v-if="loading" :illustrated="false">加载中…</EmptyState>
      <EmptyState v-else-if="activities.length === 0">暂无记录</EmptyState>
    </section>

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

.activity-table {
  width: 100%;
  min-width: 620px;
  border-collapse: collapse;
  font-size: 14px;
}

.activity-table th,
.activity-table td {
  padding: 13px 10px;
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
  background: color-mix(in srgb, var(--act-info) 14%, transparent);
  color: var(--act-info);
}

.badge--success {
  background: color-mix(in srgb, var(--act-success) 14%, transparent);
  color: var(--act-success);
}

.badge--warning {
  background: color-mix(in srgb, var(--act-warning) 16%, transparent);
  color: var(--act-warning);
}

.badge--error {
  background: color-mix(in srgb, var(--act-error) 14%, transparent);
  color: var(--act-error);
}

.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: min(280px, calc(100vw - 72px));
}

.dialog-form md-outlined-select,
.date-input {
  width: 100%;
}

.date-input {
  height: var(--app-field-height);
  padding: 0 12px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-extra-small);
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

.activity-table tbody tr { transition: background-color 160ms ease; }
.activity-table tbody tr:hover { background: color-mix(in srgb, var(--md-sys-color-primary) 4%, transparent); }

@media (max-width: 640px) {
  .catalog-header { align-items: stretch; flex-direction: column; gap: 16px; }
  .catalog-header-actions { justify-content: flex-start; }
  .catalog-header-actions md-filled-button { flex: 1; }
  .catalog-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .catalog-card .card-head { align-items: flex-start; }
  .table-wrap { overflow: visible; padding: 0 16px 10px; }
  .activity-table, .activity-table tbody, .activity-table tr, .activity-table td { display: block; width: auto; min-width: 0; }
  .activity-table thead { display: none; }
  .activity-table tr { padding: 10px 0; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
  .activity-table tr:last-child { border-bottom: 0; }
  .activity-table td { display: grid; grid-template-columns: minmax(64px, 0.3fr) minmax(0, 1fr); gap: 12px; align-items: start; padding: 7px 0; border: 0; }
  .activity-table td::before { content: attr(data-label); color: var(--md-sys-color-on-surface-variant); font-size: 11px; font-weight: 600; }
  .activity-table .cell-actions { display: flex; justify-content: flex-end; gap: 4px; padding-top: 10px; }
  .activity-table .cell-actions::before { content: none; }
  .activity-table .cell-content { overflow-wrap: anywhere; }
}
</style>
