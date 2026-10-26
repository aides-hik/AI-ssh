<template>
  <Teleport to="body">
    <div
      v-if="visible && suggestions.length > 0"
      ref="popupRef"
      class="autocomplete-popup"
      :style="popupStyle"
    >
      <div class="autocomplete-header">
        <span class="autocomplete-title">
          <span class="icon">✨</span>
          建议 ({{ suggestions.length }})
        </span>
        <span class="autocomplete-hint">
          <kbd>↑</kbd><kbd>↓</kbd> 选择
          <kbd>Tab</kbd> 插入
          <kbd>Esc</kbd> 关闭
        </span>
      </div>

      <div class="autocomplete-list" ref="listRef">
        <div
          v-for="(suggestion, index) in suggestions"
          :key="index"
          class="autocomplete-item"
          :class="{
            'active': index === selectedIndex,
            [`type-${suggestion.type}`]: true
          }"
          @mouseenter="selectedIndex = index"
          @click="selectSuggestion(suggestion)"
        >
          <span class="item-icon" v-if="suggestion.icon">{{ suggestion.icon }}</span>
          <span class="item-name">{{ suggestion.name }}</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Suggestion } from '@/types/autocomplete'

interface Props {
  suggestions: Suggestion[]
  visible: boolean
  position: { x: number; y: number }
}

interface Emits {
  (e: 'select', suggestion: Suggestion): void
  (e: 'close'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const popupRef = ref<HTMLElement>()
const listRef = ref<HTMLElement>()
const selectedIndex = ref(-1) // -1 表示无选中

const popupStyle = computed(() => ({
  left: `${props.position.x}px`,
  top: `${props.position.y}px`
}))

// 暴露弹窗的实际高度给父组件
function getPopupHeight(): number {
  if (!popupRef.value) return 0
  return popupRef.value.offsetHeight
}

// 监听建议列表变化,重置为无选中状态
watch(() => props.suggestions, () => {
  selectedIndex.value = -1 // 默认不选中任何项
})

// 监听可见性变化
watch(() => props.visible, (visible) => {
  if (visible) {
    selectedIndex.value = -1 // 默认不选中任何项
  }
})

/**
 * 选择建议
 */
function selectSuggestion(suggestion: Suggestion) {
  emit('select', suggestion)
}

/**
 * 向上移动选择
 */
function moveUp() {
  if (selectedIndex.value === -1) {
    // 如果没有选中,从最后一项开始
    selectedIndex.value = props.suggestions.length - 1
  } else if (selectedIndex.value > 0) {
    selectedIndex.value--
  }
  scrollToSelected()
}

/**
 * 向下移动选择
 */
function moveDown() {
  if (selectedIndex.value === -1) {
    // 如果没有选中,从第一项开始
    selectedIndex.value = 0
  } else if (selectedIndex.value < props.suggestions.length - 1) {
    selectedIndex.value++
  }
  scrollToSelected()
}

/**
 * 选择当前项 (Tab 键)
 * 注意：Enter 键不应该在这里处理，应该让终端正常处理
 */
function selectCurrent() {
  // 只有当有选中项时才执行
  if (selectedIndex.value !== -1 && props.suggestions[selectedIndex.value]) {
    selectSuggestion(props.suggestions[selectedIndex.value])
  }
  // 如果没有选中项，不做任何操作（让 Enter 键正常提交命令）
}

/**
 * 滚动到选中项
 */
function scrollToSelected() {
  if (!listRef.value) return

  const items = listRef.value.querySelectorAll('.autocomplete-item')
  const selectedItem = items[selectedIndex.value] as HTMLElement

  if (selectedItem) {
    selectedItem.scrollIntoView({
      block: 'nearest',
      behavior: 'instant'
    })
  }
}

/**
 * 获取类型标签
 */

/**
 * 检查是否有选中项
 */
function hasSelection(): boolean {
  return selectedIndex.value !== -1
}

// 暴露方法给父组件
defineExpose({
  moveUp,
  moveDown,
  selectCurrent,
  getPopupHeight,
  hasSelection
})
</script>

<style scoped>
.autocomplete-popup {
  position: fixed;
  z-index: 9999;
  background: var(--prism-surface);
  border: 1px solid var(--liquid-rim);
  border-radius: 14px;
  box-shadow: var(--prism-shadow);
  min-width: min(300px, calc(100vw - 24px));
  max-width: min(500px, calc(100vw - 24px));
  max-height: 320px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: var(--prism-font);
  backdrop-filter: blur(24px) saturate(1.3);
  color: var(--prism-text);
}

.autocomplete-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: transparent;
  border-bottom: 1px solid var(--prism-border);
  font-size: var(--prism-font-12);
  gap: 10px;
  flex-wrap: wrap;
}

.autocomplete-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--prism-text);
  font-weight: 500;
}

.autocomplete-title .icon {
  font-size: var(--prism-font-14);
}

.autocomplete-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--vscode-descriptionForeground);
  font-size: var(--prism-font-11);
}

.autocomplete-hint kbd {
  padding: 2px 6px;
  background: var(--prism-control);
  border: 1px solid var(--prism-border);
  border-radius: var(--prism-radius-small);
  color: var(--vscode-keybindingLabel-foreground);
  font-family: monospace;
  font-size: var(--prism-font-10);
  line-height: 1;
}

.autocomplete-list {
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px;
}

.autocomplete-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  transition: background-color 0.1s;
  border-left: 2px solid transparent;
  min-height: 32px;
  border-radius: var(--prism-radius-small);
}

.autocomplete-item:hover,
.autocomplete-item.active {
  background: var(--vscode-list-hoverBackground);
  border-left-color: var(--vscode-accent);
}

.item-icon {
  font-size: var(--prism-font-14);
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}

.item-name {
  color: var(--prism-text);
  font-family: var(--vscode-editor-font-family, 'Courier New', monospace);
  font-size: var(--prism-font-12);
  font-weight: 400;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.item-type {
  padding: 2px 8px;
  border-radius: var(--prism-radius-small);
  font-size: var(--prism-font-10);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.type-badge-subcommand {
  background: var(--prism-success-bg);
  color: var(--prism-success);
}

.type-badge-option {
  background: var(--prism-info-bg);
  color: var(--prism-info);
}

.type-badge-arg {
  background: var(--prism-warning-bg);
  color: var(--prism-warning);
}

.type-badge-file {
  background: var(--prism-info-bg);
  color: var(--prism-info);
}

.type-badge-folder {
  background: var(--prism-warning-bg);
  color: var(--prism-warning);
}

.type-badge-special {
  background: var(--prism-control);
  color: var(--prism-muted);
}

.item-description {
  grid-column: 2 / 4;
  color: var(--vscode-descriptionForeground);
  font-size: var(--prism-font-11);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: -4px;
}

/* 滚动条样式 */
.autocomplete-list::-webkit-scrollbar {
  width: 10px;
}

.autocomplete-list::-webkit-scrollbar-track {
  background: transparent;
}

.autocomplete-list::-webkit-scrollbar-thumb {
  background: var(--prism-border);
  border-radius: 5px;
}

.autocomplete-list::-webkit-scrollbar-thumb:hover {
  background: var(--prism-muted);
}
</style>

