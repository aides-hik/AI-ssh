<template>
  <div class="settings-view prism-settings">
    <!-- 左侧导航树 -->
    <div class="settings-sidebar">
      <div class="sidebar-header">
        <h3 class="sidebar-title">{{ $t('settings.sidebarTitle') }}</h3>
      </div>
      <nav class="settings-nav">
        <button
          v-for="section in settingsSections"
          :key="section.id"
          type="button"
          :class="['nav-item', { active: activeSection === section.id }]"
          :aria-current="activeSection === section.id ? 'page' : undefined"
          :data-prism-tooltip="section.label"
          @click="scrollToSection(section.id)"
        >
          <AiProvidersIcon v-if="section.id === 'ai-providers'" class="nav-icon" />
          <i v-else :class="['nav-icon', section.icon]" aria-hidden="true"></i>
          <span class="nav-label">{{ section.label }}</span>
        </button>
      </nav>
    </div>

    <!-- 右侧内容区域 -->
    <div class="settings-content" ref="contentContainer" @scroll="onScroll">
      <div class="content-inner">
        <!-- 外观设置 -->
        <SettingsAppearance
          :selected-theme-mode="selectedThemeMode"
          :selected-color-scheme="selectedColorScheme"
          :font-size="fontSize"
          :available-themes="availableThemes"
          :available-color-schemes="availableColorSchemes"
          @theme-mode-change="
            (value: ThemeMode) => {
              selectedThemeMode = value
              onThemeModeChange()
            }
          "
          @color-scheme-change="
            (value: 'blue' | 'green' | 'purple' | 'orange' | 'red') => {
              selectedColorScheme = value
              onColorSchemeChange(value)
            }
          "
          @font-size-change="
            (value: 'small' | 'medium' | 'large') => {
              fontSize = value
              onFontSizeChange()
            }
          "
        />

        <SettingsAiProviders
          v-model:providers="aiProviders"
          :testing-providers="testingProviders"
          :fetching-models="fetchingModels"
          :model-test-results="modelTestResults"
          @test="testProviderConnection"
          @refresh="refreshModelList"
          @add="openAddModelDialog"
          @remove="removeCustomModel"
          @clear="clearProviderConfig"
        />

        <!-- AI 助手设置 -->
        <section :id="'section-ai-assistant'" class="setting-section prism-settings-section">
          <h2 class="section-title">
            <i class="bi bi-chat-dots"></i>
            {{ $t('settings.aiAssistantTitle') }}
          </h2>
          <p class="section-description">{{ $t('settings.aiAssistantDesc') }}</p>

          <!-- 自动批准只读操作 -->
          <div class="setting-row">
            <div class="setting-left">
              <label class="setting-label">{{ $t('settings.autoApproveReadOnly') }}</label>
              <p class="setting-hint">{{ $t('settings.autoApproveReadOnlyHint') }}</p>
            </div>
            <div class="setting-right">
              <label class="toggle-switch">
                <input
                  :aria-label="$t('settings.autoApproveReadOnly')"
                  v-model="autoApproveReadOnly"
                  type="checkbox"
                  @change="saveSettings"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <!-- 命令风险等级 -->
          <div class="setting-row">
            <div class="setting-left">
              <label class="setting-label">{{ $t('settings.commandRiskLevel') }}</label>
              <p class="setting-hint">{{ $t('settings.commandRiskLevelHint') }}</p>
            </div>
            <div class="setting-right">
              <select
                :aria-label="$t('settings.commandRiskLevel')"
                v-model.number="commandRiskLevel"
                @change="saveSettings"
                class="form-select"
              >
                <option :value="0">{{ $t('settings.riskLevel0') }}</option>
                <option :value="1">{{ $t('settings.riskLevel1') }}</option>
                <option :value="2">{{ $t('settings.riskLevel2') }}</option>
                <option :value="3">{{ $t('settings.riskLevel3') }}</option>
                <option :value="4">{{ $t('settings.riskLevel4') }}</option>
                <option :value="5">{{ $t('settings.riskLevel5') }}</option>
              </select>
              <p class="setting-info">
                <i class="bi bi-info-circle"></i>
                <span v-if="commandRiskLevel === 0">{{ $t('settings.riskLevelInfo0') }}</span>
                <span v-else-if="commandRiskLevel === 1">{{ $t('settings.riskLevelInfo1') }}</span>
                <span v-else-if="commandRiskLevel === 2">{{ $t('settings.riskLevelInfo2') }}</span>
                <span v-else-if="commandRiskLevel === 3">{{ $t('settings.riskLevelInfo3') }}</span>
                <span v-else-if="commandRiskLevel === 4">{{ $t('settings.riskLevelInfo4') }}</span>
                <span v-else>{{ $t('settings.riskLevelInfo5') }}</span>
              </p>
            </div>
          </div>

          <!-- 对话历史 -->
          <div class="setting-row">
            <div class="setting-left">
              <label class="setting-label">{{ $t('settings.saveChatHistory') }}</label>
              <p class="setting-hint">{{ $t('settings.saveChatHistoryHint') }}</p>
            </div>
            <div class="setting-right">
              <label class="toggle-switch">
                <input
                  :aria-label="$t('settings.saveChatHistory')"
                  v-model="enableChatHistory"
                  type="checkbox"
                  @change="saveSettings"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <!-- 最大历史消息数 -->
          <div v-if="enableChatHistory" class="setting-row">
            <div class="setting-left">
              <label class="setting-label">{{ $t('settings.maxHistoryMessages') }}</label>
              <p class="setting-hint">{{ $t('settings.maxHistoryMessagesHint') }}</p>
            </div>
            <div class="setting-right">
              <input
                :aria-label="$t('settings.maxHistoryMessages')"
                v-model.number="maxHistoryMessages"
                type="number"
                class="form-input"
                min="1"
                max="200"
                step="10"
                @change="saveSettings"
              />
            </div>
          </div>
        </section>

        <section :id="'section-updates'" class="setting-section prism-settings-section">
          <h2 class="section-title">
            <i class="bi bi-arrow-repeat"></i>
            应用更新
          </h2>
          <p class="section-description">
            软件启动后会在后台检查更新、探测更快的下载源，并缓存安装包供直接安装。
          </p>

          <div class="setting-row">
            <div class="setting-left">
              <label class="setting-label">当前版本</label>
              <p class="setting-hint">当前正在运行的桌面端版本号。</p>
            </div>
            <div class="setting-right">
              <div class="setting-info">{{ currentAppVersion || '读取中...' }}</div>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-left">
              <label class="setting-label">更新状态</label>
              <p class="setting-hint">显示检查、测速、后台下载和安装准备状态。</p>
            </div>
            <div class="setting-right">
              <div class="setting-info">
                {{ updaterStatusText }}
                <span v-if="updaterState.selectedSourceId">
                  （源：{{ updaterState.selectedSourceId }}）
                </span>
              </div>
              <div v-if="updaterState.status === 'downloading'" class="setting-info">
                下载进度：{{ updaterState.progress || 0 }}%
              </div>
              <div v-if="updaterState.availableVersion" class="setting-info">
                最新版本：{{ updaterState.availableVersion }}
              </div>
              <div v-if="updaterState.enabled" class="setting-action">
                <button type="button" class="btn-sync prism-button" @click="refreshUpdateState">
                  <i class="bi bi-arrow-repeat"></i>
                  重新检查更新
                </button>
                <button
                  v-if="updaterState.status === 'downloaded'"
                  type="button"
                  class="btn-update prism-button prism-button--primary"
                  @click="installDownloadedUpdate"
                >
                  <i class="bi bi-download"></i>
                  立即安装更新
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- 数据存储设置 -->
        <section :id="'section-storage'" class="setting-section prism-settings-section">
          <h2 class="section-title">
            <i class="bi bi-database"></i>
            {{ $t('settings.storageTitle') }}
          </h2>
          <p class="section-description">{{ $t('settings.storageDesc') }}</p>

          <!-- 存储模式 -->
          <div class="setting-row">
            <div class="setting-left">
              <label class="setting-label">{{ $t('settings.storageMode') }}</label>
              <p class="setting-hint">{{ $t('settings.storageModeHint') }}</p>
            </div>
            <div class="setting-right">
              <select
                :aria-label="$t('settings.storageMode')"
                v-model="storageMode"
                class="form-select"
                disabled
              >
                <option value="local">{{ $t('settings.storageModeLocal') }}</option>
              </select>
              <p class="setting-info">
                <i class="bi bi-info-circle"></i>
                <span>{{ $t('settings.storageModeInfoLocal') }}</span>
              </p>
              <div class="setting-action">
                <button
                  type="button"
                  class="btn-open-directory prism-button"
                  @click="openStorageDirectory"
                >
                  <i class="bi bi-folder2-open"></i>
                  {{ $t('settings.openStorageDirectory') }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- SSH 配置 -->
        <section :id="'section-ssh'" class="setting-section prism-settings-section">
          <h2 class="section-title">
            <i class="bi bi-terminal"></i>
            {{ $t('settings.sshTitle') }}
          </h2>
          <p class="section-description">{{ $t('settings.sshDesc') }}</p>

          <!-- 默认超时时间 -->
          <div class="setting-row">
            <div class="setting-left">
              <label class="setting-label">{{ $t('settings.connectionTimeout') }}</label>
              <p class="setting-hint">{{ $t('settings.connectionTimeoutHint') }}</p>
            </div>
            <div class="setting-right">
              <input
                :aria-label="$t('settings.connectionTimeout')"
                v-model.number="sshTimeout"
                type="number"
                class="form-input"
                min="10"
                max="300"
              />
            </div>
          </div>

          <!-- 保持连接 -->
          <div class="setting-row">
            <div class="setting-left">
              <label class="setting-label">{{ $t('settings.keepAlive') }}</label>
              <p class="setting-hint">{{ $t('settings.keepAliveHint') }}</p>
            </div>
            <div class="setting-right">
              <label class="toggle-switch">
                <input :aria-label="$t('settings.keepAlive')" v-model="keepAlive" type="checkbox" />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-left">
              <label class="setting-label">{{ $t('settings.keepAliveInterval') }}</label>
              <p class="setting-hint">{{ $t('settings.keepAliveIntervalHint') }}</p>
            </div>
            <div class="setting-right">
              <input
                :aria-label="$t('settings.keepAliveInterval')"
                v-model.number="keepAliveInterval"
                type="number"
                class="form-input"
                min="5"
                max="300"
                :disabled="!keepAlive"
              />
            </div>
          </div>

          <!-- 默认端口 -->
          <div class="setting-row">
            <div class="setting-left">
              <label class="setting-label">{{ $t('settings.defaultPort') }}</label>
              <p class="setting-hint">{{ $t('settings.defaultPortHint') }}</p>
            </div>
            <div class="setting-right">
              <input
                :aria-label="$t('settings.defaultPort')"
                v-model.number="defaultSSHPort"
                type="number"
                class="form-input"
                min="1"
                max="65535"
              />
            </div>
          </div>
        </section>

        <!-- 终端设置 -->
        <section :id="'section-terminal'" class="setting-section prism-settings-section">
          <h2 class="section-title">
            <i class="bi bi-terminal-fill"></i>
            {{ $t('settings.terminalTitle') }}
          </h2>
          <p class="section-description">{{ $t('settings.terminalDesc') }}</p>

          <!-- 终端字体大小 -->
          <div class="setting-row">
            <div class="setting-left">
              <label class="setting-label">{{ $t('settings.terminalFontSizeLabel') }}</label>
              <p class="setting-hint">{{ $t('settings.terminalFontSizeHint') }}</p>
            </div>
            <div class="setting-right">
              <input
                :aria-label="$t('settings.terminalFontSizeLabel')"
                v-model.number="terminalFontSize"
                type="number"
                class="form-input"
                min="10"
                max="24"
              />
            </div>
          </div>

          <!-- 光标样式 -->
          <div class="setting-row">
            <div class="setting-left">
              <label class="setting-label">{{ $t('settings.cursorStyle') }}</label>
              <p class="setting-hint">{{ $t('settings.cursorStyleHint') }}</p>
            </div>
            <div class="setting-right">
              <select
                :aria-label="$t('settings.cursorStyle')"
                v-model="cursorStyle"
                class="form-select"
              >
                <option value="block">{{ $t('settings.cursorBlock') }}</option>
                <option value="underline">{{ $t('settings.cursorUnderline') }}</option>
                <option value="bar">{{ $t('settings.cursorBar') }}</option>
              </select>
            </div>
          </div>

          <!-- 光标闪烁 -->
          <div class="setting-row">
            <div class="setting-left">
              <label class="setting-label">{{ $t('settings.cursorBlink') }}</label>
              <p class="setting-hint">{{ $t('settings.cursorBlinkHint') }}</p>
            </div>
            <div class="setting-right">
              <label class="toggle-switch">
                <input
                  :aria-label="$t('settings.cursorBlink')"
                  v-model="cursorBlink"
                  type="checkbox"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <!-- 启用终端自动补全 -->
          <div class="setting-row">
            <div class="setting-left">
              <label class="setting-label">{{ $t('settings.enableAutocomplete') }}</label>
              <p class="setting-hint">{{ $t('settings.enableAutocompleteHint') }}</p>
            </div>
            <div class="setting-right">
              <label class="toggle-switch">
                <input
                  :aria-label="$t('settings.enableAutocomplete')"
                  v-model="enableAutocomplete"
                  type="checkbox"
                  @change="handleAutocompleteChange"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </section>

        <!-- 高级设置 -->
        <section :id="'section-advanced'" class="setting-section prism-settings-section">
          <h2 class="section-title">
            <i class="bi bi-gear-fill"></i>
            {{ $t('settings.advancedTitle') }}
          </h2>
          <p class="section-description">{{ $t('settings.advancedDesc') }}</p>

          <!-- 启动时自动连接 -->
          <div class="setting-row">
            <div class="setting-left">
              <label class="setting-label">{{ $t('settings.autoConnect') }}</label>
              <p class="setting-hint">{{ $t('settings.autoConnectHint') }}</p>
            </div>
            <div class="setting-right">
              <label class="toggle-switch">
                <input
                  :aria-label="$t('settings.autoConnect')"
                  v-model="autoConnect"
                  type="checkbox"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <!-- 记录命令历史 -->
          <div class="setting-row">
            <div class="setting-left">
              <label class="setting-label">{{ $t('settings.commandHistory') }}</label>
              <p class="setting-hint">{{ $t('settings.commandHistoryHint') }}</p>
            </div>
            <div class="setting-right">
              <label class="toggle-switch">
                <input
                  :aria-label="$t('settings.commandHistory')"
                  v-model="saveCommandHistory"
                  type="checkbox"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <!-- 开发者工具 -->
          <div class="setting-row">
            <div class="setting-left">
              <label class="setting-label">{{ $t('settings.developerMode') }}</label>
              <p class="setting-hint">{{ $t('settings.developerModeHint') }}</p>
            </div>
            <div class="setting-right">
              <label class="toggle-switch">
                <input
                  :aria-label="$t('settings.developerMode')"
                  v-model="developerMode"
                  type="checkbox"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </section>

        <!-- 关于 -->
        <section :id="'section-about'" class="setting-section prism-settings-section">
          <h2 class="section-title">
            <i class="bi bi-info-circle"></i>
            {{ $t('settings.aboutTitle') }}
          </h2>
          <p class="section-description">{{ $t('settings.aboutDesc') }}</p>

          <div class="about-info">
            <div class="app-logo">
              <AppIcon :size="64" />
            </div>
            <h3 class="app-name">{{ $t('welcome.appTitle') }}</h3>
            <p class="app-version">
              {{ $t('settings.appVersion', { version: currentAppVersion }) }}
            </p>
            <p class="app-description">
              {{ $t('settings.appDescription') }}
            </p>
            <AboutAppActions centered />
          </div>
        </section>
      </div>
    </div>
    <div
      v-if="settingsNotice"
      class="notification show"
      :class="`notification-${settingsNotice.type}`"
      role="status"
      aria-live="polite"
    >
      {{ settingsNotice.message }}
    </div>
    <!-- 添加模型对话框 -->
    <Teleport to="body">
      <Transition name="model-dialog" @before-leave="prepareModelDialogLeave">
        <div
          v-if="showAddModelDialog"
          class="dialog-overlay"
          @click.self="cancelAddModel"
          @keydown.esc.prevent.stop="cancelAddModel"
          @keydown.tab="trapModelDialogFocus"
        >
          <form
            ref="modelDialog"
            class="dialog-container"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-model-title"
            data-testid="add-model-dialog"
            novalidate
            @submit.prevent="addCustomModel"
            @invalid.capture.prevent
            @input="revalidateModelInput"
            @compositionstart="isModelComposing = true"
            @compositionend="isModelComposing = false"
            @keydown.capture="guardModelCompositionSubmit"
          >
            <div class="dialog-header">
              <h3 id="add-model-title" class="dialog-title">
                <i class="bi bi-plus-circle"></i>
                {{ $t('settings.addCustomModel') }}
              </h3>
              <button
                type="button"
                class="dialog-close"
                :aria-label="$t('settings.cancel')"
                @click="cancelAddModel"
              >
                <i class="bi bi-x"></i>
              </button>
            </div>
            <div class="dialog-body">
              <div class="form-group">
                <label for="custom-model-id" class="form-label">
                  模型 ID <span class="required">*</span>
                </label>
                <input
                  id="custom-model-id"
                  ref="newModelIdInput"
                  data-testid="custom-model-id"
                  v-model="newModel.id"
                  type="text"
                  class="form-input"
                  required
                  spellcheck="false"
                  autocomplete="off"
                  placeholder="例如: my-model-id"
                  :aria-invalid="!!modelErrors['custom-model-id']"
                  :aria-describedby="
                    modelErrors['custom-model-id'] ? 'custom-model-id-error' : undefined
                  "
                />
                <p
                  v-if="modelErrors['custom-model-id']"
                  id="custom-model-id-error"
                  class="prism-field-error"
                  role="alert"
                >
                  {{ modelErrors['custom-model-id'] }}
                </p>
                <p class="form-hint">
                  <i class="bi bi-info-circle"></i>
                  请输入服务商文档中提供的准确模型 ID
                </p>
              </div>

              <div class="form-group">
                <label for="custom-model-name" class="form-label">
                  模型名称 <span class="required">*</span>
                </label>
                <input
                  id="custom-model-name"
                  data-testid="custom-model-name"
                  v-model="newModel.name"
                  type="text"
                  class="form-input"
                  required
                  placeholder="用于模型选择器的显示名称"
                  :aria-invalid="!!modelErrors['custom-model-name']"
                  :aria-describedby="
                    modelErrors['custom-model-name'] ? 'custom-model-name-error' : undefined
                  "
                />
                <p
                  v-if="modelErrors['custom-model-name']"
                  id="custom-model-name-error"
                  class="prism-field-error"
                  role="alert"
                >
                  {{ modelErrors['custom-model-name'] }}
                </p>
              </div>

              <div class="form-group">
                <label for="custom-model-description" class="form-label">描述（可选）</label>
                <input
                  id="custom-model-description"
                  v-model="newModel.description"
                  type="text"
                  class="form-input"
                  placeholder="例如: 推荐使用，性能更强"
                />
              </div>

              <div class="form-group">
                <label for="custom-model-context" class="form-label">上下文窗口（tokens）</label>
                <input
                  id="custom-model-context"
                  v-model.number="newModel.contextWindow"
                  type="number"
                  class="form-input"
                  min="1"
                  step="1"
                  placeholder="按官方文档填写，可留空"
                  :aria-invalid="!!modelErrors['custom-model-context']"
                  :aria-describedby="
                    modelErrors['custom-model-context'] ? 'custom-model-context-error' : undefined
                  "
                />
                <p
                  v-if="modelErrors['custom-model-context']"
                  id="custom-model-context-error"
                  class="prism-field-error"
                  role="alert"
                >
                  {{ modelErrors['custom-model-context'] }}
                </p>
              </div>

              <div class="form-group">
                <label class="form-label">能力</label>
                <div class="checkbox-group">
                  <label class="checkbox-item">
                    <input type="checkbox" v-model="newModel.capabilities.text" />
                    <span>文本对话</span>
                  </label>
                  <label class="checkbox-item">
                    <input type="checkbox" v-model="newModel.capabilities.vision" />
                    <span>视觉理解</span>
                  </label>
                  <label class="checkbox-item">
                    <input type="checkbox" v-model="newModel.capabilities.image" />
                    <span>图像生成</span>
                  </label>
                  <label class="checkbox-item">
                    <input type="checkbox" v-model="newModel.capabilities.functionCall" />
                    <span>函数调用</span>
                  </label>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">价格（USD / 百万 tokens，可选）</label>
                <div class="price-inputs">
                  <div class="price-input-group">
                    <label for="custom-model-input-price" class="price-label">输入</label>
                    <input
                      id="custom-model-input-price"
                      v-model.number="newModel.price.input"
                      type="number"
                      class="form-input"
                      min="0"
                      step="0.01"
                      placeholder="未知，可留空"
                      :aria-invalid="!!modelErrors['custom-model-input-price']"
                      :aria-describedby="
                        modelErrors['custom-model-input-price']
                          ? 'custom-model-input-price-error'
                          : undefined
                      "
                    />
                    <p
                      v-if="modelErrors['custom-model-input-price']"
                      id="custom-model-input-price-error"
                      class="prism-field-error"
                      role="alert"
                    >
                      {{ modelErrors['custom-model-input-price'] }}
                    </p>
                  </div>
                  <div class="price-input-group">
                    <label for="custom-model-output-price" class="price-label">输出</label>
                    <input
                      id="custom-model-output-price"
                      v-model.number="newModel.price.output"
                      type="number"
                      class="form-input"
                      min="0"
                      step="0.01"
                      placeholder="未知，可留空"
                      :aria-invalid="!!modelErrors['custom-model-output-price']"
                      :aria-describedby="
                        modelErrors['custom-model-output-price']
                          ? 'custom-model-output-price-error'
                          : undefined
                      "
                    />
                    <p
                      v-if="modelErrors['custom-model-output-price']"
                      id="custom-model-output-price-error"
                      class="prism-field-error"
                      role="alert"
                    >
                      {{ modelErrors['custom-model-output-price'] }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div class="dialog-footer">
              <button
                type="button"
                class="btn-cancel"
                data-testid="custom-model-cancel"
                @click="cancelAddModel"
              >
                {{ $t('settings.cancel') }}
              </button>
              <button type="submit" class="btn-confirm" data-testid="custom-model-save">
                {{ $t('settings.add') }}
              </button>
            </div>
          </form>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { APP_VERSION } from '@ai-ssh/shared'

import { useTheme } from '../composables/useTheme'
import { themeService, type ThemeMode } from '../services/theme.service'
import { settingsService } from '../services/settings.service'
import { mergeProviderForSave } from '../utils/managed-provider-settings'
import { registerManagedProviderRefreshListeners } from '../utils/managed-provider-refresh'
import { DEFAULT_PROVIDERS, type AIProvider } from '../types/ai-providers'

import { mergeSavedProviderWithDefault } from '../utils/provider-config-merge'
import { buildInitialAIProviders } from '../utils/initial-ai-providers'
import {
  testProviderConnection as testProviderAPI,
  type TestResult
} from '../services/ai-test.service'
import { fetchModelsForProvider } from '../services/model-fetcher.service'
import { useUpdateClient } from '@/services/update-client'
import SettingsAppearance from '@/components/settings/SettingsAppearance.vue'
import SettingsAiProviders from '@/components/settings/SettingsAiProviders.vue'
import AiProvidersIcon from '@/components/common/AiProvidersIcon.vue'
import AboutAppActions from '@/components/common/AboutAppActions.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import { useInlineValidation } from '@/composables/useInlineValidation'

// 设置分类
const settingsSections = computed(() => [
  { id: 'appearance', label: $t('settings.navAppearance'), icon: 'bi bi-palette' },
  { id: 'ai-providers', label: $t('settings.navAiProviders'), icon: '' },
  { id: 'ai-assistant', label: $t('settings.navAiAssistant'), icon: 'bi bi-chat-dots' },
  { id: 'updates', label: '应用更新', icon: 'bi bi-arrow-repeat' },
  { id: 'storage', label: $t('settings.navStorage'), icon: 'bi bi-database' },
  { id: 'ssh', label: $t('settings.navSsh'), icon: 'bi bi-terminal' },
  { id: 'terminal', label: $t('settings.navTerminal'), icon: 'bi bi-terminal-fill' },
  { id: 'advanced', label: $t('settings.navAdvanced'), icon: 'bi bi-gear-fill' },
  { id: 'about', label: $t('settings.navAbout'), icon: 'bi bi-info-circle' }
])

// 主题 Composable
const theme = useTheme()
const { mode, colorScheme, fontSize: themeFontSize } = theme

// 国际化
const { t: $t } = useI18n()

// Vue Router
const route = useRoute()

// 导航相关
const activeSection = ref('appearance')
const contentContainer = ref<HTMLElement | null>(null)
const isScrolling = ref(false)
let sectionScrollTimer: ReturnType<typeof setTimeout> | undefined
let sectionScrollTarget = 0
let sectionScrollDeadline = 0
const releaseSectionScroll = () => {
  const container = contentContainer.value
  if (
    container &&
    Math.abs(container.scrollTop - sectionScrollTarget) > 2 &&
    performance.now() < sectionScrollDeadline
  ) {
    sectionScrollTimer = setTimeout(releaseSectionScroll, 120)
    return
  }
  isScrolling.value = false
  onScroll()
}
const updater = useUpdateClient()
const currentAppVersion = ref(APP_VERSION)
const updaterState = ref<any>({ enabled: false, status: 'idle' })
let disposeUpdaterListener: (() => void) | null = null

const updaterStatusText = computed(() => {
  if (!updaterState.value.enabled) return '未配置更新源'
  const statusMap: Record<string, string> = {
    idle: '尚未开始检查',
    checking: '正在检查更新',
    'up-to-date': '当前已是最新版本',
    'update-available': '已发现新版本，准备下载',
    'probing-sources': '正在探测最快下载源',
    downloading: '正在后台下载更新',
    downloaded: '安装包已下载完成，可直接安装',
    installing: '正在启动安装程序',
    error: updaterState.value.error || '更新失败'
  }

  return updaterState.value.statusText || statusMap[updaterState.value.status] || '未知状态'
})

const refreshUpdateState = async () => {
  if (!window.electronAPI?.updater) {
    return
  }

  updaterState.value = await window.electronAPI.updater.startBackgroundCheck()
}

const installDownloadedUpdate = async () => {
  if (!window.electronAPI?.updater) {
    return
  }

  await window.electronAPI.updater.installDownloadedUpdate()
}

// 基础设置
// 注意：theme 相关的状态已经从 useTheme() composable 中获取
// mode, colorScheme, themeFontSize 已经在上面解构
const fontSize = ref<'small' | 'medium' | 'large'>('medium')
const selectedColorScheme = ref<'blue' | 'green' | 'purple' | 'orange' | 'red'>('blue')

// 新主题系统
const selectedThemeMode = ref<ThemeMode>(themeService.getMode())
const availableThemes = computed(() => themeService.getAvailableThemes())

// SSH 设置
const sshTimeout = ref(10)
const keepAlive = ref(true)
const keepAliveInterval = ref(15)
const defaultSSHPort = ref(22)

// 终端设置
const terminalFontSize = ref(14)
const cursorStyle = ref('block')
const cursorBlink = ref(true)
const enableAutocomplete = ref(false) // 默认禁用自动补全（功能尚未成熟）

// AI 助手设置
const autoApproveReadOnly = ref(true)
const commandRiskLevel = ref(2) // 命令风险等级：1-5，自动通过此等级及以下的命令
const enableChatHistory = ref(true)
const maxHistoryMessages = ref(50)

// 高级设置
const autoConnect = ref(false)
const saveCommandHistory = ref(true)
const developerMode = ref(false)

// AI 服务商设置
const aiProviders = ref<AIProvider[]>(buildInitialAIProviders(DEFAULT_PROVIDERS))
const suppressProviderAutosave = ref(false)
const testingProviders = ref<Record<string, boolean>>({})
const modelTestResults = ref<Record<string, Record<string, TestResult>>>({})
const getRuntimeProviderId = (provider: AIProvider): string => {
  return provider.config?.runtimeProviderId || provider.id
}

const isManagedProvider = (provider: AIProvider): boolean => {
  return !!provider.config?.managedByApp
}

const setAIProviders = (providers: AIProvider[]) => {
  suppressProviderAutosave.value = true
  aiProviders.value = providers
  nextTick(() => {
    suppressProviderAutosave.value = false
  })
}

const fetchingModels = ref<Record<string, boolean>>({})

// 手动添加模型对话框
const showAddModelDialog = ref(false)
const currentEditingProvider = ref<AIProvider | null>(null)
const modelDialog = ref<HTMLFormElement | null>(null)
const newModelIdInput = ref<HTMLInputElement | null>(null)
const isModelComposing = ref(false)
const {
  errors: modelErrors,
  validateForm: validateModelForm,
  revalidateInput: revalidateModelInput,
  setFieldError: setModelFieldError,
  clearErrors: clearModelErrors
} = useInlineValidation()
const guardModelCompositionSubmit = (event: KeyboardEvent) => {
  if (
    event.key === 'Enter' &&
    (isModelComposing.value || event.isComposing || event.keyCode === 229)
  ) {
    event.preventDefault()
  }
}
let modelDialogReturnFocus: HTMLElement | null = null
const newModel = ref({
  id: '',
  name: '',
  contextWindow: '' as number | '',
  capabilities: {
    text: true,
    image: false,
    functionCall: false,
    vision: false
  },
  price: {
    input: '' as number | '',
    output: '' as number | ''
  },
  description: ''
})

// 可用的颜色方案
const availableColorSchemes = computed(() => theme.getAvailableColorSchemes())

// 处理自动补全开关变化
const handleAutocompleteChange = () => {
  localStorage.setItem('terminalAutocompleteEnabled', String(enableAutocomplete.value))
  // 触发 storage 事件通知其他组件
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: 'terminalAutocompleteEnabled',
      newValue: String(enableAutocomplete.value),
      url: window.location.href
    })
  )
}

