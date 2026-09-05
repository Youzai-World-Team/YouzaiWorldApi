<script setup lang="ts">
import { computed, ref, watch } from 'vue'

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

interface FormAction {
  type: string
  payload: string
}

interface ScheduleForm {
  name: string
  type: number
  intervalDays: number
  intervalHours: number
  intervalMinutes: number
  intervalSeconds: number
  weeklyTime: string
  weekdays: number[]
  specifiedMonth: number
  specifiedDay: number
  specifiedTime: string
  count: number
  actions: FormAction[]
}

const MAX_ACTIONS = 10
const SUPPORTED_TYPES = new Set([1, 2, 3])
const WEEKDAYS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' },
]

const { showToast } = useToast()
const { apply: applyDialogAnimation } = useDialogAnimation()

const loading = ref(true)
const schedules = ref<ScheduleEntry[]>([])
const types = ref<Option<number>[]>([])
const actions = ref<Option<string>[]>([])
const dialogOpen = ref(false)
const editing = ref(false)
const saving = ref(false)
const scheduleDialog = ref<HTMLElement | null>(null)
const schedulesTableWrap = ref<HTMLElement | null>(null)
const deleteTarget = ref<ScheduleEntry | null>(null)
const deleting = ref(false)

function defaultForm(): ScheduleForm {
  return {
    name: '',
    type: 1,
    intervalDays: 0,
    intervalHours: 1,
    intervalMinutes: 0,
    intervalSeconds: 0,
    weeklyTime: '05:00:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    specifiedMonth: 1,
    specifiedDay: 1,
    specifiedTime: '05:00:00',
    count: -1,
    actions: [{ type: 'command', payload: '' }],
  }
}

const form = ref<ScheduleForm>(defaultForm())

const actionValues = computed(() => new Set(actions.value.map((option) => option.value)))
const intervalTotalSeconds = computed(() => (
  Math.max(0, Math.trunc(form.value.intervalDays || 0)) * 86400
  + Math.max(0, Math.trunc(form.value.intervalHours || 0)) * 3600
  + Math.max(0, Math.trunc(form.value.intervalMinutes || 0)) * 60
  + Math.max(0, Math.trunc(form.value.intervalSeconds || 0))
))
const hasPowerAction = computed(() => form.value.actions.some((action) => ['stop', 'restart', 'kill'].includes(action.type)))
const hasBackupAction = computed(() => form.value.actions.some((action) => action.type === 'backup'))
const canSubmit = computed(() => {
  if (!form.value.name.trim() || !SUPPORTED_TYPES.has(form.value.type)) return false
  if (form.value.type === 1 && (intervalTotalSeconds.value < 3 || intervalTotalSeconds.value > 2592000)) return false
  if (form.value.type === 2 && (!form.value.weeklyTime || form.value.weekdays.length === 0)) return false
  if (form.value.type === 3 && !validSpecifiedDate(
    form.value.specifiedMonth,
    form.value.specifiedDay,
    form.value.specifiedTime,
  )) return false
  if (form.value.type !== 3 && form.value.count !== -1
      && (form.value.count < 1 || form.value.count > 9999)) return false
  if (form.value.actions.length === 0 || form.value.actions.length > MAX_ACTIONS) return false
  return form.value.actions.every((action) => {
    if (!actionValues.value.has(action.type)) return false
    if (action.type === 'command') return Boolean(action.payload.trim())
    if (action.type === 'delay') {
      const delay = Number(action.payload)
      return Number.isInteger(delay) && delay >= 1 && delay <= 86400000
    }
    return true
  })
})

function errorMessage(error: any, fallback: string) {
  return error?.data?.statusMessage || error?.statusMessage || fallback
}

function countLabel(count: number) {
  return count < 0 ? '无限次' : `${count} 次`
}

function twoDigits(value: number) {
  return String(value).padStart(2, '0')
}

function parseClock(value: string): { hours: number; minutes: number; seconds: number } | null {
  const match = value.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3] || 0)
  if (hours > 23 || minutes > 59 || seconds > 59) return null
  return { hours, minutes, seconds }
}

