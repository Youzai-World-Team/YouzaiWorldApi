<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  page?: boolean
  target?: HTMLElement | null
  axis?: 'vertical' | 'horizontal'
  label?: string
}>(), {
  page: false,
  target: null,
  axis: 'vertical',
  label: '滚动条',
})

const track = ref<HTMLElement | null>(null)
const isScrollable = ref(false)
const isActive = ref(false)
const isDragging = ref(false)
const thumbSize = ref(0)
const thumbOffset = ref(0)
const scrollOffset = ref(0)
const maxOffset = ref(0)
const targetRect = ref<DOMRect | null>(null)

let hideTimer: number | undefined
let resizeObserver: ResizeObserver | null = null
let mutationObserver: MutationObserver | null = null
let updateFrame = 0
let dragStartPosition = 0
let dragStartScrollOffset = 0
let observedTarget: HTMLElement | null = null
let observedAxis: 'vertical' | 'horizontal' | null = null
let observedGeometryElements: Element[] = []

const isWindowTarget = computed(() => props.page)
const isHorizontal = computed(() => props.axis === 'horizontal')
const targetClass = (axis: 'vertical' | 'horizontal') => `app-scrollbar-target--${axis}`
const trackStyle = computed(() => {
  if (isWindowTarget.value || !targetRect.value) return undefined
  if (isHorizontal.value) {
    return {
      left: `${targetRect.value.left}px`,
      top: `${Math.max(0, targetRect.value.bottom - 12)}px`,
      width: `${targetRect.value.width}px`,
      right: 'auto',
      bottom: 'auto',
    }
  }
  return {
    top: `${targetRect.value.top}px`,
    left: `${Math.max(0, targetRect.value.right - 12)}px`,
    height: `${targetRect.value.height}px`,
    right: 'auto',
    bottom: 'auto',
  }
})
const thumbStyle = computed(() => ({
  width: isHorizontal.value ? `${thumbSize.value}px` : undefined,
  height: isHorizontal.value ? undefined : `${thumbSize.value}px`,
  transform: isHorizontal.value
    ? `translateX(${thumbOffset.value}px)`
    : `translateY(${thumbOffset.value}px)`,
}))

function getMetrics() {
  if (props.target) {
    const style = window.getComputedStyle(props.target)
    const overflow = isHorizontal.value ? style.overflowX : style.overflowY
    const enabled = overflow !== 'visible' && overflow !== 'clip'
    return isHorizontal.value
      ? { content: enabled ? props.target.scrollWidth : props.target.clientWidth, viewport: props.target.clientWidth, current: props.target.scrollLeft }
      : { content: enabled ? props.target.scrollHeight : props.target.clientHeight, viewport: props.target.clientHeight, current: props.target.scrollTop }
  }
  if (!props.page) return { content: 0, viewport: 0, current: 0 }
  const documentElement = document.documentElement
  return isHorizontal.value
    ? {
        content: Math.max(documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
        viewport: window.innerWidth,
        current: window.scrollX || documentElement.scrollLeft || 0,
      }
    : {
        content: Math.max(documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
        viewport: window.innerHeight,
        current: window.scrollY || documentElement.scrollTop || 0,
      }
}

function composedParent(element: Element): Element | null {
  if (element.assignedSlot) return element.assignedSlot
  if (element.parentElement) return element.parentElement
  const root = element.getRootNode()
  return root instanceof ShadowRoot ? root.host : null
}

function clippingAncestors(target: Element): Element[] {
  const ancestors: Element[] = []
  let current = composedParent(target)
  while (current) {
    const style = window.getComputedStyle(current)
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') ancestors.push(current)
    current = composedParent(current)
  }
  return ancestors
}

function visibleTargetRect(target: HTMLElement): DOMRect {
  const targetBox = target.getBoundingClientRect()
  let left = targetBox.left
  let right = targetBox.right
  let top = targetBox.top
  let bottom = targetBox.bottom

  for (const ancestor of clippingAncestors(target)) {
    const style = window.getComputedStyle(ancestor)
    const box = ancestor.getBoundingClientRect()
    if (style.overflowX !== 'visible') {
      left = Math.max(left, box.left)
      right = Math.min(right, box.right)
    }
    if (style.overflowY !== 'visible') {
      top = Math.max(top, box.top)
      bottom = Math.min(bottom, box.bottom)
    }
  }

  return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top))
}

