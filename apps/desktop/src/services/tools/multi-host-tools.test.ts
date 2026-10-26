import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { registerHooks } from 'node:module'
import { MultiHostRun } from '../multi-host-run'
import type { ToolInfo } from './tool'
import type { FrozenDeploymentStage } from '../multi-host-deployment'
import type { HostTarget } from '../multi-host-run'
import type { MultiHostToolOptions } from './multi-host-tools'
import type { SSHExecuteOutputEvent } from '../ssh/ssh-command.service'

// Load the real tool module with the desktop alias map, while all IPC is a local fixture.
let modulePromise: Promise<typeof import('./multi-host-tools')> | undefined
function loadTools() {
  if (!modulePromise) {
    const hook = registerHooks({
      resolve(specifier, context, nextResolve) {
        return nextResolve(specifier.startsWith('@/')
          ? new URL(`../../${specifier.slice(2)}`, import.meta.url).href : specifier, context)
      }
    })
    modulePromise = import('./multi-host-tools').finally(() => hook.deregister())
  }
  return modulePromise
}

const selected = [
  { id: 'runtime-a', name: 'Web A', host: 'a.fixture.invalid' },
  { id: 'runtime-b', name: 'Web B', host: 'b.fixture.invalid' }
]

interface Invocation { id: string; command: string; requestId: string; options?: { timeoutMs?: number } }
interface Bridge {
  getConnections: () => Promise<Array<{ id: string; status: string }>>
  execute: (id: string, command: string, requestId: string, options?: { timeoutMs?: number }) => Promise<unknown>
  cancelExecute: (requestId: string) => Promise<boolean>
  onExecuteOutput: (callback: (event: SSHExecuteOutputEvent) => void) => () => void
  readEnvDoc: (id: string) => Promise<{ content: string; fullPath: string } | null>
  writeEnvDoc: (id: string, content: string) => Promise<{ content: string; fullPath: string }>
}

