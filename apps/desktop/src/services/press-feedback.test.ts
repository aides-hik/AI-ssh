import test from 'node:test'
import assert from 'node:assert/strict'
import { installPressFeedback, resolvePressOwner } from './press-feedback'

class Style {
  values = new Map<string, string>()
  priorities = new Map<string, string>()
  getPropertyValue(key: string) { return this.values.get(key) ?? '' }
  getPropertyPriority(key: string) { return this.priorities.get(key) ?? '' }
  setProperty(key: string, value: string, priority = '') { this.values.set(key, value); this.priorities.set(key, priority) }
  removeProperty(key: string) { const value = this.getPropertyValue(key); this.values.delete(key); this.priorities.delete(key); return value }
}

class ElementFixture {
  parentElement?: ElementFixture
  children: ElementFixture[] = []
  attributes = new Map<string, string>()
  style = new Style()
  width = 90
  height = 36
  isConnected = true
  animationScale?: string
  animations: AnimationFixture[] = []
  constructor(public tagName = 'div', classes = '') { this.attributes.set('class', classes) }
  append(child: ElementFixture) { child.parentElement = this; this.children.push(child); return child }
  getAttribute(name: string) { return this.attributes.get(name) ?? null }
  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
  removeAttribute(name: string) { this.attributes.delete(name) }
  matches(selector: string): boolean {
    // Small DOM fixture for the service's standard tag/class/attribute selectors.
    // The production browser checks exercise the actual CSS selector engine.
    return selector.split(',').some(part => {
      let token = part.trim()
      const exclusions = [...token.matchAll(/:not\(([^)]+)\)/g)].map(match => match[1])
      if (exclusions.some(exclusion => this.matches(exclusion))) return false
      token = token.replace(/:not\([^)]+\)/g, '')
      if (token.includes(':disabled') && !this.attributes.has('disabled')) return false
      token = token.replace(/:disabled/g, '')
      const tag = token.match(/^[a-z][\w-]*/i)?.[0]
      if (tag && tag.toLowerCase() !== this.tagName.toLowerCase()) return false
      for (const match of token.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        if (!this.attributes.has(match[1]) || match[2] !== undefined && this.attributes.get(match[1]) !== match[2]) return false
      }
      const stripped = token.replace(/\[[^\]]+\]/g, '')
      const classes = (this.attributes.get('class') ?? '').split(/\s+/)
      return [...stripped.matchAll(/\.([\w-]+)/g)].every(match => classes.includes(match[1]))
    })
  }
  closest(selector: string): ElementFixture | null {
    if (this.matches(selector)) return this
    return this.parentElement?.closest(selector) ?? null
  }
  querySelector(selector: string): ElementFixture | null {
    for (const child of this.children) {
      if (child.matches(selector)) return child
      const match = child.querySelector(selector)
      if (match) return match
    }
    return null
  }
  contains(node: ElementFixture): boolean { return node === this || this.children.some(child => child.contains(node)) }
  getBoundingClientRect() { return { width: this.width, height: this.height } }
  animate(frames: Array<{ scale: string }>, options: unknown) {
    const animation = new AnimationFixture(this, frames, options)
    this.animations.push(animation)
    this.animationScale = frames[0].scale
    return animation
  }
  dom(): HTMLElement { return this as unknown as HTMLElement }
}

class AnimationFixture {
  onfinish: (() => void) | null = null
  oncancel: (() => void) | null = null
  cancelled = false
  constructor(public node: ElementFixture, public frames: Array<{ scale: string }>, public options: unknown) {}
  cancel() { this.cancelled = true; this.node.animationScale = undefined; this.oncancel?.() }
  finish() { this.node.animationScale = undefined; this.onfinish?.() }
}

class TargetFixture extends EventTarget {
  listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  addEventListener(type: string, callback: any, options?: any) {
    super.addEventListener(type, callback, options)
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(callback); this.listeners.set(type, listeners)
  }
  removeEventListener(type: string, callback: any, options?: any) {
    super.removeEventListener(type, callback, options); this.listeners.get(type)?.delete(callback)
  }
  emit(type: string, target: ElementFixture, data: Record<string, unknown> = {}) {
    const event = new Event(type, { cancelable: true })
    Object.defineProperties(event, {
      composedPath: { value: () => [target] },
      ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, { value }]))
    })
    this.dispatchEvent(event)
    return event
  }
}

function browser() {
  const root = new ElementFixture('html')
  const doc = Object.assign(new TargetFixture(), { documentElement: root, visibilityState: 'visible', defaultView: undefined as unknown })
  const media = Object.assign(new EventTarget(), { matches: false })
  const observers: Array<{ callback: () => void; disconnected: boolean; observing: boolean }> = []
  class Observer {
    callback: () => void
    disconnected = false
    observing = false
    constructor(callback: () => void) { this.callback = callback; observers.push(this) }
    observe() { this.observing = true }
    disconnect() { this.disconnected = true; this.observing = false }
  }
  const win = Object.assign(new TargetFixture(), {
    matchMedia: () => media,
    getComputedStyle: (node: ElementFixture) => ({ scale: node.animationScale ?? (node.style.getPropertyValue('scale') || 'none') }),
    MutationObserver: Observer
  })
  doc.defaultView = win
  const cleanup = installPressFeedback({ document: doc as unknown as Document, window: win as unknown as Window })
  const pointer = (type: string, target: ElementFixture, overrides: Record<string, unknown> = {}) =>
    (type === 'pointerdown' ? doc : win).emit(type, target, { button: 0, pointerId: 1, isPrimary: true, clientX: 20, clientY: 20, ...overrides })
  return { root, doc, win, media, cleanup, pointer, notify: () => observers.at(-1)?.callback(), observer: () => observers.at(-1) }
}

