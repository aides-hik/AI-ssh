import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import type { AIModel, AIProvider } from '../../types/ai-providers.types'
import type { ProcessorConfig, ProcessorResult } from '../../services/processor'
import { createAssistantMessage, type Message } from '../../services/messages/message'
import { compactMessages, filterCompactedMessages, filterValidMessages, fromUserMessage, type ModelMessage } from '../../services/messages/convert'
import { ProcessorHistory } from '../../services/messages/processor-history'
import { getReasoningCapability, type ReasoningSelection } from '../../utils/model-reasoning'

const currentDir = dirname(fileURLToPath(import.meta.url))
const chatViewPath = join(currentDir, 'AIChatOpenCodeStyle.vue')

async function loadComponentFunctions(names: string[], dependencies: Record<string, unknown> = {}) {
  const source = await readFile(chatViewPath, 'utf8')
  const script = source.slice(source.indexOf('>') + 1, source.indexOf('</script>'))
  const parsed = ts.createSourceFile('chat.ts', script, ts.ScriptTarget.Latest, true)
  const declarations = names.map(name => {
    const declaration = parsed.statements.find(statement =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name
    )
    assert(declaration, `The actual component function ${name} must exist`)
    return declaration.getText(parsed)
  })
  const javascript = ts.transpileModule(declarations.join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  return new Function(...Object.keys(dependencies), javascript + `\nreturn { ${names.join(', ')} }`)(
    ...Object.values(dependencies)
  ) as Record<string, (...args: unknown[]) => unknown>
}

test('IME confirmation Enter never sends or blocks the composition event', async () => {
  let sends = 0
  let prevented = 0
  const { handleInputKeydown } = await loadComponentFunctions(['handleInputKeydown'], {
    handleSendMessage: () => { sends++ },
    serverEnvMenuOpen: { value: false }
  })
  for (const composition of [{ isComposing: true, keyCode: 13 }, { isComposing: false, keyCode: 229 }]) {
    handleInputKeydown({
      key: 'Enter', ...composition, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
      preventDefault: () => { prevented++ }
    })
  }
  assert.equal(sends, 0)
  assert.equal(prevented, 0)
})

test('Enter submits once while Shift Enter remains available for a new line', async () => {
  let sends = 0
  let prevented = 0
  const { handleInputKeydown } = await loadComponentFunctions(['handleInputKeydown'], {
    handleSendMessage: () => { sends++ },
    serverEnvMenuOpen: { value: false }
  })
  const event = {
    key: 'Enter', isComposing: false, keyCode: 13,
    shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
    preventDefault: () => { prevented++ }
  }
  handleInputKeydown(event)
  assert.equal(sends, 1)
  assert.equal(prevented, 1)
  handleInputKeydown({ ...event, shiftKey: true })
  assert.equal(sends, 1)
  assert.equal(prevented, 1)
})

test('loading earlier messages preserves the visible reading anchor after layout grows', async () => {
  const container = { scrollHeight: 1200, scrollTop: 240 }
  const followLatest = { value: true }
  const isLoadingMore = { value: false }
  const visibleCount = { value: 5 }
  const { loadEarlierMessages } = await loadComponentFunctions(['loadEarlierMessages'], {
    messagesContainer: { value: container }, followLatest, isLoadingMore, visibleCount,
    nextTick: async () => { container.scrollHeight = 1780 }
  })
  await loadEarlierMessages()
  assert.equal(container.scrollTop, 820)
  assert.equal(container.scrollHeight - container.scrollTop, 960)
  assert.equal(visibleCount.value > 5, true)
  assert.equal(followLatest.value, false)
  assert.equal(isLoadingMore.value, false)
})

test('a second history load cannot race the pending layout update', async () => {
  const isLoadingMore = { value: false }
  const visibleCount = { value: 5 }
  let finishLayout: (() => void) | undefined
  const { loadEarlierMessages } = await loadComponentFunctions(['loadEarlierMessages'], {
    messagesContainer: { value: { scrollHeight: 1200, scrollTop: 240 } },
    followLatest: { value: true }, isLoadingMore, visibleCount,
    nextTick: () => new Promise<void>(resolve => { finishLayout = resolve })
  })
  const pending = loadEarlierMessages()
  assert.equal(isLoadingMore.value, true)
  const firstVisibleCount = visibleCount.value
  await loadEarlierMessages()
  assert.equal(visibleCount.value, firstVisibleCount)
  assert(finishLayout)
  finishLayout()
  await pending
  assert.equal(isLoadingMore.value, false)
})

const statusLabels = {
  stopping: 'Stopping', thinking: 'Thinking', failed: 'Failed', stopped: 'Stopped', done: 'Done'
}

test('user messages and unfinished historical messages do not claim completion', async () => {
  const { messageStatus } = await loadComponentFunctions(['messageStatus'], {
    activeAssistantId: { value: 'active' }, isGenerating: { value: false }, isStopping: { value: false },
    currentStage: { value: 'complete' }, ui: { value: statusLabels }
  })
  assert.equal(messageStatus({ id: 'user', role: 'user', finish: 'stop', blocks: [] }), null)
  assert.equal(messageStatus({ id: 'old', role: 'assistant', blocks: [] }), null)
})

test('only the current assistant reports generation and stopping status', async () => {
  const isStopping = { value: false }
  const { messageStatus } = await loadComponentFunctions(['messageStatus'], {
    activeAssistantId: { value: 'active' }, isGenerating: { value: true }, isStopping,
    currentStage: { value: 'thinking' }, ui: { value: statusLabels }
  })
  const active = { id: 'active', role: 'assistant', blocks: [] }
  const historical = { id: 'old', role: 'assistant', finish: 'stop', blocks: [] }
  assert.deepEqual(messageStatus(active), { label: 'Thinking', kind: 'info' })
  assert.deepEqual(messageStatus(historical), { label: 'Done', kind: 'success' })
  isStopping.value = true
  assert.deepEqual(messageStatus(active), { label: 'Stopping', kind: 'info' })
  assert.deepEqual(messageStatus(historical), { label: 'Done', kind: 'success' })
})

test('the current stopped or failed request cannot appear completed', async () => {
  const currentStage = { value: 'stopped' }
  const { messageStatus } = await loadComponentFunctions(['messageStatus'], {
    activeAssistantId: { value: 'active' }, isGenerating: { value: false }, isStopping: { value: false },
    currentStage, ui: { value: statusLabels }
  })
  const active = { id: 'active', role: 'assistant', finish: 'stop', blocks: [] }
  assert.deepEqual(messageStatus(active), { label: 'Stopped', kind: 'muted' })
  currentStage.value = 'error'
  assert.deepEqual(messageStatus(active), { label: 'Failed', kind: 'error' })
  assert.deepEqual(messageStatus({
    id: 'old', role: 'assistant', finish: 'stop',
    blocks: [{ type: 'tool', toolPart: { state: { status: 'error' } } }]
  }), { label: 'Failed', kind: 'error' })
})

test('stream updates preserve reading position until the user explicitly follows latest', async () => {
  const followLatest = { value: false }
  const container = { scrollHeight: 1400, scrollTop: 220 }
  const frames: Array<() => void> = []
  const { scrollToBottom } = await loadComponentFunctions(['scrollToBottom'], {
    followLatest, messagesContainer: { value: container }, scrollFrame: 0,
    requestAnimationFrame: (callback: () => void) => { frames.push(callback); return frames.length }
  })
  scrollToBottom()
  assert.equal(container.scrollTop, 220)
  assert.equal(frames.length, 0)
  scrollToBottom(true)
  assert.equal(followLatest.value, true)
  assert.equal(frames.length, 1)
  const frame = frames.shift()
  assert(frame)
  frame()
  assert.equal(container.scrollTop, 1400)
})

test('scrolling away before a pending animation frame cancels automatic following', async () => {
  const followLatest = { value: true }
  const container = { scrollHeight: 1400, scrollTop: 220 }
  const frames: Array<() => void> = []
  const { scrollToBottom } = await loadComponentFunctions(['scrollToBottom'], {
    followLatest, messagesContainer: { value: container }, scrollFrame: 0,
    requestAnimationFrame: (callback: () => void) => { frames.push(callback); return frames.length }
  })
  scrollToBottom()
  followLatest.value = false
  const frame = frames.shift()
  assert(frame)
  frame()
  assert.equal(container.scrollTop, 220)
})

async function loadSendHandler(overrides: Record<string, any> = {}) {
  const source = await readFile(chatViewPath, 'utf8')
  const script = source.slice(source.indexOf('>') + 1, source.indexOf('</script>'))
  const parsed = ts.createSourceFile('chat.ts', script, ts.ScriptTarget.Latest, true)
  const declaration = parsed.statements.find(statement =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'handleSendMessage'
  )
  assert(declaration, 'The actual component submit handler must exist')
  const javascript = ts.transpileModule(declaration.getText(parsed), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const state = {
    props: { currentProvider: { id: 'openai' }, currentModel: { id: 'test-model' }, connectionId: 'test-ssh' },
    inputMessage: { value: '  保留这段草稿  ' },
    isGenerating: { value: false },
    activeAssistantId: { value: null as string | null },
    error: { value: null as Error | null },
    statuses: [] as string[],
    requests: [] as string[],
    inputRef: { value: { focus() {} } },
    nextTick: (callback: () => void) => callback(),
    resizeInputHeight() {},
    normalizeUserErrorMessage: (message: string) => message,
    console: { error() {} },
    ...overrides
  }
  const dependencies = {
    ...state,
    setStatus: (_stage: string, message: string) => state.statuses.push(message),
    sendMessageWithTools: overrides.sendMessageWithTools || (async (content: string) => { state.requests.push(content) })
  }
  const run = new Function(...Object.keys(dependencies), javascript + '\nreturn handleSendMessage')(
    ...Object.values(dependencies)
  ) as () => Promise<void>
  return { state, run }
}

test('sending without a model keeps the draft and shows an actionable error', async () => {
  const { state, run } = await loadSendHandler({
    props: { currentProvider: null, currentModel: null, connectionId: 'test-ssh' }
  })
  await run()
  assert.equal(state.inputMessage.value, '  保留这段草稿  ')
  assert.match(state.error.value?.message || '', /选择.*模型/)
  assert.equal(state.requests.length, 0)
})

test('model HTTP errors explain authentication, quota and service failures without displaying response bodies', async () => {
  const source = await readFile(chatViewPath, 'utf8')
  const script = source.slice(source.indexOf('>') + 1, source.indexOf('</script>'))
  const parsed = ts.createSourceFile('chat.ts', script, ts.ScriptTarget.Latest, true)
  const declaration = parsed.statements.find(statement =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'normalizeUserErrorMessage'
  )
  assert(declaration)
  const javascript = ts.transpileModule(declaration.getText(parsed), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText
  const normalize = new Function(javascript + '\nreturn normalizeUserErrorMessage')() as (error: string) => string
  for (const status of [401, 403]) {
    const message = normalize(`HTTP ${status}: forbidden - private response body`)
    assert.match(message, /API Key.*权限/)
    assert.match(message, new RegExp(`HTTP ${status}`))
    assert.doesNotMatch(message, /private response body/)
  }
  assert.match(normalize('HTTP 429: limit'), /检查配额/)
  assert.match(normalize('HTTP 503: unavailable'), /HTTP 503.*模型是否可用/)
})

test('sending without an SSH connection keeps the draft and shows an actionable error', async () => {
  const { state, run } = await loadSendHandler({
    props: { currentProvider: { id: 'openai' }, currentModel: { id: 'test-model' }, connectionId: '' }
  })
  await run()
  assert.equal(state.inputMessage.value, '  保留这段草稿  ')
  assert.match(state.error.value?.message || '', /建立 SSH 连接/)
  assert.equal(state.requests.length, 0)
})

test('model or SSH validation errors do not relabel the previous completed response', async () => {
  for (const props of [
    { currentProvider: null, currentModel: null, connectionId: 'test-ssh' },
    { currentProvider: { id: 'openai' }, currentModel: { id: 'test-model' }, connectionId: '' }
  ]) {
    const activeAssistantId = { value: 'previous-response' as string | null }
    const { state, run } = await loadSendHandler({ props, activeAssistantId })
    await run()
    assert.equal(activeAssistantId.value, null)
    assert(state.error.value)
    const { messageStatus } = await loadComponentFunctions(['messageStatus'], {
      activeAssistantId, isGenerating: state.isGenerating, isStopping: { value: false },
      currentStage: { value: 'error' }, ui: { value: statusLabels }
    })
    assert.deepEqual(messageStatus({
      id: 'previous-response', role: 'assistant', finish: 'stop', blocks: []
    }), { label: 'Done', kind: 'success' })
  }
})

test('request preparation and missing key errors cannot mark the previous response as current', async () => {
  const activeAssistantId = { value: 'previous-response' as string | null }
  const isGenerating = { value: false }
  const currentStage = { value: 'preparing' }
  const { messageStatus } = await loadComponentFunctions(['messageStatus'], {
    activeAssistantId, isGenerating, isStopping: { value: false }, currentStage,
    ui: { value: statusLabels }
  })
  const previous = { id: 'previous-response', role: 'assistant', finish: 'stop', blocks: [] }
  let prepared = false
  const { state, run } = await loadSendHandler({
    activeAssistantId, isGenerating,
    sendMessageWithTools: async () => {
      isGenerating.value = true
      assert.equal(activeAssistantId.value, null)
      assert.deepEqual(messageStatus(previous), { label: 'Done', kind: 'success' })
      prepared = true
      isGenerating.value = false
      throw new Error('未找到 API 密钥配置')
    }
  })
  await run()
  currentStage.value = 'error'
  assert.equal(prepared, true)
  assert.match(state.error.value?.message || '', /API 密钥/)
  assert.equal(activeAssistantId.value, null)
  assert.deepEqual(messageStatus(previous), { label: 'Done', kind: 'success' })
})

test('ignored empty or busy sends keep the current response identity intact', async () => {
  for (const overrides of [
    { inputMessage: { value: '   ' } },
    { isGenerating: { value: true } }
  ]) {
    const activeAssistantId = { value: 'current-response' as string | null }
    const { state, run } = await loadSendHandler({ ...overrides, activeAssistantId })
    await run()
    assert.equal(activeAssistantId.value, 'current-response')
    assert.equal(state.requests.length, 0)
  }
})

test('an unexpected send failure is displayed and restores the submitted draft', async () => {
  const failure = new Error('local fixture failed')
  const { state, run } = await loadSendHandler({
    sendMessageWithTools: async () => { throw failure }
  })
  await run()
  assert.equal(state.error.value, failure)
  assert.equal(state.inputMessage.value, '保留这段草稿')
  assert.equal(state.statuses.at(-1), failure.message)
})

test('a failed request preserves a new draft typed while waiting', async () => {
  const { state, run } = await loadSendHandler()
  const { run: fail } = await loadSendHandler({
    inputMessage: state.inputMessage,
    sendMessageWithTools: async () => {
      state.inputMessage.value = '用户新写的草稿'
      throw new Error('local fixture failed')
    }
  })
  await fail()
  assert.equal(state.inputMessage.value, '用户新写的草稿')
  state.inputMessage.value = '正常发送'
  await run()
  assert.deepEqual(state.requests, ['正常发送'])
  assert.equal(state.inputMessage.value, '')
})

type RequestSettings = { aiProviders: Array<{ id: string; apiKey: string }> }
type ToolExecutionContext = {
  abort: AbortSignal
  sessionID: string
  extra: { connectionId: string; serverEnvDocId: string }
}

async function loadToolSendFixture(getSettings?: () => Promise<RequestSettings>) {
  const provider: AIProvider = {
    id: 'initial-provider', name: 'Initial provider', endpoint: 'https://initial.invalid/v1',
    description: '', icon: '', website: '',
    apiKey: '', enabled: true, isDefault: true, models: []
  }
  const model: AIModel = {
    id: 'gpt-6-astra', name: 'Initial model', providerId: provider.id, contextWindow: 128000,
    capabilities: { text: true, image: false, functionCall: true, vision: false },
    reasoning: { protocol: 'openai', supportedEfforts: ['low', 'high'] }
  }
  const state = {
    props: {
      currentProvider: provider, currentModel: model, connectionId: 'initial-ssh',
      sessionId: 'initial-session', serverEnvDocId: 'initial-env'
    },
    reasoningSelection: { value: 'high' as ReasoningSelection },
    isGenerating: { value: false }, isStopping: { value: false }, stopRequested: { value: false },
    abortController: { value: null as AbortController | null },
    error: { value: null as Error | null }, interruptionState: { value: null },
    activeAssistantId: { value: null as string | null }, messages: { value: [] as Message[] },
    currentStage: { value: 'idle' }, performanceMetrics: { value: {} },
    cachedConnection: { value: { id: 'initial-ssh' } }, cachedServerEnvDoc: { value: null },
    configs: [] as ProcessorConfig[], remembered: [] as Array<{ assistantId: string; messages: ModelMessage[] }>,
    historyReads: [] as Array<{ scope: string; requireOpaqueState: boolean }>,
    toolExecutions: [] as ToolExecutionContext[]
  }
  const history = new ProcessorHistory()
  const hooks = {
    process: async (config: ProcessorConfig): Promise<ProcessorResult> => {
      config.onEvent?.({ type: 'text-delta', delta: 'Completed fixture answer' })
      config.onEvent?.({ type: 'done', finish: 'stop' })
      return {
        finish: 'stop', messages: [
          ...config.messages,
          {
            role: 'assistant', content: 'Completed fixture answer',
            responseItems: [{ type: 'reasoning', id: 'opaque-item', encrypted_content: 'fixture-encrypted-state' }]
          }
        ]
      }
    }
  }
  class StubSessionProcessor {
    constructor(private config: ProcessorConfig) { state.configs.push(config) }
    process() { return hooks.process(this.config) }
  }
  let timerId = 0
  const functions = await loadComponentFunctions([
    'sendMessageWithTools', 'handleStop', 'appendAssistantTextBlock', 'markLastAssistantTextBlockAsSummary'
  ], {
    ...state, getReasoningCapability, createAssistantMessage, fromUserMessage,
    filterValidMessages, filterCompactedMessages, compactMessages,
    settingsService: {
      getSettings: getSettings || (async () => ({ aiProviders: [{ id: provider.id, apiKey: 'initial-key' }] }))
    },
    processorHistory: {
      toModelMessages: (messages: Message[], scope: string, requireOpaqueState: boolean) => {
        state.historyReads.push({ scope, requireOpaqueState })
        return history.toModelMessages(messages, scope, requireOpaqueState)
      },
      remember: (assistantId: string, messages: ModelMessage[]) => {
        state.remembered.push({ assistantId, messages })
        history.remember(assistantId, messages)
      }
    },
    SessionProcessor: StubSessionProcessor,
    SSH_TOOLS: [{
      id: 'fixture-tool',
      init: async () => ({
        execute: async (_input: unknown, context: ToolExecutionContext) => {
          state.toolExecutions.push(context)
          return { output: 'synthetic tool result' }
        }
      })
    }],
    window: { setTimeout: () => ++timerId }, clearTimeout() {},
    nextTick: async () => {}, scrollToBottom() {}, startDurationTimer() {}, stopDurationTimer() {},
    refreshSessionContext: async () => {}, getAdaptiveCompactionLimit: () => 20,
    buildSystemPrompt: () => 'Fixture system prompt', updateStatus() {}, logPerformanceSummary() {},
    captureInterruptionState() {}, normalizeUserErrorMessage: (message: string) => message,
    setStatus: (stage: string) => { state.currentStage.value = stage }, console: { error() {} }
  })
  return { state, history, hooks, send: functions.sendMessageWithTools, stop: functions.handleStop }
}

test('tool requests retain the clicked model and effort across asynchronous settings, then preserve completed processor history', async () => {
  const settings = Promise.withResolvers<RequestSettings>()
  const { state, history, send } = await loadToolSendFixture(() => settings.promise)
  const initialProvider = state.props.currentProvider
  const initialModel = state.props.currentModel
  const pending = send('Initial request')
  assert.equal(state.isGenerating.value, true)
  assert.equal(state.configs.length, 0, 'settings preparation must still be pending')

  initialProvider.endpoint = 'https://mutated.invalid/v1'
  initialModel.capabilities.functionCall = false
  assert(initialModel.reasoning)
  initialModel.reasoning.supportedEfforts?.splice(0, 2, 'none')
  state.props.currentProvider = { ...initialProvider, id: 'different-provider', endpoint: 'https://different.invalid/v1' }
  state.props.currentModel = { ...initialModel, id: 'different-model' }
  state.props.connectionId = 'different-ssh'
  state.props.sessionId = 'different-session'
  state.props.serverEnvDocId = 'different-env'
  state.reasoningSelection.value = 'none'
  settings.resolve({ aiProviders: [
    { id: 'initial-provider', apiKey: 'initial-key' }, { id: 'different-provider', apiKey: 'different-key' }
  ] })
  await pending

  assert.equal(state.configs.length, 1)
  const config = state.configs[0]
  assert.equal(config.provider.id, 'initial-provider')
  assert.equal(config.provider.endpoint, 'https://initial.invalid/v1')
  assert.equal(config.provider.apiKey, 'initial-key')
  assert.equal(config.model.id, 'gpt-6-astra')
  assert.equal(config.model.capabilities.functionCall, true)
  assert.deepEqual(config.model.reasoning && config.model.reasoning.supportedEfforts, ['low', 'high'])
  assert.equal(config.reasoning, 'high')
  assert.equal(config.connectionId, 'initial-ssh')
  assert.equal(config.serverEnvDocId, 'initial-env')
  assert.deepEqual(state.historyReads, [{
    scope: JSON.stringify(['initial-provider', 'https://initial.invalid/v1', 'gpt-6-astra', 'initial-ssh', 'initial-session']),
    requireOpaqueState: true
  }])
  const assistant = state.messages.value.find(message => message.info.role === 'assistant')
  assert(assistant)
  assert.equal(assistant.info.finish, 'stop')
  assert.equal(state.remembered.length, 1)
  assert.equal(state.remembered[0].assistantId, assistant.info.id)
  const replay = history.toModelMessages(state.messages.value, state.historyReads[0].scope, true)
  assert.deepEqual(replay.find(message => message.role === 'assistant')?.responseItems, [
    { type: 'reasoning', id: 'opaque-item', encrypted_content: 'fixture-encrypted-state' }
  ])
  assert.equal(state.isGenerating.value, false)
  assert.equal(state.abortController.value, null)
})

test('stopping clears the controller ref while the processor and tools retain the same aborted request signal', async () => {
  const { state, hooks, send, stop } = await loadToolSendFixture()
  hooks.process = async config => {
    const signal = config.abortSignal
    assert(signal)
    assert.equal(signal, state.abortController.value?.signal)
    config.onEvent?.({ type: 'text-delta', delta: 'Partial answer' })
    stop()
    assert.equal(state.abortController.value, null)
    assert.equal(signal.aborted, true)
    await config.onToolExecute?.('fixture-tool', { synthetic: true })
    assert.equal(state.toolExecutions.length, 1)
    assert.equal(state.toolExecutions[0].abort, signal)
    assert.equal(state.toolExecutions[0].abort.aborted, true)
    assert.equal(state.toolExecutions[0].sessionID, 'initial-session')
    assert.deepEqual(state.toolExecutions[0].extra, { connectionId: 'initial-ssh', serverEnvDocId: 'initial-env' })
    config.onEvent?.({ type: 'done', finish: 'stop' })
    return { finish: 'stop', messages: [...config.messages, { role: 'assistant', content: 'Late result after stop' }] }
  }
  await send('Request that is stopped')
  assert.equal(state.remembered.length, 0, 'a late resolving processor must not retain an aborted turn')
  assert.equal(state.error.value, null)
  assert.equal(state.isGenerating.value, false)
  assert.equal(state.isStopping.value, false)
})

test('failed and aborting processors never remember a partial streamed assistant turn', async () => {
  for (const failure of [new Error('fixture service failure'), new DOMException('fixture cancelled', 'AbortError')]) {
    const { state, hooks, send } = await loadToolSendFixture()
    hooks.process = async config => {
      config.onEvent?.({ type: 'text-delta', delta: 'Unfinished partial answer' })
      throw failure
    }
    if (failure.name === 'AbortError') {
      await send('Cancelled request')
      assert.equal(state.error.value, null)
      assert.equal(state.currentStage.value, 'stopped')
    } else {
      await assert.rejects(async () => send('Failed request'), error => error === failure)
      assert.equal(state.error.value, failure)
      assert.equal(state.currentStage.value, 'error')
    }
    assert(state.messages.value.some(message => message.info.role === 'assistant'))
    assert.equal(state.remembered.length, 0)
    assert.equal(state.abortController.value, null)
    assert.equal(state.isGenerating.value, false)
    assert.equal(state.isStopping.value, false)
  }
})

test('chat input stays editable while generation is in progress', async () => {
  const source = await readFile(chatViewPath, 'utf8')

  assert.doesNotMatch(source, /:disabled="isGenerating"/)
  assert.match(source, /if \(!inputMessage\.value\.trim\(\) \|\| isGenerating\.value\) return/)
})

test('chat stop button shows stopping state and aborted tools render as cancelled', async () => {
  let aborted = 0
  const abortController = { value: { abort: () => { aborted++ } } as { abort(): void } | null }
  const isStopping = { value: false }
  const stopRequested = { value: false }
  const locale = { value: 'en-US' }
  const statuses: string[] = []
  const { handleStop, getToolStatusText } = await loadComponentFunctions(['handleStop', 'getToolStatusText'], {
    abortController, isStopping, stopRequested, locale,
    setStatus: (stage: string) => { statuses.push(stage) }
  })
  handleStop()
  assert.equal(aborted, 1)
  assert.equal(abortController.value, null)
  assert.equal(isStopping.value, true)
  assert.equal(stopRequested.value, true)
  assert.equal(statuses.at(-1), 'stopped')
  assert.equal(getToolStatusText('aborted'), 'Cancelled')
  locale.value = 'zh-CN'
  assert.equal(getToolStatusText('aborted'), '已取消')
})

test('session status panel is collapsed by default', async () => {
  const source = await readFile(chatViewPath, 'utf8')

  assert.match(source, /const sessionStatusExpanded = ref\(false\)/)
})

test('assistant display is built from ordered timeline blocks', async () => {
  const source = await readFile(chatViewPath, 'utf8')

  assert.match(source, /blocks:\s*getOrderedBlocks\(msg\)/)
  assert.match(source, /v-for="block in msg\.blocks"/)
  assert.doesNotMatch(source, /!isThinkingContent\(msg\.content\)/)
  assert.doesNotMatch(source, /getResponseText\(msg\)/)
})

test('stream handler writes explicit analysis inquiry and summary semantics', async () => {
  const source = await readFile(chatViewPath, 'utf8')

  assert.match(source, /appendAssistantTextBlock\(currentMsg, event\.delta\)/)
  assert.match(source, /event\.toolName === 'ask_followup_question'/)
  assert.match(
    source,
    /displayKind:\s*event\.toolName === 'ask_followup_question' \? 'inquiry' : 'tool'/
  )
  assert.match(source, /markLastAssistantTextBlockAsSummary\(currentMsg\)/)
})

test('inquiry and summary use response shell while tools stay in timeline', async () => {
  const source = await readFile(chatViewPath, 'utf8')

  assert.match(source, /v-if="block\.type === 'analysis'"/)
  assert.match(source, /v-else-if="block\.type === 'tool' && block\.toolPart"/)
  assert.match(
    source,
    /v-else-if="\(block\.type === 'inquiry' \|\| block\.type === 'summary'\) && block\.text"/
  )
  assert.match(source, /block\.type === 'inquiry' \? '询问' : '总结'/)
  assert.match(source, /copyResponse\(block\.text\)/)
})

test('active SSH chat system prompt forbids interactive shell commands', async () => {
  const source = await readFile(chatViewPath, 'utf8')

  assert.match(source, /SSH command execution rules:/)
  assert.match(source, /All SSH commands must be non-interactive and one-shot\./)
  assert.match(
    source,
    /Never run interactive programs like vim, nano, less, more, top, htop, watch, mysql, psql, or ssh\./
  )
  assert.match(
    source,
    /Never run commands that wait indefinitely for input or stream forever, such as tail -f, journalctl -f, docker logs -f, or read\./
  )
  assert.match(
    source,
    /Use non-interactive flags whenever available \(for example: --no-pager, -n, --yes, --batch, --non-interactive\)\./
  )
  assert.match(
    source,
    /If a task cannot be completed safely in non-interactive mode, ask the user before proceeding instead of executing the command\./
  )
})

test('active SSH chat system prompt explains how to update env docs without force_replace errors', async () => {
  const source = await readFile(chatViewPath, 'utf8')

  assert.match(
    source,
    /When updating the server environment document, default to old_string\/new_string exact replacements\./
  )
  assert.match(
    source,
    /Do not replace the entire document with content unless the user clearly asked for a full rewrite\./
  )
  assert.match(
    source,
    /Only use force_replace=true after the user explicitly confirms a full-document overwrite\./
  )
  assert.match(
    source,
    /canonical environment document is env\.md in the authenticated remote user's \$HOME/
  )
  assert.match(source, /shared by every computer that connects as that same remote user/)
})

test('active SSH chat system prompt requires complete and readable software inventory updates', async () => {
  const source = await readFile(chatViewPath, 'utf8')

  assert.match(source, /Software documentation workflow:/)
  assert.match(source, /read the full env\.md.*inspect the live server.*update only that section.*read env\.md again/)
  assert.match(source, /exact version and build options/)
  assert.match(source, /package manager, and verified install\/update\/remove commands/)
  assert.match(source, /installation, configuration, include, module, certificate, web root, data, cache, temporary, PID, and log paths/)
  assert.match(source, /Adapt inspection to the target type instead of using a product-specific checklist/)
  assert.match(source, /for databases inspect client\/server versions/)
  assert.match(source, /for containers inspect runtime/)
  assert.match(source, /for language runtimes inspect executable/)
  assert.match(source, /for web applications inspect deployment root/)
  assert.match(source, /Collect only fields applicable to the target/)
  assert.match(source, /do not stop after a version check/)
  assert.doesNotMatch(source, /For Nginx specifically/)
  assert.match(source, /record it as 未确认 and briefly state why/)
  assert.match(source, /Do not paste raw command output into env\.md/)
  assert.match(source, /基本信息 table/)
  assert.match(source, /路径与文件 table/)
  assert.match(source, /网络与实例 table/)
  assert.match(source, /常用命令 fenced shell block/)
  assert.match(source, /target software section exists exactly once/)
})

test('assistant turns with tool activity stay expanded while tools are running', async () => {
  const source = await readFile(chatViewPath, 'utf8')

  assert.match(source, /const hasRunningTool = msg\.blocks\.some\(/)
  assert.match(source, /block\.type === 'tool' && block\.toolPart\?\.state\.status === 'running'/)
  assert.match(source, /if \(hasRunningTool\) \{\s*return false\s*\}/)
})
