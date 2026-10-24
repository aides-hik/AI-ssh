import { nextTick, onBeforeUnmount, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'

const dialogStack: HTMLElement[] = []
const focusableSelector =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'

/** Keep teleported dialogs usable with the keyboard and return to their trigger. */
export function useDialogFocus(
  visible: MaybeRefOrGetter<boolean | string>,
  dialog: Ref<HTMLElement | null>,
  onEscape: () => void,
  initialFocus?: () => HTMLElement | null | undefined
) {
  let previous: HTMLElement | null = null
  let current: HTMLElement | null = null
  let revision = 0

  const release = () => {
    revision++
    if (current) {
      const index = dialogStack.indexOf(current)
      if (index !== -1) dialogStack.splice(index, 1)
      if (current.contains(document.activeElement) && previous?.isConnected)
        previous.focus({ preventScroll: true })
    }
    document.removeEventListener('keydown', onKeydown, true)
    current = null
    previous = null
  }
  const onKeydown = (event: KeyboardEvent) => {
    if (event.isComposing) return
    if (!current || dialogStack.at(-1) !== current) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      onEscape()
    } else if (event.key === 'Tab') {
      const controls = [...current.querySelectorAll<HTMLElement>(focusableSelector)].filter(node =>
        node.checkVisibility()
      )
      const first = controls[0] || current
      const last = controls.at(-1) || current
      if (
        event.shiftKey &&
        (document.activeElement === first || !current.contains(document.activeElement))
      ) {
        event.preventDefault()
        last.focus()
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !current.contains(document.activeElement))
      ) {
        event.preventDefault()
        first.focus()
      }
    }
  }

  watch(
    () => toValue(visible),
    async value => {
      release()
      if (!value) return
      previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const pending = revision
      await nextTick()
      if (pending !== revision || !dialog.value) return
      current = dialog.value
      dialogStack.push(current)
      document.addEventListener('keydown', onKeydown, true)
      const target =
        initialFocus?.() || current.querySelector<HTMLElement>(focusableSelector) || current
      target.focus({ preventScroll: true })
    },
    { immediate: true, flush: 'pre' }
  )
  onBeforeUnmount(release)
}
