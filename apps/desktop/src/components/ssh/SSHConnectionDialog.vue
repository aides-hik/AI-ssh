<template>
  <teleport to="body">
    <Transition name="connection-modal">
      <div v-if="modelValue" class="modal-overlay prism-dialog-overlay">
        <LiquidSurface
          class="modal-container"
          :radius="24"
          :strength="30"
          :blur="10"
          :interactive="false"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="`${dialogId}-title`"
          :aria-describedby="`${dialogId}-description`"
          tabindex="-1"
        >
          <div ref="dialogContent" class="dialog-content" tabindex="-1">
            <div class="modal-header">
              <div class="modal-heading">
                <span class="connection-symbol" aria-hidden="true"
                  ><i class="bi bi-hdd-network"
                /></span>
                <div>
                  <h3 :id="`${dialogId}-title`" class="modal-title">
                    {{ isEdit ? '编辑连接' : '新建连接' }}
                  </h3>
                  <p :id="`${dialogId}-description`" class="modal-description">
                    配置 SSH 连接，凭据保存在本机
                  </p>
                </div>
              </div>
              <button
                type="button"
                class="close-button"
                aria-label="关闭连接设置"
                @click="handleClose"
              >
                <i class="bi bi-x" aria-hidden="true"></i>
              </button>
            </div>

            <div class="modal-body">
              <form
                ref="connectionForm"
                novalidate
                @submit.prevent="handleSubmit"
                @invalid.capture.prevent
                @input="revalidateInput"
                @compositionstart="isComposing = true"
                @compositionend="isComposing = false"
                @keydown.capture="guardCompositionSubmit"
              >
                <!-- 连接名称 -->
                <div class="form-group">
                  <label :for="`${dialogId}-name`" class="form-label"
                    >连接名称 <span class="required">*</span></label
                  >
                  <input
                    :id="`${dialogId}-name`"
                    ref="nameInput"
                    v-model="formData.name"
                    type="text"
                    class="form-input-full"
                    placeholder="我的服务器"
                    required
                    :aria-invalid="!!fieldErrors[`${dialogId}-name`]"
                    :aria-describedby="
                      fieldErrors[`${dialogId}-name`] ? `${dialogId}-name-error` : undefined
                    "
                  />
                  <p
                    v-if="fieldErrors[`${dialogId}-name`]"
                    :id="`${dialogId}-name-error`"
                    class="prism-field-error"
                    role="alert"
                  >
                    {{ fieldErrors[`${dialogId}-name`] }}
                  </p>
                </div>

                <!-- 主机和端口 -->
                <div class="form-row">
                  <div class="form-group flex-1">
                    <label :for="`${dialogId}-host`" class="form-label"
                      >主机地址 <span class="required">*</span></label
                    >
                    <input
                      :id="`${dialogId}-host`"
                      v-model="formData.host"
                      type="text"
                      class="w-full"
                      placeholder="192.168.1.100"
                      required
                      :aria-invalid="!!fieldErrors[`${dialogId}-host`]"
                      :aria-describedby="
                        fieldErrors[`${dialogId}-host`] ? `${dialogId}-host-error` : undefined
                      "
                    />
                    <p
                      v-if="fieldErrors[`${dialogId}-host`]"
                      :id="`${dialogId}-host-error`"
                      class="prism-field-error"
                      role="alert"
                    >
                      {{ fieldErrors[`${dialogId}-host`] }}
                    </p>
                  </div>
                  <div class="form-group port-field">
                    <label :for="`${dialogId}-port`" class="form-label">端口</label>
                    <input
                      :id="`${dialogId}-port`"
                      v-model.number="formData.port"
                      type="number"
                      class="w-full"
                      placeholder="22"
                      :aria-invalid="!!fieldErrors[`${dialogId}-port`]"
                      :aria-describedby="
                        fieldErrors[`${dialogId}-port`] ? `${dialogId}-port-error` : undefined
                      "
                    />
                    <p
                      v-if="fieldErrors[`${dialogId}-port`]"
                      :id="`${dialogId}-port-error`"
                      class="prism-field-error"
                      role="alert"
                    >
                      {{ fieldErrors[`${dialogId}-port`] }}
                    </p>
                  </div>
                </div>

                <!-- 用户名 -->
                <div class="form-group">
                  <label :for="`${dialogId}-username`" class="form-label"
                    >用户名 <span class="required">*</span></label
                  >
                  <input
                    :id="`${dialogId}-username`"
                    v-model="formData.username"
                    type="text"
                    class="form-input-full"
                    placeholder="root"
                    autocomplete="username"
                    required
                    :aria-invalid="!!fieldErrors[`${dialogId}-username`]"
                    :aria-describedby="
                      fieldErrors[`${dialogId}-username`] ? `${dialogId}-username-error` : undefined
                    "
                  />
                  <p
                    v-if="fieldErrors[`${dialogId}-username`]"
                    :id="`${dialogId}-username-error`"
                    class="prism-field-error"
                    role="alert"
                  >
                    {{ fieldErrors[`${dialogId}-username`] }}
                  </p>
                </div>

                <!-- 认证方式 -->
                <div class="form-group">
                  <label :for="`${dialogId}-auth`" class="form-label">认证方式</label>
                  <select
                    :id="`${dialogId}-auth`"
                    v-model="formData.authType"
                    class="form-input-full"
                  >
                    <option value="PASSWORD">密码</option>
                    <option value="PRIVATE_KEY">私钥</option>
                    <option value="SSH_AGENT">SSH Agent</option>
                  </select>
                </div>

                <!-- 密码（当认证方式为密码时显示） -->
                <div v-if="formData.authType === 'PASSWORD'" class="form-group">
                  <label :for="`${dialogId}-password`" class="form-label">密码</label>
                  <input
                    :id="`${dialogId}-password`"
                    v-model="formData.password"
                    type="password"
                    class="form-input-full"
                    placeholder="••••••••"
                    autocomplete="current-password"
                  />
                </div>

                <!-- 私钥（当认证方式为私钥时显示） -->
                <div v-if="formData.authType === 'PRIVATE_KEY'" class="form-group">
                  <label :for="`${dialogId}-private-key`" class="form-label">私钥路径</label>
                  <input
                    :id="`${dialogId}-private-key`"
                    v-model="formData.privateKey"
                    type="text"
                    class="form-input-full"
                    placeholder="~/.ssh/id_rsa"
                  />
                </div>

                <!-- 私钥密码 -->
                <div
                  v-if="formData.authType === 'PRIVATE_KEY' && formData.privateKey"
                  class="form-group"
                >
                  <label :for="`${dialogId}-passphrase`" class="form-label">私钥密码（可选）</label>
                  <input
                    :id="`${dialogId}-passphrase`"
                    v-model="formData.passphrase"
                    type="password"
                    class="form-input-full"
                    placeholder="如果私钥有密码保护"
                  />
                </div>

                <!-- 错误和成功提示 -->
                <div v-if="error" class="error-message" role="alert">
                  <i class="bi bi-exclamation-circle" aria-hidden="true"></i>
                  {{ error }}
                </div>
                <div v-if="successMessage" class="success-message" role="status">
                  <i class="bi bi-check-circle" aria-hidden="true"></i>
                  {{ successMessage }}
                </div>

                <!-- 底部按钮 -->
                <div class="modal-footer">
                  <button type="button" class="btn-secondary" @click="handleClose">取消</button>
                  <button type="button" class="btn-test" :disabled="loading" @click="handleTest">
                    {{ loading ? '测试中...' : '测试连接' }}
                  </button>
                  <button type="submit" class="btn-primary" :disabled="loading">
                    {{ loading ? '保存中...' : isEdit ? '更新' : '创建' }}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </LiquidSurface>
      </div>
    </Transition>
  </teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import LiquidSurface from '@/components/common/LiquidSurface.vue'
