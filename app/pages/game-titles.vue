<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

useHead({ title: '玩家称号' })

type RenderType = 'text' | 'texture' | 'text_texture'
type GrantSource = 'registration' | 'manual' | 'permission'

interface GameTitle {
  id: string
  display_name: string
  render_type: RenderType
  text_content: string
  text_color: string
  bold: boolean
  italic: boolean
  texture_key: string
  font_id: string
  glyph: string
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
const { apply: applyDialogAnimation } = useDialogAnimation()

const form = ref({
  id: '',
  display_name: '',
  render_type: 'text' as RenderType,
  text_content: '',
  text_color: '#FFFFFF',
  bold: false,
  italic: false,
  texture_key: '',
  font_id: 'youzaiworldcore:title',
  glyph: '',
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

function textureUrl(title: GameTitle) {
  const key = title.texture_key.split('/').map((part) => encodeURIComponent(part)).join('/')
  return title.texture_key
    ? `https://assets.mcyzw.top/images/titles/${key}.png`
    : ''
}

function sourceLabel(source: GrantSource) {
  if (source === 'permission') return '权限自动授予'
  if (source === 'registration') return '注册默认授予'
  return '后台手动授予'
}

function grantsFor(player: PlayerTitles, titleId: string) {
  return player.grants.filter((grant) => grant.title_id === titleId)
}

function hasEditableGrant(player: PlayerTitles, titleId: string) {
  return grantsFor(player, titleId).some((grant) => grant.source !== 'permission')
}

function equippedName(player: PlayerTitles) {
  return player.equipped_title_id ? titleMap.value.get(player.equipped_title_id)?.display_name || player.equipped_title_id : '未佩戴'
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
    id: '', display_name: '', render_type: 'text', text_content: '', text_color: '#FFFFFF',
    bold: false, italic: false, texture_key: '', font_id: 'youzaiworldcore:title', glyph: '',
    enabled: true, sort_order: 0,
  }
}

function openEdit(title: GameTitle) {
  editTarget.value = title
  editorOpen.value = true
  form.value = {
    id: title.id,
    display_name: title.display_name,
    render_type: title.render_type,
    text_content: title.text_content,
    text_color: title.text_color,
    bold: title.bold,
    italic: title.italic,
    texture_key: title.texture_key,
    font_id: title.font_id,
    glyph: title.glyph,
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

function setRenderType(event: Event) {
  form.value.render_type = (event.target as HTMLSelectElement).value as RenderType
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
  <div class="page">
    <div class="page-heading">
      <div>
        <h1 class="page-title">玩家称号</h1>
      </div>
      <div class="heading-actions">
        <md-icon-button aria-label="刷新" :disabled="loading" @click="loadOverview">
          <md-icon :class="{ 'refresh-icon--loading': loading }">refresh</md-icon>
        </md-icon-button>
        <md-filled-button v-if="activeView === 'catalog' && canEditCatalog" @click="openCreate">
          <md-icon slot="icon">add</md-icon>新建称号
        </md-filled-button>
      </div>
    </div>

    <div class="view-switch" role="tablist" aria-label="称号管理视图">
      <button :class="{ active: activeView === 'catalog' }" @click="activeView = 'catalog'">称号目录</button>
      <button :class="{ active: activeView === 'players' }" @click="activeView = 'players'">玩家授权</button>
    </div>

    <div v-if="activeView === 'catalog'" class="card table-card">
      <div v-if="loading" class="empty">加载中…</div>
      <div v-else-if="!overview.titles.length" class="empty">暂无称号</div>
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th>预览</th><th>称号</th><th>ID</th><th>类型</th><th>状态</th><th class="actions-column">操作</th></tr></thead>
          <tbody>
            <tr v-for="title in overview.titles" :key="title.id">
              <td>
                <img v-if="title.texture_key" class="title-image" :src="textureUrl(title)" :alt="title.display_name">
                <span v-else class="text-preview" :style="{ color: title.text_color, fontWeight: title.bold ? '700' : '400', fontStyle: title.italic ? 'italic' : 'normal' }">{{ title.text_content }}</span>
              </td>
              <td class="name">{{ title.display_name }}<span v-if="title.system_managed" class="system-badge">系统</span></td>
              <td class="mono">{{ title.id }}</td>
              <td>{{ title.render_type === 'text' ? '文字' : title.render_type === 'texture' ? '贴图' : '文字 + 贴图' }}</td>
              <td><span class="status-dot" :class="{ disabled: !title.enabled }"></span>{{ title.enabled ? '启用' : '停用' }}</td>
              <td class="actions"><md-icon-button v-if="canEditCatalog" aria-label="编辑称号" @click="openEdit(title)"><md-icon>edit</md-icon></md-icon-button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <template v-else>
      <md-outlined-text-field class="player-search" label="搜索玩家或 UUID" :value="keyword" @input="keyword = ($event.target as HTMLInputElement).value">
        <md-icon slot="leading-icon">search</md-icon>
      </md-outlined-text-field>
      <div class="card table-card">
        <div v-if="loading" class="empty">加载中…</div>
        <div v-else-if="!filteredPlayers.length" class="empty">没有匹配的玩家</div>
        <div v-else class="table-wrap">
          <table>
            <thead><tr><th>玩家</th><th>当前佩戴</th><th>已拥有</th><th class="actions-column">操作</th></tr></thead>
            <tbody>
              <tr v-for="player in filteredPlayers" :key="player.username">
                <td><strong>{{ player.username }}</strong><div class="mono subline">{{ player.uuid || '未绑定 UUID' }}</div></td>
                <td>{{ equippedName(player) }}</td>
                <td><span v-if="!player.owned_title_ids.length" class="muted">无</span><span v-for="id in player.owned_title_ids" :key="id" class="title-chip">{{ titleMap.get(id)?.display_name || id }}</span></td>
                <td class="actions"><md-icon-button aria-label="管理玩家称号" @click="playerTarget = player"><md-icon>manage_accounts</md-icon></md-icon-button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <md-dialog ref="editorDialog" :open="editorOpen" :aria-busy="saving ? 'true' : 'false'" @closed="closeEditor">
      <div slot="headline">{{ editTarget ? '编辑称号' : '新建称号' }}</div>
      <div slot="content" class="dialog-form title-editor">
        <md-outlined-text-field label="称号 ID" :readonly="!!editTarget" :value="form.id" @input="form.id = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
        <md-outlined-text-field label="后台显示名称" :value="form.display_name" @input="form.display_name = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
        <label class="native-field"><span>渲染类型</span><select :value="form.render_type" @change="setRenderType"><option value="text">文字</option><option value="texture">贴图</option><option value="text_texture">文字 + 贴图</option></select></label>
        <md-outlined-text-field label="回退文字" :value="form.text_content" @input="form.text_content = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
        <div class="two-columns">
          <md-outlined-text-field label="文字颜色" :value="form.text_color" @input="form.text_color = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
          <md-outlined-text-field type="number" label="排序" :value="String(form.sort_order)" @input="form.sort_order = Number(($event.target as HTMLInputElement).value) || 0"></md-outlined-text-field>
        </div>
        <template v-if="form.render_type !== 'text'">
          <md-outlined-text-field label="贴图资源标识" :value="form.texture_key" @input="form.texture_key = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
          <div class="two-columns">
            <md-outlined-text-field label="字体资源 ID" :value="form.font_id" @input="form.font_id = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
            <md-outlined-text-field label="字体字符" :value="form.glyph" @input="form.glyph = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
          </div>
        </template>
        <div class="check-row"><label><md-checkbox :checked="form.bold" @change="form.bold = !form.bold"></md-checkbox>粗体</label><label><md-checkbox :checked="form.italic" @change="form.italic = !form.italic"></md-checkbox>斜体</label><label><md-checkbox :checked="form.enabled" @change="form.enabled = !form.enabled"></md-checkbox>启用</label></div>
      </div>
      <div slot="actions"><md-text-button :disabled="saving" @click="closeEditor">取消</md-text-button><md-filled-button :disabled="saving" @click="saveTitle">{{ saving ? '保存中…' : '保存' }}</md-filled-button></div>
    </md-dialog>

    <md-dialog ref="playerDialog" :open="!!playerTarget" :aria-busy="pendingOperation ? 'true' : 'false'" @closed="playerTarget = null">
      <div slot="headline">管理 {{ playerTarget?.username }} 的称号</div>
      <div slot="content" class="grant-list">
        <div class="unequip-row"><span>当前佩戴：{{ playerTarget ? equippedName(playerTarget) : '' }}</span><md-text-button v-if="canEditGrants && playerTarget?.equipped_title_id" :disabled="!!pendingOperation" @click="equipForPlayer(playerTarget!, null)">{{ playerTarget && operationPending('equip', playerTarget, null) ? '卸下中…' : '卸下' }}</md-text-button></div>
        <div v-for="title in overview.titles" :key="title.id" class="grant-row">
          <div><strong>{{ title.display_name }}</strong><span v-if="!title.enabled" class="disabled-badge">已停用</span><div class="source-list"><span v-for="grant in grantsFor(playerTarget!, title.id)" :key="`${grant.source}-${grant.source_key}`">{{ sourceLabel(grant.source) }}</span><span v-if="!grantsFor(playerTarget!, title.id).length">尚未拥有</span></div></div>
          <div class="grant-actions">
            <md-icon-button v-if="canEditGrants && title.enabled && playerTarget?.owned_title_ids.includes(title.id) && playerTarget.equipped_title_id !== title.id" aria-label="佩戴称号" title="佩戴称号" :disabled="!!pendingOperation" @click="equipForPlayer(playerTarget!, title.id)"><md-icon>{{ playerTarget && operationPending('equip', playerTarget, title.id) ? 'progress_activity' : 'check_circle' }}</md-icon></md-icon-button>
            <md-icon-button v-if="canEditGrants && title.enabled && !playerTarget?.owned_title_ids.includes(title.id)" aria-label="授予称号" title="授予称号" :disabled="!!pendingOperation" @click="changeGrant(playerTarget!, title, 'grant')"><md-icon>{{ playerTarget && operationPending('grant', playerTarget, title.id) ? 'progress_activity' : 'add_circle' }}</md-icon></md-icon-button>
            <md-icon-button v-if="canEditGrants && hasEditableGrant(playerTarget!, title.id)" aria-label="回收称号" title="仅回收注册和手动来源" :disabled="!!pendingOperation" @click="changeGrant(playerTarget!, title, 'revoke')"><md-icon>{{ playerTarget && operationPending('revoke', playerTarget, title.id) ? 'progress_activity' : 'remove_circle' }}</md-icon></md-icon-button>
          </div>
        </div>
      </div>
      <div slot="actions"><md-text-button :disabled="!!pendingOperation" @click="playerTarget = null">关闭</md-text-button></div>
    </md-dialog>
  </div>
</template>

<style scoped>
.heading-actions,.actions,.grant-actions,.check-row,.two-columns,.unequip-row{display:flex;align-items:center;gap:8px}.view-switch{display:inline-grid;grid-template-columns:repeat(2,minmax(110px,1fr));padding:3px;border:1px solid var(--md-sys-color-outline-variant);border-radius:8px;margin-bottom:18px}.view-switch button{border:0;background:transparent;color:var(--md-sys-color-on-surface-variant);padding:9px 14px;border-radius:6px;cursor:pointer}.view-switch button.active{background:var(--md-sys-color-secondary-container);color:var(--md-sys-color-on-secondary-container);font-weight:600}.table-card{overflow:hidden}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:13px 16px;border-bottom:1px solid var(--md-sys-color-outline-variant);vertical-align:middle}th{font-size:13px;color:var(--md-sys-color-on-surface-variant);font-weight:600}.actions-column{width:64px}.actions{justify-content:flex-end}.title-image{display:block;max-width:116px;height:22px;object-fit:contain;object-position:left center;image-rendering:pixelated}.text-preview{white-space:nowrap}.name{font-weight:600}.system-badge,.disabled-badge,.title-chip,.source-list span{display:inline-block;margin-left:7px;padding:2px 6px;border-radius:5px;background:var(--md-sys-color-surface-container-high);font-size:12px;font-weight:400}.disabled-badge{color:var(--md-sys-color-error)}.status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;background:#2e7d32}.status-dot.disabled{background:var(--md-sys-color-outline)}.player-search{width:min(420px,100%);margin-bottom:14px}.subline{margin-top:4px;font-size:12px;color:var(--md-sys-color-on-surface-variant)}.muted,.source-list{color:var(--md-sys-color-on-surface-variant)}.dialog-form{display:grid;gap:14px;min-width:min(520px,75vw);padding-top:8px}.two-columns{align-items:stretch}.two-columns>*{flex:1}.check-row{flex-wrap:wrap}.check-row label{display:flex;align-items:center;gap:3px}.native-field{display:grid;gap:6px;color:var(--md-sys-color-on-surface-variant);font-size:12px}.native-field select{height:48px;border:1px solid var(--md-sys-color-outline);border-radius:4px;background:var(--md-sys-color-surface);color:var(--md-sys-color-on-surface);padding:0 12px;font:inherit}.grant-list{display:grid;gap:0;min-width:min(560px,78vw);max-height:65vh;overflow:auto}.unequip-row,.grant-row{justify-content:space-between;padding:12px 2px;border-bottom:1px solid var(--md-sys-color-outline-variant)}.grant-row{display:flex;align-items:center;gap:16px}.source-list{margin-top:4px;font-size:12px}.source-list span{margin:0 5px 0 0}.empty{padding:42px;text-align:center;color:var(--md-sys-color-on-surface-variant)}.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}@media(max-width:700px){th:nth-child(3),td:nth-child(3){display:none}.two-columns{display:grid}.dialog-form,.grant-list{min-width:0;width:76vw}.title-chip{margin-top:4px}.page-heading{align-items:flex-start}}
</style>