async function fixture(context: TestContext, approveDeployment?: (stage: FrozenDeploymentStage, signal: AbortSignal) => Promise<boolean>, settings: {
  targets?: HostTarget[]
  onOutput?: MultiHostToolOptions['onOutput']
  onPhase?: MultiHostToolOptions['onPhase']
} = {}) {
  const calls: Invocation[] = []
  const targets = settings.targets ?? selected
  const outputListeners = new Set<(event: SSHExecuteOutputEvent) => void>()
  const documents = new Map(targets.map(target => [target.id, `# ${target.name}\nOriginal environment`]))
  const documentReads: string[] = []
  const documentWrites: Array<{ id: string; content: string }> = []
  const backups: string[] = []
  let queries = 0
  const bridge: Bridge = {
    getConnections: async () => { queries++; return targets.map(target => ({ id: target.id, status: 'connected' })) },
    execute: async (id, command, requestId, options) => {
      calls.push({ id, command, requestId, options })
      return { success: true, output: `${id} observation`, exitCode: 0 }
    },
    cancelExecute: async () => true,
    onExecuteOutput: callback => { outputListeners.add(callback); return () => { outputListeners.delete(callback) } },
    readEnvDoc: async id => {
      documentReads.push(id)
      const content = documents.get(id)
      return content === undefined ? null : { content, fullPath: `/home/${id}/env.md` }
    },
    writeEnvDoc: async (id, content) => {
      documents.set(id, content)
      documentWrites.push({ id, content })
      return { content, fullPath: `/home/${id}/env.md` }
    }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: { ssh: bridge,
    docStorage: { save: async (_category: string, _filename: string, content: string) => { backups.push(content); return {} } }
  } } })
  context.after(() => {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  context.mock.method(globalThis, 'fetch', async () => { throw new Error('No network access is allowed in tool fixtures') })
  const run = new MultiHostRun(targets, new AbortController().signal)
  context.after(() => run.finish())
  const module = await loadTools()
  const tools = module.createMultiHostTools(run, { approveDeployment, onOutput: settings.onOutput, onPhase: settings.onPhase })
  const invoke = async (name: string, input: Record<string, unknown>) => {
    const tool: ToolInfo | undefined = tools.find(candidate => candidate.id === name)
    assert.ok(tool, `Unknown fixture tool: ${name}`)
    const initialized = await tool.init()
    return initialized.execute(input, {
      sessionID: 'fixture-session', messageID: 'fixture-message', agent: 'fixture-agent',
      abort: new AbortController().signal, metadata() {}
    })
  }
  return { run, tools, invoke, bridge, calls, queries: () => queries, module, documents, documentReads, documentWrites, backups,
    emitOutput: (event: SSHExecuteOutputEvent) => { for (const listener of outputListeners) listener(event) },
    outputListeners }
}

test('all remote tools reject targets outside the selected live connection IDs', async context => {
  const { tools, invoke, calls, queries } = await fixture(context)
  const inputs: Record<string, Record<string, unknown>> = {
    inspect_server: { checks: ['cpu'] }, read_file: { path: '/etc/hostname' },
    list_files: { path: '/etc' }, read_server_env_doc: {},
    execute_ssh_command: { command: 'hostname' }, update_server_env_doc: { old_string: 'Original', new_string: 'Next' }
  }
  for (const [name, input] of Object.entries(inputs)) {
    const info = await tools.find(tool => tool.id === name)?.init()
    assert.ok(info)
    assert.equal(info.parameters.safeParse({ ...input, targetId: 'saved-config-id' }).success, false)
    await assert.rejects(invoke(name, { ...input, targetId: 'saved-config-id' }), /invalid arguments/)
    await assert.rejects(invoke(name, input), /invalid arguments/)
  }
  assert.equal(queries(), 0)
  assert.deepEqual(calls, [])
})

test('inspection selects fixed checks, ignores a supplied shell command and deduplicates checks', async context => {
  const { invoke, calls, run } = await fixture(context)
  const result = await invoke('inspect_server', {
    targetId: 'runtime-b', checks: ['system', 'disk', 'disk'],
    command: 'touch /tmp/prism-must-not-execute'
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].id, 'runtime-b')
  assert.match(calls[0].command, /uname -a/)
  assert.match(calls[0].command, /df -hP/)
  assert.doesNotMatch(calls[0].command, /touch|prism-must-not-execute/)
  assert.equal(calls[0].command.match(/PRISM_INSPECT_DISK/g)?.length, 1)
  assert.match(calls[0].requestId, /^exec-/)
  const output = JSON.parse(result.output)
  assert.equal(output.targetId, 'runtime-b')
  assert.equal(output.targetName, 'Web B')
  assert.equal(output.host, 'b.fixture.invalid')
  assert.equal(output.success, true)
  assert.equal(result.metadata.targetId, 'runtime-b')
  assert.deepEqual(run.snapshot().map(host => host.completed), [0, 1])
})

test('arbitrary inspection names and empty check sets cannot reach command execution', async context => {
  const { invoke, calls } = await fixture(context)
  for (const checks of [[], ['cpu; touch /tmp/injected'], ['$(whoami)'], ['system', 'memory', 'disk', 'network', 'services', 'cpu', 'system']]) {
    await assert.rejects(invoke('inspect_server', { targetId: 'runtime-a', checks }), /invalid arguments/)
  }
  assert.equal(calls.length, 0)
})

test('file and directory arguments remain shell literals even with quotes and substitutions', async context => {
  const { invoke, calls } = await fixture(context)
  const path = '/var/log/a\'; touch /tmp/prism-injected; $(whoami) `id` "a"'
  await invoke('read_file', { targetId: 'runtime-a', path })
  assert.equal(calls[0].command, 'head -c 24001 -- \'/var/log/a\'"\'"\'; touch /tmp/prism-injected; $(whoami) `id` "a"\'')
  await invoke('list_files', { targetId: 'runtime-b', path: '-al; $(id)' })
  assert.equal(calls[1].command, "ls -la -- '-al; $(id)'")
})

test('invalid file paths do not reach the shell and omitted directory path uses the current directory', async context => {
  const { invoke, calls } = await fixture(context)
  for (const path of ['relative/file', '', '/tmp/a\nnext', '/tmp/a\rnext', '/tmp/a\0next']) {
    await assert.rejects(invoke('read_file', { targetId: 'runtime-a', path }), /invalid arguments|文件路径无效/)
  }
  assert.equal(calls.length, 0)
  await invoke('list_files', { targetId: 'runtime-a' })
  assert.equal(calls[0].command, "ls -la -- '.'")
})

test('disconnected selections are not remapped to a new connection and other hosts continue', async context => {
  const { invoke, bridge, run, calls } = await fixture(context)
  bridge.getConnections = async () => [
    { id: 'reconnected-new-id', status: 'connected' }, { id: 'runtime-b', status: 'connected' }
  ]
  await assert.rejects(invoke('inspect_server', { targetId: 'runtime-a', checks: ['cpu'] }), /Web A.*服务器连接已断开/)
  assert.equal(run.snapshot()[0].status, 'unavailable')
  assert.equal(calls.length, 0)
  await invoke('inspect_server', { targetId: 'runtime-b', checks: ['memory'] })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].id, 'runtime-b')
  assert.equal(run.snapshot()[1].status, 'complete')
})