function validSpecifiedDate(month: number, day: number, time: string) {
  const clock = parseClock(time)
  if (!clock || !Number.isInteger(month) || !Number.isInteger(day)) return false
  const probe = new Date(Date.UTC(2024, month - 1, day))
  return month >= 1 && month <= 12 && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
}

function scheduleTime(): string {
  if (form.value.type === 1) return String(intervalTotalSeconds.value)
  if (form.value.type === 2) {
    const clock = parseClock(form.value.weeklyTime)
    if (!clock) return ''
    const weekdays = [...new Set(form.value.weekdays)].sort((a, b) => a - b)
    return `${clock.seconds} ${clock.minutes} ${clock.hours} * * ${weekdays.join(',')}`
  }
  const clock = parseClock(form.value.specifiedTime)
  if (!clock) return ''
  return `${clock.seconds} ${clock.minutes} ${clock.hours} ${form.value.specifiedDay} ${form.value.specifiedMonth} *`
}

function isEditable(task: ScheduleEntry) {
  return SUPPORTED_TYPES.has(task.type) && task.actions.length > 0
    && task.actions.every((action) => actionValues.value.has(action.type))
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
    showToast(errorMessage(error, '计划任务加载失败'), 'error')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  if (!props.canEdit) return
  editing.value = false
  form.value = defaultForm()
  dialogOpen.value = true
  applyDialogAnimation(scheduleDialog.value)
}

function openEdit(task: ScheduleEntry) {
  if (!props.canEdit || !isEditable(task)) return
  const next = defaultForm()
  next.name = task.name
  next.type = task.type
  next.count = task.type === 3 ? 1 : task.count
  next.actions = task.actions.map((action) => ({ type: action.type, payload: action.payload }))

  if (task.type === 1) {
    const seconds = Math.max(0, Number(task.time) || 0)
    next.intervalDays = Math.floor(seconds / 86400)
    next.intervalHours = Math.floor((seconds % 86400) / 3600)
    next.intervalMinutes = Math.floor((seconds % 3600) / 60)
    next.intervalSeconds = seconds % 60
  } else if (task.type === 2) {
    const match = task.time.match(/^(\d{1,2}) (\d{1,2}) (\d{1,2}) \* \* ([1-7](?:,[1-7])*)$/)
    if (match) {
      next.weeklyTime = `${twoDigits(Number(match[3]))}:${twoDigits(Number(match[2]))}:${twoDigits(Number(match[1]))}`
      next.weekdays = [...new Set(match[4]!.split(',').map(Number))]
    }
  } else {
    const match = task.time.match(/^(\d{1,2}) (\d{1,2}) (\d{1,2}) (\d{1,2}) (\d{1,2}) \*$/)
    if (match) {
      next.specifiedMonth = Number(match[5])
      next.specifiedDay = Number(match[4])
      next.specifiedTime = `${twoDigits(Number(match[3]))}:${twoDigits(Number(match[2]))}:${twoDigits(Number(match[1]))}`
    }
  }

  editing.value = true
  form.value = next
  dialogOpen.value = true
  applyDialogAnimation(scheduleDialog.value)
}

function toggleWeekday(value: number) {
  form.value.weekdays = form.value.weekdays.includes(value)
    ? form.value.weekdays.filter((item) => item !== value)
    : [...form.value.weekdays, value].sort((a, b) => a - b)
}

function addAction() {
  if (form.value.actions.length >= MAX_ACTIONS) return
  form.value.actions.push({ type: 'command', payload: '' })
}

function removeAction(index: number) {
  if (form.value.actions.length <= 1) return
  form.value.actions.splice(index, 1)
}

function moveAction(index: number, offset: number) {
  const target = index + offset
  if (target < 0 || target >= form.value.actions.length) return
  const [action] = form.value.actions.splice(index, 1)
  if (action) form.value.actions.splice(target, 0, action)
}

function setActionType(index: number, value: string) {
  const action = form.value.actions[index]
  if (!action) return
  action.type = value
  action.payload = ''
}

