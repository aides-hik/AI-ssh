import * as monaco from 'monaco-editor'
import { themeService } from '@/services/theme.service'
import monacoGlassCss from '@/assets/styles/monaco-glass.css?inline'

const themeSignatures = new Map<string, string>()

/** Monaco accepts hex colors, while Prism tokens may contain color-mix/rgb/alpha. */
function resolveColors(values: Record<string, string>): Record<string, string> {
  const probe = document.createElement('span')
  probe.hidden = true
  document.documentElement.appendChild(probe)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  try {
    return Object.fromEntries(
      Object.entries(values).map(([name, value]) => {
        probe.style.color = value
        const resolved = getComputedStyle(probe).color
        if (!context) throw new Error('Canvas color resolution is unavailable')
        context.clearRect(0, 0, 1, 1)
        context.fillStyle = resolved
        context.fillRect(0, 0, 1, 1)
        const rgba = context.getImageData(0, 0, 1, 1).data
        return [
          name,
          `#${Array.from(rgba, channel => channel.toString(16).padStart(2, '0')).join('')}`
        ]
      })
    )
  } finally {
    probe.remove()
  }
}

export function applyPrismMonacoTheme(): string {
  const dark = themeService.isDarkTheme()
  const name = dark ? 'prism-editor-dark' : 'prism-editor-light'
  const colors = resolveColors({
    surface: 'var(--prism-surface-floating)',
    control: 'var(--prism-control)',
    foreground: 'var(--prism-text)',
    muted: 'var(--prism-muted)',
    border: 'var(--prism-border)',
    rim: 'var(--liquid-rim)',
    accent: 'var(--vscode-accent)',
    hover: 'var(--vscode-list-hoverBackground)',
    selected: 'var(--liquid-selected)',
    shadow: 'var(--liquid-shadow)',
    danger: 'var(--prism-danger)',
    dangerBackground: 'color-mix(in srgb, var(--prism-danger) 12%, var(--prism-surface-raised))',
    warning: 'var(--prism-warning)',
    warningBackground: 'color-mix(in srgb, var(--prism-warning) 12%, var(--prism-surface-raised))',
    infoBackground: 'color-mix(in srgb, var(--prism-info) 12%, var(--prism-surface-raised))'
  })
  const signature = JSON.stringify(colors)
  if (themeSignatures.get(name) !== signature) {
    const uiColors: Record<string, string> = {
      foreground: colors.foreground,
      disabledForeground: colors.muted,
      focusBorder: colors.accent,
      'icon.foreground': colors.muted,
      'widget.shadow': colors.shadow,
      'widget.border': colors.rim,
      'editorWidget.background': colors.surface,
      'editorWidget.foreground': colors.foreground,
      'editorWidget.border': colors.rim,
      'editorWidget.resizeBorder': colors.accent,
      'menu.background': colors.surface,
      'menu.foreground': colors.foreground,
      'menu.border': colors.rim,
      'menu.selectionBackground': colors.hover,
      'menu.selectionForeground': colors.foreground,
      'menu.selectionBorder': colors.accent,
      'menu.separatorBackground': colors.border,
      'input.background': colors.control,
      'input.foreground': colors.foreground,
      'input.border': colors.border,
      'input.placeholderForeground': colors.muted,
      'inputOption.activeBackground': colors.selected,
      'inputOption.activeForeground': colors.accent,
      'inputOption.activeBorder': colors.accent,
      'inputOption.hoverBackground': colors.hover,
      'inputValidation.errorBackground': colors.dangerBackground,
      'inputValidation.errorForeground': colors.danger,
      'inputValidation.errorBorder': colors.danger,
      'inputValidation.warningBackground': colors.warningBackground,
      'inputValidation.warningForeground': colors.warning,
      'inputValidation.warningBorder': colors.warning,
      'inputValidation.infoBackground': colors.infoBackground,
      'inputValidation.infoForeground': colors.foreground,
      'inputValidation.infoBorder': colors.accent,
      'list.hoverBackground': colors.hover,
      'list.hoverForeground': colors.foreground,
      'list.focusBackground': colors.selected,
      'list.focusForeground': colors.foreground,
      'list.focusOutline': colors.accent,
      'list.activeSelectionBackground': colors.selected,
      'list.activeSelectionForeground': colors.foreground,
      'list.inactiveSelectionBackground': colors.hover,
      'list.inactiveSelectionForeground': colors.foreground,
      'list.highlightForeground': colors.accent,
      'list.focusHighlightForeground': colors.accent,
      'quickInput.background': colors.surface,
      'quickInput.foreground': colors.foreground,
      'quickInputTitle.background': colors.selected,
      'quickInputList.focusBackground': colors.selected,
      'quickInputList.focusForeground': colors.foreground,
      'quickInputList.focusIconForeground': colors.accent,
      'quickInputList.focusHighlightForeground': colors.accent,
      'editorHoverWidget.background': colors.surface,
      'editorHoverWidget.foreground': colors.foreground,
      'editorHoverWidget.border': colors.rim,
      'editorHoverWidget.statusBarBackground': colors.selected,
      'editorSuggestWidget.background': colors.surface,
      'editorSuggestWidget.foreground': colors.foreground,
      'editorSuggestWidget.border': colors.rim,
      'editorSuggestWidget.selectedBackground': colors.selected,
      'editorSuggestWidget.selectedForeground': colors.foreground,
      'editorSuggestWidget.selectedIconForeground': colors.accent,
      'editorSuggestWidget.highlightForeground': colors.accent,
      'editorSuggestWidget.focusHighlightForeground': colors.accent,
      'editorSuggestWidget.focusOutline': colors.accent,
      'editorSuggestWidgetStatus.foreground': colors.muted,
      'keybindingLabel.background': colors.control,
      'keybindingLabel.foreground': colors.muted,
      'keybindingLabel.border': colors.border,
      'keybindingLabel.bottomBorder': colors.border,
      'toolbar.hoverBackground': colors.hover,
      'toolbar.activeBackground': colors.selected
    }
    // Inherit code colors and token rules from Monaco's readable base themes.
    monaco.editor.defineTheme(name, {
      base: dark ? 'vs-dark' : 'vs',
      inherit: true,
      rules: [],
      colors: uiColors
    })
    themeSignatures.set(name, signature)
  }
  return name
}