test('failed command observations remain attributable while other checks can still succeed', async context => {
  const { invoke, bridge, run } = await fixture(context)
  bridge.execute = async () => ({ success: false, exitCode: 1, output: 'CPU check succeeded; memory check unavailable', stderr: 'free: not found' })
  await assert.rejects(invoke('inspect_server', { targetId: 'runtime-a', checks: ['cpu', 'memory'] }), /Web A.*free: not found[\s\S]*CPU check succeeded/)
  bridge.execute = async () => ({ success: true, exitCode: 0, output: 'Disk is healthy' })
  const result = await invoke('inspect_server', { targetId: 'runtime-a', checks: ['disk'] })
  assert.equal(JSON.parse(result.output).targetId, 'runtime-a')
  assert.equal(run.snapshot()[0].status, 'error')
  assert.equal(run.snapshot()[0].failed, 1)
  assert.equal(run.snapshot()[0].completed, 1)
})

test('stopping a host cancels its IPC request without cancelling a different host', async context => {
  const { invoke, bridge, run } = await fixture(context)
  const pending = new Map<string, (result: unknown) => void>()
  const requests: Array<{ id: string; requestId: string }> = []
  const cancelled: string[] = []
  let bothStarted!: () => void
  const started = new Promise<void>(resolve => { bothStarted = resolve })
  bridge.execute = async (id, _command, requestId) => {
    requests.push({ id, requestId })
    const result = new Promise<unknown>(resolve => pending.set(requestId, resolve))
    if (requests.length === 2) bothStarted()
    return result
  }
  bridge.cancelExecute = async requestId => {
    cancelled.push(requestId)
    pending.get(requestId)?.({ success: false, error: 'Command aborted' })
    return true
  }
  const a = invoke('inspect_server', { targetId: 'runtime-a', checks: ['cpu'] })
  const rejectedA = assert.rejects(a, /Web A.*已停止此服务器/)
  const b = invoke('inspect_server', { targetId: 'runtime-b', checks: ['cpu'] })
  await started
  run.stopTarget('runtime-a')
  await rejectedA
  assert.deepEqual(cancelled, [requests[0].requestId])
  assert.notEqual(requests[0].requestId, requests[1].requestId)
  pending.get(requests[1].requestId)?.({ success: true, exitCode: 0, output: 'B survived' })
  assert.equal(JSON.parse((await b).output).output, 'B survived')
  assert.equal(run.snapshot()[0].status, 'stopped')
  assert.equal(run.snapshot()[1].status, 'complete')
})

test('environment reads stay scoped and mutations are only exposed through the approved stage tool', async context => {
  const { tools, invoke, calls } = await fixture(context)
  assert.deepEqual(tools.map(tool => tool.id).sort(), [
    'ask_followup_question', 'attempt_completion', 'execute_deployment_stage', 'execute_ssh_command', 'inspect_server', 'list_files', 'read_file', 'read_server_env_doc', 'update_server_env_doc', 'webfetch'
  ])
  const result = await invoke('read_server_env_doc', { targetId: 'runtime-b' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].id, 'runtime-b')
  assert.equal(calls[0].command, 'if [ -f "$HOME/env.md" ]; then head -c 16001 -- "$HOME/env.md"; else printf "%s\\n" "服务器环境文档不存在"; fi')
  assert.equal(JSON.parse(result.output).targetId, 'runtime-b')
  assert.equal(JSON.parse(result.output).output, 'runtime-b observation')
})

