<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'

useHead({ title: '更新服务' })

interface UpdateEntry {
  id: string
  key: string
  name: string
  latestVersion: string
  type: string
  forcedUpdate: boolean
  release_date: string
  release_time: string
  changelog: string[]
}

const endpoint = '/api/updates'

const TYPE_OPTIONS = ['release', 'snapshot', 'beta', 'alpha', 'indev', 'dev']

const list = ref<UpdateEntry[]>([])
const access = useAdminAccess()
const canEdit = computed(() => access.levelForKey('updates') === 'edit')
const loading = ref(true)

const formOpen = ref(false)
const formMode = ref<'add' | 'edit'>('add')
const editingId = ref<string | null>(null)
const formName = ref('')
const formKey = ref('')
const formVersion = ref('')
const formType = ref('release')
const formForced = ref(false)
const formDate = ref('')
const formTime = ref('')
const formChangelog = ref('')
const submitting = ref(false)

const deleteOpen = ref(false)
const deleteTarget = ref<UpdateEntry | null>(null)
const deleting = ref(false)

const formDialog = ref<HTMLElement | null>(null)
const deleteDialog = ref<HTMLElement | null>(null)
const apiDialog = ref<HTMLElement | null>(null)
const apiOpen = ref(false)

const { showToast } = useToast()
const { apply: applyDialogAnimation } = useDialogAnimation()

const forcedUpdateCount = computed(() => list.value.filter((entry) => entry.forcedUpdate).length)
const updateTypeCount = computed(() => new Set(list.value.map((entry) => entry.type || 'release')).size)
const latestRelease = computed(() => list.value[0] ? releaseLabel(list.value[0]) : '暂无发布时间')

onMounted(() => {
  load()
  applyDialogAnimation(formDialog.value)
  applyDialogAnimation(deleteDialog.value)
  applyDialogAnimation(apiDialog.value)
})

