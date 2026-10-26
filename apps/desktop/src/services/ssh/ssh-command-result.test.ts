import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSSHCommandResult } from './ssh-command-result'

test('exit zero keeps stderr diagnostics without marking a command failed', () => {
  const result = normalizeSSHCommandResult({ success: true, stdout: 'ok\n', stderr: 'warning\n', exitCode: 0, durationMs: 42, truncated: true })
  assert.deepEqual(result, { success: true, output: 'ok\n', stdout: 'ok\n', stderr: 'warning\n', exitCode: 0, durationMs: 42, truncated: true })
})

test('nonzero, missing and signalled exit statuses remain failures even with empty stderr', () => {
  for (const data of [{ exitCode: 17 }, { exitCode: null }, { exitCode: 0, signal: 'TERM' }]) {
    const result = normalizeSSHCommandResult({ success: true, output: 'partial', ...data })
    assert.equal(result.success, false)
    assert(result.error)
    assert.equal(result.output, 'partial')
  }
})

test('legacy responses remain usable without treating stderr as an execution error', () => {
  assert.deepEqual(normalizeSSHCommandResult('legacy output'), { success: true, output: 'legacy output' })
  assert.equal(normalizeSSHCommandResult({ success: true, output: 'legacy', stderr: 'diagnostic' }).success, true)
  assert.equal(normalizeSSHCommandResult({ success: false, error: 'disconnected' }).error, 'disconnected')
  assert.equal(normalizeSSHCommandResult(undefined).success, false)
})
