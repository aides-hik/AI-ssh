import assert from 'node:assert/strict'
import test from 'node:test'
import { MultiHostRun } from './multi-host-run'
import {
  executeDeploymentStage, type DeploymentStage, type FrozenDeploymentStage,
  type DeploymentExecutionOptions
} from './multi-host-deployment'
import type { SSHCommandResult } from './ssh/ssh-command-result'

const targets = ['a', 'b', 'c', 'd'].map(id => ({ id, name: `Host ${id}`, host: `${id}.fixture.invalid` }))
const ok = (output = 'ok'): SSHCommandResult => ({ success: true, output, exitCode: 0, durationMs: 10 })
function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function stage(ids = ['a', 'b'], strategy: DeploymentStage['strategy'] = 'rolling'): DeploymentStage {
  return { name: 'Deploy web nodes', kind: 'deploy', strategy,
    steps: ids.map(targetId => ({ targetId, label: `Release ${targetId}`,
      command: `deploy-${targetId}`, verifyCommand: `health-${targetId}` })) }
}
function fixture() {
  const controller = new AbortController()
  const run = new MultiHostRun(targets, controller.signal)
  const calls: Array<{ id: string; command: string; signal: AbortSignal }> = []
  const options: DeploymentExecutionOptions = {
    signal: controller.signal, approve: async () => true,
    execute: async (id, command, signal) => { calls.push({ id, command, signal }); return ok(command) }
  }
  return { controller, run, calls, options }
}

test('Stop during the final atomic document commit preserves its observed success and stops later hosts', async () => {
  const { controller, run, options, calls } = fixture()
  options.execute = async (id, command, signal) => {
    calls.push({ id, command, signal })
    controller.abort()
    return { ...ok('document saved'), committed: true }
  }
  const result = await executeDeploymentStage(run, {
    name: 'Save documents', kind: 'command', strategy: 'rolling', operation: 'environment-document',
    steps: ['a', 'b'].map(targetId => ({ targetId, label: 'Save env.md', command: '{"content":"observations"}' }))
  }, options)
  assert.deepEqual(result.steps.map(step => step.status), ['completed', 'stopped'])
  assert.equal(result.steps[0].commandResult?.committed, true)
  assert.equal(run.snapshot()[0].status, 'complete')
  assert.equal(calls.length, 1)
  run.finish()
})

test('all targets, duplicate nodes, commands and health checks are validated before approval or execution', async () => {
  const { run, calls, options } = fixture()
  let approvals = 0
  options.approve = async () => { approvals++; return true }
  const invalid: DeploymentStage[] = [
    { ...stage(), steps: [] },
    stage(['a', 'a']),
    stage(['a', 'unselected']),
    { ...stage(), name: '' },
    { ...stage(), steps: [{ targetId: 'a', label: 'release', command: '' }] },
    { ...stage(), steps: [{ targetId: 'a', label: 'release', command: 'deploy-a' }] },
    { ...stage(), steps: [{ targetId: 'a', label: 'release', command: 'deploy-a', verifyCommand: ' ' }] }
  ]
  for (const candidate of invalid) await assert.rejects(executeDeploymentStage(run, candidate, options))
  assert.equal(approvals, 0)
  assert.deepEqual(calls, [])
  assert.deepEqual(run.snapshot().map(host => host.status), ['waiting', 'waiting', 'waiting', 'waiting'])
  run.finish()
})

for (const choice of ['missing', 'denied', 'throws'] as const) {
  test(`${choice} approval never changes the remote hosts or their run states`, async () => {
    const { run, calls, options } = fixture()
    options.approve = choice === 'missing' ? undefined
      : choice === 'denied' ? async () => false : async () => { throw new Error('dialog closed') }
    const result = await executeDeploymentStage(run, stage(), options)
    assert.equal(result.status, 'rejected')
    assert.deepEqual(result.steps.map(step => step.status), ['skipped', 'skipped'])
    assert.deepEqual(calls, [])
    assert.deepEqual(run.snapshot().map(host => host.status), ['waiting', 'waiting', 'waiting', 'waiting'])
    run.finish()
  })
}

