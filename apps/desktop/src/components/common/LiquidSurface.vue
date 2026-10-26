<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useAttrs, useId, watch } from 'vue'
import type { CSSProperties } from 'vue'
import { createRefractionMap } from '@/utils/glass-optics'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    as?: string
    radius?: number
    strength?: number
    blur?: number
    interactive?: boolean
    motion?: boolean
    refraction?: boolean
  }>(),
  {
    as: 'div',
    radius: 24,
    strength: 44,
    blur: 0.35,
    interactive: true,
    motion: true,
    refraction: true
  }
)

const attrs = useAttrs()
const surface = ref<HTMLElement>()
const glow = ref<HTMLElement>()
const filterId = `liquid-refraction-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`
const dimensions = ref({ width: 1, height: 1 })
const displacementMap = ref('')
const supported = ref(false)
const reducedMotion = ref(false)
const finePointer = ref(false)
const pressed = ref(false)
const isMoving = computed(() => props.motion && !reducedMotion.value)
const isRefracting = computed(
  () => props.refraction && supported.value && Boolean(displacementMap.value)
)
const safeRadius = computed(() => Math.max(0, props.radius))
const safeBlur = computed(() => Math.min(20, Math.max(0, props.blur)))
const safeStrength = computed(() => Math.min(64, Math.max(0, props.strength)))
// Give the lens room to sample outside its silhouette without a dark blur seam.
const filterPadding = computed(() => Math.ceil(safeStrength.value / 2 + safeBlur.value * 3 + 2))
const surfaceStyle = computed<CSSProperties>(
  () =>
    ({
      borderRadius: `${safeRadius.value}px`,
      '--liquid-radius': `${safeRadius.value}px`
    }) as CSSProperties
)
const backdropStyle = computed<CSSProperties>(() => {
  const filter = isRefracting.value
    ? `url("#${filterId}")`
    : `blur(${safeBlur.value}px) saturate(1.2)`
  return { backdropFilter: filter, WebkitBackdropFilter: filter }
})

let observer: ResizeObserver | undefined
let visibilityObserver: IntersectionObserver | undefined
let geometryTimer = 0
let geometryIdle = 0
let geometryRevision = 0
let geometryFrame = 0
let pendingWidth = 1
let pendingHeight = 1
let mappedGeometry = ''
let isIntersecting = false
let pointerFrame = 0
let pointerX = 0
let pointerY = 0
let glowCleanupTimer = 0
let motionPreference: MediaQueryList | undefined
let pointerPreference: MediaQueryList | undefined

function cancelGeometry() {
  geometryRevision++
  clearTimeout(geometryTimer)
  geometryTimer = 0
  if (geometryIdle) cancelIdleCallback(geometryIdle)
  geometryIdle = 0
}

function canUpdateGeometry() {
  const element = surface.value
  return (
    props.refraction &&
    supported.value &&
    isIntersecting &&
    document.visibilityState !== 'hidden' &&
    element?.isConnected &&
    !element.closest('[inert], [aria-hidden="true"]') &&
    dimensions.value.width > 1 &&
    dimensions.value.height > 1
  )
}

async function updateOpticalMap() {
  geometryIdle = geometryTimer = 0
  if (!canUpdateGeometry()) return
  const { width, height } = dimensions.value
  const key = `${width}:${height}:${safeRadius.value}`
  if (key === mappedGeometry) return
  const revision = geometryRevision
  try {
    const image = await createRefractionMap(width, height, safeRadius.value)
    if (revision !== geometryRevision || !canUpdateGeometry()) return
    displacementMap.value = image
    mappedGeometry = key
  } catch {
    // A restrictive Canvas policy or unavailable renderer still gets legible frost.
    if (revision === geometryRevision) {
      displacementMap.value = ''
      supported.value = false
    }
  }
}

function queueGeometry() {
  cancelGeometry()
  if (!canUpdateGeometry()) return
  // ResizeObserver runs on every frame of a panel/window resize. Keep the existing
  // optical texture stretched to the current bounds, then encode only the settled
  // shape; PNG generation must not share the animation's frame budget.
  geometryTimer = window.setTimeout(() => {
    geometryTimer = 0
    if (typeof requestIdleCallback === 'function')
      geometryIdle = requestIdleCallback(updateOpticalMap, { timeout: 150 })
    else geometryTimer = window.setTimeout(updateOpticalMap, 0)
  }, 100)
}