test('nested actions press only themselves and never alter Dock positioning or delay click handlers', () => {
  const env = browser()
  const row = env.root.append(new ElementFixture('div', 'tree-node-content'))
  const button = row.append(new ElementFixture('button', 'workspace-dock-button'))
  button.style.setProperty('transform', 'translate3d(182px, 0, 0)')
  const icon = button.append(new ElementFixture('i'))
  const down = env.pointer('pointerdown', icon)
  assert.equal(button.getAttribute('data-prism-press'), 'down')
  assert.equal(row.getAttribute('data-prism-press'), null)
  assert.equal(button.style.getPropertyValue('scale'), '0.97 0.96')
  assert.equal(button.style.getPropertyValue('transform'), 'translate3d(182px, 0, 0)')
  let clicks = 0
  env.doc.addEventListener('click', () => { clicks++ })
  env.pointer('pointerup', icon)
  const click = env.doc.emit('click', icon, { detail: 1 })
  assert.equal(clicks, 1)
  assert.equal(down.defaultPrevented, false)
  assert.equal(click.defaultPrevented, false)
  assert.equal(button.animations.length, 1)
  assert.equal(button.getAttribute('data-prism-press'), null)
  button.animations[0].finish()
  assert.equal(button.style.getPropertyValue('scale'), '')
  assert.equal(button.getAttribute('data-prism-press-target'), null)
  env.cleanup()
})

test('press and cleanup preserve pre-existing independent scale, priorities and markers', () => {
  const env = browser()
  const button = env.root.append(new ElementFixture('button'))
  button.style.setProperty('scale', '1.1 1.2', 'important')
  button.setAttribute('data-prism-press-target', 'existing')
  env.pointer('pointerdown', button)
  const pressed = button.style.getPropertyValue('scale').split(' ').map(Number)
  assert(Math.abs(pressed[0] - 1.067) < 0.00001)
  assert(Math.abs(pressed[1] - 1.152) < 0.00001)
  env.pointer('pointerup', button)
  assert.deepEqual(button.animations[0].frames.at(-1), { scale: '1.1 1.2' })
  button.animations[0].finish()
  assert.equal(button.style.getPropertyValue('scale'), '1.1 1.2')
  assert.equal(button.style.getPropertyPriority('scale'), 'important')
  assert.equal(button.getAttribute('data-prism-press-target'), 'existing')
  env.cleanup()
})

test('repressing during the return spring cancels it without letting old completion clear the new press', () => {
  const env = browser()
  const button = env.root.append(new ElementFixture('button'))
  env.pointer('pointerdown', button); env.pointer('pointerup', button)
  const first = button.animations[0]
  const oldFinish = first.onfinish
  button.animationScale = '1.005 1.005'
  env.pointer('pointerdown', button)
  assert.equal(first.cancelled, true)
  oldFinish?.()
  assert.equal(button.getAttribute('data-prism-press'), 'down')
  assert.equal(button.style.getPropertyValue('scale'), '0.97 0.96')
  env.pointer('pointerup', button)
  button.animations[1].finish()
  assert.equal(button.getAttribute('data-prism-press-target'), null)
  assert.equal(button.style.getPropertyValue('scale'), '')
  env.cleanup()
})

test('keyboard presses ignore repeat, retain native activation and return once on key release', () => {
  const env = browser()
  const button = env.root.append(new ElementFixture('button'))
  const down = env.doc.emit('keydown', button, { key: ' ', repeat: false })
  env.doc.emit('keydown', button, { key: ' ', repeat: true })
  env.doc.emit('click', button, { detail: 0 })
  assert.equal(button.getAttribute('data-prism-press'), 'down')
  assert.equal(button.animations.length, 0)
  env.doc.emit('keyup', button, { key: ' ' })
  env.doc.emit('click', button, { detail: 0 })
  assert.equal(button.animations.length, 1)
  assert.equal(down.defaultPrevented, false)
  env.cleanup()
})

