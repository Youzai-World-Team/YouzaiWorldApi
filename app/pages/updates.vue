<script setup lang="ts">
import { ref, onMounted } from 'vue'

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
  formDate.value = u.release_date
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
      release_date: formDate.value.trim(),
      release_time: formTime.value.trim(),
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
  <div class="page">
    <h1 class="page-title">更新服务</h1>

    <div class="endpoint">
      <span class="endpoint-label">数据 API：</span>
      <code class="endpoint-url">GET /api/update/{key}</code>
    </div>

    <div class="card">
      <div class="card-head">
        <h2 class="card-title">程序列表</h2>
        <md-filled-button @click="openAdd">
          <md-icon slot="icon">add</md-icon>
          添加程序
        </md-filled-button>
      </div>

      <table class="update-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>标识</th>
            <th>最新版本</th>
            <th>类型</th>
            <th>强制更新</th>
            <th>发布时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in list" :key="u.id">
            <td class="cell-name">{{ u.name }}</td>
            <td class="cell-key"><code>{{ u.key }}</code></td>
            <td class="cell-version">{{ u.latestVersion }}</td>
            <td class="cell-type">
              <span class="type-badge" :class="`type-badge--${typeColor(u.type)}`">{{ u.type || 'release' }}</span>
            </td>
            <td class="cell-forced">
              <span v-if="u.forcedUpdate" class="forced-badge">强制</span>
              <span v-else class="muted">否</span>
            </td>
            <td class="cell-release">{{ releaseLabel(u) }}</td>
            <td class="cell-actions">
              <md-text-button @click="openEdit(u)">
                <md-icon slot="icon">edit</md-icon>
                编辑
              </md-text-button>
              <md-text-button class="delete-btn" @click="openDelete(u)">
                <md-icon slot="icon">delete</md-icon>
                删除
              </md-text-button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!loading && list.length === 0" class="empty">暂无程序，点击右上角添加</p>
    </div>

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
            label="程序标识（用于更新接口 URL）"
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

          <div class="row-group">
            <md-outlined-text-field
              label="发布日期"
              placeholder="如 2026.7.19"
              :value="formDate"
              @input="formDate = ($event.target as HTMLInputElement).value"
            ></md-outlined-text-field>
            <md-outlined-text-field
              label="发布时间"
              placeholder="如 22:19:30"
              :value="formTime"
              @input="formTime = ($event.target as HTMLInputElement).value"
            ></md-outlined-text-field>
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

.update-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.update-table th,
.update-table td {
  padding: 12px;
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
  background: rgba(24, 128, 56, 0.14);
  color: var(--act-success);
}

.type-badge--warning {
  background: rgba(176, 96, 0, 0.14);
  color: var(--act-warning);
}

.forced-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  background: rgba(197, 34, 31, 0.14);
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
  min-width: 320px;
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

.row-group {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  width: 100%;
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
