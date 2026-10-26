<template>
  <div class="notification-container" aria-label="通知">
    <TransitionGroup name="prism-notification" tag="div" class="notification-stack">
      <article
        v-for="notification in notifications"
        :key="notification.id"
        class="notification-item"
        :data-type="notification.type"
        :data-paused="pausedIds.has(notification.id)"
        :role="notification.type === 'error' ? 'alert' : 'status'"
        aria-atomic="true"
        @mouseenter="pauseTimer(notification.id)"
        @mouseleave="resumeUnlessFocused(notification.id, $event)"
        @focusin="pauseTimer(notification.id)"
        @focusout="resumeUnlessFocused(notification.id, $event)"
      >
        <div class="notification-content">
          <span
            class="notification-icon prism-status-icon"
            :data-type="notification.type"
            aria-hidden="true"
            ><i class="bi" :class="icons[notification.type]"></i
          ></span>
          <div class="notification-copy">
            <p v-if="notification.title" class="notification-title">{{ notification.title }}</p>
            <p class="notification-message">{{ notification.message }}</p>
            <div v-if="notification.actions?.length" class="notification-actions">
              <button
                v-for="action in notification.actions"
                :key="action.label"
                class="prism-button"
                :class="action.type === 'primary' ? 'prism-button--primary' : 'prism-button--quiet'"
                @click="handleAction(notification, action)"
              >
                {{ action.label }}
              </button>
            </div>
          </div>
          <button
            class="notification-close prism-button prism-button--quiet prism-button--icon"
            :aria-label="`关闭${notification.title || '通知'}`"
            @click="removeNotification(notification.id)"
          >
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </div>
        <div
          v-if="!notification.persistent && notification.duration && notification.duration > 0"
          class="notification-progress"
          aria-hidden="true"
        >
          <span :style="{ animationDuration: `${notification.duration}ms` }"></span>
        </div>
      </article>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

interface NotificationAction {
  label: string
  type?: 'primary' | 'secondary'
  handler: () => void
}
interface Notification {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title?: string
  message: string
  duration?: number
  persistent?: boolean
  actions?: NotificationAction[]
  createdAt: number
}
const icons = {
  success: 'bi-check-circle',
  error: 'bi-exclamation-octagon',
  warning: 'bi-exclamation-triangle',
  info: 'bi-info-circle'
}
const notifications = ref<Notification[]>([])
const pausedIds = ref(new Set<string>())
const timers = new Map<
  string,
  { handle: ReturnType<typeof setTimeout> | null; remaining: number; started: number }
>()
let notificationId = 0
let unsubscribe: (() => void) | undefined

const addNotification = (options: Omit<Notification, 'id' | 'createdAt'>) => {
  const notification: Notification = {
    ...options,
    duration: options.duration ?? 4000,
    id: `notification-${++notificationId}`,
    createdAt: Date.now()
  }
  notifications.value.push(notification)
  if (!notification.persistent && notification.duration && notification.duration > 0) {
    timers.set(notification.id, {
      handle: setTimeout(() => removeNotification(notification.id), notification.duration),
      remaining: notification.duration,
      started: Date.now()
    })
  }
  return notification.id
}
const removeNotification = (id: string) => {
  const timer = timers.get(id)
  if (timer?.handle) clearTimeout(timer.handle)
  timers.delete(id)
  pausedIds.value.delete(id)
  notifications.value = notifications.value.filter(notification => notification.id !== id)
}
const clearAll = () => {
  for (const id of timers.keys()) removeNotification(id)
  notifications.value = []
  pausedIds.value.clear()
}
function pauseTimer(id: string) {
  const timer = timers.get(id)
  if (!timer?.handle) return
  clearTimeout(timer.handle)
  timer.handle = null
  timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.started))
  pausedIds.value.add(id)
}
function resumeUnlessFocused(id: string, event: Event) {
  const element = event.currentTarget as HTMLElement
  const nextFocus = (event as FocusEvent).relatedTarget
  if (event.type === 'focusout' && nextFocus instanceof Node && element.contains(nextFocus)) return
  if (
    element.matches(':hover') ||
    (event.type !== 'focusout' && element.contains(document.activeElement))
  )
    return
  const timer = timers.get(id)
  if (!timer || timer.handle) return
  timer.started = Date.now()
  timer.handle = setTimeout(() => removeNotification(id), timer.remaining)
  pausedIds.value.delete(id)
}
const handleAction = (notification: Notification, action: NotificationAction) => {
  action.handler()
  removeNotification(notification.id)
}
const success = (message: string, options?: Partial<Notification>) =>
  addNotification({ ...options, type: 'success', message })
