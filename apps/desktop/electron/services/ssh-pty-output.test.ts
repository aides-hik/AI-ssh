import test from 'node:test'
import assert from 'node:assert/strict'
import { SSHPTYOutput } from './ssh-pty-output'

test('PTY output preserves Chinese, emoji and ANSI sequences split at every byte boundary', () => {
  const expected = '\u001b[32m中文目录 😀 /测试\u001b[0m\r\n'
  const chunks: string[] = []
  const output = new SSHPTYOutput((_stream, text) => chunks.push(text))
  for (const byte of Buffer.from(expected)) output.write('stdout', Buffer.from([byte]))
  output.end('stdout')
  assert.equal(chunks.join(''), expected)
  assert(chunks.every(Boolean))
})

test('interleaved PTY stdout and stderr keep independent decoder states', () => {
  const chunks = { stdout: '', stderr: '' }
  const output = new SSHPTYOutput((stream, text) => { chunks[stream] += text })
  const stdout = Buffer.from('中😀')
  const stderr = Buffer.from('错❌')
  for (let index = 0; index < Math.max(stdout.length, stderr.length); index++) {
    if (index < stdout.length) output.write('stdout', stdout.subarray(index, index + 1))
    if (index < stderr.length) output.write('stderr', stderr.subarray(index, index + 1))
  }
  output.end('stdout')
  output.end('stderr')
  assert.deepEqual(chunks, { stdout: '中😀', stderr: '错❌' })
})

test('PTY stream end flushes incomplete bytes once and ignores late data', () => {
  const chunks: string[] = []
  const output = new SSHPTYOutput((_stream, text) => chunks.push(text))
  output.write('stdout', Buffer.from([0xe4, 0xb8]))
  assert.equal(chunks.length, 0)
  output.end('stdout')
  output.end('stdout')
  output.write('stdout', Buffer.from('late'))
  assert.deepEqual(chunks, ['�'])
})
