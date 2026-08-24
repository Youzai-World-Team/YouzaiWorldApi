<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  page?: boolean
  target?: HTMLElement | null
  label?: string
}>(), {
  page: false,
  target: null,
  label: '滚动条',
})

const track = ref<HTMLElement | null>(null)
const isScrollable = ref(false)
const isActive = ref(false)
const isDragging = ref(false)
const thumbHeight = ref(0)
const thumbTop = ref(0)
const scrollTop = ref(0)
const maxScroll = ref(0)
const targetRect = ref<DOMRect | null>(null)

let hideTimer: number | undefined
let resizeObserver: ResizeObserver | null = null
let mutationObserver: MutationObserver | null = null
let updateFrame = 0
let dragStartY = 0
let dragStartScrollTop = 0
let observedTarget: HTMLElement | null = null

const isWindowTarget = computed(() => props.page)
const trackStyle = computed(() => {
  if (isWindowTarget.value || !targetRect.value) return undefined
  return {
    top: `${targetRect.value.top}px`,
    left: `${Math.max(0, targetRect.value.right - 12)}px`,
    height: `${targetRect.value.height}px`,
    right: 'auto',
    bottom: 'auto',
  }
})
const thumbStyle = computed(() => ({
  height: `${thumbHeight.value}px`,
  transform: `translateY(${thumbTop.value}px)`,
}))

