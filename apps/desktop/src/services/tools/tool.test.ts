import assert from 'node:assert/strict'
import test from 'node:test'
import z from 'zod'
import { Tool, type Context } from './tool'

const context: Context = {
  sessionID: 'session', messageID: 'message', agent: 'fixture',
  abort: new AbortController().signal, metadata() {}
}

test('tool execution uses parsed defaults, transformations and stripped fields without changing caller input', async () => {
  let executed: unknown
  const tool = await Tool.define('fixture', async () => ({
    description: 'Fixture with real schema conversions',
    parameters: z.object({
      name: z.string().trim(), count: z.number().default(3),
      mode: z.string().transform(value => value.toUpperCase())
    }),
    execute: async parameters => {
      executed = parameters
      return { title: '', metadata: {}, output: 'done' }
    }
  })).init()
  const input = { name: '  selected  ', mode: 'read', unregistered: 'must not reach execution' }
  await tool.execute(input, context)
  assert.deepEqual(executed, { name: 'selected', count: 3, mode: 'READ' })
  assert.deepEqual(input, { name: '  selected  ', mode: 'read', unregistered: 'must not reach execution' })
})

test('invalid tool parameters never enter the implementation', async () => {
  let executed = false
  const tool = await Tool.define('fixture', async () => ({
    description: '', parameters: z.object({ count: z.number().int().min(1) }),
    execute: async () => {
      executed = true
      return { title: '', metadata: {}, output: '' }
    }
  })).init()
  await assert.rejects(tool.execute({ count: 0 }, context), /fixture.*invalid arguments/)
  assert.equal(executed, false)
})

test('cancellation while a tool initializes prevents its implementation from starting', async () => {
  const controller = new AbortController()
  let initialized!: () => void
  const ready = new Promise<void>(resolve => { initialized = resolve })
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  let executions = 0
  const pending = Tool.define('fixture', async () => {
    initialized()
    await waiting
    return {
      description: '', parameters: z.object({}),
      execute: async () => {
        executions++
        return { title: '', metadata: {}, output: 'must not execute' }
      }
    }
  }).init()
  await ready
  controller.abort()
  release()
  const tool = await pending
  await assert.rejects(tool.execute({}, { ...context, abort: controller.signal }), { name: 'AbortError' })
  assert.equal(executions, 0)
})
