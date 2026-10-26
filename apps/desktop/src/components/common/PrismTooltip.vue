<template>
  <Teleport :to="teleportTarget">
    <div
      :id="id"
      ref="tooltip"
      class="prism-tooltip"
      role="tooltip"
      popover="manual"
      :aria-hidden="!visible"
      :data-visible="visible"
      :style="position"
    >
      {{ content }}
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'

const id = `prism-tooltip-${useId()}`
const tooltip = ref<HTMLElement | null>(null)
const visible = ref(false)
const content = ref('')
const position = ref({ left: '8px', top: '8px' })
const teleportTarget = ref<string | HTMLElement>('body')
let active: HTMLElement | null = null
let pointerTrigger: HTMLElement | null = null
let focusTrigger: HTMLElement | null = null
let overTooltip = false
let keyboard = true
let openTimer: ReturnType<typeof setTimeout> | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined
let observer: MutationObserver | undefined
let mutationFrame = 0
let revision = 0

function triggerAt(target: EventTarget | null) {
  return target instanceof Element ? target.closest<HTMLElement>('[data-prism-tooltip]') : null
}
function clearTimers() {
  clearTimeout(openTimer)
  clearTimeout(closeTimer)
  openTimer = closeTimer = undefined
}
function describe(trigger: HTMLElement, add: boolean) {
  const ids = new Set((trigger.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean))
  if (add) ids.add(id)
  else ids.delete(id)
  if (ids.size) trigger.setAttribute('aria-describedby', [...ids].join(' '))
  else trigger.removeAttribute('aria-describedby')
}
function place() {
  if (!active || !tooltip.value) return
  const anchor = active.getBoundingClientRect()
  const box = tooltip.value.getBoundingClientRect()
  const left = Math.max(
    8,
    Math.min(anchor.left + (anchor.width - box.width) / 2, innerWidth - box.width - 8)
  )
  let top = anchor.top - box.height - 8
  if (top < 8) top = anchor.bottom + 8
  top = Math.max(8, Math.min(top, innerHeight - box.height - 8))
  position.value = { left: `${left}px`, top: `${top}px` }
}
function hide() {
  revision++
  clearTimers()
  observer?.disconnect()
  cancelAnimationFrame(mutationFrame)
  mutationFrame = 0
  if (active) describe(active, false)
  active = null
  visible.value = false
  if (tooltip.value?.matches(':popover-open')) tooltip.value.hidePopover()
  teleportTarget.value = 'body'
}
async function show(trigger: HTMLElement) {
  clearTimers()
  const text = trigger.dataset.prismTooltip?.trim()
  if (!text || !trigger.isConnected || !trigger.getClientRects().length) {
    hide()
    return
  }
  if (active && active !== trigger) describe(active, false)
  active = trigger
  content.value = text
  visible.value = true
  // Content outside a native modal is inert even when painted in the top layer.
  // Keep the tooltip inside that modal's focus scope before promoting it.
  const destination = trigger.closest<HTMLDialogElement>('dialog[open]') || 'body'
  if (teleportTarget.value !== destination && tooltip.value?.matches(':popover-open'))
    tooltip.value.hidePopover()
  teleportTarget.value = destination
  const pending = ++revision
  await nextTick()
  if (pending !== revision || !active || !tooltip.value) return
  if (typeof tooltip.value.showPopover === 'function' && !tooltip.value.matches(':popover-open'))
    tooltip.value.showPopover()
  place()
  describe(trigger, true)
  observeTrigger()
}
function observeTrigger() {
  observer?.disconnect()
  if (!active || !observer) return
  // Observe only the trigger's path. Streaming chat, terminal output and glass
  // pointer highlights elsewhere must not enqueue a global observer callback.
  for (let node: HTMLElement | null = active; node; node = node.parentElement) {
    observer.observe(node, {
      childList: true,
      attributes: true,
      attributeFilter: [
        'data-prism-tooltip',
        'class',
        'style',
        'hidden',
        'inert',
        'aria-hidden',
        'open'
      ]
    })
  }
}
function request(trigger: HTMLElement, delay: number) {
  clearTimers()
  if (visible.value && active === trigger) return
  if (active && active !== trigger) hide()
  if (!delay) void show(trigger)
  else
    openTimer = setTimeout(() => {
      if (pointerTrigger === trigger) void show(trigger)
    }, delay)
}
function leave() {
  clearTimeout(closeTimer)
  // A short bridge lets the pointer cross the gap into the tooltip itself.
  closeTimer = setTimeout(() => {
    if (!pointerTrigger && !overTooltip && focusTrigger !== active) hide()
  }, 160)
}
function pointerOver(event: PointerEvent) {
  if (event.pointerType === 'touch') return
  if (event.target instanceof Node && tooltip.value?.contains(event.target)) {
    overTooltip = true
    clearTimeout(closeTimer)
    return
  }
  const trigger = triggerAt(event.target)
  if (trigger === pointerTrigger) return
  pointerTrigger = trigger
  if (trigger) request(trigger, 400)
}
function pointerOut(event: PointerEvent) {
  if (event.pointerType === 'touch') return
  const related = event.relatedTarget
  if (related instanceof Node && tooltip.value?.contains(related)) {
    overTooltip = true
    pointerTrigger = null
    clearTimeout(closeTimer)
    return
  }
  if (event.target instanceof Node && tooltip.value?.contains(event.target)) overTooltip = false
  if (pointerTrigger && related instanceof Node && pointerTrigger.contains(related)) return
  pointerTrigger = null
  clearTimeout(openTimer)
  leave()
}
function focusIn(event: FocusEvent) {
  const trigger = triggerAt(event.target)
  if (!trigger || (!keyboard && !trigger.matches(':focus-visible'))) return
  focusTrigger = trigger
  request(trigger, 0)
}
function focusOut(event: FocusEvent) {
  if (
    focusTrigger &&
    event.relatedTarget instanceof Node &&
    focusTrigger.contains(event.relatedTarget)
  )
    return
  focusTrigger = null
  if (!pointerTrigger && !overTooltip) hide()
}
function dismiss() {
  focusTrigger = null
  overTooltip = false
  hide()
}
function scroll(event: Event) {
  if (event.target instanceof Node && tooltip.value?.contains(event.target)) return
  dismiss()
}
function pointerDown() {
  keyboard = false
  dismiss()
}
function keyDown(event: KeyboardEvent) {
  if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) keyboard = true
  if (event.key === 'Escape' && visible.value) {
    dismiss()
    event.preventDefault()
    event.stopImmediatePropagation()
  }
}
onMounted(() => {
  if (tooltip.value && typeof tooltip.value.showPopover !== 'function') {
    tooltip.value.removeAttribute('popover')
    tooltip.value.dataset.fallback = 'true'
  }
  document.addEventListener('pointerover', pointerOver, true)
  document.addEventListener('pointerout', pointerOut, true)
  document.addEventListener('pointerdown', pointerDown, true)
  // Activation can come from Enter/Space or a scripted click without pointerdown.
  // Retire the trigger's hint before its action opens another surface.
  document.addEventListener('click', dismiss, true)
  document.addEventListener('focusin', focusIn, true)
  document.addEventListener('focusout', focusOut, true)
  document.addEventListener('keydown', keyDown, true)
  document.addEventListener('scroll', scroll, true)
  window.addEventListener('resize', dismiss)
  observer = new MutationObserver(records => {
    if (!active) return
    if (!active.isConnected || !active.dataset.prismTooltip?.trim()) {
      dismiss()
      return
    }
    const trigger = active
    const relevant = records.some(record =>
      record.type === 'attributes'
        ? record.target instanceof Element && record.target.contains(trigger)
        : [...record.removedNodes].some(node => node === trigger || node.contains(trigger))
    )
    if (!relevant || mutationFrame) return
    // A trigger may be moved while still connected. Follow its new ancestor path
    // and defer visibility reads until the next frame, after DOM writes settle.
    mutationFrame = requestAnimationFrame(() => {
      mutationFrame = 0
      if (!active) return
      if (
        !active.isConnected ||
        !active.checkVisibility({ visibilityProperty: true }) ||
        active.closest('[inert], [aria-hidden="true"]') ||
        !active.dataset.prismTooltip?.trim()
      ) {
        dismiss()
        return
      }
      if (content.value !== active.dataset.prismTooltip.trim()) void show(active)
      else observeTrigger()
    })
  })
})
onBeforeUnmount(() => {
  hide()
  observer?.disconnect()
  document.removeEventListener('pointerover', pointerOver, true)
  document.removeEventListener('pointerout', pointerOut, true)
  document.removeEventListener('pointerdown', pointerDown, true)
  document.removeEventListener('click', dismiss, true)
  document.removeEventListener('focusin', focusIn, true)
  document.removeEventListener('focusout', focusOut, true)
  document.removeEventListener('keydown', keyDown, true)
  document.removeEventListener('scroll', scroll, true)
  window.removeEventListener('resize', dismiss)
})
</script>