// 存储设置
const storageMode = ref<'local'>('local')
let unregisterManagedProviderRefresh: (() => void) | null = null

// 滚动到指定区域
const scrollToSection = (sectionId: string) => {
  const element = document.getElementById(`section-${sectionId}`)
  if (element && contentContainer.value) {
    clearTimeout(sectionScrollTimer)
    isScrolling.value = true
    activeSection.value = sectionId

    const container = contentContainer.value
    const offsetTop =
      container.scrollTop +
      element.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      20

    const motionDisabled =
      document.documentElement.dataset.motion === 'off' ||
      document.documentElement.dataset.transitions === 'off' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    sectionScrollTarget = Math.max(
      0,
      Math.min(offsetTop, container.scrollHeight - container.clientHeight)
    )
    sectionScrollDeadline = performance.now() + 1600
    container.scrollTo({
      top: sectionScrollTarget,
      behavior: motionDisabled ? 'auto' : 'smooth'
    })

    // A new navigation replaces the previous scroll target and its settling timer.
    sectionScrollTimer = setTimeout(releaseSectionScroll, motionDisabled ? 0 : 600)
  }
}

// 监听滚动，更新激活的导航项
const onScroll = () => {
  if (isScrolling.value) {
    clearTimeout(sectionScrollTimer)
    sectionScrollTimer = setTimeout(releaseSectionScroll, 120)
    return
  }

  const container = contentContainer.value
  if (!container) return

  // A short final section cannot always reach the top of the scroll container.
  if (
    container.scrollHeight > container.clientHeight + 1 &&
    container.scrollTop + container.clientHeight >= container.scrollHeight - 2
  ) {
    activeSection.value = settingsSections.value.at(-1)?.id || activeSection.value
    return
  }

  const sectionThreshold = container.getBoundingClientRect().top + 40
  const sections = settingsSections.value.map(s => ({
    id: s.id,
    element: document.getElementById(`section-${s.id}`)
  }))

  // 找到当前滚动位置对应的section
  for (let i = sections.length - 1; i >= 0; i--) {
    const section = sections[i]
    if (section.element) {
      if (section.element.getBoundingClientRect().top <= sectionThreshold) {
        activeSection.value = section.id
        break
      }
    }
  }
}