test('disabled and editing controls are excluded, labels share one owner, modal buttons remain available', () => {
  const root = new ElementFixture('html')
  const row = root.append(new ElementFixture('div', 'file-item'))
  for (const type of ['text', 'range']) {
    const input = row.append(new ElementFixture('input')); input.setAttribute('type', type)
    assert.equal(resolvePressOwner(input.dom()), null)
  }
  assert.equal(resolvePressOwner(row.append(new ElementFixture('select')).dom()), null)
  const label = root.append(new ElementFixture('label', 'toggle-switch'))
  const input = label.append(new ElementFixture('input')); input.setAttribute('type', 'checkbox')
  assert.equal(resolvePressOwner(input.dom()), label)
  input.setAttribute('disabled', '')
  assert.equal(resolvePressOwner(label.dom()), null)
  const overlay = root.append(new ElementFixture('div', 'prism-dialog-overlay'))
  const modalButton = overlay.append(new ElementFixture('button'))
  assert.equal(resolvePressOwner(modalButton.dom()), modalButton)
  const scrim = root.append(new ElementFixture('button', 'sidebar-scrim'))
  assert.equal(resolvePressOwner(scrim.dom()), null)
  overlay.setAttribute('inert', '')
  assert.equal(resolvePressOwner(modalButton.dom()), null)
})

test('window controls scale their icon while keeping the native hit region fixed', () => {
  const env = browser()
  const button = env.root.append(new ElementFixture('button', 'vscode-window-control'))
  const icon = button.append(new ElementFixture('svg')); button.width = 46
  env.pointer('pointerdown', icon)
  assert.equal(button.style.getPropertyValue('scale'), '')
  assert.equal(icon.style.getPropertyValue('scale'), '0.96 0.96')
  env.pointer('pointerup', icon)
  assert.equal(icon.animations.length, 1)
  env.cleanup()
})

test('motion preferences disable displacement immediately while retaining pressed paint until release', () => {
  const env = browser()
  const button = env.root.append(new ElementFixture('button'))
  env.pointer('pointerdown', button)
  env.media.matches = true; env.media.dispatchEvent(new Event('change'))
  assert.equal(button.style.getPropertyValue('scale'), '')
  assert.equal(button.getAttribute('data-prism-press'), 'down')
  env.pointer('pointerup', button)
  assert.equal(button.animations.length, 0)
  env.media.matches = false
  env.pointer('pointerdown', button)
  env.root.setAttribute('data-motion', 'off'); env.notify()
  assert.equal(button.style.getPropertyValue('scale'), '')
  assert.equal(button.getAttribute('data-prism-press'), 'down')
  env.pointer('pointerup', button)
  assert.equal(button.animations.length, 0)
  env.cleanup()
})

test('scrolling, drag and lost-window gestures restore controls and retire the active-only move listener', () => {
  const env = browser()
  const button = env.root.append(new ElementFixture('button'))
  const cancel = [
    () => env.pointer('pointermove', button, { clientX: 29 }),
    () => env.pointer('pointercancel', button),
    () => env.doc.emit('dragstart', button),
    () => env.win.emit('blur', button),
    () => { env.doc.visibilityState = 'hidden'; env.doc.emit('visibilitychange', button) }
  ]
  for (const cancelGesture of cancel) {
    env.doc.visibilityState = 'visible'
    env.pointer('pointerdown', button)
    assert.equal(env.win.listeners.get('pointermove')?.size, 1)
    cancelGesture()
    assert.equal(button.getAttribute('data-prism-press'), null)
    assert.equal(button.style.getPropertyValue('scale'), '')
    assert.equal(env.win.listeners.get('pointermove')?.size, 0)
  }
  assert.equal(button.animations.length, 0)
  env.cleanup()
})

test('disposing cancels in-flight animation, restores styles and removes all service listeners', () => {
  const env = browser()
  const button = env.root.append(new ElementFixture('button'))
  env.pointer('pointerdown', button); env.pointer('pointerup', button)
  env.cleanup(); env.cleanup()
  assert.equal(button.animations[0].cancelled, true)
  assert.equal(button.style.getPropertyValue('scale'), '')
  assert.equal(button.getAttribute('data-prism-press-target'), null)
  assert.equal(env.observer()?.disconnected, true)
  for (const listeners of [...env.doc.listeners.values(), ...env.win.listeners.values()]) assert.equal(listeners.size, 0)
  env.pointer('pointerdown', button)
  assert.equal(button.getAttribute('data-prism-press'), null)
})

test('only active feedback observes mutations and an accepted action may become busy without cutting its return spring', () => {
  const env = browser()
  const section = env.root.append(new ElementFixture('section'))
  const button = section.append(new ElementFixture('button'))
  assert.equal(env.observer()?.observing, false)
  env.pointer('pointerdown', button)
  assert.equal(env.observer()?.observing, true)
  env.pointer('pointerup', button)
  button.setAttribute('disabled', '')
  section.setAttribute('aria-busy', 'true')
  env.notify()
  assert.equal(button.animations[0].cancelled, false)
  button.animations[0].finish()
  assert.equal(env.observer()?.observing, false)
  assert.equal(button.getAttribute('data-prism-press-target'), null)
  button.removeAttribute('disabled'); section.removeAttribute('aria-busy')
  env.pointer('pointerdown', button)
  button.setAttribute('disabled', '')
  env.notify()
  assert.equal(button.getAttribute('data-prism-press'), null)
  assert.equal(button.style.getPropertyValue('scale'), '')
  env.cleanup()
})
