import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { z } from 'zod'
import { SessionProcessor, type ProcessorConfig, type StreamEvent } from './processor'
import type { AIProvider, AIModel } from '../types/ai-providers'

interface Call {
  id: string
  target?: string
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

function requiredId(id: string | undefined): string {
  assert.ok(id, 'The executor must receive the original tool call ID')
  return id
}

const provider: AIProvider = {
  id: 'openai', name: 'Fixture', description: '', icon: '', website: '',
  endpoint: 'https://fixture.invalid/v1', apiKey: 'fixture-only',
  enabled: true, isDefault: false, models: []
}
const model: AIModel = {
  id: 'fixture', name: 'Fixture', providerId: provider.id, contextWindow: 8192,
  capabilities: { text: true, image: false, functionCall: true, vision: false }
}
const tools = [{
  id: 'inspect',
  init: async () => ({
    description: 'Inspect a fixture host',
    parameters: z.object({ target: z.string().optional() }),
    execute: async () => ({ title: '', metadata: {}, output: '' })
  })
}]

function fixture(context: TestContext, calls: Call[], config: Partial<ProcessorConfig> = {}) {
  const requests: Array<Record<string, unknown>> = []
  const events: StreamEvent[] = []
  context.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)))
    const event = requests.length === 1
      ? { choices: [{ delta: { tool_calls: calls.map((call, index) => ({
          index, id: call.id, type: 'function',
          function: { name: 'inspect', arguments: JSON.stringify({ target: call.target }) }
        })) }, finish_reason: 'tool_calls' }] }
      : { choices: [{ delta: { content: 'Summary' }, finish_reason: 'stop' }] }
    return new Response(`data: ${JSON.stringify(event)}\n\n`)
  })
  const processor = new SessionProcessor({
    provider, model, tools, messages: [{ role: 'user', content: 'Inspect selected hosts' }],
    toolConcurrency: 3, toolExecutionKey: (_name, input) => input.target,
    ...config,
    onEvent: event => { events.push(event); config.onEvent?.(event) }
  })
  return { processor, requests, events }
}

test('host tools overlap up to the configured limit, then fill free slots', { timeout: 3000 }, async context => {
  const calls = ['a', 'b', 'c', 'd'].map(id => ({ id, target: id }))
  const started = Object.fromEntries(calls.map(call => [call.id, deferred()]))
  const release = Object.fromEntries(calls.map(call => [call.id, deferred()]))
  let active = 0
  let peak = 0
  const starts: string[] = []
  const { processor, events } = fixture(context, calls, {
    toolConcurrency: 2,
    onToolExecute: async (_name, _input, id) => {
      const key = requiredId(id)
      active++
      peak = Math.max(peak, active)
      starts.push(key)
      started[key].resolve()
      await release[key].promise
      active--
      return { output: key }
    }
  })
  const pending = processor.process()
  await Promise.all([started.a.promise, started.b.promise])
  assert.deepEqual(starts, ['a', 'b'])
  assert.equal(events.filter(event => event.type === 'tool-call').length, 4)
  assert.equal(events.filter(event => event.type === 'tool-start').length, 2)
  release.b.resolve()
  await started.c.promise
  assert.deepEqual(starts, ['a', 'b', 'c'])
  release.c.resolve()
  await started.d.promise
  release.d.resolve()
  release.a.resolve()
  await pending
  assert.equal(peak, 2)
})

test('steps on one host remain ordered while another host runs independently', { timeout: 3000 }, async context => {
  const aOne = deferred()
  const aTwo = deferred()
  const bOne = deferred()
  const releaseA = deferred()
  const releaseB = deferred()
  const starts: string[] = []
  const { processor } = fixture(context, [
    { id: 'a1', target: 'a' }, { id: 'a2', target: 'a' }, { id: 'b1', target: 'b' }
  ], {
    onToolExecute: async (_name, _input, id) => {
      starts.push(requiredId(id))
      if (id === 'a1') { aOne.resolve(); await releaseA.promise }
      if (id === 'a2') aTwo.resolve()
      if (id === 'b1') { bOne.resolve(); await releaseB.promise }
      return { output: requiredId(id) }
    }
  })
  const pending = processor.process()
  await Promise.all([aOne.promise, bOne.promise])
  assert.deepEqual(starts, ['a1', 'b1'])
  releaseA.resolve()
  await aTwo.promise
  assert.deepEqual(starts, ['a1', 'b1', 'a2'])
  releaseB.resolve()
  await pending
})

test('unkeyed tools form an exclusive barrier before later host work', { timeout: 3000 }, async context => {
  const started = Object.fromEntries(['a', 'b', 'barrier', 'c'].map(id => [id, deferred()]))
  const release = Object.fromEntries(['a', 'b', 'barrier', 'c'].map(id => [id, deferred()]))
  const starts: string[] = []
  const { processor } = fixture(context, [
    { id: 'a', target: 'a' }, { id: 'b', target: 'b' },
    { id: 'barrier' }, { id: 'c', target: 'c' }
  ], {
    onToolExecute: async (_name, _input, id) => {
      const key = requiredId(id)
      starts.push(key)
      started[key].resolve()
      await release[key].promise
      return { output: key }
    }
  })
  const pending = processor.process()
  await Promise.all([started.a.promise, started.b.promise])
  release.a.resolve()
  await Promise.resolve()
  assert.deepEqual(starts, ['a', 'b'])
  release.b.resolve()
  await started.barrier.promise
  assert.deepEqual(starts, ['a', 'b', 'barrier'])
  release.barrier.resolve()
  await started.c.promise
  release.c.resolve()
  await pending
})

