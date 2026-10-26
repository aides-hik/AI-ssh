<template>
  <section id="section-permission" class="setting-section prism-settings-section">
    <h2 class="section-title">
      <i class="bi bi-shield-lock"></i>
      {{ $t('settings.permissionTitle') }}
    </h2>
    <p class="section-description">{{ $t('settings.permissionDesc') }}</p>

    <!-- 模式设置 -->
    <div class="setting-row">
      <div class="setting-left">
        <label class="setting-label">{{ $t('settings.permissionPlanMode') }}</label>
        <p class="setting-hint">{{ $t('settings.permissionPlanModeHint') }}</p>
      </div>
      <div class="setting-right">
        <label class="toggle-switch">
          <input
            :aria-label="$t('settings.permissionPlanMode')"
            v-model="planModeEnabled"
            type="checkbox"
          />
          <span class="toggle-slider"></span>
        </label>
        <span class="toggle-label">{{
          planModeEnabled ? $t('settings.enabled') : $t('settings.disabled')
        }}</span>
      </div>
    </div>

    <!-- 自动确认危险命令 -->
    <div class="setting-row">
      <div class="setting-left">
        <label class="setting-label">{{ $t('settings.permissionAutoConfirm') }}</label>
        <p class="setting-hint">{{ $t('settings.permissionAutoConfirmHint') }}</p>
      </div>
      <div class="setting-right">
        <label class="toggle-switch">
          <input
            :aria-label="$t('settings.permissionAutoConfirm')"
            v-model="autoConfirmDangerous"
            type="checkbox"
          />
          <span class="toggle-slider"></span>
        </label>
        <span class="toggle-label">{{
          autoConfirmDangerous ? $t('settings.enabled') : $t('settings.disabled')
        }}</span>
      </div>
    </div>

    <!-- 自定义规则列表 -->
    <div class="setting-row">
      <div class="setting-left">
        <label class="setting-label">{{ $t('settings.permissionCustomRules') }}</label>
        <p class="setting-hint">{{ $t('settings.permissionCustomRulesHint') }}</p>
      </div>
    </div>

    <!-- 规则列表 -->
    <div class="rules-list">
      <div v-for="(rule, index) in customRules" :key="index" class="rule-item">
        <div class="rule-pattern">
          <code>{{ rule.pattern }}</code>
        </div>
        <div class="rule-action" :class="rule.action">
          {{ getActionLabel(rule.action) }}
        </div>
        <button
          class="prism-button prism-button--quiet delete-rule"
          @click="removeRule(index)"
          :data-prism-tooltip="$t('settings.deleteRule')"
          :aria-label="$t('settings.deleteRule')"
        >
          <i class="bi bi-trash"></i>
        </button>
      </div>

      <div v-if="customRules.length === 0" class="empty-rules">
        <i class="bi bi-info-circle"></i>
        <span>{{ $t('settings.noCustomRules') }}</span>
      </div>
    </div>

    <!-- 添加新规则 -->
    <div class="add-rule-form">
      <h4>{{ $t('settings.addRule') }}</h4>
      <div class="form-row">
        <input
          :aria-label="$t('settings.permissionCustomRules')"
          v-model="newRule.pattern"
          type="text"
          class="form-input"
          :placeholder="$t('settings.rulePatternPlaceholder')"
        />
        <select v-model="newRule.action" class="form-select">
          <option value="allow">{{ $t('settings.actionAllow') }}</option>
          <option value="deny">{{ $t('settings.actionDeny') }}</option>
          <option value="ask">{{ $t('settings.actionAsk') }}</option>
        </select>
        <input
          v-model="newRule.description"
          type="text"
          class="form-input"
          :placeholder="$t('settings.ruleDescriptionPlaceholder')"
        />
        <button
          class="prism-button prism-button--primary"
          @click="addRule"
          :disabled="!newRule.pattern"
        >
          <i class="bi bi-plus-lg"></i>
          {{ $t('settings.add') }}
        </button>
      </div>
    </div>

    <!-- 重置按钮 -->
    <div class="setting-actions">
      <button class="prism-button" @click="resetToDefault">
        <i class="bi bi-arrow-counterclockwise"></i>
        {{ $t('settings.resetPermissionRules') }}
      </button>
      <button class="prism-button prism-button--primary" @click="saveSettings">
        <i class="bi bi-check-lg"></i>
        {{ $t('settings.savePermissionSettings') }}
      </button>
    </div>

    <p
      v-if="feedback"
      class="permission-feedback"
      :class="{ 'has-error': feedbackError }"
      role="status"
    >
      {{ feedback }}
    </p>
    <!-- 危险命令预览 -->
    <div class="danger-preview">
      <h4><i class="bi bi-exclamation-triangle"></i> {{ $t('settings.dangerousCommands') }}</h4>
      <ul>
        <li><code>rm -rf /</code> - {{ $t('settings.dangerDeleteRoot') }}</li>
        <li><code>dd if=/dev/zero of=/dev/sda</code> - {{ $t('settings.dangerDiskDump') }}</li>
        <li><code>mkfs.*</code> - {{ $t('settings.dangerFormatFs') }}</li>
        <li><code>:(){ :|:& };:</code> - {{ $t('settings.dangerForkBomb') }}</li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { $confirm } from '@/composables/useDialog'
import {
  settingsService,
  type PermissionConfig,
  type PermissionRule
} from '@/services/settings.service'

const { t } = useI18n()