import { sshService } from '@/services/ssh.service'
import { useInlineValidation } from '@/composables/useInlineValidation'

interface SSHConnectionFormData {
  name: string
  host: string
  port: number
  username: string
  authType: 'PASSWORD' | 'PRIVATE_KEY' | 'SSH_AGENT'
  password?: string
  privateKey?: string
  passphrase?: string
  folderId?: string | null
}

interface Props {
  modelValue: boolean
  connection?: any
  folderId?: string | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [data: SSHConnectionFormData]
  test: [data: SSHConnectionFormData]
}>()

const isEdit = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const successMessage = ref<string | null>(null)
const dialogId = `ssh-connection-${useId()}`
const dialogContent = ref<HTMLElement>()
const nameInput = ref<HTMLInputElement>()
const connectionForm = ref<HTMLFormElement>()
const isComposing = ref(false)
const { errors: fieldErrors, validateForm, revalidateInput, clearErrors } = useInlineValidation()
const guardCompositionSubmit = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && (isComposing.value || event.isComposing || event.keyCode === 229)) {
    event.preventDefault()
  }
}
let previousFocus: HTMLElement | null = null
let focusEpoch = 0

const formData = ref<SSHConnectionFormData>({
  name: '',
  host: '',
  port: 22,
  username: '',
  authType: 'PASSWORD',
  password: '',
  privateKey: '',
  passphrase: '',
  folderId: props.folderId
})

