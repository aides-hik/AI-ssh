import assert from 'node:assert/strict'
import test from 'node:test'
import { bindTerminalSelection } from './terminal-selection.ts'

test('terminal selection changes update menu state and stop after disposal', () => {
  let selected = false
  let listener: (() => void) | undefined
  const values: boolean[] = []
  const subscription = bindTerminalSelection({
    hasSelection: () => selected,
    onSelectionChange: callback => {
      listener = callback
      return { dispose: () => { listener = undefined } }
    }
  }, value => values.push(value))

  selected = true
  listener?.()
  selected = false
  listener?.()
  assert.deepEqual(values, [false, true, false])

  subscription.dispose()
  selected = true
  listener?.()
  assert.deepEqual(values, [false, true, false])
})
