import test from 'node:test'
import assert from 'node:assert/strict'
import { SSHExecOutput } from './ssh-exec-output'

test('SSH output preserves UTF-8 characters split between packets', () => {
  const output = new SSHExecOutput()
  const bytes = Buffer.from('状态正常\n')
  output.append('stdout', bytes.subarray(0, 2))
  output.append('stdout', bytes.subarray(2))
  output.append('stderr', Buffer.from('warning\n'))
  assert.deepEqual(output.snapshot(), { stdout: '状态正常\n', stderr: 'warning\n', truncated: false })
})

test('SSH output bounds total retained bytes across stdout and stderr and drains later packets', () => {
  const output = new SSHExecOutput(10)
  output.append('stdout', Buffer.from('12345'))
  output.append('stderr', Buffer.from('678901234'))
  for (let packet = 0; packet < 100; packet++) output.append('stdout', Buffer.alloc(4096, 'x'))
  assert.deepEqual(output.snapshot(), { stdout: '12345', stderr: '67890', truncated: true })
})

test('SSH output omits a truncated UTF-8 tail without inserting a broken character', () => {
  const output = new SSHExecOutput(5)
  output.append('stdout', Buffer.from('状态正常'))
  assert.deepEqual(output.snapshot(), { stdout: '状', stderr: '', truncated: true })
})
