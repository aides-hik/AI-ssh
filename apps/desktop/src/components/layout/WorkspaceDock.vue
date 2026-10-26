<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import LiquidSurface from '@/components/common/LiquidSurface.vue'

type Destination = 'home' | 'terminal' | 'files' | 'settings'
const props = defineProps<{
  active: Destination
  connected: boolean
  motion: boolean
}>()
const emit = defineEmits<{ navigate: [destination: Destination] }>()
const { t } = useI18n()
const home = ref<HTMLButtonElement>()
const track = ref<HTMLDivElement>()
const selected = computed(() =>
  !props.connected && (props.active === 'terminal' || props.active === 'files')
    ? 'none'
    : props.active
)

watch(
  () => props.connected,
  connected => {
    if (connected) return
    const focused = document.activeElement
    if (
      focused instanceof HTMLElement &&
      track.value?.contains(focused) &&
      ['terminal', 'files'].includes(focused.dataset.destination || '')
    )
      home.value?.focus()
  },
  { flush: 'pre' }
)

function navigate(destination: Destination) {
  if (!props.connected && (destination === 'terminal' || destination === 'files')) return
  emit('navigate', destination)
}
</script>

<template>
  <LiquidSurface
    as="nav"
    class="liquid-dock workspace-dock"
    :radius="28"
    :blur="0.2"
    :strength="56"
    :motion="motion"
    :interactive="false"
    aria-label="主导航"
  >
    <div
      ref="track"
      class="workspace-dock-track"
      :data-connected="connected"
      :data-active="selected"
    >
      <span class="workspace-dock-slider" aria-hidden="true" />
      <button
        ref="home"
        type="button"
        class="workspace-dock-button workspace-dock-home"
        data-destination="home"
        aria-label="工作台"
        :class="{ active: active === 'home' }"
        :aria-current="active === 'home' ? 'page' : undefined"
        @click="navigate('home')"
      >
        <i class="bi bi-grid-1x2" aria-hidden="true" /><span>工作台</span>
      </button>
      <button
        type="button"
        class="workspace-dock-button workspace-dock-session workspace-dock-terminal"
        data-destination="terminal"
        aria-label="终端"
        :class="{ active: active === 'terminal' }"
        :aria-current="connected && active === 'terminal' ? 'page' : undefined"
        :aria-hidden="!connected || undefined"
        :inert="!connected"
        :tabindex="connected ? 0 : -1"
        @click="navigate('terminal')"
      >
        <i class="bi bi-terminal" aria-hidden="true" /><span>终端</span>
      </button>
      <button
        type="button"
        class="workspace-dock-button workspace-dock-session workspace-dock-files"
        data-destination="files"
        aria-label="文件管理"
        :class="{ active: active === 'files' }"
        :aria-current="connected && active === 'files' ? 'page' : undefined"
        :aria-hidden="!connected || undefined"
        :inert="!connected"
        :tabindex="connected ? 0 : -1"
        @click="navigate('files')"
      >
        <i class="bi bi-folder2" aria-hidden="true" /><span>文件</span>
      </button>
      <span class="workspace-dock-divider" aria-hidden="true" />
      <button
        type="button"
        class="workspace-dock-button workspace-dock-settings"
        data-destination="settings"
        :aria-label="t('common.settings')"
        :class="{ active: active === 'settings' }"
        :aria-current="active === 'settings' ? 'page' : undefined"
        @click="navigate('settings')"
      >
        <i class="bi bi-sliders2" aria-hidden="true" /><span>{{ t('common.settings') }}</span>
      </button>
    </div>
  </LiquidSurface>
</template>