function updateScrollbar() {
  updateFrame = 0
  if (props.target) targetRect.value = visibleTargetRect(props.target)
  const metrics = getMetrics()
  const trackLength = props.target && targetRect.value
    ? (isHorizontal.value ? targetRect.value.width : targetRect.value.height)
    : (isHorizontal.value ? track.value?.clientWidth : track.value?.clientHeight) || Math.max(0, metrics.viewport - 72)
  const max = Math.max(0, metrics.content - metrics.viewport)
  isScrollable.value = max > 1 && trackLength > 0
  scrollOffset.value = Math.min(metrics.current, max)
  maxOffset.value = max
  if (!isScrollable.value) {
    thumbSize.value = 0
    thumbOffset.value = 0
    return
  }
  thumbSize.value = Math.min(trackLength, Math.max(36, (metrics.viewport / metrics.content) * trackLength))
  const travel = Math.max(0, trackLength - thumbSize.value)
  thumbOffset.value = max > 0 ? (scrollOffset.value / max) * travel : 0
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

function scrollTo(offset: number) {
  if (props.target) {
    if (isHorizontal.value) props.target.scrollLeft = offset
    else props.target.scrollTop = offset
  } else if (isHorizontal.value) {
    window.scrollTo(offset, window.scrollY)
  } else {
    window.scrollTo(window.scrollX, offset)
  }
}

function scrollToTrackPosition(position: number) {
  const element = track.value
  if (!element || !isScrollable.value) return
  const rect = element.getBoundingClientRect()
  const trackPosition = isHorizontal.value ? position - rect.left : position - rect.top
  const travel = Math.max(1, (isHorizontal.value ? rect.width : rect.height) - thumbSize.value)
  const nextPosition = Math.min(travel, Math.max(0, trackPosition - thumbSize.value / 2))
  scrollTo((nextPosition / travel) * maxOffset.value)
}

function onTrackPointerDown(event: PointerEvent) {
  if (event.target === event.currentTarget) {
    scrollToTrackPosition(isHorizontal.value ? event.clientX : event.clientY)
    showScrollbar()
  }
}

function onThumbPointerDown(event: PointerEvent) {
  if (!isScrollable.value) return
  isDragging.value = true
  isActive.value = true
  dragStartPosition = isHorizontal.value ? event.clientX : event.clientY
  dragStartScrollOffset = scrollOffset.value
  track.value?.setPointerCapture?.(event.pointerId)
  event.preventDefault()
}

function onThumbPointerMove(event: PointerEvent) {
  if (!isDragging.value || !track.value) return
  const travel = Math.max(1, (isHorizontal.value ? track.value.clientWidth : track.value.clientHeight) - thumbSize.value)
  const position = isHorizontal.value ? event.clientX : event.clientY
  const delta = position - dragStartPosition
  scrollTo(Math.min(maxOffset.value, Math.max(0, dragStartScrollOffset + (delta / travel) * maxOffset.value)))
  scheduleUpdate()
}

function stopDragging() { if (isDragging.value) { isDragging.value = false; showScrollbar() } }

function onKeydown(event: KeyboardEvent) {
  if (!isScrollable.value) return
  const viewport = isHorizontal.value ? props.target?.clientWidth : props.target?.clientHeight
  const pageStep = Math.max(48, (viewport ?? (isHorizontal.value ? window.innerWidth : window.innerHeight)) * 0.9)
  let next: number | null = null
  if (isHorizontal.value) {
    if (event.key === 'ArrowRight') next = scrollOffset.value + 48
    if (event.key === 'ArrowLeft') next = scrollOffset.value - 48
  } else {
    if (event.key === 'ArrowDown') next = scrollOffset.value + 48
    if (event.key === 'ArrowUp') next = scrollOffset.value - 48
  }
  if (event.key === 'PageDown') next = scrollOffset.value + pageStep
  if (event.key === 'PageUp') next = scrollOffset.value - pageStep
  if (event.key === 'Home') next = 0
  if (event.key === 'End') next = maxOffset.value
  if (next === null) return
  event.preventDefault()
  scrollTo(Math.min(maxOffset.value, Math.max(0, next)))
  showScrollbar()
}

function detachTarget() {
  for (const element of observedGeometryElements) resizeObserver?.unobserve(element)
  observedGeometryElements = []
  observedTarget?.removeEventListener('scroll', onScroll)
  if (observedTarget && observedAxis) observedTarget.classList.remove(targetClass(observedAxis))
  observedTarget = null
  observedAxis = null
}

function attachTarget(target: HTMLElement | null) {
  detachTarget()
  if (!target) { scheduleUpdate(); return }
  observedTarget = target
  observedAxis = props.axis
  target.classList.add(targetClass(props.axis))
  target.addEventListener('scroll', onScroll, { passive: true })
  observedGeometryElements = [target, ...clippingAncestors(target)]
    .filter((element) => element !== document.documentElement && element !== document.body)
  for (const element of observedGeometryElements) resizeObserver?.observe(element)
  scheduleUpdate()
}

watch([() => props.target, () => props.axis], ([target]) => attachTarget(target))

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
    :class="{ 'app-scrollbar--page': isWindowTarget, 'app-scrollbar--target': !isWindowTarget, 'app-scrollbar--horizontal': isHorizontal, 'app-scrollbar--vertical': !isHorizontal, 'app-scrollbar--available': isScrollable, 'app-scrollbar--visible': isScrollable && isActive, 'app-scrollbar--dragging': isDragging }"
    :style="trackStyle"
    role="scrollbar"
    :tabindex="isScrollable ? 0 : -1"
    :aria-hidden="!isScrollable"
    :aria-label="label"
    :aria-orientation="isHorizontal ? 'horizontal' : 'vertical'"
    :aria-valuemin="0"
    :aria-valuemax="Math.round(maxOffset)"
    :aria-valuenow="Math.round(scrollOffset)"
    @pointerdown="onTrackPointerDown"
    @keydown="onKeydown"
  >
    <span class="app-scrollbar__thumb" :style="thumbStyle" @pointerdown.stop="onThumbPointerDown" />
  </div>
</template>
