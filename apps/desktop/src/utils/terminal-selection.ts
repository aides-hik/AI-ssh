interface TerminalSelectionSource {
  hasSelection(): boolean
  onSelectionChange(listener: () => void): { dispose(): void }
}

export function bindTerminalSelection(
  terminal: TerminalSelectionSource,
  update: (selected: boolean) => void
): { dispose(): void } {
  const syncSelection = () => update(terminal.hasSelection())
  syncSelection()
  return terminal.onSelectionChange(syncSelection)
}