const error = (message: string, options?: Partial<Notification>) =>
  addNotification({ ...options, type: 'error', message })
const warning = (message: string, options?: Partial<Notification>) =>
  addNotification({ ...options, type: 'warning', message })
const info = (message: string, options?: Partial<Notification>) =>
  addNotification({ ...options, type: 'info', message })
defineExpose({ addNotification, removeNotification, clearAll, success, error, warning, info })
declare global {
  interface Window {
    $notification: {
      add: typeof addNotification
      remove: typeof removeNotification
      clear: typeof clearAll
      success: typeof success
      error: typeof error
      warning: typeof warning
      info: typeof info
    }
  }
}
if (typeof window !== 'undefined')
  window.$notification = {
    add: addNotification,
    remove: removeNotification,
    clear: clearAll,
    success,
    error,
    warning,
    info
  }
onMounted(() => {
  unsubscribe = window.electronAPI?.onNotification?.(notification => addNotification(notification))
})
onBeforeUnmount(() => {
  clearAll()
  unsubscribe?.()
})
</script>

<style scoped>
.notification-container {
  position: fixed;
  z-index: var(--prism-z-notification);
  bottom: 38px;
  right: 22px;
  width: min(420px, calc(100vw - 32px));
  max-height: calc(100dvh - 100px);
  overflow-y: auto;
  padding: 6px;
  pointer-events: none;
  font-family: var(--prism-font);
  scrollbar-width: thin;
}
.notification-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.notification-item {
  --notification-color: var(--prism-info);
  flex: 0 0 auto;
  width: 100%;
  overflow: hidden;
  border: 1px solid var(--liquid-rim);
  border-radius: var(--prism-radius-panel);
  background: var(--prism-surface-floating);
  backdrop-filter: blur(24px) saturate(140%);
  box-shadow: var(--prism-shadow-raised);
  color: var(--prism-text);
  pointer-events: auto;
}
.notification-item[data-type='success'] {
  --notification-color: var(--prism-success);
}
.notification-item[data-type='error'] {
  --notification-color: var(--prism-danger);
}
.notification-item[data-type='warning'] {
  --notification-color: var(--prism-warning);
}
.notification-content {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
}
.notification-icon {
  width: 30px;
  height: 30px;
  font-size: var(--prism-font-16);
  border-radius: var(--prism-radius-control);
}
.notification-copy {
  flex: 1;
  min-width: 0;
  padding-top: 3px;
  user-select: text;
}
.notification-title {
  margin: 0 0 4px;
  font-size: var(--prism-font-13);
  font-weight: 620;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.notification-message {
  margin: 0;
  font-size: var(--prism-font-12);
  line-height: 1.8;
  color: var(--prism-muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.notification-close {
  width: 30px;
  min-height: 30px;
  font-size: var(--prism-font-11);
}
.notification-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
.notification-actions .prism-button {
  min-height: 32px;
  padding: 5px 10px;
  font-size: var(--prism-font-12);
}
.notification-progress {
  height: 2px;
  background: color-mix(in srgb, var(--notification-color) 12%, transparent);
}
.notification-progress span {
  display: block;
  height: 100%;
  background: var(--notification-color);
  transform-origin: left;
  animation: notification-countdown linear forwards;
}
.notification-item[data-paused='true'] .notification-progress span {
  animation-play-state: paused;
}
@keyframes notification-countdown {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}
.prism-notification-enter-active,
.prism-notification-leave-active {
  transition:
    opacity 180ms var(--prism-ease),
    transform 180ms var(--prism-ease);
}
.prism-notification-enter-from,
.prism-notification-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
.prism-notification-move {
  transition: transform 180ms var(--prism-ease);
}
@media (max-width: 540px) {
  .notification-container {
    right: 10px;
    bottom: 34px;
  }
}
@media (prefers-reduced-transparency: reduce) {
  .notification-item {
    background: var(--prism-surface-raised);
    backdrop-filter: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .prism-notification-enter-active,
  .prism-notification-leave-active {
    transition: opacity 80ms ease;
  }
  .prism-notification-enter-from,
  .prism-notification-leave-to {
    transform: none;
  }
  .prism-notification-move {
    transition: none;
  }
  .notification-progress span {
    animation: none;
  }
}
html[data-motion='off'] .notification-item,
html[data-transitions='off'] .notification-item {
  transition: none;
}
html[data-motion='off'] .notification-progress span,
html[data-transitions='off'] .notification-progress span {
  animation: none;
}
</style>
