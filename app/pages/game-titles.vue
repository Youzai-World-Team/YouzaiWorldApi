<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

useHead({ title: '玩家称号' })

type GrantSource = 'registration' | 'manual' | 'permission'

interface GameTitle {
  id: string
  display_name: string
  text_content: string
  text_color: string
  bold: boolean
  italic: boolean
  enabled: boolean
  sort_order: number
  system_managed: boolean
}

interface TitleGrant {
  title_id: string
  source: GrantSource
  source_key: string
  granted_by: string
  created_at: number
}

interface PlayerTitles {
  username: string
  uuid: string | null
  owned_title_ids: string[]
  equipped_title_id: string | null
  grants: TitleGrant[]
}

interface Overview {
  titles: GameTitle[]
  players: PlayerTitles[]
}

const access = useAdminAccess()
const canEditPage = computed(() => access.levelForKey('game-titles') === 'edit')
const canEditCatalog = computed(() => canEditPage.value && access.featureLevelForKey('game-titles-catalog') === 'edit')
const canEditGrants = computed(() => canEditPage.value && access.featureLevelForKey('game-titles-grants') === 'edit')
const { showToast } = useToast()

const overview = ref<Overview>({ titles: [], players: [] })
const loading = ref(false)
const activeView = ref<'catalog' | 'players'>('catalog')
const keyword = ref('')
const editTarget = ref<GameTitle | null>(null)
const editorOpen = ref(false)
const playerTarget = ref<PlayerTitles | null>(null)
const saving = ref(false)
const pendingOperation = ref('')
const editorDialog = ref<HTMLElement | null>(null)
const playerDialog = ref<HTMLElement | null>(null)
const titlesCatalogWrap = ref<HTMLElement | null>(null)
const titlesPlayersWrap = ref<HTMLElement | null>(null)
const titleGrantList = ref<HTMLElement | null>(null)
const { apply: applyDialogAnimation } = useDialogAnimation()

const form = ref({
  id: '',
  display_name: '',
  text_content: '',
  text_color: '#FFFFFF',
  bold: false,
  italic: false,
  enabled: true,
  sort_order: 0,
})

const titleMap = computed(() => new Map(overview.value.titles.map((title) => [title.id, title])))
const filteredPlayers = computed(() => {
  const query = keyword.value.trim().toLocaleLowerCase('zh-CN')
  if (!query) return overview.value.players
  return overview.value.players.filter((player) => player.username.toLocaleLowerCase('zh-CN').includes(query)
    || String(player.uuid || '').toLocaleLowerCase('en-US').includes(query))
})

function titleLabel(title: Pick<GameTitle, 'text_content' | 'display_name'>) {
  const text = title.text_content.trim() || title.display_name.trim()
  return text ? `{${text}}` : ''
}

function titleStyle(title: Pick<GameTitle, 'text_color' | 'bold' | 'italic'>) {
  return { color: title.text_color, fontWeight: title.bold ? '700' : '400', fontStyle: title.italic ? 'italic' : 'normal' }
}

function ownedTitleLabel(id: string) {
  const title = titleMap.value.get(id)
  return title ? titleLabel(title) : `{${id}}`
}

function sourceLabel(source: GrantSource) {
  if (source === 'permission') return '权限自动授予'
  if (source === 'registration') return '注册默认授予'
  return '后台手动授予'
}

function grantsFor(player: PlayerTitles | null | undefined, titleId: string) {
  return player?.grants?.filter((grant) => grant.title_id === titleId) ?? []
}

function hasEditableGrant(player: PlayerTitles | null | undefined, titleId: string) {
  return grantsFor(player, titleId).some((grant) => grant.source !== 'permission')
}

function equippedName(player: PlayerTitles) {
  return player.equipped_title_id ? ownedTitleLabel(player.equipped_title_id) : '不佩戴称号'
}