const stageInput = (kind: 'deploy' | 'verify' | 'rollback' = 'deploy') => ({
  name: 'Compose project', kind, strategy: 'rolling', steps: selected.map(target => ({
    targetId: target.id, label: 'Start application',
    command: 'cd /srv/project\ndocker compose up -d',
    verifyCommand: 'curl --fail --max-time 10 http://127.0.0.1:8080/health'
  }))
})

test('deployment cannot execute without an actual approval callback or with model approval flags', async context => {
  const { invoke, calls, run } = await fixture(context)
  const result = JSON.parse((await invoke('execute_deployment_stage', stageInput())).output)
  assert.equal(result.status, 'rejected')
  assert.equal(calls.length, 0)
  assert.deepEqual(run.snapshot().map(host => host.completed), [0, 0])
  await assert.rejects(invoke('execute_deployment_stage', { ...stageInput(), approved: true }), /invalid arguments/)
  assert.equal(calls.length, 0)
})

test('all stage targets are validated before asking approval or sending commands', async context => {
  let approvals = 0
  const { invoke, calls } = await fixture(context, async () => { approvals++; return true })
  const stage = stageInput()
  stage.steps[1].targetId = 'unselected-live-connection'
  await assert.rejects(invoke('execute_deployment_stage', stage), /invalid arguments/)
  assert.equal(approvals, 0)
  assert.equal(calls.length, 0)
  const noVerification = stageInput()
  Reflect.deleteProperty(noVerification.steps[0], 'verifyCommand')
  await assert.rejects(invoke('execute_deployment_stage', noVerification), /验证命令/)
  assert.equal(approvals, 0)
})

test('approved exact frozen scripts execute on their selected hosts and verify before the next host', async context => {
  let approvals = 0
  const { invoke, calls } = await fixture(context, async stage => {
    approvals++
    assert.equal(Object.isFrozen(stage), true)
    assert.equal(Object.isFrozen(stage.steps), true)
    assert.equal(Object.isFrozen(stage.steps[0]), true)
    return true
  })
  const stage = stageInput()
  const output = JSON.parse((await invoke('execute_deployment_stage', stage)).output)
  assert.equal(approvals, 1)
  assert.equal(output.status, 'completed')
  assert.deepEqual(calls.map(call => [call.id, call.command]), [
    ['runtime-a', `set -e\n${stage.steps[0].command}`],
    ['runtime-a', `set -e\n${stage.steps[0].verifyCommand}`],
    ['runtime-b', `set -e\n${stage.steps[1].command}`],
    ['runtime-b', `set -e\n${stage.steps[1].verifyCommand}`]
  ])
  assert.equal(output.steps.every((step: { verified: boolean }) => step.verified), true)
})

test('deployment rechecks the selected connection after approval and never remaps a reconnect', async context => {
  const { invoke, calls, bridge } = await fixture(context, async () => {
    bridge.getConnections = async () => [{ id: 'replacement-runtime-id', status: 'connected' }]
    return true
  })
  const result = JSON.parse((await invoke('execute_deployment_stage', stageInput())).output)
  assert.notEqual(result.status, 'completed')
  assert.equal(result.steps[0].status, 'stopped')
  assert.equal(result.steps[1].status, 'skipped')
  assert.match(result.steps[0].error, /服务器连接已断开/)
  assert.equal(calls.length, 0)
})