// 打开本地存储目录
const openStorageDirectory = async () => {
  try {
    // 获取 userData 路径
    const userDataPath = await window.electronAPI.getPath('userData')
    // 打开目录
    await window.electronAPI.shell.openPath(userDataPath)
  } catch (error) {
    console.error('[Settings] 打开存储目录失败:', error)
    showErrorNotification('打开存储目录失败')
  }
}

// 主题变化处理

// 新主题系统的切换处理
const onThemeModeChange = () => {
  themeService.applyTheme(selectedThemeMode.value)
  showSuccessNotification(
    `主题已切换为: ${availableThemes.value.find(t => t.value === selectedThemeMode.value)?.label}`
  )
}

const onColorSchemeChange = (scheme: 'blue' | 'green' | 'purple' | 'orange' | 'red') => {
  selectedColorScheme.value = scheme
  theme.setColorScheme(scheme)
  showSuccessNotification('颜色方案已更新')
}

const onFontSizeChange = () => {
  theme.setFontSize(fontSize.value)
  showSuccessNotification('字体大小已更新')
}

// 显示通知
const showSuccessNotification = (message: string) => {
  showNotification(message, 'success')
}

const showErrorNotification = (message: string) => {
  showNotification(message, 'error')
}

const settingsNotice = ref<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null)
let settingsNoticeTimer: ReturnType<typeof setTimeout> | undefined
const showNotification = (message: string, type: 'success' | 'error' | 'warning' = 'success') => {
  if (window.$notification) {
    window.$notification.add({ type, message, duration: 3000 })
    return
  }
  clearTimeout(settingsNoticeTimer)
  settingsNotice.value = { message, type }
  settingsNoticeTimer = setTimeout(() => {
    settingsNotice.value = null
  }, 3000)
}