function observeGeometry(entries: ResizeObserverEntry[]) {
  const entry = entries[0]
  if (!entry) return
  // Observer sizes already came from layout and ignore the button press transform.
  // Do not synchronously read offsetWidth/Height in another animation frame.
  const box = entry.borderBoxSize?.[0]
  const width = Math.round(box?.inlineSize ?? entry.contentRect.width)
  const height = Math.round(box?.blockSize ?? entry.contentRect.height)
  if (width < 1 || height < 1) {
    cancelGeometry()
    return
  }
  pendingWidth = width
  pendingHeight = height
  if (geometryFrame) return
  // Updating SVG filter attributes from the observer itself can invalidate its
  // delivery cycle. Apply at most once in the following frame, without encoding.
  geometryFrame = requestAnimationFrame(() => {
    geometryFrame = 0
    if (pendingWidth === dimensions.value.width && pendingHeight === dimensions.value.height) return
    dimensions.value = { width: pendingWidth, height: pendingHeight }
    queueGeometry()
  })
}

function resetPointer() {
  cancelAnimationFrame(pointerFrame)
  pointerFrame = 0
  pressed.value = false
  const highlight = glow.value
  if (highlight) {
    highlight.style.opacity = '0'
    clearTimeout(glowCleanupTimer)
    glowCleanupTimer = window.setTimeout(() => {
      highlight.style.willChange = ''
      glowCleanupTimer = 0
    }, 150)
  }
}

function updatePointer() {
  pointerFrame = 0
  const element = surface.value
  const highlight = glow.value
  if (!element || !highlight) return
  const bounds = element.getBoundingClientRect()
  // A fixed-size, rasterized glow moves on the compositor. Moving a gradient's
  // centre would repaint the entire glass surface for every high-rate event.
  highlight.style.transform = `translate3d(${pointerX - bounds.left - 180}px, ${pointerY - bounds.top - 110}px, 0)`
  highlight.style.opacity = '1'
}

function onPointerMove(event: PointerEvent) {
  if (!props.interactive || !isMoving.value || !finePointer.value || event.pointerType === 'touch')
    return
  pointerX = event.clientX
  pointerY = event.clientY
  clearTimeout(glowCleanupTimer)
  if (glow.value) glow.value.style.willChange = 'transform, opacity'
  if (!pointerFrame) pointerFrame = requestAnimationFrame(updatePointer)
}

function onPointerDown(event: PointerEvent) {
  if (!props.interactive || !isMoving.value || !finePointer.value || event.button !== 0) return
  pressed.value = true
}

function onPreferencesChange() {
  reducedMotion.value = motionPreference?.matches ?? false
  finePointer.value = pointerPreference?.matches ?? false
  resetPointer()
}

function onVisibilityChange() {
  resetPointer()
  queueGeometry()
}

watch(() => props.radius, queueGeometry)
watch(() => props.refraction, queueGeometry)
watch([() => props.motion, () => props.interactive], resetPointer)

