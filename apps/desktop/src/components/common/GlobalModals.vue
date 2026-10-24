<template>
  <Teleport to="body">
    <Transition name="prism-dialog-motion">
      <div v-if="activeKind" class="modal-overlay prism-dialog-overlay" @click.self="handleCancel">
        <form
          ref="dialogRef"
          class="global-modal prism-dialog"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="`${id}-title`"
          :aria-describedby="`${id}-message`"
          tabindex="-1"
          novalidate
          @submit.prevent="handleOk"
        >
          <header class="prism-dialog__header">
            <span class="prism-status-icon" :data-type="statusType" aria-hidden="true"
              ><i class="bi" :class="statusIcon"></i
            ></span>
            <h3 :id="`${id}-title`" class="prism-dialog__title">{{ activeModal.title }}</h3>
          </header>
          <div class="prism-dialog__body">
            <p :id="`${id}-message`" class="prism-dialog__message">{{ activeModal.message }}</p>
            <input
              v-if="activeKind === 'prompt'"
              ref="promptInput"
              :id="`${id}-input`"
              v-model="promptModal.inputValue"
              :type="promptModal.inputType || 'text'"
              :placeholder="promptModal.placeholder"
              :aria-label="promptModal.title"
              :aria-describedby="`${id}-message${promptError ? ` ${id}-input-error` : ''}`"
              :aria-invalid="promptError ? 'true' : undefined"
              class="prism-field"
              @compositionstart="isComposing = true"
              @compositionend="isComposing = false"
              @input="promptError && validatePrompt()"
            />
            <p
              v-if="activeKind === 'prompt' && promptError"
              :id="`${id}-input-error`"
              class="prism-field-error"
              role="status"
            >
              {{ promptError }}
            </p>
          </div>
          <footer class="prism-dialog__footer">
            <button
              v-if="activeKind !== 'alert'"
              ref="cancelButton"
              type="button"
              class="prism-button"
              @click="handleCancel"
            >
              {{ cancelText }}
            </button>
            <button
              type="submit"
              class="prism-button"
              :class="statusType === 'danger' ? 'prism-button--danger' : 'prism-button--primary'"
            >
              {{ activeModal.okText }}
            </button>
          </footer>
        </form>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, nextTick, computed, useId } from 'vue'
import { useDialogFocus } from '@/composables/useDialogFocus'

// 扩展Window接口以包含$modal属性
declare global {
  interface Window {
    $modal: {
      showConfirm: (options: {
        title?: string
        message: string
        type?: 'info' | 'danger'
        okText?: string
        cancelText?: string
        onOk?: () => void
        onCancel?: () => void
      }) => void
      showAlert: (options: {
        title?: string
        message: string
        type?: 'info' | 'success' | 'error' | 'warning'
        okText?: string
        onOk?: () => void
      }) => void
      showPrompt: (options: {
        title?: string
        message: string
        placeholder?: string
        inputType?: string
        defaultValue?: string
        okText?: string
        cancelText?: string
        onOk?: (value: string) => void
        onCancel?: () => void
      }) => void
    }
  }
}

// 模态框状态
const confirmModal = reactive({
  visible: false,
  title: '',
  message: '',
  type: 'info' as 'info' | 'danger',
  okText: '确定',
  cancelText: '取消',
  onOk: null as (() => void) | null,
  onCancel: null as (() => void) | null
})

const alertModal = reactive({
  visible: false,
  title: '',
  message: '',
  type: 'info' as 'info' | 'success' | 'error' | 'warning',
  okText: '确定',
  onOk: null as (() => void) | null
})

const promptModal = reactive({
  visible: false,
  title: '',
  message: '',
  placeholder: '',
  inputType: 'text',
  inputValue: '',
  okText: '确定',
  cancelText: '取消',
  onOk: null as ((value: string) => void) | null,
  onCancel: null as (() => void) | null
})

const promptInput = ref<HTMLInputElement>()
const isComposing = ref(false)
const promptError = ref('')
const validatePrompt = () => {
  const input = promptInput.value
  promptError.value = input && !input.checkValidity() ? input.validationMessage : ''
  return !promptError.value
}

// 确认对话框处理函数
const handleConfirmOk = () => {
  confirmModal.visible = false
  if (confirmModal.onOk) {
    confirmModal.onOk()
  }
}