// 保存设置
const settingsLoaded = ref(false)
let loadingSettings = false
const saveSettings = async () => {
  if (!settingsLoaded.value || loadingSettings) return
  try {
    const currentSettings = await settingsService.getSettings()

    // 将响应式对象转换为纯 JSON 对象（避免 IPC 序列化错误）
    const settings = {
      ...currentSettings,
      appearance: {
        theme: mode.value,
        fontSize: fontSize.value,
        colorScheme: selectedColorScheme.value
      },
      ssh: {
        timeout: sshTimeout.value,
        keepAlive: keepAlive.value,
        keepAliveInterval: keepAliveInterval.value,
        defaultPort: defaultSSHPort.value
      },
      terminal: {
        fontSize: terminalFontSize.value,
        cursorStyle: cursorStyle.value,
        cursorBlink: cursorBlink.value
      },
      aiAssistant: {
        autoApproveReadOnly: autoApproveReadOnly.value,
        commandRiskLevel: commandRiskLevel.value,
        enableChatHistory: enableChatHistory.value,
        maxHistoryMessages: maxHistoryMessages.value
      },
      // 转换为纯 JSON，移除响应式代理和不可序列化的对象
      aiProviders: JSON.parse(
        JSON.stringify(
          serializeProvidersForSave((currentSettings.aiProviders || []) as AIProvider[])
        )
      ),
      advanced: {
        autoConnect: autoConnect.value,
        saveCommandHistory: saveCommandHistory.value,
        developerMode: developerMode.value,
        storageMode: 'local',
        syncFrequency: 'moderate'
      },
      storage: {
        mode: 'local'
      },
      version: '1.0.0',
      lastUpdated: new Date().toISOString()
    }

    // ✅ 使用 settingsService，自动处理 userId
    await settingsService.saveSettings(settings)

    // 更新主题 Composable
    theme.setMode(mode.value)
    theme.setColorScheme(selectedColorScheme.value)
    theme.setFontSize(fontSize.value)

    // 触发设置更新事件
    window.dispatchEvent(new CustomEvent('settings-updated'))
  } catch {
    showNotification('保存设置失败', 'error')
  }
}

