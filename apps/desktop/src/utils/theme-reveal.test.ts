import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { revealThemeFrom } from './theme-reveal'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function browser(
  t: TestContext,
  options: { supported?: boolean; reduced?: boolean; motion?: string } = {}
) {
  const transitions: Array<{
    commit(): void
    ready: ReturnType<typeof deferred>
    finished: ReturnType<typeof deferred>
    skipped: boolean
  }> = []
  const animations: Array<{
    frames: { clipPath: string[] }
    options: KeyframeAnimationOptions
    finished: ReturnType<typeof deferred>
    canceled: boolean
  }> = []
  const root = {
    dataset: { motion: options.motion } as Record<string, string | undefined>,
    animate(frames: { clipPath: string[] }, animationOptions: KeyframeAnimationOptions) {
      const item = { frames, options: animationOptions, finished: deferred(), canceled: false }
      animations.push(item)
      return {
        finished: item.finished.promise,
        cancel() {
          item.canceled = true
          item.finished.reject(new Error('Canceled'))
        }
      }
    }
  }
  const document = {
    documentElement: root,
    startViewTransition:
      options.supported === false
        ? undefined
        : (update: () => void) => {
            const item = {
              ready: deferred(),
              finished: deferred(),
              skipped: false,
              commit() {
                update()
                item.ready.resolve()
              }
            }
            transitions.push(item)
            return {
              ready: item.ready.promise,
              finished: item.finished.promise,
              skipTransition() {
                item.skipped = true
                item.ready.reject(new Error('Skipped'))
                item.finished.resolve()
              }
            }
          }
  }
  for (const [name, value] of Object.entries({
    document,
    window: {
      innerWidth: 1200,
      innerHeight: 800,
      matchMedia: () => ({ matches: options.reduced === true })
    }
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { configurable: true, value })
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original)
      else Reflect.deleteProperty(globalThis, name)
    })
  }
  const origin = {
    getBoundingClientRect: () => ({ left: 1100, top: 0, width: 40, height: 40 })
  } as HTMLElement
  return { root, transitions, animations, origin }
}

test('theme changes immediately when snapshots are unsupported or motion is disabled', async t => {
  for (const options of [{ supported: false }, { reduced: true }, { motion: 'off' }]) {
    await t.test(JSON.stringify(options), async child => {
      const env = browser(child, options)
      let changes = 0
      await revealThemeFrom(env.origin, () => changes++)
      assert.equal(changes, 1)
      assert.equal(env.transitions.length, 0)
      assert.equal(env.root.dataset.themeReveal, undefined)
    })
  }
})

test('the reveal starts at the control centre and covers every viewport corner', async t => {
  const env = browser(t)
  let changes = 0
  const done = revealThemeFrom(env.origin, () => changes++)
  env.transitions[0].commit()
  await Promise.resolve()
  assert.equal(changes, 1)
  const animation = env.animations[0]
  assert.equal(animation.frames.clipPath[0], 'circle(0px at 1120px 20px)')
  const radius = Number(animation.frames.clipPath[1].match(/circle\((\d+)px/)?.[1])
  assert.ok(radius >= 1364.112, 'the bottom-left corner must be inside the revealed circle')
  assert.ok(radius < 1366, 'the reveal should finish at the viewport, without excess travel')
  assert.equal(animation.options.pseudoElement, '::view-transition-new(root)')
  assert.equal(env.root.dataset.themeReveal, '')
  animation.finished.resolve()
  env.transitions[0].finished.resolve()
  await done
  assert.equal(env.root.dataset.themeReveal, undefined)
})

test('rapid changes cancel the old reveal without committing a stale pending palette', async t => {
  const env = browser(t)
  const changes: string[] = []
  const old = revealThemeFrom(env.origin, () => changes.push('old'))
  const current = revealThemeFrom(env.origin, () => changes.push('current'))
  assert.equal(env.transitions[0].skipped, true)
  env.transitions[0].commit()
  env.transitions[1].commit()
  await Promise.resolve()
  assert.deepEqual(changes, ['current'])
  assert.equal(env.root.dataset.themeReveal, '')
  env.animations[0].finished.resolve()
  env.transitions[1].finished.resolve()
  await Promise.all([old, current])
  assert.equal(env.root.dataset.themeReveal, undefined)
})

test('a snapshot failure still applies the requested palette exactly once', async t => {
  const env = browser(t)
  let changes = 0
  const done = revealThemeFrom(env.origin, () => changes++)
  env.transitions[0].ready.reject(new Error('Snapshot unavailable'))
  await done
  assert.equal(changes, 1)
  assert.equal(env.transitions[0].skipped, true)
  assert.equal(env.root.dataset.themeReveal, undefined)
})