export function observePrismMonacoTheme(editor: monaco.editor.IStandaloneCodeEditor): () => void {
  let frame = 0
  const sync = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      editor.updateOptions({ theme: applyPrismMonacoTheme() })
    })
  }
  // Accent changes update root inline tokens without emitting theme-changed.
  const observer = new MutationObserver(sync)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style']
  })
  window.addEventListener('theme-changed', sync)
  // Monaco keeps context menus in its own shadow tree. Theme colors inherit, but
  // app selectors do not cross that boundary; reuse the exact same chrome sheet.
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(monacoGlassCss)
  const roots = new Set<ShadowRoot>()
  const attachMenus = () => {
    // Monaco assigns a native title only when the find count reaches its cap.
    // Preserve its text/ARIA and use the same delegated tooltip as other chrome.
    editor
      .getDomNode()
      ?.querySelectorAll<HTMLElement>('.find-widget .matchesCount[title]')
      .forEach(count => {
        const title = count.getAttribute('title')
        if (title) count.dataset.prismTooltip = title
        else delete count.dataset.prismTooltip
        count.removeAttribute('title')
      })
    editor
      .getDomNode()
      ?.querySelectorAll('.shadow-root-host')
      .forEach(host => {
        const root = host.shadowRoot
        if (!root || roots.has(root)) return
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
        roots.add(root)
      })
  }
  const menus = new MutationObserver(attachMenus)
  const node = editor.getDomNode()
  if (node)
    menus.observe(node, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['title']
    })
  attachMenus()
  return () => {
    observer.disconnect()
    menus.disconnect()
    roots.forEach(root => {
      root.adoptedStyleSheets = root.adoptedStyleSheets.filter(value => value !== sheet)
    })
    window.removeEventListener('theme-changed', sync)
    if (frame) cancelAnimationFrame(frame)
  }
}
