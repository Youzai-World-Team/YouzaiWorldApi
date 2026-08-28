<script setup lang="ts">
import { computed, ref, watch } from 'vue'

// 计划任务。面板的这块接口官方文档没写，字段语义见 server/utils/mcsm-server-config.ts
// 里的实测注释：type 决定 time 的含义，动作固定成 {type,payload}。
const props = defineProps<{
  uuid: string
  daemonId: string
  canEdit: boolean
}>()

interface ScheduleAction {
  type: string
  typeLabel: string
  payload: string
}

interface ScheduleEntry {
  name: string
  count: number
  type: number
  typeLabel: string
  time: string
  timeLabel: string
  actions: ScheduleAction[]
}

interface Option<T> {
  value: T
  label: string
}

// 循环间隔的常用档位，省得让人自己换算秒数。
const INTERVAL_PRESETS = [
  { value: 1800, label: '每 30 分钟' },
  { value: 3600, label: '每小时' },
  { value: 21600, label: '每 6 小时' },
  { value: 43200, label: '每 12 小时' },
  { value: 86400, label: '每天' },
]

const { showToast } = useToast()

const loading = ref(true)
const schedules = ref<ScheduleEntry[]>([])
const types = ref<Option<number>[]>([])
const actions = ref<Option<string>[]>([])

const createOpen = ref(false)
const creating = ref(false)
const createDialog = ref<HTMLElement | null>(null)
const deleteTarget = ref<ScheduleEntry | null>(null)
const deleting = ref(false)

const form = ref({
  name: '',
  type: 2,
  interval: 3600,
  cron: '0 5 * * *',
  at: '',
  count: -1,
  actionType: 'command',
  command: '',
})

const { apply: applyDialogAnimation } = useDialogAnimation()

const needsCommand = computed(() => form.value.actionType === 'command')
const canSubmit = computed(() => {
  if (!form.value.name.trim()) return false
  if (needsCommand.value && !form.value.command.trim()) return false
  if (form.value.type === 3 && !form.value.at.trim()) return false
  return true
})

function countLabel(count: number) {
  return count < 0 ? '无限次' : `${count} 次`
}

async function load() {
  if (!props.uuid) return
  loading.value = true
  try {
    const result = await $fetch<{ schedules: ScheduleEntry[]; types: Option<number>[]; actions: Option<string>[] }>(
      '/api/admin/mcsm/schedules',
      { query: { uuid: props.uuid, daemonId: props.daemonId } },
    )
    schedules.value = result.schedules
    types.value = result.types
    actions.value = result.actions
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '计划任务加载失败', 'error')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  if (!props.canEdit) return
  form.value = {
    name: '',
    type: 2,
    interval: 3600,
    cron: '0 5 * * *',
    at: '',
    count: -1,
    actionType: 'command',
    command: '',
  }
  createOpen.value = true
  applyDialogAnimation(createDialog.value)
}

async function submit() {
  if (!props.canEdit || creating.value || !canSubmit.value) return
  creating.value = true
  try {
    const time = form.value.type === 1
      ? form.value.interval
      : form.value.type === 2
        ? form.value.cron.trim()
        : form.value.at.trim()
    await $fetch('/api/admin/mcsm/schedules', {
      method: 'POST',
      body: {
        uuid: props.uuid,
        daemonId: props.daemonId,
        name: form.value.name.trim(),
        type: form.value.type,
        time,
        count: form.value.type === 3 ? 1 : form.value.count,
        actionType: form.value.actionType,
        command: needsCommand.value ? form.value.command.trim() : '',
      },
    })
    showToast('计划任务已创建')
    createOpen.value = false
    await load()
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '创建失败', 'error')
  } finally {
    creating.value = false
  }
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (!target || !props.canEdit || deleting.value) return
  deleting.value = true
  try {
    await $fetch('/api/admin/mcsm/schedules', {
      method: 'DELETE',
      body: { uuid: props.uuid, daemonId: props.daemonId, name: target.name },
    })
    showToast(`已删除计划任务 ${target.name}`)
    deleteTarget.value = null
    await load()
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '删除失败', 'error')
  } finally {
    deleting.value = false
  }
}

watch(() => [props.uuid, props.daemonId], () => void load(), { immediate: true })
</script>