// 重置表单（需要先定义，因为 watch 中会用到）
const resetForm = () => {
  clearErrors()
  formData.value = {
    name: '',
    host: '',
    port: 22,
    username: '',
    authType: 'PASSWORD',
    password: '',
    privateKey: '',
    passphrase: '',
    folderId: props.folderId
  }
}

// 监听 connection 变化，用于编辑模式
watch(
  () => props.connection,
  newVal => {
    if (newVal) {
      isEdit.value = true
      formData.value = {
        name: newVal.name || '',
        host: newVal.host || '',
        port: newVal.port || 22,
        username: newVal.username || '',
        authType: newVal.authType || 'PASSWORD',
        password: normalizeCredential(newVal.password),
        privateKey: normalizeCredential(newVal.privateKey),
        passphrase: normalizeCredential(newVal.passphrase),
        folderId: newVal.folderId
      }
    } else {
      isEdit.value = false
      resetForm()
    }
  },
  { immediate: true }
)

// 监听 folderId 变化
watch(
  () => props.folderId,
  newVal => {
    formData.value.folderId = newVal
  }
)

const handleClose = () => {
  emit('update:modelValue', false)
  error.value = null
  successMessage.value = null
  clearErrors()
  isComposing.value = false
}

function focusableControls(): HTMLElement[] {
  const controls = dialogContent.value?.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'
  )
  return Array.from(controls ?? []).filter(
    element => !element.hidden && element.getClientRects().length > 0
  )
}

function handleDialogKeydown(event: KeyboardEvent) {
  if (!props.modelValue) return
  if (event.key === 'Escape' && !event.isComposing) {
    event.preventDefault()
    event.stopImmediatePropagation()
    handleClose()
    return
  }
  if (event.key !== 'Tab') return
  const controls = focusableControls()
  const first = controls[0]
  const last = controls.at(-1)
  if (!first || !last) {
    event.preventDefault()
    return
  }
  const current = document.activeElement
  if (event.shiftKey && (current === first || !dialogContent.value?.contains(current))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (current === last || !dialogContent.value?.contains(current))) {
    event.preventDefault()
    first.focus()
  }
}

function keepFocusInDialog(event: FocusEvent) {
  if (!props.modelValue || !dialogContent.value) return
  if (event.target instanceof Node && !dialogContent.value.contains(event.target)) {
    ;(focusableControls()[0] ?? dialogContent.value).focus()
  }
}

function releaseFocus() {
  window.removeEventListener('keydown', handleDialogKeydown, true)
  document.removeEventListener('focusin', keepFocusInDialog)
  const target = previousFocus
  previousFocus = null
  if (target?.isConnected) target.focus({ preventScroll: true })
}

watch(
  () => props.modelValue,
  async open => {
    const epoch = ++focusEpoch
    if (!open) {
      releaseFocus()
      return
    }
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    if (!props.modelValue || epoch !== focusEpoch) return
    window.addEventListener('keydown', handleDialogKeydown, true)
    document.addEventListener('focusin', keepFocusInDialog)
    nameInput.value?.focus({ preventScroll: true })
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  focusEpoch++
  releaseFocus()
})

function normalizeCredential(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : String(value)
}