test('failed deployment preserves partial output, pauses later deploys, and requires new rollback approval', async context => {
  let approvals = 0
  const { invoke, bridge, calls } = await fixture(context, async () => { approvals++; return true })
  bridge.execute = async (id, command, requestId) => {
    calls.push({ id, command, requestId })
    return { success: false, output: 'image pulled; start failed', stderr: 'container port unavailable', exitCode: 1 }
  }
  const result = JSON.parse((await invoke('execute_deployment_stage', stageInput())).output)
  assert.equal(result.status, 'failed')
  assert.equal(result.steps[1].status, 'skipped')
  assert.match(result.steps[0].commandResult.output, /image pulled/)
  assert.match(result.steps[0].commandResult.stderr, /port unavailable/)
  await assert.rejects(invoke('execute_deployment_stage', stageInput()), /已暂停后续部署/)
  assert.equal(approvals, 1)
  bridge.execute = async () => ({ success: true, output: 'previous version restored', exitCode: 0 })
  const rollback = JSON.parse((await invoke('execute_deployment_stage', stageInput('rollback'))).output)
  assert.equal(rollback.status, 'completed')
  assert.equal(approvals, 2)
})

test('deployment output stays bounded without splitting UTF-8 characters or hiding truncation', async context => {
  const { invoke, bridge } = await fixture(context, async () => true)
  bridge.execute = async () => ({ success: true, output: '中🙂'.repeat(20000), stdout: '中🙂'.repeat(20000), stderr: '诊断'.repeat(10000), exitCode: 0 })
  const result = JSON.parse((await invoke('execute_deployment_stage', stageInput())).output)
  assert.equal(result.status, 'completed')
  for (const step of result.steps) {
    assert.equal(step.commandResult.truncated, true)
    assert.ok(new TextEncoder().encode(step.commandResult.output).length <= 12000)
    assert.equal(step.commandResult.output.includes('\ufffd'), false)
    assert.equal(step.commandResult.stdout, undefined)
  }
})

test('large command and document output is bounded and explicitly marked truncated', async context => {
  const { invoke, bridge } = await fixture(context)
  bridge.execute = async () => ({ success: true, exitCode: 0, output: 'a'.repeat(50000) })
  const command = JSON.parse((await invoke('inspect_server', { targetId: 'runtime-a', checks: ['services'] })).output)
  assert.equal(command.truncated, true)
  assert.ok(command.output.length <= 24000)
  bridge.execute = async () => ({ success: true, exitCode: 0, output: 'd'.repeat(16001) })
  const document = JSON.parse((await invoke('read_server_env_doc', { targetId: 'runtime-b' })).output)
  assert.equal(document.truncated, true)
  assert.ok(document.output.length <= 16000)
})

test('file and environment limits count UTF-8 bytes and preserve complete characters', async context => {
  const { invoke, bridge } = await fixture(context)
  const text = '中🙂'.repeat(8000)
  bridge.execute = async () => ({ success: true, exitCode: 0, output: text })
  const file = JSON.parse((await invoke('read_file', { targetId: 'runtime-a', path: '/var/log/fixture' })).output)
  assert.equal(file.truncated, true)
  assert.ok(new TextEncoder().encode(file.output).length <= 24000)
  assert.equal(file.output.includes('\ufffd'), false)
  assert.equal(text.startsWith(file.output), true)
  const environment = JSON.parse((await invoke('read_server_env_doc', { targetId: 'runtime-b' })).output)
  assert.equal(environment.truncated, true)
  assert.ok(new TextEncoder().encode(environment.output).length <= 16000)
  assert.equal(environment.output.includes('\ufffd'), false)
  assert.equal(text.startsWith(environment.output), true)
})

test('a single selected host exposes the same complete tool registry and target validation', async context => {
  const { tools, invoke, calls } = await fixture(context, undefined, { targets: [selected[0]] })
  assert.deepEqual(tools.map(tool => tool.id).sort(), [
    'ask_followup_question', 'attempt_completion', 'execute_deployment_stage', 'execute_ssh_command',
    'inspect_server', 'list_files', 'read_file', 'read_server_env_doc', 'update_server_env_doc', 'webfetch'
  ])
  await assert.rejects(invoke('execute_ssh_command', { targetId: 'runtime-b', command: 'hostname' }), /invalid arguments/)
  const result = JSON.parse((await invoke('execute_ssh_command', { targetId: 'runtime-a', command: 'hostname' })).output)
  assert.equal(result.status, 'rejected')
  assert.equal(calls.length, 0)
})

