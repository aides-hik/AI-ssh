<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="context-menu-backdrop"
      @click="close"
      @contextmenu.prevent="close"
    ></div>
    <div
      v-if="visible"
      ref="menuRef"
      class="context-menu prism-menu"
      role="menu"
      aria-label="操作菜单"
      :style="menuStyle"
      tabindex="-1"
      @keydown="handleKeydown"
      @click.stop
    >
      <template v-for="(item, index) in items" :key="index">
        <div
          v-if="item.type === 'divider'"
          class="menu-divider prism-menu-divider"
          role="separator"
        ></div>
        <button
          v-else
          class="menu-item prism-menu-item"
          role="menuitem"
          :class="{ disabled: item.disabled, danger: item.danger }"
          :disabled="item.disabled"
          :data-danger="item.danger || undefined"
          @click="handleItemClick(item)"
        >
          <i v-if="item.icon" class="menu-icon" :class="item.icon" aria-hidden="true"></i>
          <span class="menu-label">{{ item.label }}</span>
          <span v-if="item.shortcut" class="menu-shortcut">{{ item.shortcut }}</span>
          <i v-if="item.children" class="menu-arrow bi bi-chevron-right" aria-hidden="true"></i>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'

export interface ContextMenuItem {
  type?: 'item' | 'divider'
  label?: string
  icon?: string
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  children?: ContextMenuItem[]
  onClick?: () => void
}
const props = defineProps<{ items: ContextMenuItem[]; visible: boolean; x: number; y: number }>()
const emit = defineEmits<{ close: [] }>()
const menuRef = ref<HTMLElement | null>(null)
const menuStyle = ref({ left: '8px', top: '8px' })
let previous: HTMLElement | null = null
let revision = 0
function position() {
  const bounds = menuRef.value?.getBoundingClientRect()
  if (!bounds) return
  menuStyle.value = {
    left: `${Math.max(8, Math.min(props.x, innerWidth - bounds.width - 8))}px`,
    top: `${Math.max(8, Math.min(props.y, innerHeight - bounds.height - 8))}px`
  }
}
function release() {
  revision++
  window.removeEventListener('resize', position)
  if (menuRef.value?.contains(document.activeElement) && previous?.isConnected)
    previous.focus({ preventScroll: true })
  previous = null
}
watch(
  () => [props.visible, props.x, props.y, props.items] as const,
  async ([visible]) => {
    if (!visible) {
      release()
      return
    }
    if (!previous)
      previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const pending = ++revision
    await nextTick()
    if (!props.visible || pending !== revision) return
    position()
    window.addEventListener('resize', position)
    const first =
      menuRef.value?.querySelector<HTMLElement>('button:not(:disabled)') || menuRef.value
    first?.focus({ preventScroll: true })
  },
  { immediate: true }
)
function handleItemClick(item: ContextMenuItem) {
  if (item.disabled) return
  close()
  item.onClick?.()
}
function close() {
  release()
  emit('close')
}
function handleKeydown(event: KeyboardEvent) {
  const controls = [
    ...(menuRef.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])
  ]
  const index = controls.indexOf(document.activeElement as HTMLButtonElement)
  let next: HTMLButtonElement | undefined
  if (event.key === 'ArrowDown') next = controls[(index + 1) % controls.length]
  else if (event.key === 'ArrowUp') next = controls[(index - 1 + controls.length) % controls.length]
  else if (event.key === 'Home') next = controls[0]
  else if (event.key === 'End') next = controls.at(-1)
  else if (event.key === 'Escape' || event.key === 'Tab') close()
  else return
  event.preventDefault()
  event.stopPropagation()
  next?.focus()
}
onBeforeUnmount(release)
</script>

<style scoped>
.context-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9998;
  background: transparent;
}
.context-menu {
  position: fixed;
  z-index: 9999;
  min-width: min(200px, calc(100vw - 16px));
  max-width: calc(100vw - 16px);
  max-height: calc(100dvh - 16px);
  overflow: auto;
  outline: none;
}
.menu-icon {
  width: 18px;
  flex: 0 0 auto;
  color: var(--prism-muted);
  text-align: center;
}
.menu-item.danger .menu-icon {
  color: inherit;
}
.menu-label {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.menu-shortcut {
  margin-left: 20px;
  color: var(--prism-muted);
  font-size: var(--prism-font-11);
  white-space: nowrap;
}
.menu-arrow {
  font-size: var(--prism-font-10);
  color: var(--prism-muted);
}
</style>