const handleConfirmCancel = () => {
  confirmModal.visible = false
  if (confirmModal.onCancel) {
    confirmModal.onCancel()
  }
}

// 信息对话框处理函数
const handleAlertOk = () => {
  alertModal.visible = false
  if (alertModal.onOk) {
    alertModal.onOk()
  }
}

// 输入对话框处理函数
const handlePromptOk = () => {
  if (!validatePrompt()) {
    promptInput.value?.focus()
    return
  }
  const value = promptModal.inputValue
  promptModal.visible = false
  promptModal.inputValue = ''
  if (promptModal.onOk) {
    promptModal.onOk(value)
  }
}

const handlePromptCancel = () => {
  promptError.value = ''
  promptModal.visible = false
  promptModal.inputValue = ''
  if (promptModal.onCancel) {
    promptModal.onCancel()
  }
}

// 全局方法
const showConfirm = (options: {
  title?: string
  message: string
  type?: 'info' | 'danger'
  okText?: string
  cancelText?: string
  onOk?: () => void
  onCancel?: () => void
}) => {
  Object.assign(confirmModal, {
    visible: true,
    title: options.title || '确认操作',
    message: options.message,
    type: options.type || 'info',
    okText: options.okText || '确定',
    cancelText: options.cancelText || '取消',
    onOk: options.onOk || null,
    onCancel: options.onCancel || null
  })
}

const showAlert = (options: {
  title?: string
  message: string
  type?: 'info' | 'success' | 'error' | 'warning'
  okText?: string
  onOk?: () => void
}) => {
  Object.assign(alertModal, {
    visible: true,
    title: options.title || '提示',
    message: options.message,
    type: options.type || 'info',
    okText: options.okText || '确定',
    onOk: options.onOk || null
  })
}

const showPrompt = (options: {
  title?: string
  message: string
  placeholder?: string
  inputType?: string
  defaultValue?: string
  okText?: string
  cancelText?: string
  onOk?: (value: string) => void
  onCancel?: () => void
}) => {
  promptError.value = ''
  Object.assign(promptModal, {
    visible: true,
    title: options.title || '输入信息',
    message: options.message,
    placeholder: options.placeholder || '',
    inputType: options.inputType || 'text',
    inputValue: options.defaultValue || '',
    okText: options.okText || '确定',
    cancelText: options.cancelText || '取消',
    onOk: options.onOk || null,
    onCancel: options.onCancel || null
  })

  // 聚焦输入框
  nextTick(() => {
    promptInput.value?.focus()
  })
}

// 暴露给全局使用
defineExpose({
  showConfirm,
  showAlert,
  showPrompt
})

// 注册到全局
if (typeof window !== 'undefined') {
  window.$modal = {
    showConfirm,
    showAlert,
    showPrompt
  }
}

const id = useId()
const dialogRef = ref<HTMLElement | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)
const activeKind = computed(() =>
  promptModal.visible
    ? 'prompt'
    : alertModal.visible
      ? 'alert'
      : confirmModal.visible
        ? 'confirm'
        : ''
)
const activeModal = computed(() =>
  activeKind.value === 'prompt'
    ? promptModal
    : activeKind.value === 'alert'
      ? alertModal
      : confirmModal
)
const statusType = computed(() =>
  activeKind.value === 'alert'
    ? alertModal.type
    : activeKind.value === 'confirm'
      ? confirmModal.type
      : 'info'
)
const statusIcon = computed(
  () =>
    ({
      info: 'bi-info-circle',
      success: 'bi-check-circle',
      error: 'bi-exclamation-octagon',
      danger: 'bi-exclamation-octagon',
      warning: 'bi-exclamation-triangle'
    })[statusType.value]
)
const cancelText = computed(() =>
  activeKind.value === 'prompt' ? promptModal.cancelText : confirmModal.cancelText
)
function handleOk() {
  if (isComposing.value) return
  if (activeKind.value === 'prompt') handlePromptOk()
  else if (activeKind.value === 'alert') handleAlertOk()
  else handleConfirmOk()
}
function handleCancel() {
  if (activeKind.value === 'prompt') handlePromptCancel()
  else if (activeKind.value === 'alert') handleAlertOk()
  else handleConfirmCancel()
}
useDialogFocus(
  () => activeKind.value,
  dialogRef,
  handleCancel,
  () => (activeKind.value === 'prompt' ? promptInput.value : cancelButton.value)
)
</script>