test('ordinary commands require approval and cannot carry model approval flags or internal operations', async context => {
  let approvals = 0
  const { invoke, calls } = await fixture(context, async () => { approvals++; return false })
  const input = { targetId: 'runtime-a', command: 'docker compose ps' }
  for (const extra of [{ approved: true }, { operation: 'environment-document' }]) {
    await assert.rejects(invoke('execute_ssh_command', { ...input, ...extra }), /invalid arguments/)
  }
  await assert.rejects(invoke('execute_deployment_stage', { ...stageInput(), operation: 'environment-document' }), /invalid arguments/)
  const result = JSON.parse((await invoke('execute_ssh_command', input)).output)
  assert.equal(result.status, 'rejected')
  assert.equal(approvals, 1)
  assert.equal(calls.length, 0)
})

test('approved ordinary commands use the selected timeout and do not certify health', async context => {
  const approved: FrozenDeploymentStage[] = []
  const { invoke, calls } = await fixture(context, async stage => { approved.push(stage); return true })
  const input = { targetId: 'runtime-b', command: 'docker compose ps', label: '查看容器', timeoutSeconds: 90 }
  const result = JSON.parse((await invoke('execute_ssh_command', input)).output)
  assert.equal(approved[0].kind, 'command')
  assert.equal(approved[0].operation, 'shell')
  assert.equal(approved[0].timeoutSeconds, 90)
  assert.equal(approved[0].steps[0].command, input.command)
  assert.deepEqual(calls.map(call => [call.id, call.command, call.options?.timeoutMs]), [
    ['runtime-b', 'set -e\ndocker compose ps', 90000]
  ])
  assert.equal(result.status, 'completed')
  assert.equal(result.steps[0].verified, false)
  await invoke('execute_ssh_command', { targetId: 'runtime-a', command: 'hostname' })
  assert.equal(approved[1].timeoutSeconds, 300)
  assert.equal(calls[1].options?.timeoutMs, 300000)
})

test('invalid command timeouts are rejected before approval or remote execution', async context => {
  let approvals = 0
  const { invoke, calls } = await fixture(context, async () => { approvals++; return true })
  for (const timeoutSeconds of [0, 9, 1801, 10.5, '60']) {
    await assert.rejects(invoke('execute_ssh_command', { targetId: 'runtime-a', command: 'hostname', timeoutSeconds }), /invalid arguments/)
  }
  assert.equal(approvals, 0)
  assert.equal(calls.length, 0)
})

test('command logs stream before the final result and each phase remains tied to its selected host', { timeout: 3000 }, async context => {
  const output: Array<{ targetId: string; stream: string; data: string }> = []
  const phases: Array<{ targetId: string; phase: string }> = []
  const { invoke, bridge, emitOutput, outputListeners, run } = await fixture(context, async () => true, {
    onOutput: event => output.push(event),
    onPhase: event => {
      assert.equal(run.snapshot().find(host => host.id === event.targetId)?.phase, event.phase)
      phases.push(event)
    }
  })
  let started!: () => void
  let release!: (result: unknown) => void
  const active = new Promise<void>(resolve => { started = resolve })
  const result = new Promise<unknown>(resolve => { release = resolve })
  bridge.execute = async (id, _command, requestId) => {
    emitOutput({ requestId, connectionId: id, stream: 'stdout', data: 'Pulling image\n' })
    emitOutput({ requestId, connectionId: id, stream: 'stderr', data: 'Retrying layer\n' })
    started()
    return result
  }
  let settled = false
  const pending = invoke('execute_ssh_command', { targetId: 'runtime-b', command: 'docker compose pull' })
    .finally(() => { settled = true })
  await active
  assert.equal(settled, false)
  assert.deepEqual(output.map(event => [event.targetId, event.stream, event.data]), [
    ['runtime-b', 'stdout', 'Pulling image\n'], ['runtime-b', 'stderr', 'Retrying layer\n']
  ])
  assert.deepEqual(phases.map(event => [event.targetId, event.phase]), [['runtime-b', 'executing']])
  assert.equal(outputListeners.size, 1)
  release({ success: true, output: 'Image pulled', exitCode: 0 })
  assert.equal(JSON.parse((await pending).output).status, 'completed')
  assert.equal(outputListeners.size, 0)
})