async function loadOverview() {
  loading.value = true
  try {
    overview.value = await $fetch<Overview>('/api/admin/game-titles')
    if (playerTarget.value) {
      playerTarget.value = overview.value.players.find((player) => player.username === playerTarget.value?.username) || null
    }
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '称号数据加载失败', 'error')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editTarget.value = null
  editorOpen.value = true
  form.value = {
    id: '', display_name: '', text_content: '', text_color: '#FFFFFF',
    bold: false, italic: false,
    enabled: true, sort_order: 0,
  }
}

function openEdit(title: GameTitle) {
  editTarget.value = title
  editorOpen.value = true
  form.value = {
    id: title.id,
    display_name: title.display_name,
    text_content: title.text_content,
    text_color: title.text_color,
    bold: title.bold,
    italic: title.italic,
    enabled: title.enabled,
    sort_order: title.sort_order,
  }
}

function closeEditor() {
  editorOpen.value = false
  editTarget.value = null
  form.value.id = ''
}

async function saveTitle() {
  if (!canEditCatalog.value) {
    showToast('当前账户没有称号目录的修改权限', 'error')
    return
  }
  if (saving.value) return
  saving.value = true
  try {
    const path = editTarget.value
      ? `/api/admin/game-titles/${encodeURIComponent(editTarget.value.id)}`
      : '/api/admin/game-titles'
    await $fetch(path, { method: editTarget.value ? 'PATCH' : 'POST', body: form.value })
    showToast(editTarget.value ? '称号已保存' : '称号已创建')
    closeEditor()
    await loadOverview()
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '称号保存失败', 'error')
  } finally {
    saving.value = false
  }
}

async function changeGrant(player: PlayerTitles, title: GameTitle, action: 'grant' | 'revoke') {
  if (!canEditGrants.value) {
    showToast('当前账户没有玩家称号授权权限', 'error')
    return
  }
  const operation = `${action}:${player.username}:${title.id}`
  if (pendingOperation.value) return
  pendingOperation.value = operation
  try {
    await $fetch('/api/admin/game-titles/grants', {
      method: 'POST',
      body: { username: player.username, title_id: title.id, action },
    })
    showToast(action === 'grant' ? '称号已授予' : '可回收的称号来源已移除')
    await loadOverview()
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '称号授权操作失败', 'error')
  } finally {
    if (pendingOperation.value === operation) pendingOperation.value = ''
  }
}

async function equipForPlayer(player: PlayerTitles, titleId: string | null) {
  if (!canEditGrants.value) {
    showToast('当前账户没有玩家称号授权权限', 'error')
    return
  }
  const operation = `equip:${player.username}:${titleId || 'none'}`
  if (pendingOperation.value) return
  pendingOperation.value = operation
  try {
    await $fetch('/api/admin/game-titles/selection', {
      method: 'PATCH', body: { username: player.username, title_id: titleId },
    })
    showToast(titleId ? '佩戴称号已更新' : '已卸下称号')
    await loadOverview()
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '佩戴状态更新失败', 'error')
  } finally {
    if (pendingOperation.value === operation) pendingOperation.value = ''
  }
}

function operationPending(operation: string, player: PlayerTitles, titleId: string | null) {
  return pendingOperation.value === `${operation}:${player.username}:${titleId || 'none'}`
}

onMounted(async () => {
  try {
    await access.load(true)
    await loadOverview()
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '称号管理初始化失败', 'error')
  }
  applyDialogAnimation(editorDialog.value)
  applyDialogAnimation(playerDialog.value)
})
</script>

