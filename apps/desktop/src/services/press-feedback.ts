type FeedbackNode = HTMLElement | SVGElement

const controlLabels = 'label.toggle-switch, label.glass-switch, label.oc-target-option, label.toggle-label'
const candidates = [
  'button', 'a[href]', '[role="button"]', '[role="tab"]', '[role="menuitem"]', '[role="treeitem"]',
  'summary', '.tree-node-content', '.file-item', '.context-menu-item', '.autocomplete-item', '.command-item',
  '.status-badge.clickable', '.upload-progress-indicator', '.download-progress-indicator', '.statusbar-item', controlLabels,
  'input[type="checkbox"]', 'input[type="radio"]', 'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]'
].join(', ')
const excluded = [
  'textarea', 'select', 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"])',
  '[contenteditable]:not([contenteditable="false"])', '.xterm', '.monaco-editor',
  '[role="separator"]', '.vscode-splitter', '[data-resize-handle]',
  '[data-prism-press="off"]', '[data-prism-press-disabled]'
].join(', ')
const unavailable = '[inert], [hidden], [aria-hidden="true"], [aria-disabled="true"], [aria-busy="true"]'
const motionDisabled = '[data-motion="off"], [data-motion="false"], [data-transitions="off"], [data-theme-switching]'

function isElement(value: unknown): value is Element {
  return !!value && typeof (value as Element).matches === 'function' && typeof (value as Element).closest === 'function'
}

function eventElement(event: Event): Element | null {
  return event.composedPath().find(isElement) ?? (isElement(event.target) ? event.target : null)
}

/** Resolve only the nearest control, so a row and its nested action never both press. */
export function resolvePressOwner(target: Element | null): HTMLElement | null {
  if (!target || target.closest(excluded)) return null
  let owner = target.closest(candidates) as HTMLElement | null
  if (owner?.matches('input[type="checkbox"], input[type="radio"]')) {
    owner = owner.closest(controlLabels) as HTMLElement | null ?? owner
  }
  if (!owner || owner.matches('.sidebar-scrim, .modal-overlay, .prism-dialog-overlay') ||
      owner.closest(unavailable) || owner.matches(':disabled') ||
      owner.querySelector('input:disabled') && owner.matches(controlLabels)) return null
  return owner
}

function feedbackNode(owner: HTMLElement): FeedbackNode {
  if (owner.matches('.vscode-window-control:not(.theme-toggle)')) {
    return owner.querySelector<FeedbackNode>('svg, i') ?? owner
  }
  return owner
}

function scalePair(value: string): [number, number] {
  const values = value.trim().split(/\s+/).map(Number)
  if (!values.length || !Number.isFinite(values[0]) || values[0] <= 0) return [1, 1]
  return [values[0], Number.isFinite(values[1]) && values[1] > 0 ? values[1] : values[0]]
}

function scaleText([x, y]: [number, number]): string {
  return `${x} ${y}`
}

interface Press {
  owner: HTMLElement
  node: FeedbackNode
  scale: string
  scalePriority: string
  base: [number, number]
  marker: string | null
  ownerMarker: string | null
  animation?: Animation
  spatial: boolean
  released: boolean
  kind: 'pointer' | 'keyboard' | 'activation'
  pointerId?: number
  key?: string
  x: number
  y: number
}

export interface PressFeedbackEnvironment {
  document: Document
  window: Window
}