<style scoped>
.prism-tooltip {
  position: fixed;
  inset: auto;
  margin: 0;
  z-index: 12000;
  width: max-content;
  max-width: min(360px, calc(100dvw - 16px));
  max-height: min(280px, calc(100dvh - 16px));
  overflow: auto;
  padding: 8px 11px;
  border: 1px solid var(--liquid-rim);
  border-radius: var(--prism-radius-control);
  background: var(--prism-surface-floating);
  backdrop-filter: blur(24px) saturate(140%);
  box-shadow: var(--prism-shadow-raised);
  color: var(--prism-text);
  font: 400 var(--prism-font-12)/1.65 var(--prism-font);
  text-align: start;
  white-space: pre-line;
  overflow-wrap: anywhere;
  user-select: text;
  opacity: 0;
  transition:
    opacity 100ms ease-out,
    display 100ms allow-discrete,
    overlay 100ms allow-discrete;
}
.prism-tooltip:popover-open,
.prism-tooltip[data-fallback][data-visible='true'] {
  opacity: 1;
}
@starting-style {
  .prism-tooltip:popover-open {
    opacity: 0;
  }
}
.prism-tooltip:not(:popover-open):not([data-fallback]),
.prism-tooltip[data-visible='false'] {
  pointer-events: none;
}
.prism-tooltip[data-fallback] {
  display: none;
}
.prism-tooltip[data-fallback][data-visible='true'] {
  display: block;
}
@media (prefers-reduced-transparency: reduce) {
  .prism-tooltip {
    background: var(--prism-surface-raised);
    backdrop-filter: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .prism-tooltip {
    transition: none;
  }
}
html:is([data-motion='off'], [data-transitions='off']) .prism-tooltip {
  transition: none;
}
</style>