<style scoped>
.workspace-dock-track {
  --dock-button-width: 88px;
  --dock-step: calc(var(--dock-button-width) + 3px);
  --dock-settings-x: calc(var(--dock-step) + 14px);
  position: relative;
  height: 42px;
  width: calc(var(--dock-button-width) * 2 + 17px);
  /* The one deliberate layout tween expands the existing glass shell in place. */
  transition: width 280ms cubic-bezier(0.22, 1, 0.36, 1);
}
.workspace-dock-track[data-connected='true'] {
  --dock-settings-x: calc(var(--dock-step) * 3 + 14px);
  width: calc(var(--dock-button-width) * 4 + 23px);
}
.workspace-dock-button {
  position: absolute;
  inset: 0 auto auto 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: var(--dock-button-width);
  min-width: 0;
  height: 42px;
  padding: 0 10px;
  border: 0;
  border-radius: 22px;
  background: transparent;
  color: var(--vscode-fg-muted);
  font: inherit;
  font-size: var(--prism-font-12);
  touch-action: manipulation;
  transition:
    transform 280ms cubic-bezier(0.22, 1, 0.36, 1),
    color 100ms ease-out,
    background-color 100ms ease-out;
}
.workspace-dock-button i {
  font-size: var(--prism-font-17);
}
.workspace-dock-button.active {
  color: var(--vscode-accent);
}
.workspace-dock-settings {
  transform: translate3d(var(--dock-settings-x), 0, 0);
}
.workspace-dock-session {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translate3d(0, 0, 0) scale(0.86);
  transition:
    transform 280ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 140ms ease-out,
    visibility 0s 280ms,
    color 100ms ease-out,
    background-color 100ms ease-out;
}
[data-connected='true'] .workspace-dock-session {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transition-delay: 0s;
}
[data-connected='true'] .workspace-dock-terminal {
  transform: translate3d(var(--dock-step), 0, 0);
}
[data-connected='true'] .workspace-dock-files {
  transform: translate3d(calc(var(--dock-step) * 2), 0, 0);
}
.workspace-dock-slider {
  position: absolute;
  inset: 0 auto auto 0;
  width: var(--dock-button-width);
  height: 42px;
  border-radius: 22px;
  background: var(--liquid-selected);
  box-shadow:
    inset 0 1px 0 var(--liquid-inner-light),
    0 2px 5px #273d5b0d;
  pointer-events: none;
  transition:
    transform 240ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 100ms ease-out;
}
[data-active='terminal'] .workspace-dock-slider {
  transform: translate3d(var(--dock-step), 0, 0);
}
[data-active='files'] .workspace-dock-slider {
  transform: translate3d(calc(var(--dock-step) * 2), 0, 0);
}
[data-active='settings'] .workspace-dock-slider {
  transform: translate3d(var(--dock-settings-x), 0, 0);
}
[data-active='none'] .workspace-dock-slider {
  opacity: 0;
}
.workspace-dock-divider {
  position: absolute;
  top: 11px;
  left: 0;
  width: 1px;
  height: 20px;
  background: var(--vscode-border);
  transform: translate3d(calc(var(--dock-settings-x) - 9px), 0, 0);
  transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
}
@media (hover: hover) and (pointer: fine) {
  .workspace-dock-button:hover {
    background: color-mix(in srgb, var(--liquid-selected) 45%, transparent);
    color: var(--vscode-fg);
  }
}
@media (max-width: 480px) {
  .workspace-dock-track {
    --dock-button-width: 58px;
  }
  .workspace-dock-button span {
    display: none;
  }
}
.workspace-dock[data-motion='false']
  :is(
    .workspace-dock-track,
    .workspace-dock-button,
    .workspace-dock-slider,
    .workspace-dock-divider
  ),
:global(html[data-transitions='off'])
  :is(
    .workspace-dock-track,
    .workspace-dock-button,
    .workspace-dock-slider,
    .workspace-dock-divider
  ) {
  transition: none;
}
@media (prefers-reduced-motion: reduce) {
  .workspace-dock
    :is(
      .workspace-dock-track,
      .workspace-dock-button,
      .workspace-dock-slider,
      .workspace-dock-divider
    ) {
    transition: none;
  }
}
</style>