test('approval sees an immutable snapshot and later caller edits cannot change the approved commands', { timeout: 3000 }, async () => {
  const { run, calls, options } = fixture()
  const requested = stage(['a'])
  const shown = deferred()
  const accepted = deferred<boolean>()
  let approved: FrozenDeploymentStage | undefined
  options.approve = async frozen => { approved = frozen; shown.resolve(); return accepted.promise }
  const pending = executeDeploymentStage(run, requested, options)
  await shown.promise
  assert.ok(approved)
  assert.equal(Object.isFrozen(approved), true)
  assert.equal(Object.isFrozen(approved.steps), true)
  assert.equal(Object.isFrozen(approved.steps[0]), true)
  requested.name = 'Changed after confirmation opened'
  requested.steps[0].command = 'unapproved-command'
  requested.steps[0].targetId = 'd'
  requested.steps.push({ targetId: 'c', label: 'extra', command: 'extra', verifyCommand: 'extra-health' })
  accepted.resolve(true)
  const result = await pending
  assert.equal(result.stage.name, 'Deploy web nodes')
  assert.deepEqual(calls.map(call => [call.id, call.command]), [['a', 'deploy-a'], ['a', 'health-a']])
  assert.equal(result.steps[0].verified, true)
  run.finish()
})

test('timeout and operation are frozen in approval and ordinary commands are completed without health claims', async () => {
  const { run, options } = fixture()
  const requested: DeploymentStage = {
    name: 'Run bounded command', kind: 'command', strategy: 'rolling', timeoutSeconds: 90,
    steps: [{ targetId: 'a', label: 'Check Compose', command: 'docker compose ps' }]
  }
  const execution: Array<{ timeoutMs: number; phase: string; stageName: string }> = []
  options.approve = async approved => {
    assert.equal(approved.operation, 'shell')
    assert.equal(approved.timeoutSeconds, 90)
    requested.timeoutSeconds = 1800
    requested.operation = 'environment-document'
    return true
  }
  options.execute = async (_id, _command, _signal, context) => { execution.push(context); return ok() }
  const result = await executeDeploymentStage(run, requested, options)
  assert.equal(result.stage.operation, 'shell')
  assert.equal(result.stage.timeoutSeconds, 90)
  assert.equal(result.status, 'completed')
  assert.equal(result.steps[0].verified, false)
  assert.deepEqual(execution.map(item => [item.timeoutMs, item.phase, item.stageName]), [
    [90000, 'executing', 'Run bounded command']
  ])
  run.finish()
})