const handleSubmit = async () => {
  if (loading.value || isComposing.value || !validateForm(connectionForm.value)) return
  error.value = null
  loading.value = true

  try {
    emit('submit', { ...formData.value })
    handleClose()
  } catch (err: any) {
    error.value = err.message || '保存失败'
  } finally {
    loading.value = false
  }
}

const handleTest = async () => {
  error.value = null
  successMessage.value = null

  // 表单验证
  if (!formData.value.host) {
    error.value = '请输入主机地址'
    return
  }
  if (!formData.value.username) {
    error.value = '请输入用户名'
    return
  }
  if (formData.value.authType === 'PASSWORD' && !formData.value.password) {
    error.value = '请输入密码'
    return
  }
  if (formData.value.authType === 'PRIVATE_KEY' && !formData.value.privateKey) {
    error.value = '请输入私钥'
    return
  }

  loading.value = true

  try {
    // 使用与保存后实际连接相同的认证字段进行测试。
    const result = await sshService.testConnection({
      host: formData.value.host,
      port: formData.value.port || 22,
      username: formData.value.username,
      authType: formData.value.authType,
      password: formData.value.password,
      privateKey: formData.value.privateKey,
      passphrase: formData.value.passphrase
    })

    if (result.success) {
      successMessage.value = '连接测试成功！'
      error.value = null
    } else {
      error.value = result.message || '连接测试失败'
      successMessage.value = null
    }
  } catch (err: any) {
    error.value = err.message || '测试连接时发生错误'
    successMessage.value = null
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 9999;
}

.modal-container {
  --liquid-tint: var(--liquid-dialog-tint, color-mix(in srgb, var(--vscode-bg) 80%, transparent));
  width: min(100%, 520px);
  max-height: min(90dvh, 820px);
  color: var(--prism-text);
  font-family: var(--prism-font);
  box-shadow: var(--prism-shadow);
}

.modal-container :deep(.liquid-surface__content) {
  display: flex;
  flex-direction: column;
  max-height: inherit;
}

.dialog-content {
  min-height: 0;
  display: flex;
  flex-direction: column;
  max-height: inherit;
  outline: none;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
  padding: 26px 26px 20px;
}

.modal-heading {
  display: flex;
  align-items: center;
  gap: 12px;
}

.connection-symbol {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 1px solid color-mix(in srgb, var(--vscode-accent) 24%, transparent);
  border-radius: var(--prism-radius-row);
  background: color-mix(in srgb, var(--vscode-accent) 12%, transparent);
  color: var(--vscode-accent);
  font-size: 21px;
}

.modal-title {
  font-size: 18px;
  font-weight: 650;
  color: var(--vscode-fg);
  margin: 0;
}

.modal-description {
  margin: 5px 0 0;
  color: var(--vscode-fg-muted);
  font-size: 12px;
  line-height: 1.5;
}

.close-button {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--vscode-fg-muted);
  cursor: pointer;
  border-radius: var(--prism-radius-small);
  transition:
    color 120ms ease-out,
    background-color 120ms ease-out;
  touch-action: manipulation;
}

.close-button:focus-visible {
  outline: 2px solid var(--vscode-focusBorder);
  outline-offset: 3px;
}

@media (hover: hover) and (pointer: fine) {
  .close-button:hover {
    background: var(--vscode-bg-lighter);
    color: var(--vscode-fg);
  }
}

.close-button i {
  font-size: 20px;
}

.modal-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 26px 24px;
}

.form-group {
  margin-bottom: 16px;
}

.form-row {
  display: flex;
  gap: 14px;
}

.flex-1 {
  flex: 1;
  min-width: 0;
}

.port-field {
  width: 108px;
}

.form-label {
  display: block;
  font-size: 13px;
  font-weight: 550;
  color: var(--vscode-fg);
  margin-bottom: 8px;
}

.modal-body input,
.modal-body select {
  width: 100%;
  min-width: 0;
  min-height: 42px;
  height: auto;
  padding: 10px 12px;
  border: 1px solid var(--prism-border);
  border-radius: var(--prism-radius-control);
  background: var(--prism-control);
  color: var(--vscode-input-foreground);
  font: inherit;
  font-size: 13px;
  line-height: 1.4;
  transition:
    border-color 100ms ease-out,
    background-color 100ms ease-out;
}

.modal-body input::placeholder {
  color: var(--vscode-input-placeholderForeground);
}