// 加载设置
const loadSettings = async () => {
  loadingSettings = true
  try {
    // 从主题 Composable 加载主题设置（mode, colorScheme, themeFontSize 已经从 composable 解构）
    fontSize.value = themeFontSize.value
    selectedColorScheme.value = colorScheme.value

    // ✅ 使用 settingsService，自动处理 userId
    const settings = await settingsService.getSettings()

    if (settings) {
      // Appearance has already been initialized from theme-settings, with legacy
      // app-settings used only as a migration fallback. Its old mirror must not
      // overwrite a newer font or color choice when this page opens.

      // SSH 设置
      if (settings.ssh) {
        sshTimeout.value = settings.ssh.timeout || 10
        keepAlive.value = settings.ssh.keepAlive !== undefined ? settings.ssh.keepAlive : true
        keepAliveInterval.value = settings.ssh.keepAliveInterval ?? 15
        defaultSSHPort.value = settings.ssh.defaultPort || 22
      }

      // 终端设置
      if (settings.terminal) {
        terminalFontSize.value = settings.terminal.fontSize || 14
        cursorStyle.value = settings.terminal.cursorStyle || 'block'
        cursorBlink.value =
          settings.terminal.cursorBlink !== undefined ? settings.terminal.cursorBlink : true
      }

      // AI 助手设置
      if (settings.aiAssistant) {
        autoApproveReadOnly.value =
          settings.aiAssistant.autoApproveReadOnly !== undefined
            ? settings.aiAssistant.autoApproveReadOnly
            : true
        commandRiskLevel.value =
          settings.aiAssistant.commandRiskLevel !== undefined
            ? settings.aiAssistant.commandRiskLevel
            : 2
        enableChatHistory.value =
          settings.aiAssistant.enableChatHistory !== undefined
            ? settings.aiAssistant.enableChatHistory
            : true
        maxHistoryMessages.value = settings.aiAssistant.maxHistoryMessages || 50
      }

      // AI 服务商配置（优先使用数据库数据）
      if (settings.aiProviders && settings.aiProviders.length > 0) {
        // 合并数据库配置和默认配置
        setAIProviders(
          DEFAULT_PROVIDERS.map(defaultProvider => {
            const savedProvider = settings.aiProviders?.find(
              (p: any) => p.id === defaultProvider.id
            )

            if (savedProvider) {
              return mergeSavedProviderWithDefault(defaultProvider, savedProvider) as any
            }

            return {
              ...defaultProvider,
              apiKey: (defaultProvider as any).apiKey || '',
              enabled: (defaultProvider as any).config?.defaultEnabled ?? false,
              isDefault: false
            } as any
          }) as any
        )
      } else {
        // 初始化默认配置
        setAIProviders(buildInitialAIProviders(DEFAULT_PROVIDERS))
      }

      // 高级设置
      if (settings.advanced) {
        autoConnect.value = settings.advanced.autoConnect || false
        saveCommandHistory.value =
          settings.advanced.saveCommandHistory !== undefined
            ? settings.advanced.saveCommandHistory
            : true
        developerMode.value = settings.advanced.developerMode || false
        storageMode.value = 'local'
      }
    }
    settingsLoaded.value = true
  } catch (error) {
    settingsLoaded.value = false
    showNotification(error instanceof Error ? error.message : '读取设置失败，原有配置已保留，请重试。', 'error')
  } finally {
    await nextTick()
    loadingSettings = false
  }
}