test('default timeout is approved explicitly and invalid bounds cannot reach approval', async () => {
  const { run, options, calls } = fixture()
  let approvals = 0
  options.approve = async approved => { approvals++; assert.equal(approved.timeoutSeconds, 300); return true }
  for (const timeoutSeconds of [9, 1801, 90.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(executeDeploymentStage(run, { ...stage(['a']), timeoutSeconds }, options), /执行超时/)
  }
  await assert.rejects(executeDeploymentStage(run, { ...stage(['a']), operation: 'environment-document' }, options), /执行内容类型/)
  assert.equal(approvals, 0)
  assert.equal(calls.length, 0)
  const result = await executeDeploymentStage(run, stage(['a']), options)
  assert.equal(result.stage.timeoutSeconds, 300)
  assert.equal(approvals, 1)
  run.finish()
})

test('rolling starts the next node only after the previous health check has succeeded', { timeout: 3000 }, async () => {
  const { run, calls, options } = fixture()
  const checkingA = deferred()
  const healthyA = deferred<SSHCommandResult>()
  options.execute = async (id, command, signal) => {
    calls.push({ id, command, signal })
    if (command === 'health-a') { checkingA.resolve(); return healthyA.promise }
    return ok(command)
  }
  const pending = executeDeploymentStage(run, stage(), options)
  await checkingA.promise
  assert.deepEqual(calls.map(call => call.command), ['deploy-a', 'health-a'])
  healthyA.resolve(ok('healthy'))
  const result = await pending
  assert.equal(result.status, 'completed')
  assert.deepEqual(calls.map(call => call.command), ['deploy-a', 'health-a', 'deploy-b', 'health-b'])
  assert.equal(result.steps.every(step => step.verified), true)
  assert.deepEqual(run.snapshot().slice(0, 2).map(host => host.status), ['complete', 'complete'])
  run.finish()
})

test('a failed rolling health check preserves partial output and prevents later nodes from changing', async () => {
  const { run, calls, options } = fixture()
  options.execute = async (id, command, signal) => {
    calls.push({ id, command, signal })
    return command === 'health-a'
      ? { success: false, exitCode: 22, output: 'HTTP 503\n', stderr: 'unhealthy', durationMs: 45, truncated: true }
      : ok('new container was started')
  }
  const result = await executeDeploymentStage(run, stage(), options)
  assert.equal(result.status, 'failed')
  assert.deepEqual(result.steps.map(step => step.status), ['failed', 'skipped'])
  assert.equal(result.steps[0].commandResult?.output, 'new container was started')
  assert.equal(result.steps[0].verificationResult?.output, 'HTTP 503\n')
  assert.equal(result.steps[0].verificationResult?.exitCode, 22)
  assert.equal(result.steps[0].verificationResult?.truncated, true)
  assert.equal(result.steps[0].verified, false)
  assert.match(result.steps[0].error || '', /Host a.*22/)
  assert.deepEqual(calls.map(call => call.command), ['deploy-a', 'health-a'])
  assert.equal(run.snapshot()[0].status, 'error')
  assert.equal(run.snapshot()[0].failed, 1)
  run.finish()
})

test('parallel execution stops taking new nodes after a failure and settles other nodes already running', { timeout: 3000 }, async () => {
  const { run, calls, options } = fixture()
  const firstTwo = deferred()
  const releaseA = deferred<SSHCommandResult>()
  const releaseB = deferred<SSHCommandResult>()
  const failedA = deferred()
  let started = 0
  let settled = false
  options.concurrency = 2
  options.execute = async (id, command, signal) => {
    calls.push({ id, command, signal })
    if (command.startsWith('deploy')) {
      if (++started === 2) firstTwo.resolve()
      return id === 'a' ? releaseA.promise : releaseB.promise
    }
    return ok(command)
  }
  const pending = executeDeploymentStage(run, stage(['a', 'b', 'c', 'd'], 'parallel'), options)
    .finally(() => { settled = true })
  await firstTwo.promise
  assert.deepEqual(calls.map(call => call.command), ['deploy-a', 'deploy-b'])
  releaseA.resolve({ success: false, output: 'migration failed', exitCode: 7 })
  // Observe the actual failed run state rather than guessing worker timing.
  const observe = () => {
    if (run.snapshot()[0].status === 'error') failedA.resolve()
    else setImmediate(observe)
  }
  observe()
  await failedA.promise
  assert.equal(settled, false)
  releaseB.resolve(ok('node b started'))
  const result = await pending
  assert.equal(result.status, 'failed')
  assert.deepEqual(result.steps.map(step => step.status), ['failed', 'completed', 'skipped', 'skipped'])
  assert.deepEqual(calls.map(call => call.command), ['deploy-a', 'deploy-b', 'health-b'])
  assert.equal(result.steps[1].verified, true)
  run.finish()
})

test('parallel concurrency is capped at three even if the caller requests more', { timeout: 3000 }, async () => {
  const { run, options } = fixture()
  const firstThree = deferred()
  const release = deferred<SSHCommandResult>()
  const started: string[] = []
  options.concurrency = 50
  options.execute = async (id, command) => {
    if (command.startsWith('deploy')) { started.push(id); if (started.length === 3) firstThree.resolve(); return release.promise }
    return ok()
  }
  const pending = executeDeploymentStage(run, stage(['a', 'b', 'c', 'd'], 'parallel'), options)
  await firstThree.promise
  assert.deepEqual(started, ['a', 'b', 'c'])
  release.resolve(ok())
  assert.equal((await pending).status, 'completed')
  assert.deepEqual(started, ['a', 'b', 'c', 'd'])
  run.finish()
})

test('global cancellation while awaiting approval returns promptly and a late approval does not execute', { timeout: 3000 }, async () => {
  const { run, controller, calls, options } = fixture()
  const shown = deferred()
  const late = deferred<boolean>()
  options.approve = async (_stage, signal) => { assert.equal(signal, controller.signal); shown.resolve(); return late.promise }
  const pending = executeDeploymentStage(run, stage(), options)
  await shown.promise
  controller.abort()
  const result = await pending
  assert.equal(result.status, 'stopped')
  assert.deepEqual(result.steps.map(step => step.status), ['stopped', 'stopped'])
  late.resolve(true)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(calls, [])
  run.finish()
})

test('stopping one selected host during approval prevents the whole approved phase from starting', { timeout: 3000 }, async () => {
  const { run, calls, options } = fixture()
  const shown = deferred()
  const accepted = deferred<boolean>()
  options.approve = async () => { shown.resolve(); return accepted.promise }
  const pending = executeDeploymentStage(run, stage(), options)
  await shown.promise
  run.stopTarget('a')
  accepted.resolve(true)
  const result = await pending
  assert.equal(result.status, 'stopped')
  assert.deepEqual(result.steps.map(step => step.status), ['stopped', 'skipped'])
  assert.deepEqual(calls, [])
  run.finish()
})

test('a host cancellation reaches the running command and late success cannot verify it or start another node', { timeout: 3000 }, async () => {
  const { run, calls, options } = fixture()
  const started = deferred<AbortSignal>()
  const late = deferred<SSHCommandResult>()
  options.execute = async (id, command, signal) => { calls.push({ id, command, signal }); started.resolve(signal); return late.promise }
  const pending = executeDeploymentStage(run, stage(), options)
  const signal = await started.promise
  run.stopTarget('a')
  assert.equal(signal.aborted, true)
  late.resolve(ok('process may already have made changes'))
  const result = await pending
  assert.equal(result.status, 'stopped')
  assert.deepEqual(result.steps.map(step => step.status), ['stopped', 'skipped'])
  assert.equal(result.steps[0].commandResult?.output, 'process may already have made changes')
  assert.equal(result.steps[0].verified, false)
  assert.equal(calls.length, 1)
  run.finish()
})

test('nonzero, unknown exit statuses and thrown errors fail without running health or reporting success', async () => {
  for (const command of [
    async () => ({ success: true, output: 'last output', exitCode: 8 }),
    async () => ({ success: true, output: 'legacy response' }),
    async () => { throw new Error('connection lost') }
  ]) {
    const { run, options } = fixture()
    let commands = 0
    options.execute = async () => { commands++; return command() }
    const result = await executeDeploymentStage(run, stage(), options)
    assert.equal(result.status, 'failed')
    assert.equal(result.steps[0].verified, false)
    assert.equal(commands, 1)
    assert.equal(run.snapshot()[0].status, 'error')
    run.finish()
  }
})

test('verify phases certify their command itself and rollback requires a fresh explicit approval', async () => {
  const { run, calls, options } = fixture()
  let approvals = 0
  options.approve = async () => { approvals++; return true }
  const verified = await executeDeploymentStage(run, {
    name: 'Verify existing nodes', kind: 'verify', strategy: 'parallel',
    steps: [{ targetId: 'a', label: 'HTTP health', command: 'curl-health' }]
  }, options)
  assert.equal(verified.status, 'completed')
  assert.equal(verified.steps[0].verified, true)
  const rollback = { ...stage(['a']), kind: 'rollback' as const }
  options.approve = async () => { approvals++; return false }
  assert.equal((await executeDeploymentStage(run, rollback, options)).status, 'rejected')
  assert.equal(approvals, 2)
  assert.deepEqual(calls.map(call => call.command), ['curl-health'])
  run.finish()
})

test('a later repair asks again and cannot erase the failed host evidence from the earlier phase', async () => {
  const { run, options } = fixture()
  let approvals = 0
  let fail = true
  options.approve = async () => { approvals++; return true }
  options.execute = async () => fail ? { success: false, output: 'failed release', exitCode: 4 } : ok()
  assert.equal((await executeDeploymentStage(run, stage(['a']), options)).status, 'failed')
  fail = false
  assert.equal((await executeDeploymentStage(run, { ...stage(['a']), name: 'Repair release' }, options)).status, 'completed')
  assert.equal(approvals, 2)
  assert.equal(run.snapshot()[0].status, 'error')
  assert.equal(run.snapshot()[0].failed, 1)
  run.finish()
})

test('two deployment phases on the same request cannot overlap or open a second approval', { timeout: 3000 }, async () => {
  const { run, options } = fixture()
  const shown = deferred()
  const accepted = deferred<boolean>()
  let approvals = 0
  options.approve = async () => { approvals++; shown.resolve(); return accepted.promise }
  const first = executeDeploymentStage(run, stage(['a']), options)
  await shown.promise
  await assert.rejects(executeDeploymentStage(run, stage(['b']), options), /上一部署阶段尚未结束/)
  assert.equal(approvals, 1)
  accepted.resolve(false)
  assert.equal((await first).status, 'rejected')
  run.finish()
})