test('completion events are immediate but model outputs retain the original call order', { timeout: 3000 }, async context => {
  const bStarted = deferred()
  const releaseA = deferred()
  const bCompleted = deferred()
  const { processor, events, requests } = fixture(context, [
    { id: 'a', target: 'a' }, { id: 'b', target: 'b' }
  ], {
    onToolExecute: async (_name, _input, id) => {
      if (id === 'a') await releaseA.promise
      else bStarted.resolve()
      return { output: `${id} output` }
    },
    onEvent: event => { if (event.type === 'tool-result' && event.toolCallId === 'b') bCompleted.resolve() }
  })
  const pending = processor.process()
  await Promise.all([bStarted.promise, bCompleted.promise])
  assert.deepEqual(events.filter(event => event.type === 'tool-result').map(event => event.toolCallId), ['b'])
  assert.equal(requests.length, 1)
  releaseA.resolve()
  const result = await pending
  assert.deepEqual(events.filter(event => event.type === 'tool-result').map(event => event.toolCallId), ['b', 'a'])
  assert.deepEqual(result.messages?.filter(message => message.role === 'tool').map(message => message.tool_call_id), ['a', 'b'])
  assert.deepEqual((requests[1].messages as Array<{ role: string; tool_call_id?: string }>).filter(message => message.role === 'tool').map(message => message.tool_call_id), ['a', 'b'])
})

for (const errorName of ['Error', 'AbortError']) {
  test(`a host ${errorName} leaves independent hosts running and reaches a summary`, { timeout: 3000 }, async context => {
    const executed: string[] = []
    const { processor, events } = fixture(context, [
      { id: 'a', target: 'a' }, { id: 'b', target: 'b' }, { id: 'c', target: 'c' }
    ], {
      onToolExecute: async (_name, _input, id) => {
        executed.push(requiredId(id))
        if (id === 'a') { const error = new Error('Host stopped'); error.name = errorName; throw error }
        return { output: `${id} completed` }
      }
    })
    const result = await processor.process()
    assert.deepEqual(executed, ['a', 'b', 'c'])
    assert.equal(result.finish, 'stop')
    assert.equal(processor.isAborted(), false)
    assert.deepEqual(events.filter(event => event.type === 'tool-error').map(event => event.toolCallId), ['a'])
    assert.deepEqual(result.messages?.filter(message => message.role === 'tool').map(message => message.content), ['Host stopped', 'b completed', 'c completed'])
    assert.equal(result.messages?.at(-1)?.content, 'Summary')
  })
}

test('global cancellation stops queued work and waits for all in-flight tools to settle', { timeout: 3000 }, async context => {
  const controller = new AbortController()
  const aStarted = deferred()
  const bStarted = deferred()
  const releaseA = deferred()
  const releaseB = deferred()
  const executed: string[] = []
  let settled = false
  const { processor, requests } = fixture(context, [
    { id: 'a1', target: 'a' }, { id: 'a2', target: 'a' },
    { id: 'b1', target: 'b' }, { id: 'c1', target: 'c' }
  ], {
    toolConcurrency: 2, abortSignal: controller.signal,
    onToolExecute: async (_name, _input, id) => {
      executed.push(requiredId(id))
      if (id === 'a1') { aStarted.resolve(); await releaseA.promise }
      if (id === 'b1') { bStarted.resolve(); await releaseB.promise }
      return { output: `${id} finished` }
    }
  })
  const pending = processor.process().finally(() => { settled = true })
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  await Promise.all([aStarted.promise, bStarted.promise])
  controller.abort()
  releaseA.resolve()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(settled, false)
  releaseB.resolve()
  await rejected
  assert.deepEqual(executed, ['a1', 'b1'])
  assert.equal(requests.length, 1)
  assert.equal(processor.isAborted(), true)
  assert.deepEqual(processor.getMessages().filter(message => message.role === 'tool').map(message => message.tool_call_id), ['a1', 'b1'])
})

test('the default remains serial in original order and legacy tool cancellation ends the turn', { timeout: 3000 }, async context => {
  const executed: string[] = []
  const { processor, requests } = fixture(context, [
    { id: 'a1', target: 'a' }, { id: 'b1', target: 'b' }, { id: 'a2', target: 'a' }
  ], {
    toolConcurrency: undefined, toolExecutionKey: undefined,
    onToolExecute: async (_name, _input, id) => {
      executed.push(requiredId(id))
      if (id === 'b1') { const error = new Error('Command aborted'); error.name = 'AbortError'; throw error }
      return { output: requiredId(id) }
    }
  })
  await assert.rejects(processor.process(), { name: 'AbortError' })
  assert.deepEqual(executed, ['a1', 'b1'])
  assert.equal(requests.length, 1)
})