onMounted(() => {
  motionPreference = matchMedia('(prefers-reduced-motion: reduce)')
  pointerPreference = matchMedia('(hover: hover) and (pointer: fine)')
  onPreferencesChange()
  motionPreference.addEventListener('change', onPreferencesChange)
  pointerPreference.addEventListener('change', onPreferencesChange)
  // SVG backdrop displacement is supported by Chromium, our Electron renderer.
  // Other engines retain the same material and highlights with a blur fallback.
  supported.value =
    /(?:Chrome|Chromium|Edg)\//.test(navigator.userAgent) &&
    CSS.supports('backdrop-filter', 'url("#liquid-filter")')
  observer = new ResizeObserver(observeGeometry)
  if (surface.value) observer.observe(surface.value)
  if (typeof IntersectionObserver === 'function') {
    visibilityObserver = new IntersectionObserver(entries => {
      isIntersecting = entries[0]?.isIntersecting ?? false
      if (!isIntersecting) resetPointer()
      queueGeometry()
    })
    if (surface.value) visibilityObserver.observe(surface.value)
  } else isIntersecting = true
  window.addEventListener('pointerup', resetPointer, { passive: true })
  window.addEventListener('blur', resetPointer)
  document.addEventListener('visibilitychange', onVisibilityChange)
  queueGeometry()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  visibilityObserver?.disconnect()
  cancelGeometry()
  cancelAnimationFrame(geometryFrame)
  cancelAnimationFrame(pointerFrame)
  clearTimeout(glowCleanupTimer)
  motionPreference?.removeEventListener('change', onPreferencesChange)
  pointerPreference?.removeEventListener('change', onPreferencesChange)
  window.removeEventListener('pointerup', resetPointer)
  window.removeEventListener('blur', resetPointer)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <component
    :is="as"
    ref="surface"
    v-bind="attrs"
    class="liquid-surface"
    :style="surfaceStyle"
    :data-refraction="isRefracting ? 'svg' : 'frost'"
    :data-motion="isMoving"
    :data-interactive="interactive"
    :data-pressed="pressed"
    @pointermove="onPointerMove"
    @pointerdown="onPointerDown"
    @pointerleave="resetPointer"
    @pointercancel="resetPointer"
  >
    <svg
      v-if="displacementMap"
      class="liquid-surface__optics"
      width="0"
      height="0"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter
          :id="filterId"
          :x="-filterPadding"
          :y="-filterPadding"
          :width="dimensions.width + filterPadding * 2"
          :height="dimensions.height + filterPadding * 2"
          filterUnits="userSpaceOnUse"
          primitiveUnits="userSpaceOnUse"
          color-interpolation-filters="sRGB"
        >
          <feGaussianBlur
            in="SourceGraphic"
            :stdDeviation="safeBlur"
            edgeMode="duplicate"
            result="softened"
          />
          <feImage
            :href="displacementMap"
            x="0"
            y="0"
            :width="dimensions.width"
            :height="dimensions.height"
            preserveAspectRatio="none"
            result="edge-map"
          />
          <!-- Smooth the lens field, keeping the scene itself optically clear. -->
          <feGaussianBlur in="edge-map" stdDeviation="0.6" result="smooth-edge-map" />
          <feDisplacementMap
            in="softened"
            in2="smooth-edge-map"
            :scale="safeStrength"
            xChannelSelector="R"
            yChannelSelector="G"
            result="refracted"
          />
          <feColorMatrix in="refracted" type="saturate" values="1.12" />
        </filter>
      </defs>
    </svg>
    <span class="liquid-surface__backdrop" :style="backdropStyle" aria-hidden="true" />
    <span class="liquid-surface__shine" aria-hidden="true">
      <span ref="glow" class="liquid-surface__glow" />
    </span>
    <span class="liquid-surface__content"><slot /></span>
  </component>
</template>

<style scoped>
.liquid-surface {
  /*
   * Material tokens can be supplied by a parent theme or a particular surface.
   * Their fallbacks keep this primitive usable outside the application shell.
   * The default material is dark; .light/.light-modern supplies light fallbacks.
   */
  --liquid-default-tint: rgb(22 38 60 / 10%);
  --liquid-default-rim: rgb(215 234 255 / 38%);
  --liquid-default-inner-light: rgb(235 246 255 / 54%);
  --liquid-default-inner-edge: rgb(255 255 255 / 12%);
  --liquid-default-edge-shadow: rgb(0 8 25 / 44%);
  --liquid-default-caustic: rgb(211 238 255 / 24%);
  --liquid-default-reflection: rgb(220 239 255 / 3%);
  --liquid-default-highlight: rgb(255 255 255 / 12%);
  --liquid-default-shadow: rgb(6 23 49 / 50%);
  --liquid-default-focus: #b7efff;
  position: relative;
  min-width: 0;
  background: transparent;
  color: inherit;
  /* Do not add opacity/filter/isolation here: those cut off the scene backdrop. */
}

html.light .liquid-surface,
html.light-modern .liquid-surface {
  --liquid-default-tint: rgb(247 251 255 / 8%);
  --liquid-default-rim: rgb(255 255 255 / 72%);
  --liquid-default-inner-light: rgb(255 255 255 / 88%);
  --liquid-default-inner-edge: rgb(255 255 255 / 22%);
  --liquid-default-edge-shadow: rgb(36 67 104 / 22%);
  --liquid-default-caustic: rgb(255 255 255 / 62%);
  --liquid-default-reflection: rgb(255 255 255 / 4%);
  --liquid-default-highlight: rgb(255 255 255 / 18%);
  --liquid-default-shadow: rgb(39 61 91 / 24%);
  --liquid-default-focus: #1a6ccc;
}

.liquid-surface:is(button, a) {
  touch-action: manipulation;
}

.liquid-surface:is(button) {
  appearance: none;
  border: 0;
  font: inherit;
  text-align: inherit;
  cursor: pointer;
}

.liquid-surface__optics {
  position: absolute;
  overflow: hidden;
  pointer-events: none;
}

.liquid-surface__backdrop,
.liquid-surface__shine {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
}

.liquid-surface__backdrop {
  z-index: 0;
  overflow: hidden;
  background: var(--liquid-tint, var(--liquid-default-tint));
  box-shadow:
    inset 0 0 0 1px var(--liquid-inner-edge, var(--liquid-default-inner-edge)),
    inset 0 -2px 3px -2px var(--liquid-edge-shadow, var(--liquid-default-edge-shadow)),
    0 2px 6px -2px var(--liquid-shadow, var(--liquid-default-shadow)),
    0 12px 32px -20px var(--liquid-shadow, var(--liquid-default-shadow));
}

.liquid-surface__shine {
  z-index: 1;
  overflow: hidden;
  background: linear-gradient(
    120deg,
    var(--liquid-reflection, var(--liquid-default-reflection)),
    transparent 30%,
    transparent 72%,
    var(--liquid-reflection-end, rgb(255 255 255 / 2%))
  );
}

/* A lit upper lip and an opposing inner caustic describe a curved cross-section.
 * Only the one-pixel rim reflects strongly; the broad face stays transparent. */
.liquid-surface__shine::before,
.liquid-surface__shine::after {
  content: '';
  position: absolute;
  pointer-events: none;
  border-radius: inherit;
}

.liquid-surface__shine::before {
  inset: 0;
  padding: 1px;
  background: linear-gradient(
    145deg,
    var(--liquid-inner-light, var(--liquid-default-inner-light)) 4%,
    var(--liquid-rim, var(--liquid-default-rim)) 20%,
    var(--liquid-edge-shadow, var(--liquid-default-edge-shadow)) 45%,
    var(--liquid-inner-edge, var(--liquid-default-inner-edge)) 65%,
    var(--liquid-rim, var(--liquid-default-rim)) 88%
  );
  mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  mask-composite: exclude;
}

.liquid-surface__shine::after {
  inset: 2px;
  border-radius: max(0px, calc(var(--liquid-radius) - 2px));
  box-shadow:
    inset 0 1px 2px -1px var(--liquid-edge-shadow, var(--liquid-default-edge-shadow)),
    inset 0 -2px 1px -1px var(--liquid-caustic, var(--liquid-default-caustic));
}

.liquid-surface__glow {
  position: absolute;
  top: 0;
  left: 0;
  width: 360px;
  height: 220px;
  border-radius: 50%;
  background: radial-gradient(
    ellipse 180px 110px at center,
    var(--liquid-highlight, var(--liquid-default-highlight)),
    transparent 78%
  );
  opacity: 0;
  transform: translate3d(-180px, -110px, 0);
  transition: opacity 120ms ease-out;
}

.liquid-surface__content {
  position: relative;
  z-index: 2;
  display: var(--liquid-content-display, block);
  min-width: 0;
  height: 100%;
  border-radius: inherit;
}

.liquid-surface:is(button, a):focus-visible {
  outline: 2px solid var(--liquid-focus, var(--liquid-default-focus));
  outline-offset: 4px;
}

@media (hover: hover) and (pointer: fine) {
  .liquid-surface:is(button)[data-interactive='true'][data-motion='true'] {
    transition: transform 210ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .liquid-surface:is(button)[data-interactive='true'][data-motion='true'][data-pressed='true'],
  .liquid-surface:is(button)[data-interactive='true'][data-motion='true']:active {
    transform: scale(0.975, 0.96);
    transition-duration: 0s;
  }
}

.liquid-surface[data-motion='false'] .liquid-surface__glow {
  transition: opacity 100ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .liquid-surface:is(button)[data-motion='true'] {
    transform: none;
    transition:
      color 100ms ease-out,
      background-color 100ms ease-out;
  }
}
</style>