function actionPayloadLabel(type: string) {
  return type === 'delay' ? '毫秒' : '命令'
}

function actionPayloadHint(action: FormAction | ScheduleAction) {
  if (action.type === 'delay') return `${action.payload || 0} ms`
  return action.payload
}

async function submit() {
  if (!props.canEdit || saving.value || !canSubmit.value) return
  saving.value = true
  try {
    await $fetch('/api/admin/mcsm/schedules', {
      method: editing.value ? 'PATCH' : 'POST',
      body: {
        uuid: props.uuid,
        daemonId: props.daemonId,
        name: form.value.name.trim(),
        type: form.value.type,
        time: scheduleTime(),
        count: form.value.type === 3 ? 1 : form.value.count,
        actions: form.value.actions.map((action) => ({
          type: action.type,
          payload: ['command', 'delay'].includes(action.type) ? action.payload.trim() : '',
        })),
      },
    })
    showToast(editing.value ? '计划任务已更新' : '计划任务已创建')
    dialogOpen.value = false
    await load()
  } catch (error: any) {
    showToast(errorMessage(error, editing.value ? '更新失败' : '创建失败'), 'error')
  } finally {
    saving.value = false
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
    showToast(errorMessage(error, '删除失败'), 'error')
  } finally {
    deleting.value = false
  }
}

watch(() => [props.uuid, props.daemonId], () => void load(), { immediate: true })
</script>

