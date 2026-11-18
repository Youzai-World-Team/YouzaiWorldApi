<script setup lang="ts">
import { mapLayerDescription, mapLayerLabel, type GameMapLayer } from '#shared/game-map'
useHead({ title: '服务器地图' })
const {
  index, worlds, worldId, world, dimension, dimensions, layers, layer, height, heights, heightIndex, selected,
  centerX, centerZ, location, card, surface, container, busy, refreshing, error, statusError, loaded,
  lighting, grid, overviewOpen, overview, overviewBusy, overviewError, viewport, fullScreen, hover, pointed,
  coordinateText, pointerElevation, landmarks, recent, landmarkOpen, landmarkName, snapshotAge, stale, stalled, syncText,
  uploadPending, uploadRequest, canRequestUpload, canViewSettings, labelDimension, setWorld, setDimension, setLayer,
  chooseHeight, goToRecorded, chooseRegion, moveTo, jumpSaved, zoom, wheel, pointerDown, pointerMove, pointerUp, keydown,
  openLandmark, saveLandmark, removeLandmark, copyCoordinates, copyUploadCommand, requestUpload,
  toggleOverview, toggleFullscreen, refreshWorlds, loadOverview, schedule,
} = useGameMap()
const layerTitle = (value: GameMapLayer) => value === 'ROOF' ? (dimension.value === 'minecraft:the_nether' ? '下界顶板' : '顶层') : value === 'FIXED' ? '高度切片' : mapLayerLabel(value)
const exactTime = (time: number) => time ? new Date(time).toLocaleString('zh-CN') : '尚无完整同步'
</script>

