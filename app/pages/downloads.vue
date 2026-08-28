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
  <div class="page">
    <div class="page-heading">
      <h1 class="page-title">下载项目</h1>
      <md-filled-button v-if="canEdit" @click="openAdd"><md-icon slot="icon">add</md-icon>添加项目</md-filled-button>
    </div>
    <div class="card">
      <div class="table-wrap"><table class="download-table"><thead><tr><th>类型</th><th>名称</th><th>当前版本</th><th>下载地址</th><th>描述</th><th>操作</th></tr></thead>
        <tbody><tr v-for="item in list" :key="item.id"><td><span class="type-badge">{{ item.type }}</span></td><td class="name-cell">{{ item.name }}</td><td>{{ item.version }}</td><td class="url-cell"><a :href="item.url" target="_blank" rel="noopener">{{ item.url }}</a></td><td class="description-cell">{{ item.description }}</td><td class="actions"><md-text-button v-if="canEdit" @click="openEdit(item)"><md-icon slot="icon">edit</md-icon>编辑</md-text-button><md-text-button v-if="canEdit" class="delete-btn" @click="openDelete(item)"><md-icon slot="icon">delete</md-icon>删除</md-text-button></td></tr></tbody>
      </table></div>
      <p v-if="loading" class="empty">加载中…</p><p v-else-if="list.length === 0" class="empty">暂无下载项目</p>
    </div>
    <md-dialog ref="formDialog" :open="formOpen" @closed="onFormClosed"><div slot="headline">{{ editingId ? '编辑下载项目' : '添加下载项目' }}</div><div slot="content"><div class="dialog-form"><div class="field-group"><label class="field-label">项目类型</label><md-outlined-select :value="formType" @change="onTypeChange"><md-select-option value="整合包"><div slot="headline">整合包</div></md-select-option><md-select-option value="模组"><div slot="headline">模组</div></md-select-option></md-outlined-select></div><md-outlined-text-field label="项目名称" :value="formName" @input="formName = ($event.target as HTMLInputElement).value"></md-outlined-text-field><md-outlined-text-field label="下载地址" type="url" :value="formUrl" @input="formUrl = ($event.target as HTMLInputElement).value"></md-outlined-text-field><md-outlined-text-field label="当前版本" :value="formVersion" @input="formVersion = ($event.target as HTMLInputElement).value"></md-outlined-text-field><md-outlined-text-field type="textarea" rows="5" label="项目描述" :value="formDescription" @input="formDescription = ($event.target as HTMLInputElement).value"></md-outlined-text-field></div></div><div slot="actions"><md-text-button @click="closeForm">取消</md-text-button><md-filled-button :disabled="submitting" @click="submitForm">{{ submitting ? '保存中…' : '保存' }}</md-filled-button></div></md-dialog>
    <md-dialog ref="deleteDialog" :open="deleteOpen" @closed="onDeleteClosed"><div slot="headline">删除下载项目</div><div slot="content"><p class="delete-text">确定删除该下载项目吗？官网将不再显示它。</p><div v-if="deleteTarget" class="delete-preview"><strong>{{ deleteTarget.name }}</strong><span>{{ deleteTarget.type }} · {{ deleteTarget.version }}</span></div></div><div slot="actions"><md-text-button @click="closeDelete">取消</md-text-button><md-text-button class="delete-confirm" :disabled="deleting" @click="confirmDelete">{{ deleting ? '删除中…' : '删除' }}</md-text-button></div></md-dialog>
  </div>
</template>

<style scoped>
.page-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px}.page-title{margin:0}.table-wrap{overflow-x:auto}.download-table{width:100%;min-width:900px;border-collapse:collapse;font-size:14px}.download-table th,.download-table td{padding:12px;border-bottom:1px solid var(--md-sys-color-outline-variant);text-align:left;vertical-align:middle}.download-table th{color:var(--md-sys-color-on-surface-variant);font-size:13px;font-weight:500}.name-cell{font-weight:500;white-space:nowrap}.url-cell{max-width:220px}.url-cell a{color:var(--md-sys-color-primary);overflow-wrap:anywhere}.description-cell{max-width:280px}.actions{white-space:nowrap;width:180px}.type-badge{display:inline-flex;padding:3px 10px;border-radius:999px;background:var(--md-sys-color-primary-container);color:var(--md-sys-color-on-primary-container);font-size:12px}.delete-btn,.delete-confirm{color:var(--md-sys-color-error)}.empty{margin:16px 0 0;color:var(--md-sys-color-on-surface-variant);font-size:14px}.dialog-form{display:flex;flex-direction:column;gap:16px;min-width:min(360px,calc(100vw - 72px))}.dialog-form md-outlined-text-field,.dialog-form md-outlined-select{width:100%}.field-group{display:flex;flex-direction:column;gap:4px}.field-label{font-size:13px;color:var(--md-sys-color-on-surface-variant)}.delete-text{margin:0 0 12px;color:var(--md-sys-color-on-surface-variant);font-size:14px}.delete-preview{display:flex;flex-direction:column;gap:4px;padding:12px;border-radius:8px;background:var(--md-sys-color-surface)}.delete-preview span{font-size:13px;color:var(--md-sys-color-on-surface-variant)}
@media(max-width:640px){.page-heading{align-items:stretch;flex-direction:column}.page-heading md-filled-button{width:100%}.download-table{min-width:760px}.dialog-form{width:100%;min-width:0}.actions{width:auto}}
</style>