// 自动保存
watch(
  [
    mode,
    fontSize,
    selectedColorScheme,
    sshTimeout,
    keepAlive,
    defaultSSHPort,
    terminalFontSize,
    cursorStyle,
    cursorBlink,
    // AI 助手设置
    autoApproveReadOnly,
    commandRiskLevel,
    enableChatHistory,
    maxHistoryMessages,
    // 高级设置
    autoConnect,
    saveCommandHistory,
    developerMode,
    storageMode
  ],
  () => {
    saveSettings()
  },
  { deep: true }
)

const testProviderConnection = async (provider: AIProvider) => {
  const enabledModels = provider.models.filter(model => model.enabled !== false)

  if (enabledModels.length === 0) {
    showNotification('请先启用至少一个模型', 'warning')
    return
  }

  if (!provider.apiKey && getRuntimeProviderId(provider) !== 'ollama') {
    showNotification('请先输入 API Key', 'error')
    return
  }

  testingProviders.value[provider.id] = true
  modelTestResults.value[provider.id] = {}

  try {
    for (const model of enabledModels) {
      const result = await testProviderAPI(
        {
          ...provider,
          id: getRuntimeProviderId(provider)
        },
        model.id
      )
      modelTestResults.value[provider.id][model.id] = result
    }

    const successCount = enabledModels.filter(
      m => modelTestResults.value[provider.id][m.id]?.success
    ).length

    if (successCount === enabledModels.length) {
      showNotification(`所有 ${successCount} 个模型测试通过`, 'success')
    } else if (successCount > 0) {
      showNotification(`${successCount}/${enabledModels.length} 个模型测试通过`, 'warning')
    } else {
      showNotification('所有模型测试失败', 'error')
    }
  } catch {
    showNotification('测试连接失败', 'error')
  } finally {
    testingProviders.value[provider.id] = false
  }
}

const refreshModelList = async (provider: AIProvider) => {
  if (!provider.apiKey && getRuntimeProviderId(provider) !== 'ollama') {
    showNotification('请先输入 API Key', 'error')
    return
  }

  fetchingModels.value[provider.id] = true

  try {
    const result = await fetchModelsForProvider(
      provider.id,
      provider.apiKey,
      provider.endpoint,
      getRuntimeProviderId(provider)
    )

    if (result.success && result.models) {
      const currentProvider = aiProviders.value.find(item => item.id === provider.id)
      if (
        !currentProvider ||
        currentProvider.endpoint !== provider.endpoint ||
        currentProvider.apiKey !== provider.apiKey
      )
        return
      // 合并获取的模型列表和现有配置
      const existingModels = currentProvider.models || []
      const fetchedModels = result.models

      // 保留用户对现有模型的 enabled 配置，新模型默认禁用
      const mergedModels = fetchedModels.map(fetchedModel => {
        const existing = existingModels.find(m => m.id === fetchedModel.id)
        const enabled = existing?.enabled !== undefined ? existing.enabled : false
        return {
          ...fetchedModel,
          providerId: provider.id,
          enabled,
          isCustom: existing?.isCustom,
          parameters: fetchedModel.parameters ?? existing?.parameters,
          reasoning: fetchedModel.reasoning ?? existing?.reasoning,
          requestConfig: existing?.requestConfig
        }
      })

      // 更新模型列表
      currentProvider.models = [
        ...mergedModels,
        ...existingModels.filter(
          model => model.isCustom && !fetchedModels.some(fetched => fetched.id === model.id)
        )
      ]

      // 自动保存
      if (!await saveAIProviderConfigs()) return

      showNotification(`成功获取 ${mergedModels.length} 个模型`, 'success')
    } else {
      showNotification(result.error || '获取模型列表失败', 'error')
    }
  } catch (error: any) {
    showNotification('刷新模型列表失败: ' + error.message, 'error')
  } finally {
    fetchingModels.value[provider.id] = false
  }
}