<template>
  <div class="page api-redesign-page game-titles-page">
    <div class="page-heading">
      <div>
        <h1 class="page-title">玩家称号</h1>
      </div>
      <div class="heading-actions">
        <md-icon-button aria-label="刷新" title="刷新" :disabled="loading" @click="loadOverview">
          <md-icon :class="{ 'refresh-icon--loading': loading }">refresh</md-icon>
        </md-icon-button>
        <md-filled-button v-if="activeView === 'catalog' && canEditCatalog" @click="openCreate">
          <md-icon slot="icon">add</md-icon>新建称号
        </md-filled-button>
      </div>
    </div>

    <md-tabs class="view-switch" aria-label="称号管理视图">
      <md-primary-tab
        id="title-catalog-tab"
        aria-controls="title-catalog-panel"
        :active="activeView === 'catalog'"
        @click="activeView = 'catalog'"
      >称号目录</md-primary-tab>
      <md-primary-tab
        id="title-players-tab"
        aria-controls="title-players-panel"
        :active="activeView === 'players'"
        @click="activeView = 'players'"
      >玩家授权</md-primary-tab>
    </md-tabs>

    <div
      v-if="activeView === 'catalog'"
      id="title-catalog-panel"
      class="card table-card view-panel"
      role="tabpanel"
      aria-labelledby="title-catalog-tab"
    >
      <EmptyState v-if="loading" :illustrated="false">加载中…</EmptyState>
      <EmptyState v-else-if="!overview.titles.length" image="/images/empty-winner.svg">暂无称号</EmptyState>
      <div v-else ref="titlesCatalogWrap" class="table-wrap">
        <table>
          <thead><tr><th>佩戴预览</th><th>后台名称</th><th>ID</th><th>状态</th><th class="actions-column">操作</th></tr></thead>
          <tbody>
            <tr v-for="title in overview.titles" :key="title.id">
              <td>
                <span class="text-preview" :style="titleStyle(title)">{{ titleLabel(title) }}</span>
              </td>
              <td class="name">{{ title.display_name }}<span v-if="title.system_managed" class="system-badge">系统</span></td>
              <td class="mono">{{ title.id }}</td>
              <td><span class="status-dot" :class="{ disabled: !title.enabled }"></span>{{ title.enabled ? '启用' : '停用' }}</td>
              <td class="actions"><md-icon-button v-if="canEditCatalog" aria-label="编辑称号" @click="openEdit(title)"><md-icon>edit</md-icon></md-icon-button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <AppScrollbar :target="titlesCatalogWrap" axis="horizontal" label="称号目录表格横向滚动条" />
    </div>

    <div
      v-else
      id="title-players-panel"
      class="view-panel"
      role="tabpanel"
      aria-labelledby="title-players-tab"
    >
      <md-outlined-text-field class="player-search" label="搜索玩家或 UUID" :value="keyword" @input="keyword = ($event.target as HTMLInputElement).value">
        <md-icon slot="leading-icon">search</md-icon>
      </md-outlined-text-field>
      <div class="card table-card">
        <div v-if="loading" class="empty">加载中…</div>
        <EmptyState v-else-if="!filteredPlayers.length" image="/images/empty-looking-for-answers.svg">
          <template #title>没有匹配的玩家</template>
          尝试调整搜索条件。
        </EmptyState>
        <div v-else ref="titlesPlayersWrap" class="table-wrap">
          <table>
            <thead><tr><th>玩家</th><th>当前佩戴</th><th>已拥有</th><th class="actions-column">操作</th></tr></thead>
            <tbody>
              <tr v-for="player in filteredPlayers" :key="player.username">
                <td><strong>{{ player.username }}</strong><div class="mono subline">{{ player.uuid || '未绑定 UUID' }}</div></td>
                <td>{{ equippedName(player) }}</td>
                <td><span v-if="!player.owned_title_ids.length" class="muted">无</span><span v-for="id in player.owned_title_ids" :key="id" class="title-chip">{{ ownedTitleLabel(id) }}</span></td>
                <td class="actions"><md-icon-button aria-label="管理玩家称号" @click="playerTarget = player"><md-icon>manage_accounts</md-icon></md-icon-button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <AppScrollbar :target="titlesPlayersWrap" axis="horizontal" label="玩家称号表格横向滚动条" />
      </div>
    </div>

    <md-dialog ref="editorDialog" :open="editorOpen" :aria-busy="saving ? 'true' : 'false'" @closed="closeEditor">
      <div slot="headline">{{ editTarget ? '编辑称号' : '新建称号' }}</div>
      <div slot="content" class="dialog-form title-editor">
        <div class="two-columns">
          <md-outlined-text-field label="称号 ID" :readonly="!!editTarget" :value="form.id" @input="form.id = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
          <md-outlined-text-field label="后台显示名称" :value="form.display_name" @input="form.display_name = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
        </div>
        <md-outlined-text-field label="称号文字" maxlength="64" :value="form.text_content" @input="form.text_content = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
        <div class="title-preview" aria-live="polite">
          <span class="preview-label">佩戴预览</span>
          <span class="text-preview" :style="titleStyle(form)">{{ titleLabel(form) || '输入称号文字后预览' }}</span>
        </div>
        <div class="two-columns">
          <md-outlined-text-field label="文字颜色" :value="form.text_color" @input="form.text_color = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
          <md-outlined-text-field type="number" label="排序" :value="String(form.sort_order)" @input="form.sort_order = Number(($event.target as HTMLInputElement).value) || 0"></md-outlined-text-field>
        </div>
        <div class="check-row"><label><md-checkbox :checked="form.bold" @change="form.bold = !form.bold"></md-checkbox>粗体</label><label><md-checkbox :checked="form.italic" @change="form.italic = !form.italic"></md-checkbox>斜体</label><label><md-checkbox :checked="form.enabled" @change="form.enabled = !form.enabled"></md-checkbox>启用</label></div>
      </div>
      <div slot="actions"><md-text-button :disabled="saving" @click="closeEditor">取消</md-text-button><md-filled-button :disabled="saving" @click="saveTitle">{{ saving ? '保存中…' : '保存' }}</md-filled-button></div>
    </md-dialog>

    <md-dialog ref="playerDialog" :open="!!playerTarget" :aria-busy="pendingOperation ? 'true' : 'false'" @closed="playerTarget = null">
      <div slot="headline">管理 {{ playerTarget?.username }} 的称号</div>
      <div slot="content" ref="titleGrantList" class="grant-list">
        <template v-if="playerTarget">
          <div class="unequip-row"><span>当前佩戴：{{ equippedName(playerTarget) }}</span><md-text-button v-if="canEditGrants" :disabled="!!pendingOperation || !playerTarget.equipped_title_id" @click="equipForPlayer(playerTarget, null)">{{ operationPending('equip', playerTarget, null) ? '卸下中…' : '不佩戴称号' }}</md-text-button></div>
          <div v-for="title in overview.titles" :key="title.id" class="grant-row">
            <div><span class="text-preview" :style="titleStyle(title)">{{ titleLabel(title) }}</span><span v-if="!title.enabled" class="disabled-badge">已停用</span><div class="source-list"><span v-for="grant in grantsFor(playerTarget, title.id)" :key="`${grant.source}-${grant.source_key}`">{{ sourceLabel(grant.source) }}</span><span v-if="!grantsFor(playerTarget, title.id).length">尚未拥有</span></div></div>
            <div class="grant-actions">
              <md-icon-button v-if="canEditGrants && title.enabled && playerTarget.owned_title_ids.includes(title.id) && playerTarget.equipped_title_id !== title.id" aria-label="佩戴称号" title="佩戴称号" :disabled="!!pendingOperation" @click="equipForPlayer(playerTarget, title.id)"><md-icon>{{ operationPending('equip', playerTarget, title.id) ? 'progress_activity' : 'check_circle' }}</md-icon></md-icon-button>
              <md-icon-button v-if="canEditGrants && title.enabled && !playerTarget.owned_title_ids.includes(title.id)" aria-label="授予称号" title="授予称号" :disabled="!!pendingOperation" @click="changeGrant(playerTarget, title, 'grant')"><md-icon>{{ operationPending('grant', playerTarget, title.id) ? 'progress_activity' : 'add_circle' }}</md-icon></md-icon-button>
              <md-icon-button v-if="canEditGrants && hasEditableGrant(playerTarget, title.id)" aria-label="回收称号" title="仅回收注册和手动来源" :disabled="!!pendingOperation" @click="changeGrant(playerTarget, title, 'revoke')"><md-icon>{{ operationPending('revoke', playerTarget, title.id) ? 'progress_activity' : 'remove_circle' }}</md-icon></md-icon-button>
            </div>
          </div>
        </template>
      </div>
      <AppScrollbar :target="titleGrantList" label="称号授予记录滚动条" />
      <AppScrollbar :target="titleGrantList" axis="horizontal" label="称号授予记录横向滚动条" />
      <div slot="actions"><md-text-button :disabled="!!pendingOperation" @click="playerTarget = null">关闭</md-text-button></div>
    </md-dialog>
  </div>
