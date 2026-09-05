<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'

useHead({ title: '封禁列表' })

interface Ban {
  id: string
  player: string
  banTime: string
  unbanTime: string // 'permanent' 表示永久封禁
  reason: string
}

const endpoint = '/api/bans'
const access = useAdminAccess()
const canEdit = computed(() => access.levelForKey('bans') === 'edit')

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
const bansTableWrap = ref<HTMLElement | null>(null)

const { showToast } = useToast()
const { apply: applyDialogAnimation } = useDialogAnimation()

const permanentBanCount = computed(() => bans.value.filter((ban) => ban.unbanTime === 'permanent').length)
const scheduledBanCount = computed(() => bans.value.filter((ban) => ban.unbanTime !== 'permanent').length)
const latestBan = computed(() => bans.value[0]?.banTime || '暂无记录')

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
<div class="page page--wide catalog-page bans-page api-redesign-page">
    <header class="catalog-header">
      <div class="catalog-title-block">
        <h1 class="page-title">封禁列表</h1>
      </div>
      <div class="catalog-header-actions">
        <md-icon-button :href="endpoint" target="_blank" rel="noopener" aria-label="打开数据 API" title="打开数据 API"><md-icon>link</md-icon></md-icon-button>
        <md-filled-button v-if="canEdit" @click="openAdd"><md-icon slot="icon">add</md-icon>添加封禁</md-filled-button>
      </div>
    </header>
    <div class="catalog-summary" aria-label="封禁列表概览">
      <article class="summary-item summary-item--danger"><span class="summary-icon"><md-icon>gavel</md-icon></span><div><strong>{{ bans.length }}</strong><span>封禁记录</span></div></article>
      <article class="summary-item summary-item--danger"><span class="summary-icon"><md-icon>block</md-icon></span><div><strong>{{ permanentBanCount }}</strong><span>永久封禁</span></div></article>
      <article class="summary-item summary-item--warning"><span class="summary-icon"><md-icon>event_repeat</md-icon></span><div><strong>{{ scheduledBanCount }}</strong><span>定期解封</span></div></article>
      <article class="summary-item summary-item--neutral"><span class="summary-icon"><md-icon>history</md-icon></span><div><strong class="summary-value-text">{{ latestBan }}</strong><span>最近封禁时间</span></div></article>
    </div>

    <section class="card catalog-card">
      <div class="card-head">
        <div><span class="section-overline">服务器黑名单</span><h2 class="card-title">封禁记录</h2></div>
        <span class="card-caption">{{ bans.length }} 条记录</span>
      </div>

      <div ref="bansTableWrap" class="table-wrap">
        <table class="ban-table">
        <thead>
          <tr>
            <th>玩家名</th>
            <th>封禁时间</th>
            <th>解封时间</th>
            <th>原因</th>
            <th class="cell-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in bans" :key="b.id">
            <td class="cell-player" data-label="玩家名">{{ b.player }}</td>
            <td class="cell-ban" data-label="封禁时间">{{ b.banTime }}</td>
            <td class="cell-unban" data-label="解封时间">
              <span v-if="b.unbanTime === 'permanent'" class="permanent-badge">永久</span>
              <span v-else>{{ b.unbanTime }}</span>
            </td>
            <td class="cell-reason" data-label="原因">{{ b.reason || '—' }}</td>
            <td class="cell-actions" data-label="操作">
              <md-text-button v-if="canEdit" @click="openEdit(b)">
                <md-icon slot="icon">edit</md-icon>
                编辑
              </md-text-button>
              <md-text-button v-if="canEdit" class="delete-btn" @click="openDelete(b)">
                <md-icon slot="icon">delete</md-icon>
                删除
              </md-text-button>
            </td>
          </tr>
        </tbody>
        </table>
      </div>
      <AppScrollbar :target="bansTableWrap" axis="horizontal" label="封禁记录表格横向滚动条" />
      <EmptyState v-if="loading" :illustrated="false">加载中…</EmptyState>
      <EmptyState v-else-if="bans.length === 0" image="/images/empty-protection-enabled.svg">暂无封禁记录</EmptyState>
    </section>

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
            <label class="field-label" for="ban-start-date">封禁时间</label>
            <input id="ban-start-date" v-model="formBanTime" type="date" class="date-input" />
          </div>

          <label class="permanent-row">
            <md-checkbox :checked="formPermanent" @change="onPermanentChange"></md-checkbox>
            <span>永久封禁</span>
          </label>

          <div v-if="!formPermanent" class="field-group">
            <label class="field-label" for="ban-end-date">解封时间</label>
            <input id="ban-end-date" v-model="formUnbanTime" type="date" class="date-input" />
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
.catalog-page { width: min(100%, 1320px); }
.catalog-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 22px; padding-bottom: 20px; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
.catalog-title-block { min-width: 0; }
.catalog-eyebrow, .section-overline { display: inline-flex; align-items: center; gap: 6px; color: var(--md-sys-color-primary); font-size: 11px; font-weight: 700; }
.catalog-eyebrow md-icon { --md-icon-size: 16px; }
.catalog-title-block .page-title { margin: 0 0 5px; }
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

.ban-table {
  width: 100%;
  min-width: 860px;
  border-collapse: collapse;
  font-size: 14px;
}

.ban-table th,
.ban-table td {
  padding: 13px 10px;
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
  background: color-mix(in srgb, var(--act-error) 14%, transparent);
  color: var(--act-error);
}

.delete-btn {
  color: var(--md-sys-color-error);
}

.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: min(300px, calc(100vw - 72px));
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

.ban-table tbody tr { transition: background-color 160ms ease; }
.ban-table tbody tr:hover { background: color-mix(in srgb, var(--md-sys-color-primary) 4%, transparent); }

@media (max-width: 640px) {
  .catalog-header { align-items: stretch; flex-direction: column; gap: 16px; }
  .catalog-header-actions { justify-content: flex-start; }
  .catalog-header-actions md-filled-button { flex: 1; }
  .catalog-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .catalog-card .card-head { align-items: flex-start; }
  .table-wrap { overflow: visible; padding: 0 16px 10px; }
  .ban-table, .ban-table tbody, .ban-table tr, .ban-table td { display: block; width: auto; min-width: 0; }
  .ban-table thead { display: none; }
  .ban-table tr { padding: 10px 0; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
  .ban-table tr:last-child { border-bottom: 0; }
  .ban-table td { display: grid; grid-template-columns: minmax(82px, 0.35fr) minmax(0, 1fr); gap: 12px; align-items: start; padding: 7px 0; border: 0; }
  .ban-table td::before { content: attr(data-label); color: var(--md-sys-color-on-surface-variant); font-size: 11px; font-weight: 600; }
  .ban-table .cell-actions { display: flex; justify-content: flex-end; gap: 4px; padding-top: 10px; }
  .ban-table .cell-actions::before { content: none; }
  .ban-table .cell-reason { overflow-wrap: anywhere; }
}
</style>
