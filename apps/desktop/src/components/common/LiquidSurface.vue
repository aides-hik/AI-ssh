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
    strength: 22,
    blur: 8,
    interactive: true,
    motion: true,
    refraction: true
  }
)

const attrs = useAttrs()
const surface = ref<HTMLElement>()
const shine = ref<HTMLElement>()
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
let resizeFrame = 0
let motionPreference: MediaQueryList | undefined
let pointerPreference: MediaQueryList | undefined

function updateGeometry() {
  resizeFrame = 0
  const element = surface.value
  if (!element || !supported.value) return
  // offsetWidth/Height ignore the press transform; the optical map never chases it.
  const width = element.offsetWidth
  const height = element.offsetHeight
  if (width < 1 || height < 1) return
  dimensions.value = { width, height }
  try {
    displacementMap.value = createRefractionMap(width, height, safeRadius.value)
  } catch {
    // A restrictive Canvas policy or unavailable renderer still gets legible frost.
    displacementMap.value = ''
    supported.value = false
  }
}

function queueGeometry() {
  if (!resizeFrame) resizeFrame = requestAnimationFrame(updateGeometry)
}

function resetPointer() {
  pressed.value = false
  const highlight = shine.value
  if (highlight) {
    highlight.style.setProperty('--liquid-pointer-x', '38%')
    highlight.style.setProperty('--liquid-pointer-y', '12%')
    highlight.style.setProperty('--liquid-light', '0')
  }
}

function onPointerMove(event: PointerEvent) {
  if (!props.interactive || !isMoving.value || !finePointer.value || event.pointerType === 'touch')
    return
  const element = surface.value
  const highlight = shine.value
  if (!element || !highlight) return
  const bounds = element.getBoundingClientRect()
  // Local custom properties live on the paint-only highlight, not the slot tree.
  highlight.style.setProperty('--liquid-pointer-x', `${event.clientX - bounds.left}px`)
  highlight.style.setProperty('--liquid-pointer-y', `${event.clientY - bounds.top}px`)
  highlight.style.setProperty('--liquid-light', '1')
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

watch(() => props.radius, queueGeometry)
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
  observer = new ResizeObserver(queueGeometry)
  if (surface.value) observer.observe(surface.value)
  window.addEventListener('pointerup', resetPointer, { passive: true })
  window.addEventListener('blur', resetPointer)
  queueGeometry()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  cancelAnimationFrame(resizeFrame)
  motionPreference?.removeEventListener('change', onPreferencesChange)
  pointerPreference?.removeEventListener('change', onPreferencesChange)
  window.removeEventListener('pointerup', resetPointer)
  window.removeEventListener('blur', resetPointer)
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
          x="0"
          y="0"
          :width="dimensions.width"
          :height="dimensions.height"
          filterUnits="userSpaceOnUse"
          primitiveUnits="userSpaceOnUse"
          color-interpolation-filters="sRGB"
        >
          <feGaussianBlur in="SourceGraphic" :stdDeviation="safeBlur" result="softened" />
          <feImage
            :href="displacementMap"
            x="0"
            y="0"
            :width="dimensions.width"
            :height="dimensions.height"
            preserveAspectRatio="none"
            result="edge-map"
          />
          <feDisplacementMap
            in="softened"
            in2="edge-map"
            :scale="safeStrength"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
    <span class="liquid-surface__backdrop" :style="backdropStyle" aria-hidden="true" />
    <span ref="shine" class="liquid-surface__shine" aria-hidden="true" />
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
  --liquid-default-tint: rgb(226 242 255 / 10%);
  --liquid-default-rim: rgb(255 255 255 / 25%);
  --liquid-default-inner-light: rgb(255 255 255 / 47%);
  --liquid-default-inner-edge: rgb(255 255 255 / 20%);
  --liquid-default-reflection: rgb(255 255 255 / 15%);
  --liquid-default-highlight: rgb(255 255 255 / 20%);
  --liquid-default-shadow: rgb(6 23 49 / 50%);
  --liquid-default-focus: #b7efff;
  position: relative;
  min-width: 0;
  background: transparent;
  color: inherit;
  /* Do not add opacity/filter/isolation here: those cut off the scene backdrop. */
}

:global(:root.light) .liquid-surface,
:global(:root.light-modern) .liquid-surface {
  --liquid-default-tint: rgb(244 249 255 / 38%);
  --liquid-default-rim: rgb(255 255 255 / 72%);
  --liquid-default-inner-light: rgb(255 255 255 / 88%);
  --liquid-default-inner-edge: rgb(255 255 255 / 42%);
  --liquid-default-reflection: rgb(255 255 255 / 35%);
  --liquid-default-highlight: rgb(255 255 255 / 42%);
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
    inset 0 1px 0 var(--liquid-inner-light, var(--liquid-default-inner-light)),
    inset 1px 0 0 var(--liquid-inner-edge, var(--liquid-default-inner-edge)),
    inset -1px -1px 0 var(--liquid-inner-edge, var(--liquid-default-inner-edge)),
    0 14px 40px -22px var(--liquid-shadow, var(--liquid-default-shadow));
}

.liquid-surface__shine {
  z-index: 1;
  overflow: hidden;
  border: 1px solid var(--liquid-rim, var(--liquid-default-rim));
  background: linear-gradient(
    145deg,
    var(--liquid-reflection, var(--liquid-default-reflection)),
    transparent 38%,
    transparent 68%,
    var(--liquid-reflection-end, rgb(255 255 255 / 8%))
  );
}

.liquid-surface__shine::before {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(
    ellipse 180px 110px at var(--liquid-pointer-x, 38%) var(--liquid-pointer-y, 12%),
    var(--liquid-highlight, var(--liquid-default-highlight)),
    transparent 78%
  );
  opacity: var(--liquid-light, 0);
  transition: opacity 120ms ease-out;
  content: '';
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

.liquid-surface[data-motion='false'] .liquid-surface__shine::before {
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
