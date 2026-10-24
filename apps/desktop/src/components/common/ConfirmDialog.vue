<template>
  <Teleport to="body">
    <Transition name="prism-dialog-motion">
      <div
        v-if="visible"
        class="dialog-overlay prism-dialog-overlay"
        @click.self="handleOverlayClick"
      >
        <section
          ref="dialogRef"
          class="dialog-container prism-dialog"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="`${id}-title`"
          :aria-describedby="`${id}-message`"
          tabindex="-1"
        >
          <header class="prism-dialog__header">
            <span class="dialog-icon prism-status-icon" :data-type="type" aria-hidden="true"
              ><i :class="iconName"></i
            ></span>
            <h3 :id="`${id}-title`" class="dialog-title prism-dialog__title">
              {{ options.title || '确认操作' }}
            </h3>
          </header>
          <div class="dialog-content prism-dialog__body">
            <p :id="`${id}-message`" class="dialog-message prism-dialog__message">
              {{ options.message }}
            </p>
          </div>
          <footer class="dialog-footer prism-dialog__footer">
            <button
              ref="cancelButtonRef"
              class="dialog-button dialog-button-cancel prism-button"
              @click="handleCancel"
            >
              {{ options.cancelText || '取消' }}
            </button>
            <button
              class="dialog-button dialog-button-confirm prism-button"
              :class="type === 'danger' ? 'prism-button--danger' : 'prism-button--primary'"
              @click="handleConfirm"
            >
              {{ options.confirmText || '确定' }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useDialogFocus } from '@/composables/useDialogFocus'

export interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  type?: 'warning' | 'danger' | 'info' | 'success'
  closeOnOverlay?: boolean
}
const props = withDefaults(defineProps<{ visible: boolean; options: ConfirmOptions }>(), {
  visible: false
})
const emit = defineEmits<{ confirm: []; cancel: []; 'update:visible': [value: boolean] }>()
const id = useId()
const dialogRef = ref<HTMLElement | null>(null)
const cancelButtonRef = ref<HTMLButtonElement | null>(null)
const type = computed(() => props.options.type || 'warning')
const iconName = computed(
  () =>
    ({
      warning: 'bi bi-exclamation-triangle',
      danger: 'bi bi-exclamation-octagon',
      info: 'bi bi-info-circle',
      success: 'bi bi-check-circle'
    })[type.value]
)
function handleConfirm() {
  emit('confirm')
  emit('update:visible', false)
}
function handleCancel() {
  emit('cancel')
  emit('update:visible', false)
}
function handleOverlayClick() {
  if (props.options.closeOnOverlay !== false) handleCancel()
}
useDialogFocus(
  () => props.visible,
  dialogRef,
  handleCancel,
  () => cancelButtonRef.value
)
</script>
