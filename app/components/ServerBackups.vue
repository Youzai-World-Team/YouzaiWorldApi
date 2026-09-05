<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  uuid: string
  daemonId: string
  status: number
  statusLabel: string
  canEdit: boolean
}>()

const emit = defineEmits<{
  refreshInstance: []
}>()

interface BackupEntry {
  name: string
  size: number
  time: string
}

interface BackupTask {
  taskId: string
  status: -1 | 0 | 1
  statusLabel: string
  backupFileName: string
}

const TASK_POLL_MS = 2000
const { showToast } = useToast()
const { apply: applyDialogAnimation } = useDialogAnimation()

const loading = ref(true)
const backups = ref<BackupEntry[]>([])
const task = ref<BackupTask | null>(null)
const creating = ref(false)
const createConfirm = ref(false)
const restoreTarget = ref<BackupEntry | null>(null)
const restorePending = ref(false)
const deleteTarget = ref<BackupEntry | null>(null)
const deletePending = ref(false)
const tableWrap = ref<HTMLElement | null>(null)

const rulesOpen = ref(false)
const rulesDialog = ref<HTMLElement | null>(null)
const rulesLoading = ref(false)
const rulesSaving = ref(false)
const rulesText = ref('')
const rulesExists = ref(false)

let pollTimer: ReturnType<typeof setInterval> | null = null
let taskRequestPending = false

const stopped = computed(() => props.status === 0)
const taskRunning = computed(() => task.value?.status === 1)
const canCreate = computed(() => props.canEdit && stopped.value && !taskRunning.value && !creating.value)
const rulesMode = computed(() => rulesText.value.split(/\r?\n/, 1)[0]?.trim().toLowerCase() === '$white'
  ? '白名单'
  : '黑名单')

function errorMessage(error: any, fallback: string) {
  return error?.data?.statusMessage || error?.statusMessage || fallback
}