function getMetrics() {
  if (props.target) return { height: props.target.scrollHeight, viewport: props.target.clientHeight, current: props.target.scrollTop }
  if (!props.page) return { height: 0, viewport: 0, current: 0 }
  const documentElement = document.documentElement
  return {
    height: Math.max(documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
    viewport: window.innerHeight,
    current: window.scrollY || documentElement.scrollTop || 0,
  }
}

function updateScrollbar() {
  updateFrame = 0
  if (props.target) targetRect.value = props.target.getBoundingClientRect()
  const metrics = getMetrics()
  const trackHeight = props.target && targetRect.value ? targetRect.value.height : track.value?.clientHeight || Math.max(0, metrics.viewport - 72)
  const max = Math.max(0, metrics.height - metrics.viewport)
  isScrollable.value = max > 1 && trackHeight > 0
  scrollTop.value = Math.min(metrics.current, max)
  maxScroll.value = max
  if (!isScrollable.value) {
    thumbHeight.value = 0
    thumbTop.value = 0
    return
  }
  thumbHeight.value = Math.min(trackHeight, Math.max(36, (metrics.viewport / metrics.height) * trackHeight))
  const travel = Math.max(0, trackHeight - thumbHeight.value)
  thumbTop.value = max > 0 ? (scrollTop.value / max) * travel : 0
}

function scheduleUpdate() {
  if (!updateFrame) updateFrame = window.requestAnimationFrame(updateScrollbar)
}

function showScrollbar() {
  isActive.value = true
  if (hideTimer) window.clearTimeout(hideTimer)
  if (!isDragging.value) hideTimer = window.setTimeout(() => { isActive.value = false }, 900)
}

function onScroll() { scheduleUpdate(); showScrollbar() }
function onWindowScroll() { scheduleUpdate() }

function scrollTo(top: number) {
  if (props.target) props.target.scrollTop = top
  else window.scrollTo(0, top)
}

function scrollToTrackPosition(clientY: number) {
  const element = track.value
  if (!element || !isScrollable.value) return
  const rect = element.getBoundingClientRect()
  const travel = Math.max(1, rect.height - thumbHeight.value)
  const position = Math.min(travel, Math.max(0, clientY - rect.top - thumbHeight.value / 2))
  scrollTo((position / travel) * maxScroll.value)
}

function onTrackPointerDown(event: PointerEvent) {
  if (event.target === event.currentTarget) { scrollToTrackPosition(event.clientY); showScrollbar() }
}

function onThumbPointerDown(event: PointerEvent) {
  if (!isScrollable.value) return
  isDragging.value = true
  isActive.value = true
  dragStartY = event.clientY
  dragStartScrollTop = scrollTop.value
  track.value?.setPointerCapture?.(event.pointerId)
  event.preventDefault()
}

function onThumbPointerMove(event: PointerEvent) {
  if (!isDragging.value || !track.value) return
  const travel = Math.max(1, track.value.clientHeight - thumbHeight.value)
  const delta = event.clientY - dragStartY
  scrollTo(Math.min(maxScroll.value, Math.max(0, dragStartScrollTop + (delta / travel) * maxScroll.value)))
  scheduleUpdate()
}

function stopDragging() { if (isDragging.value) { isDragging.value = false; showScrollbar() } }

function onKeydown(event: KeyboardEvent) {
  if (!isScrollable.value) return
  const pageStep = Math.max(48, (props.target?.clientHeight ?? window.innerHeight) * 0.9)
  let next: number | null = null
  if (event.key === 'ArrowDown') next = scrollTop.value + 48
  if (event.key === 'ArrowUp') next = scrollTop.value - 48
  if (event.key === 'PageDown') next = scrollTop.value + pageStep
  if (event.key === 'PageUp') next = scrollTop.value - pageStep
  if (event.key === 'Home') next = 0
  if (event.key === 'End') next = maxScroll.value
  if (next === null) return
  event.preventDefault()
  scrollTo(Math.min(maxScroll.value, Math.max(0, next)))
  showScrollbar()
}

function detachTarget() {
  if (observedTarget) resizeObserver?.unobserve(observedTarget)
  observedTarget?.removeEventListener('scroll', onScroll)
  observedTarget?.classList.remove('app-scrollbar-target')
  observedTarget = null
}

function attachTarget(target: HTMLElement | null) {
  detachTarget()
  if (!target) { scheduleUpdate(); return }
  observedTarget = target
  target.classList.add('app-scrollbar-target')
  target.addEventListener('scroll', onScroll, { passive: true })
  resizeObserver?.observe(target)
  scheduleUpdate()
}

watch(() => props.target, attachTarget)

onMounted(() => {
  if (props.page) window.addEventListener('scroll', onScroll, { passive: true })
  else window.addEventListener('scroll', onWindowScroll, { passive: true })
  window.addEventListener('resize', scheduleUpdate, { passive: true })
  window.addEventListener('pointermove', onThumbPointerMove, { passive: true })
  window.addEventListener('pointerup', stopDragging, { passive: true })
  resizeObserver = new ResizeObserver(scheduleUpdate)
  resizeObserver.observe(document.documentElement)
  if (document.body) resizeObserver.observe(document.body)
  mutationObserver = new MutationObserver(scheduleUpdate)
  mutationObserver.observe(document.body, { childList: true, subtree: true, characterData: true })
  attachTarget(props.target ?? null)
  scheduleUpdate()
})

onBeforeUnmount(() => {
  detachTarget()
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('scroll', onWindowScroll)
  window.removeEventListener('resize', scheduleUpdate)
  window.removeEventListener('pointermove', onThumbPointerMove)
  window.removeEventListener('pointerup', stopDragging)
  resizeObserver?.disconnect()
  mutationObserver?.disconnect()
  if (updateFrame) window.cancelAnimationFrame(updateFrame)
  if (hideTimer) window.clearTimeout(hideTimer)
})
</script>

<template>
  <div
    ref="track"
    class="app-scrollbar"
    :class="{ 'app-scrollbar--page': isWindowTarget, 'app-scrollbar--target': !isWindowTarget, 'app-scrollbar--available': isScrollable, 'app-scrollbar--visible': isScrollable && isActive, 'app-scrollbar--dragging': isDragging }"
    :style="trackStyle"
    role="scrollbar"
    :tabindex="isScrollable ? 0 : -1"
    :aria-hidden="!isScrollable"
    :aria-label="label"
    :aria-valuemin="0"
    :aria-valuemax="Math.round(maxScroll)"
    :aria-valuenow="Math.round(scrollTop)"
    @pointerdown="onTrackPointerDown"
    @keydown="onKeydown"
  >
    <span class="app-scrollbar__thumb" :style="thumbStyle" @pointerdown.stop="onThumbPointerDown" />
  </div>
</template>
