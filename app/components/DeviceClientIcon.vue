<script setup lang="ts">
import { computed } from 'vue'
import {
  classifyClientBrowser,
  classifyClientOperatingSystem,
  clientBrowserLabel,
  clientDeviceIcon,
  clientDeviceTypeLabel,
  clientOperatingSystemLabel,
  type ClientBrowserIdentity,
  type ClientDeviceIdentity,
  type ClientOperatingSystemIdentity,
} from '#shared/client-device'

type ClientIdentity = ClientDeviceIdentity & ClientBrowserIdentity & ClientOperatingSystemIdentity

const props = withDefaults(defineProps<{
  client?: ClientIdentity | null
  size?: 'small' | 'medium' | 'large'
}>(), {
  client: null,
  size: 'medium',
})

const browserType = computed(() => classifyClientBrowser(props.client))
const browserLabel = computed(() => clientBrowserLabel(props.client))
const operatingSystemType = computed(() => classifyClientOperatingSystem(props.client))
const operatingSystemLabel = computed(() => clientOperatingSystemLabel(props.client))
const accessibleLabel = computed(() => [clientDeviceTypeLabel(props.client), operatingSystemLabel.value, browserLabel.value].filter(Boolean).join('，'))
</script>

<template>
  <span class="device-client-icon" :class="`device-client-icon--${size}`" role="img" :aria-label="accessibleLabel">
    <md-icon class="device-client-icon__device">{{ clientDeviceIcon(client) }}</md-icon>
    <span
      v-if="operatingSystemType"
      class="os-badge"
      :class="`os-badge--${operatingSystemType}`"
      :title="operatingSystemLabel || undefined"
      aria-hidden="true"
    >
      <md-icon v-if="operatingSystemType === 'linux'">terminal</md-icon>
      <md-icon v-else-if="operatingSystemType === 'macos'">laptop_mac</md-icon>
      <span v-else-if="operatingSystemType === 'ios'">iOS</span>
      <md-icon v-else-if="operatingSystemType === 'android'">android</md-icon>
      <span v-else-if="operatingSystemType === 'harmonyos'">H</span>
    </span>
    <span
      v-if="browserType"
      class="browser-badge"
      :class="`browser-badge--${browserType}`"
      :title="browserLabel || undefined"
      aria-hidden="true"
    >
      <md-icon v-if="browserType === 'safari'">explore</md-icon>
      <md-icon v-else-if="browserType === 'wechat'">chat_bubble</md-icon>
      <span v-else-if="browserType === 'huawei'">H</span>
      <span v-else-if="browserType === 'xiaomi'">MI</span>
      <span v-else-if="browserType === 'qq'">QQ</span>
      <span v-else-if="browserType === 'uc'">UC</span>
      <span v-else-if="browserType === 'quark'">Q</span>
    </span>
  </span>
</template>

<style scoped>
.device-client-icon {
  position: relative;
  width: var(--device-icon-size);
  height: var(--device-icon-size);
  display: inline-grid;
  place-items: center;
  flex: 0 0 var(--device-icon-size);
  overflow: visible;
}

.device-client-icon--small { --device-icon-size: 15px; --corner-badge-size: 9px; --corner-badge-icon-size: 7px; --corner-badge-text-size: 3px; --corner-badge-compact-text-size: 2.5px; --corner-badge-offset-x: -3px; --corner-badge-offset-y: -2px; }
.device-client-icon--medium { --device-icon-size: 21px; --corner-badge-size: 12px; --corner-badge-icon-size: 9px; --corner-badge-text-size: 4px; --corner-badge-compact-text-size: 3.5px; --corner-badge-offset-x: -4px; --corner-badge-offset-y: -3px; }
.device-client-icon--large { --device-icon-size: 28px; --corner-badge-size: 15px; --corner-badge-icon-size: 11px; --corner-badge-text-size: 5px; --corner-badge-compact-text-size: 4px; --corner-badge-offset-x: -5px; --corner-badge-offset-y: -4px; }
.device-client-icon__device { --md-icon-size: var(--device-icon-size); }

.browser-badge,
.os-badge {
  position: absolute;
  bottom: var(--corner-badge-offset-y);
  width: var(--corner-badge-size);
  height: var(--corner-badge-size);
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1.5px solid var(--md-sys-color-surface-container);
  border-radius: 50%;
  box-shadow: 0 1px 2px rgb(0 0 0 / 22%);
  color: white;
  font-family: Arial, sans-serif;
  font-size: var(--corner-badge-text-size);
  font-weight: 800;
  line-height: 1;
}

.browser-badge { right: var(--corner-badge-offset-x); }
.os-badge { left: var(--corner-badge-offset-x); }
.browser-badge > md-icon, .os-badge > md-icon { --md-icon-size: var(--corner-badge-icon-size); }
.browser-badge--chrome { background: conic-gradient(from -30deg, #ea4335 0 33.33%, #fbbc05 0 66.66%, #34a853 0); }
.browser-badge--chrome::after { width: 42%; height: 42%; border: 1px solid rgb(255 255 255 / 82%); border-radius: 50%; background: #4285f4; content: ''; }
.browser-badge--edge { background: radial-gradient(circle at 67% 70%, #0aa0f5 0 25%, transparent 27%), conic-gradient(from 205deg, #0c59a4, #0aa0f5, #0bd4a4, #0c59a4); }
.browser-badge--firefox { background: radial-gradient(circle at 58% 56%, #33206b 0 25%, transparent 27%), conic-gradient(from 20deg, #ffb000, #ff4f00, #a42aca, #ffb000); }
.browser-badge--safari { background: #168be0; }
.browser-badge--opera { background: #f2294e; }
.browser-badge--opera::after { width: 36%; height: 65%; border-radius: 50%; background: white; content: ''; }
.browser-badge--samsung { background: #5e5bc9; }
.browser-badge--samsung::after { width: 72%; height: 40%; border: 1px solid white; border-radius: 50%; content: ''; transform: rotate(-18deg); }
.browser-badge--wechat { background: #07c160; }
.browser-badge--huawei { background: #cf0a2c; }
.browser-badge--xiaomi { background: #ff6900; font-size: var(--corner-badge-compact-text-size); }
.browser-badge--qq { background: #12b7f5; font-size: var(--corner-badge-compact-text-size); }
.browser-badge--uc { background: #ff7a00; font-size: var(--corner-badge-compact-text-size); }
.browser-badge--quark { background: #1677ff; }
.os-badge--windows { border-radius: 3px; background: linear-gradient(90deg, transparent 43%, white 43% 57%, transparent 57%), linear-gradient(transparent 43%, white 43% 57%, transparent 57%), #0078d4; }
.os-badge--linux { background: #202124; }
.os-badge--macos { background: linear-gradient(145deg, #9299a2, #353a40); }
.os-badge--ios { background: #111; font-size: var(--corner-badge-compact-text-size); }
.os-badge--android { background: #3ddc84; color: #173326; }
.os-badge--harmonyos { background: linear-gradient(145deg, #1597ff, #3154d8); }
</style>