test('deployment phase callbacks distinguish execution from real health verification', async context => {
  const phases: Array<[string, string]> = []
  const { invoke } = await fixture(context, async () => true, {
    onPhase: event => phases.push([event.targetId, event.phase])
  })
  const result = JSON.parse((await invoke('execute_deployment_stage', stageInput())).output)
  assert.equal(result.status, 'completed')
  assert.deepEqual(phases, [
    ['runtime-a', 'executing'], ['runtime-a', 'verifying'],
    ['runtime-b', 'executing'], ['runtime-b', 'verifying']
  ])
})

test('ordinary commands preserve nonzero and missing exit statuses without reporting success', async context => {
  const { invoke, bridge } = await fixture(context, async () => true)
  for (const response of [
    { success: true, output: 'legacy response without exit status' },
    { success: true, output: 'partial work', exitCode: 2 }
  ]) {
    bridge.execute = async () => response
    const result = JSON.parse((await invoke('execute_ssh_command', { targetId: 'runtime-a', command: 'false' })).output)
    assert.equal(result.status, 'failed')
    assert.equal(result.steps[0].verified, false)
    assert.equal(result.steps[0].commandResult.output, response.output)
  }
})

test('denied document changes do not read, back up or write a remote document', async context => {
  const { invoke, calls, documentReads, documentWrites, backups } = await fixture(context, async () => false)
  const result = JSON.parse((await invoke('update_server_env_doc', {
    targetId: 'runtime-b', old_string: 'Original', new_string: 'Updated'
  })).output)
  assert.equal(result.status, 'rejected')
  assert.deepEqual(documentReads, [])
  assert.deepEqual(documentWrites, [])
  assert.deepEqual(backups, [])
  assert.deepEqual(calls, [])
})

test('document updates approve immutable exact changes, preserve backups and never send JSON to the shell', { timeout: 3000 }, async context => {
  let shown!: () => void
  let approve!: (value: boolean) => void
  let approved: FrozenDeploymentStage | undefined
  const visible = new Promise<void>(resolve => { shown = resolve })
  const accepted = new Promise<boolean>(resolve => { approve = resolve })
  const phases: string[] = []
  const { invoke, calls, documents, documentWrites, documentReads, backups } = await fixture(context, async stage => {
    approved = stage
    shown()
    return accepted
  }, { onPhase: event => phases.push(event.phase) })
  const input = { targetId: 'runtime-b', old_string: 'Original', new_string: 'Approved update' }
  const pending = invoke('update_server_env_doc', input)
  await visible
  assert.ok(approved)
  assert.equal(Object.isFrozen(approved.steps[0]), true)
  assert.equal(approved.operation, 'environment-document')
  assert.equal(approved.kind, 'command')
  assert.deepEqual(JSON.parse(approved.steps[0].command), { old_string: 'Original', new_string: 'Approved update' })
  input.targetId = 'runtime-a'
  input.new_string = 'Unapproved update'
  approve(true)
  const result = JSON.parse((await pending).output)
  assert.equal(result.status, 'completed')
  assert.equal(result.steps[0].verified, false)
  assert.equal(result.steps[0].commandResult.output, '已更新文档内容')
  assert.deepEqual(documentWrites, [{ id: 'runtime-b', content: '# Web B\nApproved update environment' }])
  assert.equal(documentReads.every(id => id === 'runtime-b'), true)
  assert.equal(documents.get('runtime-a'), '# Web A\nOriginal environment')
  assert.equal(backups.length, 1)
  assert.match(backups[0], /# Web B\nOriginal environment/)
  assert.deepEqual(phases, ['updating-document'])
  assert.deepEqual(calls, [])
})

test('document replacement mismatches retain the original remote content', async context => {
  const { invoke, documents, documentWrites, calls } = await fixture(context, async () => true)
  const result = JSON.parse((await invoke('update_server_env_doc', {
    targetId: 'runtime-a', old_string: 'not in the original document', new_string: 'replacement'
  })).output)
  assert.equal(result.status, 'failed')
  assert.match(result.steps[0].error, /old_string not found/)
  assert.equal(documents.get('runtime-a'), '# Web A\nOriginal environment')
  assert.deepEqual(documentWrites, [])
  assert.deepEqual(calls, [])
})
