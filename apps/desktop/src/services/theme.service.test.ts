import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { themeService, ThemeService } from './theme.service'
import { useTheme } from '../composables/useTheme'

class SystemAppearance extends EventTarget {
  matches = false
  change(dark: boolean) {
    this.matches = dark
    const event = new Event('change')
    Object.defineProperty(event, 'matches', { value: dark })
    this.dispatchEvent(event)
  }
}

function browser(t: TestContext, initial: Record<string, string> = {}, dark = false) {
  const values = new Map(Object.entries(initial))
  const classes = new Set<string>()
  const styles = new Map<string, string>()
  const frames = new Map<number, FrameRequestCallback>()
  const media = new SystemAppearance()
  media.matches = dark
  let nextFrame = 0
  const root = {
    dataset: {} as Record<string, string>,
    offsetWidth: 1200,
    classList: {
      add: (...names: string[]) => names.forEach(name => classes.add(name)),
      remove: (...names: string[]) => names.forEach(name => classes.delete(name)),
      contains: (name: string) => classes.has(name)
    },
    style: { setProperty: (name: string, value: string) => styles.set(name, value) }
  }
  const fakeWindow = Object.assign(new EventTarget(), {
    matchMedia: () => media,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const id = ++nextFrame
      frames.set(id, callback)
      return id
    },
    cancelAnimationFrame: (id: number) => frames.delete(id)
  })
  const replacements = {
    window: fakeWindow,
    document: { documentElement: root },
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    }
  }
  const original = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries(replacements)) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  t.after(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  function paint() {
    while (frames.size) {
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach(callback => callback(0))
    }
  }
  return { values, classes, styles, media, root, fakeWindow, paint }
}

test('saved app mode wins over legacy mode and initialization remains idempotent', t => {
  const env = browser(
    t,
    {
      'app-theme-mode': 'light-modern',
      'theme-settings': JSON.stringify({ mode: 'dark' })
    },
    true
  )
  const service = new ThemeService()
  let changes = 0
  env.fakeWindow.addEventListener('theme-changed', () => changes++)
  service.init()
  service.init()
  assert.deepEqual([...env.classes], ['light-modern'])
  assert.equal(service.getMode(), 'light-modern')
  assert.equal(changes, 1)
  assert.equal(env.root.dataset.themeSwitching, '')
  env.paint()
  assert.equal(env.root.dataset.themeSwitching, undefined)
})

test('auto follows repeated system changes without replacing the saved preference', t => {
  const env = browser(t, { 'app-theme-mode': 'auto' }, true)
  const service = new ThemeService()
  service.init()
  assert.equal(service.getCurrentTheme(), 'dark-modern')
  env.media.change(false)
  assert.equal(service.getCurrentTheme(), 'light-modern')
  env.media.change(true)
  assert.equal(service.getCurrentTheme(), 'dark-modern')
  assert.equal(service.getMode(), 'auto')
  assert.equal(env.values.get('app-theme-mode'), 'auto')
  assert.deepEqual([...env.classes], ['dark-modern'])
  service.applyTheme('light-modern')
  env.media.change(true)
  assert.deepEqual([...env.classes], ['light-modern'])
})

test('legacy mode migrates once and does not override a newer selection on reload', t => {
  const env = browser(t, { 'theme-settings': JSON.stringify({ mode: 'dark' }) })
  const first = new ThemeService()
  first.init()
  assert.equal(env.values.get('app-theme-mode'), 'dark')
  first.applyTheme('light-modern')
  const reloaded = new ThemeService()
  reloaded.init()
  assert.equal(reloaded.getMode(), 'light-modern')
  assert.deepEqual([...env.classes], ['light-modern'])
})

test('toolbar selection survives composable startup, font/color changes, and reload', t => {
  const env = browser(t, {
    'app-theme-mode': 'dark-modern',
    'theme-settings': JSON.stringify({ mode: 'auto', fontSize: 'small', colorScheme: 'blue' })
  })
  themeService.init()
  const appearance = useTheme()
  appearance.initialize()
  assert.equal(appearance.mode.value, 'dark')
  assert.equal(appearance.fontSize.value, 'small')
  assert.equal(env.styles.get('--vscode-accent'), '#3979e7')
  themeService.toggleTheme()
  assert.equal(appearance.mode.value, 'light')
  assert.equal(appearance.isDark.value, false)
  appearance.setFontSize('large')
  appearance.setColorScheme('purple')
  assert.deepEqual([...env.classes], ['light-modern'])
  assert.equal(env.values.get('app-theme-mode'), 'light-modern')
  assert.equal(env.styles.get('--font-size-base'), '18px')
  assert.equal(env.styles.get('--prism-font-scale'), '1.125')
  appearance.toggleAnimations()
  appearance.toggleTransitions()
  assert.equal(env.root.dataset.motion, 'off')
  assert.equal(env.root.dataset.transitions, 'off')
  assert.equal(env.styles.get('--animation-duration'), '0s')
  const reloaded = new ThemeService()
  reloaded.init()
  assert.equal(reloaded.getCurrentTheme(), 'light-modern')
  appearance.setMode('auto')
  env.media.change(true)
  assert.equal(appearance.mode.value, 'auto')
  assert.equal(appearance.isDark.value, true)
  assert.equal(env.values.get('app-theme-mode'), 'auto')
  assert.equal(JSON.parse(env.values.get('theme-settings') ?? '{}').mode, 'auto')
})
