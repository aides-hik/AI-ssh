interface ThemeRevealTransition {
  ready: Promise<void>
  finished: Promise<void>
  skipTransition(): void
}

interface ActiveThemeReveal {
  transition: ThemeRevealTransition
  animation?: Animation
}

let request = 0
let active: ActiveThemeReveal | undefined

/** Reveal the new palette from its control, keeping repeated clicks interruptible. */
export async function revealThemeFrom(origin: HTMLElement | null, changeTheme: () => void) {
  const revision = ++request
  active?.transition.skipTransition()
  active?.animation?.cancel()
  active = undefined
  const root = document.documentElement
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const startTransition = document.startViewTransition?.bind(document)
  if (
    !startTransition ||
    reducedMotion ||
    root.dataset.motion === 'off' ||
    root.dataset.transitions === 'off'
  ) {
    delete root.dataset.themeReveal
    changeTheme()
    return
  }

  const bounds = origin?.getBoundingClientRect()
  const x = bounds ? bounds.left + bounds.width / 2 : window.innerWidth / 2
  const y = bounds ? bounds.top + bounds.height / 2 : window.innerHeight / 2
  const radius = Math.ceil(
    Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
  )
  let changed = false
  const apply = () => {
    if (revision !== request || changed) return
    changed = true
    changeTheme()
  }

  root.dataset.themeReveal = ''
  try {
    const transition = startTransition(apply)
    const reveal: ActiveThemeReveal = { transition }
    active = reveal
    await transition.ready
    if (revision !== request) return
    reveal.animation = root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      {
        duration: 420,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'both',
        pseudoElement: '::view-transition-new(root)'
      }
    )
    await reveal.animation.finished
    await transition.finished
  } catch {
    // Unsupported snapshot/animation paths still commit the user's chosen theme.
    apply()
    if (revision === request) active?.transition.skipTransition()
  } finally {
    if (revision === request) {
      active?.animation?.cancel()
      delete root.dataset.themeReveal
      active = undefined
    }
  }
}