.modal-body input:focus-visible,
.modal-body select:focus-visible {
  outline: 2px solid var(--vscode-focusBorder);
  outline-offset: 2px;
  border-color: transparent;
}

.modal-body input:disabled,
.modal-body select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.required {
  color: var(--prism-danger);
}
.modal-body input[aria-invalid='true'] {
  border-color: var(--prism-danger);
}

.error-message {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  overflow-wrap: anywhere;
  background: var(--prism-danger-bg);
  border: 1px solid color-mix(in srgb, var(--prism-danger) 30%, transparent);
  border-radius: var(--prism-radius-control);
  color: var(--prism-danger);
  font-size: 13px;
  margin-bottom: 16px;
}

.success-message {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  overflow-wrap: anywhere;
  background: var(--prism-success-bg);
  border: 1px solid color-mix(in srgb, var(--prism-success) 30%, transparent);
  border-radius: var(--prism-radius-control);
  color: var(--prism-success);
  font-size: 13px;
  margin-bottom: 16px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 24px;
  padding: 20px 0 0;
  border-top: 1px solid var(--vscode-border);
}

.btn-primary,
.btn-secondary,
.btn-test {
  min-height: 38px;
  padding: 9px 16px;
  font-size: 13px;
  border-radius: var(--prism-radius-control);
  cursor: pointer;
  transition:
    background-color 120ms ease-out,
    border-color 120ms ease-out,
    color 120ms ease-out;
  border: 1px solid transparent;
  font-weight: 500;
  touch-action: manipulation;
}

.modal-footer button:focus-visible {
  outline: 2px solid var(--vscode-focusBorder);
  outline-offset: 3px;
}

.btn-primary {
  background: var(--vscode-accent);
  color: var(--vscode-button-foreground);
  border-color: var(--vscode-accent);
}

@media (hover: hover) and (pointer: fine) {
  .btn-primary:hover:not(:disabled) {
    background: var(--vscode-accent-hover);
    border-color: var(--vscode-accent-hover);
  }
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: transparent;
  color: var(--vscode-fg);
  border-color: var(--vscode-border);
}

@media (hover: hover) and (pointer: fine) {
  .btn-secondary:hover {
    background: var(--vscode-bg-lighter);
  }
}

.btn-test {
  background: var(--prism-control);
  color: var(--prism-text);
  border-color: var(--prism-border);
}

@media (hover: hover) and (pointer: fine) {
  .btn-test:hover:not(:disabled) {
    background: var(--vscode-list-hoverBackground);
    border-color: color-mix(in srgb, var(--vscode-accent) 40%, var(--prism-border));
  }
}

.btn-test:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.connection-modal-enter-active .modal-container {
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.connection-modal-enter-active {
  transition: background-color 220ms ease-out;
}

.connection-modal-leave-active {
  transition: background-color 150ms ease-out;
}

.connection-modal-enter-from,
.connection-modal-leave-to {
  background-color: transparent;
}

.connection-modal-leave-active .modal-container {
  transition: transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
}

.connection-modal-enter-from .modal-container,
.connection-modal-leave-to .modal-container {
  transform: translateY(8px) scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .connection-modal-enter-active,
  .connection-modal-leave-active,
  .connection-modal-enter-active .modal-container,
  .connection-modal-leave-active .modal-container {
    transition: none;
  }

  .connection-modal-enter-from .modal-container,
  .connection-modal-leave-to .modal-container {
    transform: none;
  }
}

html[data-motion='off'] .connection-modal-enter-active,
html[data-motion='off'] .connection-modal-leave-active,
html[data-motion='off'] .modal-container,
html[data-transitions='off'] .connection-modal-enter-active,
html[data-transitions='off'] .connection-modal-leave-active,
html[data-transitions='off'] .modal-container {
  transition: none !important;
  transform: none !important;
}

@media (max-width: 540px) {
  .modal-overlay {
    padding: 12px;
  }

  .modal-header {
    padding: 22px 20px 18px;
  }

  .modal-body {
    padding: 0 20px 20px;
  }

  .connection-symbol {
    display: none;
  }

  .modal-footer button {
    flex: 1;
    padding-inline: 10px;
  }
}
</style>