async function load() {
  loading.value = true
  try {
    list.value = await $fetch<UpdateEntry[]>(endpoint)
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
  formKey.value = ''
  formVersion.value = ''
  formType.value = 'release'
  formForced.value = false
  formDate.value = ''
  formTime.value = ''
  formChangelog.value = ''
  formOpen.value = true
}

function openEdit(u: UpdateEntry) {
  formMode.value = 'edit'
  editingId.value = u.id
  formName.value = u.name
  formKey.value = u.key
  formVersion.value = u.latestVersion
  formType.value = u.type
  formForced.value = u.forcedUpdate
  formDate.value = dateToInput(u.release_date)
  formTime.value = u.release_time
  formChangelog.value = u.changelog.join('\n')
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

function onForcedChange(e: Event) {
  formForced.value = (e.target as any).checked
}

function onTypeChange(e: Event) {
  formType.value = (e.target as any).value
}

function typeColor(t: string) {
  return t === 'release' ? 'success' : 'warning'
}

function releaseLabel(u: UpdateEntry) {
  return `${u.release_date} ${u.release_time}`
}

function dateToInput(d: string) {
  const m = d.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
  if (!m) return d
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

function dateFromInput(v: string) {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return v
  return `${m[1]}.${Number(m[2])}.${Number(m[3])}`
}

function timeFromInput(v: string) {
  if (!v) return ''
  return v.length === 5 ? `${v}:00` : v
}

function onEndpointClick(e: Event) {
  e.preventDefault()
  if (list.value.length === 0) {
    showToast('暂无程序，请先添加', 'error')
    return
  }
  apiOpen.value = true
}

function openPublicEndpoint(key: string) {
  window.open(`/api/update/${key}`, '_blank', 'noopener')
  apiOpen.value = false
}

function closeApi() {
  apiOpen.value = false
}

function onApiClosed() {
  apiOpen.value = false
}

async function submitForm() {
  if (submitting.value) return
  if (!formName.value.trim()) {
    showToast('请填写程序名称', 'error')
    return
  }
  if (formMode.value === 'add' && !formKey.value.trim()) {
    showToast('请填写程序标识', 'error')
    return
  }
  if (!formVersion.value.trim()) {
    showToast('请填写最新版本', 'error')
    return
  }
  submitting.value = true
  try {
    const payload = {
      name: formName.value.trim(),
      key: formKey.value.trim(),
      latestVersion: formVersion.value.trim(),
      type: formType.value,
      forcedUpdate: formForced.value,
      release_date: dateFromInput(formDate.value.trim()),
      release_time: timeFromInput(formTime.value.trim()),
      changelog: formChangelog.value
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    }
    if (formMode.value === 'add') {
      const entry = await $fetch<UpdateEntry>(endpoint, { method: 'POST', body: payload })
      list.value.unshift(entry)
      showToast('已添加')
    } else {
      const { key: _key, ...rest } = payload
      const updated = await $fetch<UpdateEntry>(`${endpoint}/${editingId.value}`, { method: 'PATCH', body: rest })
      const idx = list.value.findIndex((u) => u.id === updated.id)
      if (idx !== -1) list.value[idx] = updated
      showToast('已保存')
    }
    formOpen.value = false
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '操作失败', 'error')
  } finally {
    submitting.value = false
  }
}

function openDelete(u: UpdateEntry) {
  deleteTarget.value = u
  deleteOpen.value = true
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (deleting.value || !target) return
  deleting.value = true
  try {
    await $fetch(`${endpoint}/${target.id}`, { method: 'DELETE' })
    list.value = list.value.filter((u) => u.id !== target.id)
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
  <div class="page page--wide catalog-page updates-page">
    <header class="catalog-header">
      <div class="catalog-title-block">
        <span class="catalog-eyebrow"><md-icon>system_update_alt</md-icon>版本分发</span>
        <h1 class="page-title">更新服务</h1>
        <p>为客户端提供版本检查、更新类型和变更日志。</p>
      </div>
      <div class="catalog-header-actions">
        <md-icon-button aria-label="打开数据 API" title="打开数据 API" @click="onEndpointClick">
          <md-icon>link</md-icon>
        </md-icon-button>
        <md-filled-button v-if="canEdit" @click="openAdd">
          <md-icon slot="icon">add</md-icon>
          添加程序
        </md-filled-button>
      </div>
    </header>

    <div class="catalog-summary" aria-label="更新服务概览">
      <article class="summary-item summary-item--primary"><span class="summary-icon"><md-icon>inventory_2</md-icon></span><div><strong>{{ list.length }}</strong><span>已登记程序</span></div></article>
      <article class="summary-item summary-item--danger"><span class="summary-icon"><md-icon>priority_high</md-icon></span><div><strong>{{ forcedUpdateCount }}</strong><span>强制更新</span></div></article>
      <article class="summary-item summary-item--info"><span class="summary-icon"><md-icon>category</md-icon></span><div><strong>{{ updateTypeCount }}</strong><span>版本类型</span></div></article>
      <article class="summary-item summary-item--neutral"><span class="summary-icon"><md-icon>event</md-icon></span><div><strong>{{ latestRelease }}</strong><span>最近发布时间</span></div></article>
    </div>

    <section class="card catalog-card">
      <div class="card-head">
        <div><span class="section-overline">客户端目录</span><h2 class="card-title">程序列表</h2></div>
        <span class="card-caption">{{ list.length }} 个程序</span>
      </div>

      <div class="table-wrap">
        <table class="update-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>标识</th>
            <th>最新版本</th>
            <th>类型</th>
            <th>强制更新</th>
            <th>发布时间</th>
            <th class="cell-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in list" :key="u.id">
            <td class="cell-name" data-label="名称">{{ u.name }}</td>
            <td class="cell-key" data-label="标识"><code>{{ u.key }}</code></td>
            <td class="cell-version" data-label="最新版本">{{ u.latestVersion }}</td>
            <td class="cell-type" data-label="类型">
              <span class="type-badge" :class="`type-badge--${typeColor(u.type)}`">{{ u.type || 'release' }}</span>
            </td>
            <td class="cell-forced" data-label="强制更新">
              <span v-if="u.forcedUpdate" class="forced-badge">强制</span>
              <span v-else class="muted">否</span>
            </td>
            <td class="cell-release" data-label="发布时间">{{ releaseLabel(u) }}</td>
            <td class="cell-actions" data-label="操作">
              <md-text-button v-if="canEdit" @click="openEdit(u)">
                <md-icon slot="icon">edit</md-icon>
                编辑
              </md-text-button>
              <md-text-button v-if="canEdit" class="delete-btn" @click="openDelete(u)">
                <md-icon slot="icon">delete</md-icon>
                删除
              </md-text-button>
            </td>
          </tr>
        </tbody>
        </table>
      </div>
      <EmptyState v-if="loading" :illustrated="false">加载中…</EmptyState>
      <EmptyState v-else-if="list.length === 0">暂无程序</EmptyState>
    </section>

    <md-dialog ref="formDialog" :open="formOpen" @closed="onFormClosed">
      <div slot="headline">{{ formMode === 'add' ? '添加程序' : '编辑程序' }}</div>
      <div slot="content">
        <div class="dialog-form">
          <md-outlined-text-field
            label="程序名称"
            :value="formName"
            @input="formName = ($event.target as HTMLInputElement).value"
          ></md-outlined-text-field>

          <md-outlined-text-field
            label="程序标识"
            :value="formKey"
            :disabled="formMode === 'edit'"
            @input="formKey = ($event.target as HTMLInputElement).value"
          ></md-outlined-text-field>

          <md-outlined-text-field
            label="最新版本"
            :value="formVersion"
            @input="formVersion = ($event.target as HTMLInputElement).value"
          ></md-outlined-text-field>

          <div class="field-group">
            <label class="field-label">版本类型</label>
            <md-outlined-select class="type-select" :value="formType" @change="onTypeChange">
              <md-select-option v-for="t in TYPE_OPTIONS" :key="t" :value="t">
                <div slot="headline">{{ t }}</div>
              </md-select-option>
            </md-outlined-select>
          </div>

          <label class="forced-row">
            <md-checkbox :checked="formForced" @change="onForcedChange"></md-checkbox>
            <span>强制用户更新到最新版本</span>
          </label>

          <div class="field-group">
            <label class="field-label" for="update-release-date">发布日期</label>
            <input id="update-release-date" v-model="formDate" type="date" class="date-input" />
          </div>

          <div class="field-group">
            <label class="field-label" for="update-release-time">发布时间</label>
            <input id="update-release-time" v-model="formTime" type="time" step="1" class="date-input" />
          </div>

          <md-outlined-text-field
            type="textarea"
            rows="6"
            label="更新日志（每行一条）"
            :value="formChangelog"
            @input="formChangelog = ($event.target as HTMLInputElement).value"
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

    <md-dialog ref="apiDialog" :open="apiOpen" @closed="onApiClosed">
      <div slot="headline">选择程序</div>
      <div slot="content">
        <md-list class="api-list">
          <md-list-item v-for="u in list" :key="u.id" type="button" @click="openPublicEndpoint(u.key)">
            <span slot="headline">{{ u.name }}</span>
            <span slot="supporting-text">/api/update/{{ u.key }}</span>
          </md-list-item>
        </md-list>
      </div>
      <div slot="actions">
        <md-text-button @click="closeApi">取消</md-text-button>
      </div>
    </md-dialog>

    <md-dialog ref="deleteDialog" :open="deleteOpen" @closed="onDeleteClosed">
      <div slot="headline">删除程序</div>
      <div slot="content">
        <p class="delete-text">确定要删除该程序的更新配置吗？删除后客户端将无法再获取其更新信息。</p>
        <div v-if="deleteTarget" class="delete-preview">
          <span class="delete-name">{{ deleteTarget.name }}</span>
          <span class="delete-sub">{{ deleteTarget.key }} · {{ deleteTarget.latestVersion }}</span>
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

.api-list {
  --md-list-container-color: transparent;
}

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

.update-table {
  width: 100%;
  min-width: 820px;
  border-collapse: collapse;
  font-size: 14px;
}

.update-table th,
.update-table td {
  padding: 13px 10px;
  text-align: left;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  vertical-align: middle;
}

.update-table th {
  color: var(--md-sys-color-on-surface-variant);
  font-weight: 500;
  font-size: 13px;
}

.cell-name {
  font-weight: 500;
  white-space: nowrap;
}

.cell-key {
  font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
}

.cell-version {
  white-space: nowrap;
  font-weight: 500;
}

.cell-release {
  white-space: nowrap;
  color: var(--md-sys-color-on-surface-variant);
}

.cell-actions {
  width: 200px;
  white-space: nowrap;
}

.type-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
}

.type-badge--success {
  background: color-mix(in srgb, var(--act-success) 14%, transparent);
  color: var(--act-success);
}

.type-badge--warning {
  background: color-mix(in srgb, var(--act-warning) 14%, transparent);
  color: var(--act-warning);
}

.forced-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  background: color-mix(in srgb, var(--act-error) 14%, transparent);
  color: var(--act-error);
}

.muted {
  color: var(--md-sys-color-on-surface-variant);
}

.delete-btn {
  color: var(--md-sys-color-error);
}

.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: min(320px, calc(100vw - 72px));
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

.type-select {
  width: 100%;
}

.forced-row {
  display: flex;
  align-items: center;
  gap: 8px;
  align-self: flex-start;
  font-size: 14px;
  color: var(--md-sys-color-on-surface);
  cursor: pointer;
}

.date-input {
  width: 100%;
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

.update-table tbody tr { transition: background-color 160ms ease; }
.update-table tbody tr:hover { background: color-mix(in srgb, var(--md-sys-color-primary) 4%, transparent); }

@media (max-width: 640px) {
  .catalog-header { align-items: stretch; flex-direction: column; gap: 16px; }
  .catalog-header-actions { justify-content: flex-start; }
  .catalog-header-actions md-filled-button { flex: 1; }
  .catalog-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .catalog-card .card-head { align-items: flex-start; }
  .table-wrap { overflow: visible; padding: 0 16px 10px; }
  .update-table, .update-table tbody, .update-table tr, .update-table td { display: block; width: auto; min-width: 0; }
  .update-table thead { display: none; }
  .update-table tr { padding: 10px 0; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
  .update-table tr:last-child { border-bottom: 0; }
  .update-table td { display: grid; grid-template-columns: minmax(82px, 0.35fr) minmax(0, 1fr); gap: 12px; align-items: start; padding: 7px 0; border: 0; }
  .update-table td::before { content: attr(data-label); color: var(--md-sys-color-on-surface-variant); font-size: 11px; font-weight: 600; }
  .update-table .cell-actions { display: flex; justify-content: flex-end; gap: 4px; padding-top: 10px; }
  .update-table .cell-actions::before { content: none; }
  .update-table .cell-key code, .update-table .cell-release { overflow-wrap: anywhere; white-space: normal; }
}
</style>