// 打开添加模型对话框
const openAddModelDialog = (provider: AIProvider) => {
  clearModelErrors()
  isModelComposing.value = false
  modelDialogReturnFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  currentEditingProvider.value = provider
  // 重置表单
  newModel.value = {
    id: '',
    name: '',
    contextWindow: '',
    capabilities: {
      text: true,
      image: false,
      functionCall: false,
      vision: false
    },
    price: {
      input: '',
      output: ''
    },
    description: ''
  }
  showAddModelDialog.value = true
  nextTick(() => {
    if (showAddModelDialog.value) newModelIdInput.value?.focus({ preventScroll: true })
  })
}

const prepareModelDialogLeave = (element: Element) => {
  // The closing surface remains visible briefly, but must stop accepting focus immediately.
  const overlay = element as HTMLElement
  overlay.inert = true
}

const trapModelDialogFocus = (event: KeyboardEvent) => {
  if (!showAddModelDialog.value) return
  const controls = modelDialog.value?.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'
  )
  if (!controls?.length) return
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

// 添加自定义模型
const addCustomModel = async () => {
  if (isModelComposing.value || !currentEditingProvider.value) {
    return
  }

  if (!validateModelForm(modelDialog.value)) return

  const provider = aiProviders.value.find(item => item.id === currentEditingProvider.value?.id)
  if (!provider) return

  // 检查模型 ID 是否已存在
  if (provider.models.some(m => m.id === newModel.value.id.trim())) {
    setModelFieldError(newModelIdInput.value, '该模型 ID 已存在')
    return
  }

  // 添加模型
  const model = {
    id: newModel.value.id.trim(),
    name: newModel.value.name.trim(),
    providerId: provider.id,
    contextWindow:
      typeof newModel.value.contextWindow === 'number' ? newModel.value.contextWindow : 0,
    capabilities: { ...newModel.value.capabilities },
    price:
      typeof newModel.value.price.input === 'number' &&
      typeof newModel.value.price.output === 'number'
        ? { input: newModel.value.price.input, output: newModel.value.price.output }
        : undefined,
    description: newModel.value.description.trim(),
    isCustom: true, // 用户手动添加的模型
    enabled: true // 新添加的模型默认启用
  }

  provider.models.push(model)

  // 保存配置
  if (!await saveAIProviderConfigs()) return

  showNotification(`已添加模型: ${model.name}`, 'success')
  cancelAddModel()
}

const removeCustomModel = async (providerId: string, modelId: string) => {
  const provider = aiProviders.value.find(p => p.id === providerId)
  const model = provider?.models.find(m => m.id === modelId)

  if (!provider || !model) {
    return
  }

  if (provider.id !== 'custom-openai' && model.isCustom !== true) {
    return
  }

  provider.models = provider.models.filter(m => m.id !== modelId)

  if (modelTestResults.value[providerId]) {
    delete modelTestResults.value[providerId][modelId]
  }

  if (!await saveAIProviderConfigs()) return
  showNotification(`已删除模型: ${model.name}`, 'success')
}

// 取消添加模型
const cancelAddModel = () => {
  clearModelErrors()
  isModelComposing.value = false
  showAddModelDialog.value = false
  currentEditingProvider.value = null
  const returnFocus = modelDialogReturnFocus
  nextTick(() => {
    if (!showAddModelDialog.value && returnFocus?.isConnected) {
      returnFocus.focus({ preventScroll: true })
    }
  })
}

const clearProviderConfig = async (providerId: string) => {
  const provider = aiProviders.value.find(p => p.id === providerId)
  if (provider) {
    if (isManagedProvider(provider)) {
      showNotification('该服务商由应用托管，不能清除配置', 'error')
      return
    }
    provider.apiKey = ''
    provider.enabled = false
    delete modelTestResults.value[providerId]
    if (await saveAIProviderConfigs()) showNotification('配置已清除', 'success')
  }
}

const serializeProvidersForSave = (latestProviders: AIProvider[] = []) => {
  return aiProviders.value.map(provider =>
    mergeProviderForSave(
      provider,
      latestProviders.find(item => item.id === provider.id)
    )
  )
}

const saveAIProviderConfigs = async () => {
  if (!settingsLoaded.value || loadingSettings) {
    showNotification('请先成功读取现有设置后再修改模型配置。', 'error')
    return false
  }
  try {
    // ✅ 使用 settingsService，自动处理 userId
    const currentSettings = await settingsService.getSettings()
    const cleanProviders = serializeProvidersForSave(
      (currentSettings.aiProviders || []) as AIProvider[]
    )

    // 更新 AI 服务商配置（使用纯 JSON 对象）
    const updatedSettings = {
      ...currentSettings,
      aiProviders: cleanProviders,
      lastUpdated: new Date().toISOString()
    }

    // ✅ 保存到存储（使用 settingsService，自动处理 userId）
    await settingsService.saveSettings(JSON.parse(JSON.stringify(updatedSettings)))

    // 触发自定义事件通知其他组件配置已更新
    window.dispatchEvent(new CustomEvent('ai-provider-configs-updated'))
    return true
  } catch (error) {
    showNotification(error instanceof Error ? error.message : '模型配置未能保存，请重试。', 'error')
    return false
  }
}

// 监听 AI 服务商配置变化
watch(
  aiProviders,
  () => {
    if (suppressProviderAutosave.value) {
      return
    }
    saveAIProviderConfigs()
  },
  { deep: true }
)

// 监听主题 Composable 变化，同步到本地状态
watch([mode, colorScheme, themeFontSize], () => {
  // mode 已经是从 composable 解构出来的，无需再赋值
  fontSize.value = themeFontSize.value
  selectedColorScheme.value = colorScheme.value
})

// 监听路由 query 参数变化（用于从其他页面导航到设置页面的特定部分）
watch(
  () => route.query,
  async (newQuery, oldQuery) => {
    // 只有当 query 真正变化时才处理
    if (JSON.stringify(newQuery) !== JSON.stringify(oldQuery)) {
      const section = newQuery.section as string | undefined

      if (section) {
        // 滚动到指定的 section
        await nextTick()
        scrollToSection(section)
      }
    }
  },
  { deep: true }
)