<template>
  <section class="map-page">
    <header class="map-heading">
      <div><h1>服务器地图</h1><p>查看已记录地形，切换地表和地下时保持当前位置。</p></div>
      <md-outlined-button :disabled="refreshing" title="重新读取已经上传的快照；不会触发服务器上传" @click="refreshWorlds(true)"><md-icon slot="icon">refresh</md-icon>{{ refreshing ? '正在读取…' : '重读快照' }}</md-outlined-button>
    </header>
    <div v-if="statusError" class="map-error" role="alert">{{ statusError }} <button type="button" @click="refreshWorlds(true)">重试</button></div>
    <div v-if="error" class="map-error" role="alert">{{ error }} <button type="button" @click="schedule">重试读取地形</button></div>
    <div v-if="!refreshing && !worlds.length" class="map-empty">
      <md-icon>map</md-icon><h2>{{ index?.reset ? '地图已清空，等待全量上传' : '等待服务器上传地图' }}</h2>
      <p v-if="index?.reset">{{ index.reset.message }}</p><p v-else>首次上传后会自动显示已记录区域。以下步骤可以帮助确认同步是否已经开启。</p>
      <ol>
        <li v-if="!index?.diagnostics.game_api_configured">在站点设置配置游戏 API 密钥，并在 Core 的 Api 网桥中填写相同密钥和本 API 地址。</li>
        <li v-else>确认 Core 的 Api 网桥指向此 API，且游戏 API 密钥一致。</li>
        <li>确认服务端地图模块和地图上传已开启，等待区块扫描生成地形。</li>
        <li>在游戏服务器控制台执行 <code>yzwc map upload</code>，查看控制台中的上传结果；页面每 15 秒自动检查。</li>
      </ol>
      <div class="map-empty-actions">
        <md-outlined-button v-if="canRequestUpload" :disabled="uploadPending" @click="requestUpload"><md-icon slot="icon">sync</md-icon>{{ uploadPending ? '正在请求…' : '请求服务器上传' }}</md-outlined-button>
        <md-outlined-button @click="copyUploadCommand">复制上传命令</md-outlined-button>
        <NuxtLink v-if="canViewSettings" to="/settings#game-map-data">前往站点设置</NuxtLink>
      </div>
    </div>
    <div ref="card" v-show="worlds.length" class="map-card" :class="{ 'map-card-fullscreen': fullScreen }">
      <div class="map-toolbar">
        <label>存档<select :value="worldId" @change="setWorld(($event.target as HTMLSelectElement).value)"><option v-for="item in worlds" :key="item.id" :value="item.id">{{ item.name }} · {{ item.id.slice(0, 8) }}</option></select></label>
        <label>维度<select :value="dimension" @change="setDimension(($event.target as HTMLSelectElement).value)"><option v-for="id in dimensions" :key="id" :value="id">{{ labelDimension(id) }}</option></select></label>
        <details class="map-display-options"><summary>显示选项</summary><div><label><input v-model="lighting" type="checkbox">光照</label><label><input v-model="grid" type="checkbox">区块网格</label></div></details>
      </div>
      <div class="map-layer-tabs" role="group" aria-label="选择地形图层"><button v-for="value in layers" :key="value" type="button" :aria-pressed="layer === value" @click="setLayer(value)">{{ layerTitle(value) }}</button></div>
      <div v-if="layer === 'CAVE' || layer === 'FIXED'" class="map-height-controls">
        <span>地下高度</span><button type="button" :disabled="heightIndex === 0" aria-label="查看更低一层" @click="heightIndex--">−</button>
        <input :value="height" type="number" :min="heights[0]" :max="heights.at(-1)" aria-label="目标地下高度" @change="chooseHeight(Number(($event.target as HTMLInputElement).value))">
        <button type="button" :disabled="heightIndex >= heights.length - 1" aria-label="查看更高一层" @click="heightIndex++">+</button>
        <input v-model.number="heightIndex" type="range" min="0" :max="Math.max(0, heights.length - 1)" step="1" :disabled="heights.length < 2" aria-label="连续查看已记录的地下高度" :aria-valuetext="`高度 Y ${height}`">
      </div>
      <p class="map-layer-description">{{ mapLayerDescription(layer) }}</p>
      <div class="map-navigation">
        <form class="map-location" @submit.prevent="moveTo"><label class="sr-only" for="map-location">目标坐标</label><input id="map-location" v-model="location" placeholder="输入或粘贴 X Z / X Y Z" autocomplete="off" aria-label="输入或粘贴目标坐标"><button type="submit">定位</button></form>
        <button type="button" :disabled="!selected || overviewBusy" @click="goToRecorded">定位到有地形区域</button>
        <button type="button" :aria-expanded="overviewOpen" @click="toggleOverview">{{ overviewOpen ? '收起区域总览' : '区域总览' }}</button>
      </div>
      <div ref="container" class="map-viewport">
        <canvas ref="surface" tabindex="0" aria-label="服务器地图：拖动平移，滚轮或双指缩放，点击选点；方向键移动，加减键缩放"
          @wheel="wheel" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp" @lostpointercapture="pointerUp" @pointerleave="hover = null" @keydown="keydown" />
        <span class="map-north" aria-hidden="true">↑ 北</span>
        <div class="map-float-actions">
          <button type="button" title="放大地图" aria-label="放大地图" @click="zoom(1.5)"><md-icon>add</md-icon></button>
          <button type="button" title="缩小地图" aria-label="缩小地图" @click="zoom(1 / 1.5)"><md-icon>remove</md-icon></button>
          <button type="button" :title="fullScreen ? '退出全屏' : '全屏地图'" :aria-label="fullScreen ? '退出全屏' : '全屏地图'" @click="toggleFullscreen"><md-icon>{{ fullScreen ? 'fullscreen_exit' : 'fullscreen' }}</md-icon></button>
        </div>
        <div v-if="!selected" class="map-overlay"><span>此图层尚未上传地形，页面会自动检查同步状态。</span></div>
        <div v-else-if="!busy && !loaded && !error" class="map-overlay"><span>当前位置没有已记录地形。</span><button type="button" @click="goToRecorded">前往有地形区域</button><button type="button" @click="toggleOverview">查看区域总览</button></div>
        <span v-if="busy" class="map-loading" role="status">正在补充地形 · 已显示 {{ loaded }} 个区块</span>
      </div>
      <div class="map-footer">
        <div><span>{{ pointed ? '选点' : '中心' }} {{ coordinateText }}<template v-if="pointerElevation !== null"> · 地形 Y {{ pointerElevation }}</template></span><small v-if="hover">鼠标 X {{ hover.x }} · Z {{ hover.z }}</small></div>
        <div class="map-coordinate-actions"><button type="button" @click="copyCoordinates">复制坐标</button><button type="button" @click="openLandmark">保存地标</button></div>
      </div>
      <GameMapOverview v-if="overviewOpen" :overview="overview" :viewport="viewport" :busy="overviewBusy" :error="overviewError" @choose="chooseRegion" @retry="loadOverview(true)" />
      <details class="map-saved-places"><summary>地标与最近位置 <span>{{ landmarks.length }} 个地标</span></summary>
        <p>保存在当前浏览器，按后台账户区分；清空对应存档的地图后，旧位置会自动失效。</p>
        <div v-if="landmarks.length" class="map-place-list"><div v-for="item in landmarks" :key="item.id" class="map-place"><button type="button" @click="jumpSaved(item)"><strong>{{ item.name }}</strong><small>X {{ item.x }} · Z {{ item.z }} · {{ mapLayerLabel(item.layer) }}</small></button><button type="button" :aria-label="`移除地标 ${item.name}`" @click="removeLandmark(item.id)"><md-icon>close</md-icon></button></div></div>
        <p v-else>点击地图选点，再选择“保存地标”，方便下次直接定位。</p>
        <div v-if="recent.length" class="map-recent-list"><strong>最近定位</strong><button v-for="(item, i) in recent" :key="`${item.world}-${item.dimension}-${i}`" type="button" @click="jumpSaved(item)">{{ worlds.find(value => value.id === item.world)?.name || '存档' }} · {{ labelDimension(item.dimension) }} · X {{ Math.floor(item.x) }} Z {{ Math.floor(item.z) }}</button></div>
      </details>
    </div>
    <div v-if="world" class="map-sync" :class="{ 'map-sync-stale': stale || stalled }" aria-live="polite">
      <div><strong>{{ syncText }}</strong><span :title="exactTime(world.last_success)">最近完整同步：{{ snapshotAge }}</span><span>已保存 {{ world.tile_count.toLocaleString() }} 个图层区块</span></div>
      <md-outlined-button v-if="canRequestUpload" :disabled="uploadPending" @click="requestUpload"><md-icon slot="icon">sync</md-icon>{{ uploadPending ? '正在请求…' : '请求服务器上传' }}</md-outlined-button>
    </div>
    <p v-if="uploadRequest" class="map-request-result" role="status">{{ uploadRequest.message }}</p>
    <details class="map-help"><summary>同步说明与排查</summary>
      <p>这里展示最近上传的地形快照。Core 默认每 48 小时上传一次；“重读快照”只重新读取已有数据，不会更新游戏服务器的采样或触发上传。</p>
      <p>需要立即更新时，在游戏服务器控制台执行 <code>yzwc map upload</code>；已获授权的管理员也可通过页面向站点绑定的管理实例发送上传命令。</p>
      <p>超过五分钟没有收到数据，会显示上传停顿；Core 失败后默认十分钟重试。地下只列出已上传的高度，默认每 8 格记录。</p>
      <div class="map-empty-actions"><md-text-button @click="copyUploadCommand">复制上传命令</md-text-button><NuxtLink v-if="canRequestUpload" to="/settings#game-map-data">清空旧地图与重新上传</NuxtLink></div>
    </details>
    <ConfirmDialog :open="landmarkOpen" title="保存地标" icon="bookmark_add" message="保存选点或地图中心，方便下次直接定位。" confirm-label="保存地标" @confirm="saveLandmark" @cancel="landmarkOpen = false">
      <label class="map-landmark-name">地标名称<input v-model="landmarkName" maxlength="40" placeholder="例如：主城、地下仓库" @keydown.enter.prevent="saveLandmark"></label><p>{{ coordinateText }} · {{ labelDimension(dimension) }}</p>
    </ConfirmDialog>
  </section>