<template>
  <section class="card schedule-section">
    <div class="card-heading">
      <div>
        <h2 class="card-title">计划任务</h2>
        <p class="card-note">每个实例最多 8 个任务，每个任务最多 10 个顺序动作。</p>
      </div>
      <div class="heading-actions">
        <md-filled-button v-if="canEdit" :disabled="loading" @click="openCreate">
          <md-icon slot="icon">add</md-icon>
          新建任务
        </md-filled-button>
        <md-icon-button aria-label="刷新计划任务" title="刷新计划任务" :disabled="loading" @click="load">
          <md-icon>refresh</md-icon>
        </md-icon-button>
      </div>
    </div>

    <p v-if="!canEdit" class="card-note">当前账户只能查看计划任务。</p>

    <div ref="schedulesTableWrap" class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>任务名</th>
            <th>触发方式</th>
            <th>动作链</th>
            <th>剩余次数</th>
            <th class="cell-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="task in schedules" :key="task.name">
            <td class="primary-cell">{{ task.name }}</td>
            <td>
              <div>{{ task.timeLabel }}</div>
              <span class="badge">{{ task.typeLabel }}</span>
            </td>
            <td>
              <ol v-if="task.actions.length" class="action-summary">
                <li v-for="(action, index) in task.actions" :key="index">
                  <span>{{ action.typeLabel }}</span>
                  <code v-if="action.payload">{{ actionPayloadHint(action) }}</code>
                </li>
              </ol>
              <span v-else class="muted">无动作</span>
            </td>
            <td>{{ countLabel(task.count) }}</td>
            <td class="cell-actions">
              <md-icon-button
                v-if="canEdit"
                aria-label="编辑任务"
                :title="isEditable(task) ? '编辑任务' : '该任务含未知类型，不能在此编辑'"
                :disabled="!isEditable(task)"
                @click="openEdit(task)"
              >
                <md-icon>edit</md-icon>
              </md-icon-button>
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
      <EmptyState v-else-if="!schedules.length" compact image="/images/empty-monitoring-data.svg">
        暂无计划任务
      </EmptyState>
    </div>
    <AppScrollbar :target="schedulesTableWrap" axis="horizontal" label="计划任务表格横向滚动条" />

    <md-dialog ref="scheduleDialog" :open="dialogOpen" @closed="dialogOpen = false">
      <md-icon slot="icon">schedule</md-icon>
      <div slot="headline">{{ editing ? '编辑计划任务' : '新建计划任务' }}</div>
      <div slot="content" class="schedule-form">
        <md-outlined-text-field
          label="任务名"
          :disabled="editing"
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

        <div v-if="form.type === 1" class="interval-grid">
          <md-outlined-text-field type="number" min="0" max="30" label="天" :value="String(form.intervalDays)" @input="form.intervalDays = Number(($event.target as HTMLInputElement).value)"></md-outlined-text-field>
          <md-outlined-text-field type="number" min="0" max="23" label="小时" :value="String(form.intervalHours)" @input="form.intervalHours = Number(($event.target as HTMLInputElement).value)"></md-outlined-text-field>
          <md-outlined-text-field type="number" min="0" max="59" label="分钟" :value="String(form.intervalMinutes)" @input="form.intervalMinutes = Number(($event.target as HTMLInputElement).value)"></md-outlined-text-field>
          <md-outlined-text-field type="number" min="0" max="59" label="秒" :value="String(form.intervalSeconds)" @input="form.intervalSeconds = Number(($event.target as HTMLInputElement).value)"></md-outlined-text-field>
        </div>

        <template v-else-if="form.type === 2">
          <md-outlined-text-field
            type="time"
            step="1"
            label="执行时间"
            :value="form.weeklyTime"
            @input="form.weeklyTime = ($event.target as HTMLInputElement).value"
          ></md-outlined-text-field>
          <div class="weekday-grid" aria-label="执行星期">
            <label v-for="weekday in WEEKDAYS" :key="weekday.value" class="check-row">
              <md-checkbox
                :checked="form.weekdays.includes(weekday.value)"
                @change="toggleWeekday(weekday.value)"
              ></md-checkbox>
              <span>{{ weekday.label }}</span>
            </label>
          </div>
        </template>

        <div v-else class="specified-grid">
          <md-outlined-text-field type="number" min="1" max="12" label="月" :value="String(form.specifiedMonth)" @input="form.specifiedMonth = Number(($event.target as HTMLInputElement).value)"></md-outlined-text-field>
          <md-outlined-text-field type="number" min="1" max="31" label="日" :value="String(form.specifiedDay)" @input="form.specifiedDay = Number(($event.target as HTMLInputElement).value)"></md-outlined-text-field>
          <md-outlined-text-field type="time" step="1" label="执行时间" :value="form.specifiedTime" @input="form.specifiedTime = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
        </div>

        <md-outlined-text-field
          v-if="form.type !== 3"
          type="number"
          min="-1"
          max="9999"
          label="执行次数"
          supporting-text="-1 表示无限次"
          :value="String(form.count)"
          @input="form.count = Number(($event.target as HTMLInputElement).value)"
        ></md-outlined-text-field>

        <div class="actions-heading">
          <h3>顺序动作</h3>
          <md-outlined-button :disabled="form.actions.length >= MAX_ACTIONS" @click="addAction">
            <md-icon slot="icon">add</md-icon>
            添加动作
          </md-outlined-button>
        </div>

        <div class="actions-list">
          <div v-for="(action, index) in form.actions" :key="index" class="action-row">
            <span class="action-index">{{ index + 1 }}</span>
            <md-outlined-select
              label="动作"
              :value="action.type"
              @change="setActionType(index, ($event.target as HTMLSelectElement).value)"
            >
              <md-select-option
                v-for="option in actions"
                :key="option.value"
                :value="option.value"
                :selected="option.value === action.type"
              >
                <div slot="headline">{{ option.label }}</div>
              </md-select-option>
            </md-outlined-select>
            <md-outlined-text-field
              v-if="action.type === 'command' || action.type === 'delay'"
              :type="action.type === 'delay' ? 'number' : 'text'"
              :min="action.type === 'delay' ? '1' : undefined"
              :max="action.type === 'delay' ? '86400000' : undefined"
              :label="actionPayloadLabel(action.type)"
              :value="action.payload"
              @input="action.payload = ($event.target as HTMLInputElement).value"
            ></md-outlined-text-field>
            <span v-else class="action-no-input">无需参数</span>
            <div class="action-tools">
              <md-icon-button aria-label="上移动作" title="上移" :disabled="index === 0" @click="moveAction(index, -1)">
                <md-icon>arrow_upward</md-icon>
              </md-icon-button>
              <md-icon-button aria-label="下移动作" title="下移" :disabled="index === form.actions.length - 1" @click="moveAction(index, 1)">
                <md-icon>arrow_downward</md-icon>
              </md-icon-button>
              <md-icon-button aria-label="删除动作" title="删除动作" :disabled="form.actions.length === 1" @click="removeAction(index)">
                <md-icon>delete</md-icon>
              </md-icon-button>
            </div>
          </div>
        </div>

        <p v-if="hasBackupAction" class="warning-note">
          <md-icon>warning</md-icon>
          备份动作会在触发时自动停止正在运行的实例。
        </p>
        <p v-if="hasPowerAction" class="warning-note">
          <md-icon>warning</md-icon>
          停止、重启和强制结束动作会断开在线玩家。
        </p>
      </div>
      <div slot="actions">
        <md-text-button :disabled="saving" @click="dialogOpen = false">取消</md-text-button>
        <md-text-button :disabled="saving || !canSubmit" @click="submit">
          {{ saving ? '保存中…' : editing ? '保存' : '创建' }}
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
.action-summary { display: flex; flex-direction: column; gap: 5px; margin: 0; padding-left: 22px; }
.action-summary li { padding-left: 2px; }
.action-summary code { margin-left: 6px; padding: 1px 5px; border-radius: 4px; background: var(--md-sys-color-surface-variant); font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; overflow-wrap: anywhere; }
.muted { color: var(--md-sys-color-on-surface-variant); font-size: 13px; }
.badge { display: inline-block; margin-top: 5px; padding: 2px 8px; border-radius: 999px; font-size: 11px; line-height: 18px; background: var(--md-sys-color-surface-variant); color: var(--md-sys-color-on-surface-variant); }
.cell-actions { text-align: right; white-space: nowrap; }
.empty { padding: 16px 0; color: var(--md-sys-color-on-surface-variant); font-size: 14px; }
.schedule-form { display: flex; flex-direction: column; gap: 18px; width: min(720px, calc(100vw - 72px)); }
.schedule-form > md-outlined-text-field, .schedule-form > md-outlined-select { width: 100%; }
.interval-grid { display: grid; grid-template-columns: repeat(4, minmax(100px, 1fr)); gap: 10px; }
.specified-grid { display: grid; grid-template-columns: minmax(90px, 0.5fr) minmax(90px, 0.5fr) minmax(180px, 1fr); gap: 10px; }
.weekday-grid { display: grid; grid-template-columns: repeat(4, minmax(90px, 1fr)); gap: 6px 12px; }
.check-row { display: flex; align-items: center; gap: 6px; min-height: 40px; cursor: pointer; }
.actions-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.actions-heading h3 { margin: 0; font-size: 14px; }
.actions-list { border-top: 1px solid var(--md-sys-color-outline-variant); }
.action-row { display: grid; grid-template-columns: 28px minmax(160px, 0.8fr) minmax(180px, 1.2fr) auto; align-items: center; gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
.action-index { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--md-sys-color-secondary-container); color: var(--md-sys-color-on-secondary-container); font-size: 12px; }
.action-row md-outlined-select, .action-row md-outlined-text-field { width: 100%; }
.action-no-input { color: var(--md-sys-color-on-surface-variant); font-size: 12px; }
.action-tools { display: flex; align-items: center; }
.warning-note { display: flex; align-items: flex-start; gap: 8px; margin: 0; color: var(--md-sys-color-error); font-size: 13px; line-height: 1.6; }
.warning-note md-icon { flex: 0 0 auto; font-size: 20px; }

@media (max-width: 720px) {
  .heading-actions { width: 100%; justify-content: flex-end; }
  .schedule-form { width: 100%; }
  .interval-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .specified-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .specified-grid > :last-child { grid-column: 1 / -1; }
  .weekday-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .action-row { grid-template-columns: 28px minmax(0, 1fr); }
  .action-row > md-outlined-text-field, .action-row > .action-no-input, .action-tools { grid-column: 2; }
  .action-tools { justify-content: flex-end; }
}
</style>