// 状态
const feedback = ref('')
const feedbackError = ref(false)
const planModeEnabled = ref(true)
const autoConfirmDangerous = ref(false)
const customRules = ref<PermissionRule[]>([])
const newRule = ref({
  pattern: '',
  action: 'ask' as 'allow' | 'deny' | 'ask',
  description: ''
})

// 加载设置
onMounted(async () => {
  await loadSettings()
})

async function loadSettings() {
  try {
    const settings = await settingsService.getSettings()
    if (settings.permissionConfig) {
      planModeEnabled.value = settings.permissionConfig.modeSettings?.plan?.enabled ?? true
      autoConfirmDangerous.value =
        settings.permissionConfig.modeSettings?.build?.autoConfirmDangerous ?? false
      customRules.value = settings.permissionConfig.customRules || []
    }
  } catch (error) {
    console.error('[PermissionSettings] Failed to load settings:', error)
  }
}

async function saveSettings() {
  try {
    const config: PermissionConfig = {
      version: '1.0.0',
      lastUpdated: new Date().toISOString().split('T')[0],
      customRules: customRules.value,
      modeSettings: {
        plan: {
          enabled: planModeEnabled.value
        },
        build: {
          autoConfirmDangerous: autoConfirmDangerous.value
        }
      }
    }

    const settings = await settingsService.getSettings()
    settings.permissionConfig = config

    await settingsService.saveSettings(settings)
    feedback.value = t('session.saved')
    feedbackError.value = false
  } catch (error) {
    feedback.value = t('session.saveFailed')
    feedbackError.value = true
    console.error('[PermissionSettings] Failed to save settings:', error)
  }
}

async function resetToDefault() {
  if (await $confirm(t('settings.confirmReset'))) {
    customRules.value = []
    planModeEnabled.value = true
    autoConfirmDangerous.value = false
    await saveSettings()
  }
}

function addRule() {
  if (!newRule.value.pattern) return

  customRules.value.push({
    pattern: newRule.value.pattern,
    action: newRule.value.action,
    description: newRule.value.description || undefined
  })

  // 清空表单
  newRule.value = {
    pattern: '',
    action: 'ask',
    description: ''
  }
}

function removeRule(index: number) {
  customRules.value.splice(index, 1)
}

function getActionLabel(action: string): string {
  switch (action) {
    case 'allow':
      return t('settings.actionAllow')
    case 'deny':
      return t('settings.actionDeny')
    case 'ask':
      return t('settings.actionAsk')
    default:
      return action
  }
}
</script>

<style scoped>
.rules-list {
  margin: 1rem 0;
  border: 1px solid var(--prism-border);
  border-radius: var(--prism-radius-control);
  max-height: 300px;
  overflow-y: auto;
}

.rule-item {
  display: flex;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--prism-border);
  gap: 1rem;
}

.rule-item:last-child {
  border-bottom: none;
}

.rule-pattern {
  flex: 1;
  min-width: 0;
}

.rule-pattern code {
  background: var(--prism-control);
  padding: 0.25rem 0.5rem;
  border-radius: var(--prism-radius-small);
  font-size: calc(0.85rem * var(--prism-font-scale, 1));
  word-break: break-all;
}

.rule-action {
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: var(--prism-font-12);
  font-weight: 500;
  white-space: nowrap;
}

.rule-action.allow {
  background: var(--prism-success-bg);
  color: var(--prism-success);
}

.rule-action.deny {
  background: var(--prism-danger-bg);
  color: var(--prism-danger);
}

.rule-action.ask {
  background: var(--prism-warning-bg);
  color: var(--prism-warning);
}

.delete-rule {
  opacity: 0.6;
  transition:
    opacity var(--prism-duration) ease,
    color var(--prism-duration) ease;
}

.delete-rule:hover {
  opacity: 1;
  color: var(--prism-danger);
}

.empty-rules {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem;
  color: var(--prism-muted);
}

.add-rule-form {
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--prism-border);
}

.add-rule-form h4 {
  margin-bottom: 1rem;
  font-size: calc(0.9rem * var(--prism-font-scale, 1));
  color: var(--prism-muted);
}

.form-row {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.form-row .form-input,
.form-row .form-select {
  flex: 1;
  min-width: 150px;
}

.setting-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--prism-border);
}

.danger-preview {
  margin-top: 2rem;
  padding: 1rem;
  background: var(--prism-danger-bg);
  border: 1px solid color-mix(in srgb, var(--prism-danger) 25%, var(--prism-border));
  border-radius: var(--prism-radius-control);
}

.danger-preview h4 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  color: var(--prism-danger);
}

.danger-preview ul {
  margin: 0;
  padding-left: 1.5rem;
}

.danger-preview li {
  margin-bottom: 0.5rem;
}

.danger-preview code {
  background: var(--prism-danger-bg);
  padding: 0.15rem 0.4rem;
  border-radius: var(--prism-radius-small);
  font-size: calc(0.85rem * var(--prism-font-scale, 1));
}
.permission-feedback {
  font-size: var(--prism-font-12);
  color: var(--prism-success);
  margin-top: 14px;
}
.permission-feedback.has-error {
  color: var(--prism-danger);
}
.delete-rule:focus-visible {
  opacity: 1;
  color: var(--prism-danger);
}
@media (max-width: 600px) {
  .rule-item {
    gap: 8px;
    padding: 12px;
    flex-wrap: wrap;
  }
  .form-row .form-input,
  .form-row .form-select {
    min-width: 100%;
  }
}
</style>
