<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

useHead({ title: '下载项目' })

interface DownloadProject {
  id: string
  type: '整合包' | '模组'
  name: string
  url: string
  version: string
  description: string
  createdAt: number
  updatedAt: number
}

const endpoint = '/api/downloads'
const list = ref<DownloadProject[]>([])
const access = useAdminAccess()
const canEdit = computed(() => access.levelForKey('downloads') === 'edit')
const loading = ref(true)
const submitting = ref(false)
const deleting = ref(false)
const formOpen = ref(false)
const deleteOpen = ref(false)
const editingId = ref<string | null>(null)
const deleteTarget = ref<DownloadProject | null>(null)
const formType = ref<DownloadProject['type']>('整合包')
const formName = ref('')
const formUrl = ref('')
const formVersion = ref('')
const formDescription = ref('')
const { showToast } = useToast()
const formDialog = ref<HTMLElement | null>(null)
const deleteDialog = ref<HTMLElement | null>(null)
const { apply: applyDialogAnimation } = useDialogAnimation()

const packageCount = computed(() => list.value.filter((item) => item.type === '整合包').length)
const modCount = computed(() => list.value.filter((item) => item.type === '模组').length)
const latestVersion = computed(() => list.value[0]?.version || '暂无版本')

onMounted(async () => {
  await load()
  applyDialogAnimation(formDialog.value)
  applyDialogAnimation(deleteDialog.value)
})

async function load() {
  loading.value = true
  try { list.value = await $fetch<DownloadProject[]>(endpoint) }
  catch (e: any) { showToast(e?.data?.statusMessage || '加载失败', 'error') }
  finally { loading.value = false }
}

function resetForm() {
  editingId.value = null
  formType.value = '整合包'
  formName.value = ''
  formUrl.value = ''
  formVersion.value = ''
  formDescription.value = ''
}

function openAdd() { resetForm(); formOpen.value = true }
function openEdit(item: DownloadProject) {
  editingId.value = item.id
  formType.value = item.type
  formName.value = item.name
  formUrl.value = item.url
  formVersion.value = item.version
  formDescription.value = item.description
  formOpen.value = true
}
function openDelete(item: DownloadProject) { deleteTarget.value = item; deleteOpen.value = true }
function closeForm() { formOpen.value = false }
function closeDelete() { deleteOpen.value = false }
function onFormClosed() { formOpen.value = false }
function onDeleteClosed() { deleteOpen.value = false }
function onTypeChange(e: Event) { formType.value = (e.target as HTMLInputElement).value as DownloadProject['type'] }