<template>
  <section class="card">
    <div class="card-heading">
      <h2 class="card-title">计划任务</h2>
      <div class="heading-actions">
        <md-filled-button v-if="canEdit" :disabled="loading" @click="openCreate">
          <md-icon slot="icon">add</md-icon>
          新建任务
        </md-filled-button>
        <md-icon-button aria-label="刷新" title="刷新" :disabled="loading" @click="load">
          <md-icon>refresh</md-icon>
        </md-icon-button>
      </div>
    </div>

    <p class="card-note">
      面板限制单个实例的任务数量，超限会报错。<span v-if="!canEdit">当前账户没有「计划任务」权限，只能查看。</span>
    </p>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>任务名</th>
            <th>触发方式</th>
            <th>动作</th>
            <th>剩余次数</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="task in schedules" :key="task.name">
            <td class="primary-cell">{{ task.name }}</td>
            <td>
              {{ task.timeLabel }}
              <span class="badge">{{ task.typeLabel }}</span>
            </td>
            <td>
              <div v-for="(action, index) in task.actions" :key="index" class="action-cell">
                {{ action.typeLabel }}
                <code v-if="action.payload">{{ action.payload }}</code>
              </div>
              <span v-if="!task.actions.length" class="muted">（无动作）</span>
            </td>
            <td>{{ countLabel(task.count) }}</td>
            <td class="cell-actions">
              <md-icon-button
                v-if="canEdit"
                aria-label="删除任务"
                title="删除任务"
                @click="deleteTarget = task"
              >
                <md-icon>delete</md-icon>
              </md-icon-button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="loading" class="empty">加载中…</p>
      <p v-else-if="!schedules.length" class="empty">还没有计划任务</p>
    </div>

    <md-dialog ref="createDialog" :open="createOpen" @closed="createOpen = false">
      <md-icon slot="icon">schedule</md-icon>
      <div slot="headline">新建计划任务</div>
      <div slot="content" class="create-form">
        <md-outlined-text-field
          label="任务名"
          supporting-text="中文、字母、数字、点、下划线和短横线；删除时按这个名字定位"
          :value="form.name"
          @input="form.name = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>

        <md-outlined-select
          label="触发方式"
          :value="String(form.type)"
          @change="form.type = Number(($event.target as HTMLSelectElement).value)"
        >
          <md-select-option
            v-for="option in types"
            :key="option.value"
            :value="String(option.value)"
            :selected="option.value === form.type"
          >
            <div slot="headline">{{ option.label }}</div>
          </md-select-option>
        </md-outlined-select>

        <md-outlined-select
          v-if="form.type === 1"
          label="循环间隔"
          :value="String(form.interval)"
          @change="form.interval = Number(($event.target as HTMLSelectElement).value)"
        >
          <md-select-option
            v-for="option in INTERVAL_PRESETS"
            :key="option.value"
            :value="String(option.value)"
            :selected="option.value === form.interval"
          >
            <div slot="headline">{{ option.label }}</div>
          </md-select-option>
        </md-outlined-select>

        <md-outlined-text-field
          v-else-if="form.type === 2"
          label="cron 表达式"
          supporting-text="5 段或 6 段，例如 0 5 * * * 表示每天 05:00"
          :value="form.cron"
          @input="form.cron = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>

        <md-outlined-text-field
          v-else
          label="执行时刻"
          supporting-text="形如 2026-01-01 04:00:00，只执行一次"
          :value="form.at"
          @input="form.at = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>

        <md-outlined-select
          label="动作"
          :value="form.actionType"
          @change="form.actionType = ($event.target as HTMLSelectElement).value"
        >
          <md-select-option
            v-for="option in actions"
            :key="option.value"
            :value="option.value"
            :selected="option.value === form.actionType"
          >
            <div slot="headline">{{ option.label }}</div>
          </md-select-option>
        </md-outlined-select>

        <md-outlined-text-field
          v-if="needsCommand"
          label="命令"
          supporting-text="不需要前置斜杠，例如 say 服务器将在 5 分钟后重启"
          :value="form.command"
          @input="form.command = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>

        <md-outlined-select
          v-if="form.type !== 3"
          label="执行次数"
          :value="String(form.count)"
          @change="form.count = Number(($event.target as HTMLSelectElement).value)"
        >
          <md-select-option value="-1" :selected="form.count === -1">
            <div slot="headline">无限次</div>
          </md-select-option>
          <md-select-option value="1" :selected="form.count === 1">
            <div slot="headline">只执行 1 次</div>
          </md-select-option>
        </md-outlined-select>

        <p class="card-note">
          停止和重启类动作会踢掉所有在线玩家。建议先配一条定时公告提前通知，再配重启任务。
        </p>
      </div>
      <div slot="actions">
        <md-text-button :disabled="creating" @click="createOpen = false">取消</md-text-button>
        <md-text-button :disabled="creating || !canSubmit" @click="submit">
          {{ creating ? '创建中…' : '创建' }}
        </md-text-button>
      </div>
    </md-dialog>

    <ConfirmDialog
      :open="!!deleteTarget"
      title="删除计划任务"
      :message="`确定要删除计划任务「${deleteTarget?.name}」吗？`"
      icon="delete"
      confirm-label="删除"
      pending-label="删除中…"
      destructive
      :pending="deleting"
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
      @closed="deleteTarget = null"
    />
  </section>
</template>

<style scoped>
.card-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.heading-actions { display: flex; align-items: center; gap: 8px; }
.card-note { margin: 8px 0 0; font-size: 13px; line-height: 1.7; color: var(--md-sys-color-on-surface-variant); }
.table-wrap { overflow-x: auto; margin-top: 16px; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { padding: 12px 10px; border-bottom: 1px solid var(--md-sys-color-outline-variant); text-align: left; vertical-align: top; }
.data-table th { color: var(--md-sys-color-on-surface-variant); font-size: 12px; font-weight: 500; white-space: nowrap; }
.primary-cell { font-weight: 600; overflow-wrap: anywhere; }
.action-cell { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.action-cell code { padding: 1px 5px; border-radius: 4px; background: var(--md-sys-color-surface-variant); font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; overflow-wrap: anywhere; }
.muted { color: var(--md-sys-color-on-surface-variant); font-size: 13px; }
.badge { display: inline-block; margin-left: 6px; padding: 2px 8px; border-radius: 999px; font-size: 11px; line-height: 18px; background: var(--md-sys-color-surface-variant); color: var(--md-sys-color-on-surface-variant); }
.cell-actions { text-align: right; white-space: nowrap; }
.empty { padding: 16px 0; color: var(--md-sys-color-on-surface-variant); font-size: 14px; }
.create-form { display: flex; flex-direction: column; gap: 18px; min-width: min(420px, calc(100vw - 72px)); }
.create-form md-outlined-text-field, .create-form md-outlined-select { width: 100%; }
</style>