function formatBytes(value: number) {
  if (!value) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`
}

function backupFormat(name: string) {
  if (name.toLowerCase().endsWith('.tar.gz')) return 'tar.gz'
  return name.split('.').pop()?.toLowerCase() || '—'
}

function taskStorageKey() {
  return `yzwc:mcsm-backup-task:${props.daemonId}:${props.uuid}`
}

function rememberTask(taskId: string) {
  if (import.meta.client) sessionStorage.setItem(taskStorageKey(), taskId)
}

function forgetTask() {
  if (import.meta.client) sessionStorage.removeItem(taskStorageKey())
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  taskRequestPending = false
}

async function load(quiet = false) {
  if (!props.uuid) return
  if (!quiet) loading.value = true
  try {
    const result = await $fetch<{ backups: BackupEntry[] }>('/api/admin/mcsm/backups', {
      query: { uuid: props.uuid, daemonId: props.daemonId },
    })
    backups.value = result.backups
  } catch (error: any) {
    if (!quiet) showToast(errorMessage(error, '备份列表加载失败'), 'error')
  } finally {
    loading.value = false
  }
}

async function queryTask() {
  const current = task.value
  if (!current?.taskId || taskRequestPending) return
  taskRequestPending = true
  try {
    const result = await $fetch<{ task: BackupTask | null }>('/api/admin/mcsm/backups/task', {
      query: { uuid: props.uuid, daemonId: props.daemonId, taskId: current.taskId },
    })
    if (!result.task) {
      stopPolling()
      forgetTask()
      task.value = null
      await load(true)
      return
    }
    task.value = result.task
    if (result.task.status !== 1) {
      stopPolling()
      forgetTask()
      await load(true)
      emit('refreshInstance')
      showToast(result.task.status === 0 ? '整实例备份已完成' : '整实例备份失败', result.task.status === 0 ? 'info' : 'error')
    }
  } catch (error: any) {
    stopPolling()
    showToast(errorMessage(error, '备份任务状态查询失败'), 'error')
  } finally {
    taskRequestPending = false
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(() => void queryTask(), TASK_POLL_MS)
}

async function recoverTask() {
  if (!import.meta.client) return
  const taskId = sessionStorage.getItem(taskStorageKey()) || ''
  if (!taskId) return
  task.value = { taskId, status: 1, statusLabel: '正在备份', backupFileName: '' }
  await queryTask()
  if (task.value?.status === 1) startPolling()
}

async function startBackup() {
  if (!canCreate.value) return
  creating.value = true
  try {
    const result = await $fetch<{ task: BackupTask }>('/api/admin/mcsm/backups', {
      method: 'POST',
      body: { uuid: props.uuid, daemonId: props.daemonId },
    })
    task.value = result.task
    rememberTask(result.task.taskId)
    createConfirm.value = false
    startPolling()
    emit('refreshInstance')
    showToast('整实例备份任务已启动')
  } catch (error: any) {
    showToast(errorMessage(error, '备份任务启动失败'), 'error')
  } finally {
    creating.value = false
  }
}

async function confirmRestore() {
  const backup = restoreTarget.value
  if (!backup || !props.canEdit || !stopped.value || restorePending.value) return
  restorePending.value = true
  try {
    await $fetch('/api/admin/mcsm/backups/restore', {
      method: 'POST',
      body: { uuid: props.uuid, daemonId: props.daemonId, name: backup.name },
    })
    restoreTarget.value = null
    emit('refreshInstance')
    showToast('备份恢复已启动，完成前实例会保持忙碌状态')
  } catch (error: any) {
    showToast(errorMessage(error, '恢复备份失败'), 'error')
  } finally {
    restorePending.value = false
  }
}

async function confirmDelete() {
  const backup = deleteTarget.value
  if (!backup || !props.canEdit || deletePending.value) return
  deletePending.value = true
  try {
    await $fetch('/api/admin/mcsm/backups', {
      method: 'DELETE',
      body: { uuid: props.uuid, daemonId: props.daemonId, name: backup.name },
    })
    deleteTarget.value = null
    await load(true)
    showToast(`备份 ${backup.name} 已删除`)
  } catch (error: any) {
    showToast(errorMessage(error, '删除备份失败'), 'error')
  } finally {
    deletePending.value = false
  }
}

async function openRules() {
  rulesOpen.value = true
  applyDialogAnimation(rulesDialog.value)
  rulesLoading.value = true
  try {
    const result = await $fetch<{ exists: boolean; text: string }>('/api/admin/mcsm/backups/rules', {
      query: { uuid: props.uuid, daemonId: props.daemonId },
    })
    rulesExists.value = result.exists
    rulesText.value = result.text
  } catch (error: any) {
    rulesOpen.value = false
    showToast(errorMessage(error, '备份规则加载失败'), 'error')
  } finally {
    rulesLoading.value = false
  }
}

async function saveRules() {
  if (!props.canEdit || rulesSaving.value || rulesLoading.value) return
  rulesSaving.value = true
  try {
    const result = await $fetch<{ text: string }>('/api/admin/mcsm/backups/rules', {
      method: 'PUT',
      body: { uuid: props.uuid, daemonId: props.daemonId, text: rulesText.value },
    })
    rulesText.value = result.text
    rulesExists.value = true
    rulesOpen.value = false
    showToast('备份规则已保存')
  } catch (error: any) {
    showToast(errorMessage(error, '备份规则保存失败'), 'error')
  } finally {
    rulesSaving.value = false
  }
}

watch(
  () => [props.uuid, props.daemonId],
  async () => {
    stopPolling()
    task.value = null
    backups.value = []
    await Promise.all([load(), recoverTask()])
  },
  { immediate: true },
)

onBeforeUnmount(stopPolling)
</script>

<template>
  <section class="card backup-section">
    <div class="card-heading">
      <div>
        <h2 class="card-title">整实例备份</h2>
        <p class="card-note">由 ElementsPanel 节点备份插件管理，创建与恢复均要求实例已停止。</p>
      </div>
      <div class="heading-actions">
        <md-outlined-button :disabled="loading || rulesLoading" @click="openRules">
          <md-icon slot="icon">rule</md-icon>
          备份规则
        </md-outlined-button>
        <md-filled-button
          v-if="canEdit"
          :disabled="!canCreate"
          :title="stopped ? '创建整实例备份' : `实例当前${statusLabel}`"
          @click="createConfirm = true"
        >
          <md-icon slot="icon">backup</md-icon>
          创建备份
        </md-filled-button>
        <md-icon-button aria-label="刷新备份" title="刷新备份" :disabled="loading" @click="load()">
          <md-icon>refresh</md-icon>
        </md-icon-button>
      </div>
    </div>

    <div v-if="task" :class="['task-state', task.status === -1 ? 'task-state-failed' : task.status === 0 ? 'task-state-complete' : 'task-state-running']">
      <md-circular-progress v-if="taskRunning" indeterminate></md-circular-progress>
      <md-icon v-else>{{ task.status === 0 ? 'check_circle' : 'error' }}</md-icon>
      <div>
        <strong>{{ task.statusLabel }}</strong>
        <span v-if="task.backupFileName">{{ task.backupFileName }}</span>
      </div>
    </div>

    <p v-if="!canEdit" class="card-note">当前账户只能查看备份列表与规则。</p>

    <div ref="tableWrap" class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>备份文件</th>
            <th>格式</th>
            <th>大小</th>
            <th>创建时间</th>
            <th class="cell-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="backup in backups" :key="backup.name">
            <td class="primary-cell">{{ backup.name }}</td>
            <td>{{ backupFormat(backup.name) }}</td>
            <td>{{ formatBytes(backup.size) }}</td>
            <td>{{ backup.time || '—' }}</td>
            <td class="cell-actions">
              <md-icon-button
                v-if="canEdit"
                aria-label="恢复备份"
                :title="stopped ? '恢复备份' : '需要先停止实例'"
                :disabled="!stopped || taskRunning"
                @click="restoreTarget = backup"
              >
                <md-icon>restore</md-icon>
              </md-icon-button>
              <md-icon-button
                v-if="canEdit"
                aria-label="删除备份"
                title="删除备份"
                :disabled="taskRunning"
                @click="deleteTarget = backup"
              >
                <md-icon>delete</md-icon>
              </md-icon-button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="loading" class="empty">加载中…</p>
      <EmptyState v-else-if="!backups.length" compact image="/images/empty-monitoring-data.svg">
        暂无整实例备份
      </EmptyState>
    </div>
    <AppScrollbar :target="tableWrap" axis="horizontal" label="备份列表横向滚动条" />

    <md-dialog ref="rulesDialog" :open="rulesOpen" @closed="rulesOpen = false">
      <md-icon slot="icon">rule</md-icon>
      <div slot="headline">备份规则</div>
      <div slot="content" class="rules-content">
        <div class="rules-meta">
          <span class="badge">{{ rulesMode }}</span>
          <code>.epbaklst</code>
          <span>{{ rulesExists ? '已存在' : '新文件' }}</span>
        </div>
        <md-outlined-text-field
          class="rules-editor"
          type="textarea"
          rows="16"
          label="规则内容"
          :disabled="rulesLoading"
          :readonly="!canEdit"
          :value="rulesText"
          @input="rulesText = ($event.target as HTMLTextAreaElement).value"
        ></md-outlined-text-field>
      </div>
      <div slot="actions">
        <md-text-button :disabled="rulesSaving" @click="rulesOpen = false">关闭</md-text-button>
        <md-text-button v-if="canEdit" :disabled="rulesLoading || rulesSaving" @click="saveRules">
          {{ rulesSaving ? '保存中…' : '保存' }}
        </md-text-button>
      </div>
    </md-dialog>

    <ConfirmDialog
      :open="createConfirm"
      title="创建整实例备份"
      message="将按当前 .epbaklst 规则备份整个实例。任务完成后实例仍保持停止状态。"
      icon="backup"
      confirm-label="开始备份"
      pending-label="启动中…"
      :pending="creating"
      @confirm="startBackup"
      @cancel="createConfirm = false"
      @closed="createConfirm = false"
    />

    <ConfirmDialog
      :open="!!restoreTarget"
      title="恢复整实例备份"
      :message="`确定要用「${restoreTarget?.name}」覆盖实例目录吗？同名文件会被覆盖，操作无法撤销。`"
      icon="restore"
      confirm-label="开始恢复"
      pending-label="启动中…"
      destructive
      :pending="restorePending"
      @confirm="confirmRestore"
      @cancel="restoreTarget = null"
      @closed="restoreTarget = null"
    />

    <ConfirmDialog
      :open="!!deleteTarget"
      title="删除备份"
      :message="`确定要删除备份「${deleteTarget?.name}」吗？删除后无法恢复。`"
      icon="delete"
      confirm-label="删除"
      pending-label="删除中…"
      destructive
      :pending="deletePending"
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
      @closed="deleteTarget = null"
    />
  </section>
</template>

<style scoped>
.card-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.heading-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.card-note { margin: 8px 0 0; font-size: 13px; line-height: 1.7; color: var(--md-sys-color-on-surface-variant); }
.task-state { display: flex; align-items: center; gap: 12px; margin-top: 16px; padding: 12px 14px; border-left: 3px solid var(--md-sys-color-primary); background: var(--md-sys-color-surface-container); }
.task-state md-circular-progress { width: 22px; height: 22px; flex: 0 0 22px; }
.task-state md-icon { flex: 0 0 auto; }
.task-state > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.task-state strong { font-size: 13px; }
.task-state span { color: var(--md-sys-color-on-surface-variant); font-size: 12px; overflow-wrap: anywhere; }
.task-state-complete { border-left-color: var(--md-sys-color-primary); }
.task-state-failed { border-left-color: var(--md-sys-color-error); color: var(--md-sys-color-error); }
.table-wrap { overflow-x: auto; margin-top: 16px; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { padding: 12px 10px; border-bottom: 1px solid var(--md-sys-color-outline-variant); text-align: left; white-space: nowrap; }
.data-table th { color: var(--md-sys-color-on-surface-variant); font-size: 12px; font-weight: 500; }
.primary-cell { font-weight: 600; font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.cell-actions { text-align: right; white-space: nowrap; }
.empty { padding: 16px 0; color: var(--md-sys-color-on-surface-variant); font-size: 14px; }
.rules-content { width: min(640px, calc(100vw - 72px)); }
.rules-meta { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; color: var(--md-sys-color-on-surface-variant); font-size: 12px; }
.rules-meta code { font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; line-height: 18px; background: var(--md-sys-color-secondary-container); color: var(--md-sys-color-on-secondary-container); }
.rules-editor { width: 100%; font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; }

@media (max-width: 720px) {
  .heading-actions { width: 100%; justify-content: flex-end; }
  .rules-content { width: 100%; }
}
</style>