async function submitForm() {
  if (submitting.value) return
  if (!formName.value.trim() || !formUrl.value.trim() || !formVersion.value.trim() || !formDescription.value.trim()) {
    showToast('请完整填写名称、下载地址、当前版本和描述', 'error'); return
  }
  try {
    const parsed = new URL(formUrl.value.trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error()
  } catch { showToast('下载地址必须是有效的 http 或 https 地址', 'error'); return }
  submitting.value = true
  try {
    const body = { type: formType.value, name: formName.value.trim(), url: formUrl.value.trim(), version: formVersion.value.trim(), description: formDescription.value.trim() }
    if (editingId.value) {
      const updated = await $fetch<DownloadProject>(`${endpoint}/${editingId.value}`, { method: 'PATCH', body })
      const index = list.value.findIndex((item) => item.id === updated.id)
      if (index >= 0) list.value[index] = updated
      showToast('已保存')
    } else {
      const created = await $fetch<DownloadProject>(endpoint, { method: 'POST', body })
      list.value.unshift(created); showToast('已添加')
    }
    formOpen.value = false
  } catch (e: any) { showToast(e?.data?.statusMessage || '操作失败', 'error') }
  finally { submitting.value = false }
}

async function confirmDelete() {
  if (deleting.value || !deleteTarget.value) return
  deleting.value = true
  try {
    await $fetch(`${endpoint}/${deleteTarget.value.id}`, { method: 'DELETE' })
    list.value = list.value.filter((item) => item.id !== deleteTarget.value?.id)
    deleteOpen.value = false; showToast('已删除')
  } catch (e: any) { showToast(e?.data?.statusMessage || '删除失败', 'error') }
  finally { deleting.value = false }
}
</script>

<template>
  <div class="page page--wide catalog-page downloads-page">
    <header class="catalog-header">
      <div class="catalog-title-block">
        <span class="catalog-eyebrow"><md-icon>download</md-icon>资源分发</span>
        <h1 class="page-title">下载项目</h1>
        <p>维护官网展示的整合包、模组和对应下载地址。</p>
      </div>
      <div class="catalog-header-actions">
        <md-icon-button :href="endpoint" target="_blank" rel="noopener" aria-label="打开数据 API" title="打开数据 API"><md-icon>link</md-icon></md-icon-button>
        <md-filled-button v-if="canEdit" @click="openAdd"><md-icon slot="icon">add</md-icon>添加项目</md-filled-button>
      </div>
    </header>
    <div class="catalog-summary" aria-label="下载服务概览">
      <article class="summary-item summary-item--primary"><span class="summary-icon"><md-icon>download</md-icon></span><div><strong>{{ list.length }}</strong><span>下载项目</span></div></article>
      <article class="summary-item summary-item--info"><span class="summary-icon"><md-icon>inventory_2</md-icon></span><div><strong>{{ packageCount }}</strong><span>整合包</span></div></article>
      <article class="summary-item summary-item--success"><span class="summary-icon"><md-icon>extension</md-icon></span><div><strong>{{ modCount }}</strong><span>模组</span></div></article>
      <article class="summary-item summary-item--neutral"><span class="summary-icon"><md-icon>new_releases</md-icon></span><div><strong>{{ latestVersion }}</strong><span>最新版本</span></div></article>
    </div>
    <section class="card catalog-card">
      <div class="card-head">
        <div><span class="section-overline">公开下载目录</span><h2 class="card-title">下载项目</h2></div>
        <span class="card-caption">{{ list.length }} 个项目</span>
      </div>
      <div class="table-wrap"><table class="download-table"><thead><tr><th>类型</th><th>名称</th><th>当前版本</th><th>下载地址</th><th>描述</th><th class="actions">操作</th></tr></thead>
        <tbody><tr v-for="item in list" :key="item.id"><td data-label="类型"><span class="type-badge">{{ item.type }}</span></td><td class="name-cell" data-label="名称">{{ item.name }}</td><td data-label="当前版本">{{ item.version }}</td><td class="url-cell" data-label="下载地址"><a :href="item.url" target="_blank" rel="noopener">{{ item.url }}</a></td><td class="description-cell" data-label="描述">{{ item.description }}</td><td class="actions" data-label="操作"><md-text-button v-if="canEdit" @click="openEdit(item)"><md-icon slot="icon">edit</md-icon>编辑</md-text-button><md-text-button v-if="canEdit" class="delete-btn" @click="openDelete(item)"><md-icon slot="icon">delete</md-icon>删除</md-text-button></td></tr></tbody>
      </table></div>
      <p v-if="loading" class="empty">加载中…</p><p v-else-if="list.length === 0" class="empty">暂无下载项目</p>
    </section>
    <md-dialog ref="formDialog" :open="formOpen" @closed="onFormClosed"><div slot="headline">{{ editingId ? '编辑下载项目' : '添加下载项目' }}</div><div slot="content"><div class="dialog-form"><div class="field-group"><label class="field-label">项目类型</label><md-outlined-select :value="formType" @change="onTypeChange"><md-select-option value="整合包"><div slot="headline">整合包</div></md-select-option><md-select-option value="模组"><div slot="headline">模组</div></md-select-option></md-outlined-select></div><md-outlined-text-field label="项目名称" :value="formName" @input="formName = ($event.target as HTMLInputElement).value"></md-outlined-text-field><md-outlined-text-field label="下载地址" type="url" :value="formUrl" @input="formUrl = ($event.target as HTMLInputElement).value"></md-outlined-text-field><md-outlined-text-field label="当前版本" :value="formVersion" @input="formVersion = ($event.target as HTMLInputElement).value"></md-outlined-text-field><md-outlined-text-field type="textarea" rows="5" label="项目描述" :value="formDescription" @input="formDescription = ($event.target as HTMLInputElement).value"></md-outlined-text-field></div></div><div slot="actions"><md-text-button @click="closeForm">取消</md-text-button><md-filled-button :disabled="submitting" @click="submitForm">{{ submitting ? '保存中…' : '保存' }}</md-filled-button></div></md-dialog>
    <md-dialog ref="deleteDialog" :open="deleteOpen" @closed="onDeleteClosed"><div slot="headline">删除下载项目</div><div slot="content"><p class="delete-text">确定删除该下载项目吗？官网将不再显示它。</p><div v-if="deleteTarget" class="delete-preview"><strong>{{ deleteTarget.name }}</strong><span>{{ deleteTarget.type }} · {{ deleteTarget.version }}</span></div></div><div slot="actions"><md-text-button @click="closeDelete">取消</md-text-button><md-text-button class="delete-confirm" :disabled="deleting" @click="confirmDelete">{{ deleting ? '删除中…' : '删除' }}</md-text-button></div></md-dialog>
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
.card-head { display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin: 0; padding: 18px 20px 14px; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
.card-head > div { min-width: 0; display: grid; gap: 4px; }
.card-head .card-title { margin: 0; }
.card-caption { color: var(--md-sys-color-on-surface-variant); font-size: 11px; }
.table-wrap { overflow-x: auto; padding: 0 20px 12px; }
.download-table { width: 100%; min-width: 900px; border-collapse: collapse; font-size: 13px; }
.download-table th, .download-table td { padding: 13px 10px; text-align: left; border-bottom: 1px solid var(--md-sys-color-outline-variant); vertical-align: middle; }
.download-table th { color: var(--md-sys-color-on-surface-variant); font-size: 11px; font-weight: 700; }
.download-table tbody tr { transition: background-color 160ms ease; }
.download-table tbody tr:hover { background: color-mix(in srgb, var(--md-sys-color-primary) 4%, transparent); }
.name-cell { font-weight: 600; white-space: nowrap; }
.url-cell { max-width: 220px; }
.url-cell a { display: block; overflow: hidden; color: var(--md-sys-color-primary); text-overflow: ellipsis; white-space: nowrap; }
.description-cell { max-width: 280px; color: var(--md-sys-color-on-surface-variant); overflow-wrap: anywhere; }
.actions { width: 180px; white-space: nowrap; }
.type-badge { display: inline-flex; align-items: center; padding: 4px 9px; border-radius: 5px; color: var(--md-sys-color-on-primary-container); background: var(--md-sys-color-primary-container); font-size: 11px; font-weight: 700; }
.delete-btn, .delete-confirm { color: var(--md-sys-color-error); }
.empty { min-height: 120px; display: grid; place-items: center; align-content: center; margin: 0; padding: 28px 20px 32px; color: var(--md-sys-color-on-surface-variant); font-size: 13px; text-align: center; }
.dialog-form { display: flex; flex-direction: column; gap: 16px; min-width: min(360px, calc(100vw - 72px)); }
.dialog-form md-outlined-text-field, .dialog-form md-outlined-select { width: 100%; }
.field-group { display: flex; flex-direction: column; gap: 4px; }
.field-label { color: var(--md-sys-color-on-surface-variant); font-size: 13px; }
.delete-text { margin: 0 0 12px; color: var(--md-sys-color-on-surface-variant); font-size: 14px; }
.delete-preview { display: flex; flex-direction: column; gap: 4px; padding: 12px; border-radius: 8px; background: var(--md-sys-color-surface); }
.delete-preview span { color: var(--md-sys-color-on-surface-variant); font-size: 13px; }
@media (max-width: 640px) {
  .catalog-header { align-items: stretch; flex-direction: column; gap: 16px; }
  .catalog-header-actions { justify-content: flex-start; }
  .catalog-header-actions md-filled-button { flex: 1; }
  .catalog-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .catalog-card .card-head { align-items: flex-start; }
  .table-wrap { overflow: visible; padding: 0 16px 10px; }
  .download-table, .download-table tbody, .download-table tr, .download-table td { display: block; width: auto; min-width: 0; }
  .download-table thead { display: none; }
  .download-table tr { padding: 10px 0; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
  .download-table tr:last-child { border-bottom: 0; }
  .download-table td { display: grid; grid-template-columns: minmax(82px, 0.35fr) minmax(0, 1fr); gap: 12px; align-items: start; padding: 7px 0; border: 0; }
  .download-table td::before { content: attr(data-label); color: var(--md-sys-color-on-surface-variant); font-size: 11px; font-weight: 600; }
  .download-table .actions { display: flex; justify-content: flex-end; gap: 4px; width: auto; padding-top: 10px; }
  .download-table .actions::before { content: none; }
  .download-table .url-cell a { white-space: normal; overflow-wrap: anywhere; }
  .download-table .description-cell { max-width: none; }
  .dialog-form { width: 100%; min-width: 0; }
  .actions { width: auto; }
}
</style>