</template>

<style scoped>
.page-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.page-heading .page-title { margin-bottom: 18px; }
.heading-actions, .grant-actions, .check-row, .two-columns, .unequip-row { display: flex; align-items: center; gap: 8px; }
.heading-actions { flex: 0 0 auto; }
.view-switch { width: min(320px, 100%); margin-bottom: 18px; }
.view-panel { min-width: 0; }
.table-card { overflow: hidden; }
.table-wrap { width: 100%; max-width: 100%; overflow: auto; }
table { width: 100%; min-width: 640px; border-collapse: collapse; }
th, td { text-align: left; padding: 13px 16px; border-bottom: 1px solid var(--md-sys-color-outline-variant); vertical-align: middle; }
th { font-size: 13px; color: var(--md-sys-color-on-surface-variant); font-weight: 600; white-space: nowrap; }
.actions-column { width: 64px; }
.actions { text-align: right; }
.text-preview { display: inline-block; max-width: 100%; padding: 5px 10px; border-radius: 8px; background: #172723; overflow-wrap: anywhere; line-height: 1.5; }
.title-preview { display: flex; align-items: flex-start; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: 12px; background: var(--md-sys-color-surface-container-high); }
.preview-label { font-size: 12px; color: var(--md-sys-color-on-surface-variant); }
.name { font-weight: 600; }
.system-badge, .disabled-badge, .title-chip, .source-list span { display: inline-block; margin-left: 7px; padding: 2px 6px; border-radius: 5px; background: var(--md-sys-color-surface-container-high); font-size: 12px; font-weight: 400; }
.disabled-badge { color: var(--md-sys-color-error); }
.status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; background: var(--act-success); }
.status-dot.disabled { background: var(--md-sys-color-outline); }
.player-search { width: min(420px, 100%); margin-bottom: 14px; }
.subline { margin-top: 4px; font-size: 12px; color: var(--md-sys-color-on-surface-variant); }
.muted, .source-list { color: var(--md-sys-color-on-surface-variant); }
.dialog-form { width: min(520px, calc(100vw - 72px)); min-width: 0; display: grid; gap: 14px; padding-top: 8px; }
.two-columns { align-items: stretch; }
.two-columns > * { flex: 1; min-width: 0; }
.check-row { flex-wrap: wrap; }
.check-row label { display: flex; align-items: center; gap: 3px; }
.grant-list { width: min(560px, calc(100vw - 72px)); min-width: 0; display: grid; gap: 0; max-height: 65vh; overflow: auto; }
.unequip-row, .grant-row { justify-content: space-between; padding: 12px 2px; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
.unequip-row { flex-wrap: wrap; }
.unequip-row md-text-button { flex: 0 0 auto; }
.grant-row { display: flex; align-items: center; gap: 16px; }
.grant-row > div:first-child { min-width: 0; }
.grant-actions { flex: 0 0 auto; }
.source-list { margin-top: 4px; font-size: 12px; overflow-wrap: anywhere; }
.source-list span { margin: 0 5px 0 0; }
.empty { padding: 42px 16px; text-align: center; color: var(--md-sys-color-on-surface-variant); }
.mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }

@media (max-width: 700px) {
  .page-heading { align-items: stretch; flex-direction: column; }
  .page-heading .page-title { margin-bottom: 0; }
  .heading-actions { width: 100%; justify-content: flex-end; flex-wrap: wrap; }
  .heading-actions md-filled-button { flex: 1 1 auto; }
  .view-switch { width: 100%; }
  table { min-width: 540px; }
  th:nth-child(3), td:nth-child(3) { display: none; }
  .two-columns { display: grid; grid-template-columns: minmax(0, 1fr); }
  .dialog-form, .grant-list { width: 100%; }
  .grant-row { align-items: flex-start; }
  .grant-row > div:first-child { flex: 1; }
  .title-chip { margin-top: 4px; }
}
</style>