</template>

<style scoped>
.map-page { display: flex; flex-direction: column; gap: 18px; }
.map-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
h1 { margin: 0 0 6px; font-size: 28px; font-weight: 600; }.map-heading p { margin: 0; color: var(--md-sys-color-on-surface-variant); line-height: 1.7; }
.map-card { border: 1px solid var(--md-sys-color-outline-variant); border-radius: 24px; overflow: hidden; background: var(--md-sys-color-surface-container-low); }
.map-toolbar, .map-navigation { display: flex; align-items: end; gap: 12px; padding: 16px; flex-wrap: wrap; }
.map-toolbar > label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--md-sys-color-on-surface-variant); }
select, input:not([type=checkbox]):not([type=range]) { font: inherit; color: var(--md-sys-color-on-surface); background: var(--md-sys-color-surface); border: 1px solid var(--md-sys-color-outline); border-radius: 10px; padding: 10px 12px; min-height: 42px; box-sizing: border-box; max-width: 100%; }
select { max-width: 290px; }button { font: inherit; color: var(--md-sys-color-on-surface); border: 1px solid var(--md-sys-color-outline-variant); background: var(--md-sys-color-surface); border-radius: 12px; padding: 10px 14px; min-height: 42px; cursor: pointer; }
button:disabled { cursor: default; opacity: .5; }button:hover:not(:disabled) { background: var(--md-sys-color-surface-container-high); }
button:focus-visible, select:focus-visible, input:focus-visible, canvas:focus-visible, summary:focus-visible { outline: 2px solid var(--md-sys-color-primary); outline-offset: -2px; }
.map-layer-tabs { display: flex; gap: 8px; padding: 0 16px; overflow-x: auto; }.map-layer-tabs button { flex-shrink: 0; border-radius: 24px; }.map-layer-tabs button[aria-pressed=true] { background: var(--md-sys-color-secondary-container); color: var(--md-sys-color-on-secondary-container); border-color: transparent; }
.map-layer-description { margin: 10px 16px 0; color: var(--md-sys-color-on-surface-variant); font-size: 13px; line-height: 1.6; }
.map-display-options { margin-left: auto; position: relative; min-height: 42px; }summary { cursor: pointer; color: var(--md-sys-color-on-surface-variant); }.map-display-options summary { padding: 12px; }.map-display-options > div { position: absolute; right: 0; top: 46px; display: flex; flex-direction: column; gap: 14px; min-width: 150px; padding: 16px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 12px; background: var(--md-sys-color-surface-container); z-index: 5; box-shadow: 0 8px 28px #0002; }.map-display-options label { display: flex; gap: 8px; align-items: center; }
input[type=checkbox], input[type=range] { accent-color: var(--md-sys-color-primary); }input[type=checkbox] { width: 18px; height: 18px; }
.map-height-controls { display: flex; gap: 8px; align-items: center; padding: 12px 16px 0; }.map-height-controls > span { font-size: 13px; white-space: nowrap; }.map-height-controls input[type=number] { width: 85px; text-align: center; }.map-height-controls input[type=range] { flex: 1; min-width: 60px; }
.map-navigation { align-items: center; padding-top: 12px; }.map-location { display: flex; gap: 8px; flex: 1; min-width: 240px; }.map-location input { width: 100%; min-width: 0; }.map-location button { flex-shrink: 0; }
.map-viewport { height: clamp(350px, 62vh, 820px); width: 100%; position: relative; overflow: hidden; background-color: var(--md-sys-color-surface); background-image: conic-gradient(var(--md-sys-color-surface-container-high) 25%, transparent 0 50%, var(--md-sys-color-surface-container-high) 0 75%, transparent 0); background-size: 24px 24px; }
canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: grab; }canvas:active { cursor: grabbing; }
.map-north, .map-loading, .map-overlay, .map-float-actions { position: absolute; background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-on-surface); border-radius: 12px; padding: 9px 13px; font-size: 13px; }
.map-north { top: 12px; left: 12px; pointer-events: none; }.map-loading { right: 12px; bottom: 12px; pointer-events: none; }.map-float-actions { right: 12px; top: 12px; display: flex; flex-direction: column; gap: 4px; padding: 4px; }.map-float-actions button { display: grid; place-items: center; padding: 8px; border: none; background: transparent; }
.map-overlay { left: 50%; top: 50%; transform: translate(-50%, -50%); text-align: center; max-width: 80%; display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }.map-overlay span { flex-basis: 100%; line-height: 1.6; }
.map-footer { display: flex; padding: 12px 16px; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; font-size: 13px; }.map-footer > div:first-child { display: flex; flex-direction: column; gap: 4px; }.map-footer small { color: var(--md-sys-color-on-surface-variant); }.map-coordinate-actions { display: flex; gap: 8px; }
.map-saved-places { padding: 16px; border-top: 1px solid var(--md-sys-color-outline-variant); }.map-saved-places summary { display: flex; justify-content: space-between; }.map-saved-places p, .map-help p { color: var(--md-sys-color-on-surface-variant); font-size: 13px; line-height: 1.7; }
.map-place-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; }.map-place { display: flex; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 12px; overflow: hidden; }.map-place button { border: 0; border-radius: 0; }.map-place button:first-child { flex: 1; text-align: left; display: flex; flex-direction: column; gap: 4px; min-width: 0; }.map-place strong { overflow-wrap: anywhere; }.map-place small { color: var(--md-sys-color-on-surface-variant); }.map-place button:last-child { align-self: stretch; padding: 10px; }
.map-recent-list { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 16px; }.map-recent-list strong { font-size: 13px; }.map-recent-list button { font-size: 12px; }
.map-sync { padding: 14px 16px; border-radius: 16px; background: var(--md-sys-color-surface-container); display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; }.map-sync > div { display: flex; gap: 8px 20px; flex-wrap: wrap; font-size: 13px; }.map-sync-stale { border: 1px solid var(--md-sys-color-tertiary); }
.map-error, .map-request-result { border-radius: 14px; padding: 14px 18px; margin: 0; line-height: 1.7; }.map-error { color: var(--md-sys-color-on-error-container); background: var(--md-sys-color-error-container); }.map-request-result { background: var(--md-sys-color-surface-container); }
.map-empty { text-align: center; padding: 40px 24px; border-radius: 24px; background: var(--md-sys-color-surface-container-low); }.map-empty > md-icon { --md-icon-size: 48px; color: var(--md-sys-color-primary); }.map-empty p, .map-empty ol { max-width: 680px; margin: 16px auto; line-height: 1.8; color: var(--md-sys-color-on-surface-variant); }.map-empty ol { text-align: left; padding-left: 24px; }.map-empty li + li { margin-top: 8px; }.map-empty-actions { display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap; }
.map-help { padding: 16px; border-radius: 16px; background: var(--md-sys-color-surface-container-low); }.map-landmark-name { display: flex; flex-direction: column; gap: 8px; }.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
.map-card-fullscreen { border-radius: 0; height: 100dvh; width: 100vw; display: flex; flex-direction: column; }.map-card-fullscreen .map-viewport { flex: 1; min-height: 0; height: auto; }.map-card-fullscreen .map-saved-places, .map-card-fullscreen :deep(.map-overview) { display: none; }
@media (max-width: 640px) { .map-toolbar { gap: 10px; padding: 12px; }.map-toolbar > label { flex: 1; min-width: 100px; }select { width: 100%; max-width: none; }.map-display-options { margin-left: 0; }.map-display-options summary { padding: 10px 0; }.map-display-options > div { right: 0; }.map-layer-tabs { padding: 0 12px; }.map-layer-description { margin-left: 12px; margin-right: 12px; }.map-navigation { padding: 12px; gap: 8px; }.map-location { flex-basis: 100%; }.map-navigation > button { flex: 1; font-size: 12px; padding: 8px; }.map-height-controls { padding: 12px 12px 0; flex-wrap: wrap; }.map-height-controls input[type=range] { flex-basis: 100%; }.map-card { border-radius: 18px; }.map-viewport { height: 55vh; min-height: 320px; }.map-float-actions { right: 8px; top: 8px; }.map-footer { padding: 12px; }.map-coordinate-actions { width: 100%; }.map-coordinate-actions button { flex: 1; }.map-card-fullscreen { border-radius: 0; }.map-card-fullscreen .map-toolbar, .map-card-fullscreen .map-layer-description, .map-card-fullscreen .map-navigation { display: none; } }
</style>