onMounted(async () => {
  if (window.electronAPI?.getVersion) {
    try {
      currentAppVersion.value = await window.electronAPI.getVersion()
    } catch {
      // Keep the packaged version fallback if IPC is temporarily unavailable.
    }
  }
  updaterState.value = await updater.initialize()
  if (window.electronAPI?.onUpdaterStateChange) {
    disposeUpdaterListener = window.electronAPI.onUpdaterStateChange(state => {
      updaterState.value = state
    })
  }

  storageMode.value = 'local'

  // 加载终端自动补全设置
  const savedAutocomplete = localStorage.getItem('terminalAutocompleteEnabled')
  if (savedAutocomplete !== null) {
    enableAutocomplete.value = savedAutocomplete === 'true'
  }

  // 监听主题变化
  const handleThemeChange = (event: Event) => {
    const customEvent = event as CustomEvent
    selectedThemeMode.value = customEvent.detail.mode ?? customEvent.detail.theme
  }
  window.addEventListener('theme-changed', handleThemeChange)

  const handleProviderRefresh = async () => {
    await loadSettings()
  }
  unregisterManagedProviderRefresh = registerManagedProviderRefreshListeners(
    window,
    handleProviderRefresh as EventListener
  )

  // 处理 URL query 参数的函数
  const handleQueryParams = async () => {
    const section = route.query.section as string | undefined

    if (section) {
      // 滚动到指定的 section
      await nextTick()
      scrollToSection(section)
    }
  }

  // 初次加载时处理 query 参数
  await handleQueryParams()

  // 监听自定义导航事件（从 AppTitleBar 触发）
  const handleNavigateToSettings = (event: Event) => {
    const customEvent = event as CustomEvent
    const { section: navSection } = customEvent.detail || {}

    if (navSection) {
      activeSection.value = navSection
    }
  }

  window.addEventListener('navigate-to-settings', handleNavigateToSettings)

  // 加载完整设置
  await loadSettings()
})

onBeforeUnmount(() => {
  clearTimeout(sectionScrollTimer)
  clearTimeout(settingsNoticeTimer)
  disposeUpdaterListener?.()
  unregisterManagedProviderRefresh?.()
})
</script>

<style scoped>
.app-logo {
  display: flex;
  justify-content: center;
}

/* ==================== 添加模型对话框样式 ==================== */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: color-mix(in srgb, var(--liquid-canvas) 48%, transparent);
  backdrop-filter: blur(8px);
  padding: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.dialog-container {
  background: var(--liquid-panel-solid, var(--vscode-editor-background));
  border: 1px solid var(--liquid-rim, var(--vscode-border));
  border-radius: 24px;
  width: 90%;
  max-width: 600px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow:
    inset 0 1px 0 var(--liquid-inner-light),
    0 26px 80px -20px var(--liquid-shadow);
  overflow: hidden;
  transform-origin: center;
}

.model-dialog-enter-active,
.model-dialog-leave-active {
  transition: opacity 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.model-dialog-enter-active .dialog-container,
.model-dialog-leave-active .dialog-container {
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.model-dialog-leave-active,
.model-dialog-leave-active .dialog-container {
  transition-duration: 150ms;
  pointer-events: none;
}

.model-dialog-enter-from,
.model-dialog-leave-to {
  opacity: 0;
}

.model-dialog-enter-from .dialog-container,
.model-dialog-leave-to .dialog-container {
  transform: translateY(6px) scale(0.98);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--vscode-border);
}

.dialog-title {
  font-size: var(--prism-font-16);
  font-weight: 600;
  color: var(--vscode-foreground);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.dialog-title i {
  font-size: var(--prism-font-18);
  color: var(--vscode-accent);
}

.dialog-close {
  background: transparent;
  border: none;
  color: var(--vscode-foreground);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--prism-radius-small);
  font-size: var(--prism-font-20);
  display: flex;
  align-items: center;
  justify-content: center;
  touch-action: manipulation;
  transition:
    background-color 120ms ease,
    transform 120ms cubic-bezier(0.22, 1, 0.36, 1);
}

.dialog-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.form-group {
  margin-bottom: 20px;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-label {
  display: block;
  font-size: var(--prism-font-13);
  font-weight: 500;
  color: var(--vscode-foreground);
  margin-bottom: 8px;
}

.required {
  color: var(--vscode-errorForeground);
  margin-left: 4px;
}

.dialog-container .form-input {
  width: 100%;
  padding: 8px 12px;
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-border);
  border-radius: 10px;
  color: var(--vscode-input-foreground);
  font-size: var(--prism-font-13);
  transition:
    border-color 120ms ease,
    background-color 120ms ease;
}

.dialog-container .form-input:focus {
  outline: none;
  border-color: var(--vscode-accent);
  box-shadow: 0 0 0 1px var(--vscode-accent);
}
.dialog-container .form-input[aria-invalid='true'] {
  border-color: var(--prism-danger);
}

.form-hint {
  margin-top: 6px;
  font-size: var(--prism-font-12);
  color: var(--vscode-descriptionForeground);
  display: flex;
  align-items: center;
  gap: 6px;
}

.form-hint i {
  font-size: var(--prism-font-13);
}

.checkbox-group {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.checkbox-item {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 8px;
  border-radius: var(--prism-radius-small);
  touch-action: manipulation;
  transition: background-color 120ms ease;
}

.checkbox-item input[type='checkbox'] {
  cursor: pointer;
  width: 16px;
  height: 16px;
}
.checkbox-item input[type='checkbox']:disabled {
  cursor: not-allowed;
}

.checkbox-item span {
  font-size: var(--prism-font-13);
  color: var(--vscode-foreground);
  user-select: none;
}

.price-inputs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.price-input-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.price-label {
  font-size: var(--prism-font-12);
  color: var(--vscode-descriptionForeground);
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--vscode-border);
}

.btn-cancel,
.btn-confirm {
  padding: 8px 16px;
  border-radius: 10px;
  font-size: var(--prism-font-13);
  font-weight: 500;
  cursor: pointer;
  touch-action: manipulation;
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    color 120ms ease,
    transform 120ms cubic-bezier(0.22, 1, 0.36, 1);
  border: 1px solid transparent;
}

.btn-cancel {
  background: transparent;
  border-color: var(--vscode-border);
  color: var(--vscode-fg-muted);
}

.btn-confirm {
  background: var(--vscode-accent);
  color: var(--vscode-button-foreground);
  border-color: var(--vscode-accent);
}

.dialog-close:focus-visible,
.btn-cancel:focus-visible,
.btn-confirm:focus-visible {
  outline: 2px solid var(--vscode-accent);
  outline-offset: 3px;
}

.checkbox-item:focus-within {
  background: var(--vscode-list-hoverBackground);
}

@media (hover: hover) and (pointer: fine) {
  .dialog-close:hover,
  .btn-cancel:hover,
  .checkbox-item:hover {
    background: var(--vscode-list-hoverBackground);
    transition-duration: 0ms;
  }

  .btn-confirm:hover {
    background: var(--vscode-accent-hover);
    border-color: var(--vscode-accent-hover);
    transition-duration: 0ms;
  }
}

@media (prefers-reduced-motion: reduce) {
  .model-dialog-enter-active,
  .model-dialog-leave-active {
    transition-duration: 100ms;
  }

  .model-dialog-enter-active .dialog-container,
  .model-dialog-leave-active .dialog-container,
  .dialog-close,
  .dialog-close:active,
  .btn-cancel,
  .btn-cancel:active,
  .btn-confirm,
  .btn-confirm:active {
    transition-property: background-color, border-color, color;
    transform: none;
  }
}

html[data-motion='off'] .dialog-overlay,
html[data-transitions='off'] .dialog-overlay,
html[data-motion='off'] .dialog-overlay *,
html[data-transitions='off'] .dialog-overlay * {
  transition: none !important;
}

html[data-motion='off'] .dialog-container,
html[data-transitions='off'] .dialog-container,
html[data-motion='off'] .dialog-close,
html[data-transitions='off'] .dialog-close,
html[data-motion='off'] .btn-cancel,
html[data-transitions='off'] .btn-cancel,
html[data-motion='off'] .btn-confirm,
html[data-transitions='off'] .btn-confirm {
  transform: none !important;
}
</style>