/** One delegated listener set also covers controls rendered through Teleport. */
export function installPressFeedback(environment?: PressFeedbackEnvironment): () => void {
  const doc = environment?.document ?? globalThis.document
  const win = environment?.window ?? globalThis.window
  if (!doc || !win) return () => undefined
  const media = win.matchMedia('(prefers-reduced-motion: reduce)')
  const records = new Map<HTMLElement, Press>()
  let held: Press | undefined
  let recent: { owner: HTMLElement; time: number } | undefined
  let disposed = false
  let observing = false

  const motionAllowed = (owner: HTMLElement) => !media.matches && !owner.closest(motionDisabled) &&
    !doc.documentElement.matches(motionDisabled)
  const restoreScale = (press: Press) => {
    if (press.scale) press.node.style.setProperty('scale', press.scale, press.scalePriority)
    else press.node.style.removeProperty('scale')
  }
  const restoreAttribute = (node: Element, name: string, value: string | null) => {
    if (value === null) node.removeAttribute(name)
    else node.setAttribute(name, value)
  }
  const removeMoveListener = () => win.removeEventListener('pointermove', pointerMove, true)

  function cleanup(press: Press) {
    if (records.get(press.owner) !== press) return
    records.delete(press.owner)
    if (!records.size && observing) { observer?.disconnect(); observing = false }
    if (held === press) { held = undefined; removeMoveListener() }
    const animation = press.animation
    press.animation = undefined
    if (animation) { animation.onfinish = null; animation.oncancel = null; animation.cancel() }
    restoreScale(press)
    restoreAttribute(press.owner, 'data-prism-press', press.ownerMarker)
    restoreAttribute(press.node, 'data-prism-press-target', press.marker)
  }

  function stopSpatial(press: Press) {
    if (press.released) { cleanup(press); return }
    const animation = press.animation
    press.animation = undefined
    if (animation) { animation.onfinish = null; animation.oncancel = null; animation.cancel() }
    restoreScale(press)
    press.spatial = false
  }

  function begin(owner: HTMLElement, kind: Press['kind'], event?: PointerEvent, key?: string): Press {
    if (held) cleanup(held)
    const previous = records.get(owner)
    // Read before cancelling the old animation, so rapid presses start from the
    // current displayed scale instead of the previous animation's first frame.
    const node = previous?.node ?? feedbackNode(owner)
    const current = scalePair(win.getComputedStyle(node).scale)
    const base = previous?.base ?? current
    const savedScale = previous?.scale ?? node.style.getPropertyValue('scale')
    const savedPriority = previous?.scalePriority ?? node.style.getPropertyPriority('scale')
    const marker = previous ? previous.marker : node.getAttribute('data-prism-press-target')
    const ownerMarker = previous ? previous.ownerMarker : owner.getAttribute('data-prism-press')
    if (previous) cleanup(previous)
    const press: Press = {
      owner, node, base, scale: savedScale, scalePriority: savedPriority, marker, ownerMarker,
      spatial: motionAllowed(owner), released: false, kind, pointerId: event?.pointerId, key,
      x: event?.clientX ?? 0, y: event?.clientY ?? 0
    }
    records.set(owner, press)
    if (!observing) {
      observer?.observe(doc.documentElement, {
        subtree: true, childList: true, attributes: true,
        attributeFilter: ['data-motion', 'data-transitions', 'data-theme-switching', 'disabled', 'aria-disabled', 'aria-busy', 'inert', 'hidden']
      })
      observing = !!observer
    }
    held = press
    owner.setAttribute('data-prism-press', 'down')
    node.setAttribute('data-prism-press-target', '')
    if (press.spatial) {
      const box = owner.getBoundingClientRect()
      const row = box.width >= 160 || owner.matches('.tree-node-content, .file-item, .oc-target-option, summary')
      const ratio: [number, number] = row ? [0.99, 0.97] : box.width <= 52 ? [0.96, 0.96] : [0.97, 0.96]
      // Independent scale composes with Dock positioning and popup transforms.
      node.style.setProperty('scale', scaleText([base[0] * ratio[0], base[1] * ratio[1]]))
    }
    return press
  }

  function release(press: Press) {
    if (records.get(press.owner) !== press || press.released) return
    press.released = true
    if (held === press) { held = undefined; removeMoveListener() }
    recent = { owner: press.owner, time: Date.now() }
    restoreAttribute(press.owner, 'data-prism-press', press.ownerMarker)
    if (!press.spatial || !motionAllowed(press.owner) || !press.owner.isConnected || typeof press.node.animate !== 'function') {
      cleanup(press)
      return
    }
    const from = win.getComputedStyle(press.node).scale
    restoreScale(press)
    try {
      const animation = press.node.animate([{ scale: from }, { scale: scaleText(press.base) }], {
        duration: 280, easing: 'cubic-bezier(0.2, 1.65, 0.35, 1)'
      })
      press.animation = animation
      animation.onfinish = () => cleanup(press)
      animation.oncancel = () => cleanup(press)
    } catch { cleanup(press) }
  }

  function cancelAll() {
    for (const press of [...records.values()]) cleanup(press)
  }

  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || event.isPrimary === false) return
    const owner = resolvePressOwner(eventElement(event))
    if (!owner) return
    begin(owner, 'pointer', event)
    win.addEventListener('pointermove', pointerMove, { capture: true, passive: true })
  }

  function pointerMove(event: PointerEvent) {
    if (!held || held.kind !== 'pointer' || held.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - held.x, event.clientY - held.y) > 8) cleanup(held)
  }

  function pointerUp(event: PointerEvent) {
    if (held?.kind === 'pointer' && held.pointerId === event.pointerId) release(held)
  }

  function pointerCancel(event: PointerEvent) {
    if (held?.kind === 'pointer' && held.pointerId === event.pointerId) cleanup(held)
  }

  function keyDown(event: KeyboardEvent) {
    if (event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || ![' ', 'Enter'].includes(event.key)) return
    const owner = resolvePressOwner(eventElement(event))
    if (!owner) return
    if (held?.kind === 'keyboard' && held.owner === owner && held.key === event.key) return
    begin(owner, 'keyboard', undefined, event.key)
  }

  function keyUp(event: KeyboardEvent) {
    if (held?.kind === 'keyboard' && held.key === event.key) release(held)
  }

  function activation(event: MouseEvent) {
    // Native pointer/keyboard activation already has a paired press. A trusted
    // click with no such events can come from assistive technology.
    if (!event.isTrusted || event.detail !== 0) return
    const owner = resolvePressOwner(eventElement(event))
    if (!owner || held?.owner === owner || recent?.owner === owner && Date.now() - recent.time < 500) return
    release(begin(owner, 'activation'))
  }

  function preferencesChanged() {
    for (const press of [...records.values()]) {
      if (!press.owner.isConnected || !press.released && (press.owner.closest(unavailable) || press.owner.matches(':disabled'))) cleanup(press)
      else if (!motionAllowed(press.owner)) stopSpatial(press)
    }
  }

  function focusOut(event: FocusEvent) {
    if (held?.kind === 'keyboard' && !(isElement(event.relatedTarget) && held.owner.contains(event.relatedTarget))) cleanup(held)
  }

  function visibilityChanged() { if (doc.visibilityState !== 'visible') cancelAll() }

  const Observer = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver
  const observer = typeof Observer === 'function' ? new Observer(preferencesChanged) : undefined
  doc.addEventListener('pointerdown', pointerDown, { capture: true, passive: true })
  win.addEventListener('pointerup', pointerUp, { capture: true, passive: true })
  win.addEventListener('pointercancel', pointerCancel, { capture: true, passive: true })
  doc.addEventListener('keydown', keyDown, true)
  doc.addEventListener('keyup', keyUp, true)
  doc.addEventListener('click', activation, true)
  doc.addEventListener('focusout', focusOut, true)
  doc.addEventListener('dragstart', cancelAll, true)
  doc.addEventListener('visibilitychange', visibilityChanged)
  win.addEventListener('blur', cancelAll)
  media.addEventListener('change', preferencesChanged)

  return () => {
    if (disposed) return
    disposed = true
    cancelAll()
    observer?.disconnect()
    doc.removeEventListener('pointerdown', pointerDown, true)
    win.removeEventListener('pointerup', pointerUp, true)
    win.removeEventListener('pointercancel', pointerCancel, true)
    doc.removeEventListener('keydown', keyDown, true)
    doc.removeEventListener('keyup', keyUp, true)
    doc.removeEventListener('click', activation, true)
    doc.removeEventListener('focusout', focusOut, true)
    doc.removeEventListener('dragstart', cancelAll, true)
    doc.removeEventListener('visibilitychange', visibilityChanged)
    win.removeEventListener('blur', cancelAll)
    media.removeEventListener('change', preferencesChanged)
  }
}
