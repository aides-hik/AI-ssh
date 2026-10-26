import assert from 'node:assert/strict'
import test from 'node:test'
import { MultiHostRun, type HostTarget, type HostRunState } from './multi-host-run'

const targets = (): HostTarget[] => [
  { id: 'live-a', name: 'Web A', host: 'web-a.fixture.invalid' },
  { id: 'live-b', name: 'Web B', host: 'web-b.fixture.invalid' }
]

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function state(run: MultiHostRun, id: string): HostRunState {
  const found = run.snapshot().find(item => item.id === id)
  assert.ok(found)
  return found
}

test('selected live targets are frozen snapshots and published state cannot mutate the run', () => {
  const selected = targets()
  const published: HostRunState[][] = []
  const run = new MultiHostRun(selected, new AbortController().signal, states => published.push(states))
  selected[0].id = 'replacement-after-reconnect'
  selected[0].name = 'Changed name'
  selected.push({ id: 'live-c', name: 'Unselected C', host: 'c.fixture.invalid' })
  assert.equal(Object.isFrozen(run.targets), true)
  assert.equal(Object.isFrozen(run.targets[0]), true)
  assert.deepEqual(run.targets, targets())
  assert.equal(run.target('live-a').name, 'Web A')
  assert.throws(() => run.target('replacement-after-reconnect'), /不在本次选择范围/)
  assert.throws(() => run.target('live-c'), /不在本次选择范围/)
  published[0][0].status = 'complete'
  const snapshot = run.snapshot()
  snapshot[0].completed = 100
  assert.equal(state(run, 'live-a').status, 'waiting')
  assert.equal(state(run, 'live-a').completed, 0)
  run.finish()
})

test('empty and duplicate selections are rejected before any execution', () => {
  const signal = new AbortController().signal
  assert.throws(() => new MultiHostRun([], signal), /有效且不重复/)
  assert.throws(() => new MultiHostRun([targets()[0], targets()[0]], signal), /有效且不重复/)
})

test('an unselected target never invokes an action or changes selected host state', async () => {
  const run = new MultiHostRun(targets(), new AbortController().signal)
  let invoked = false
  await assert.rejects(run.execute('saved-config-id', async () => { invoked = true }), /不在本次选择范围/)
  assert.equal(invoked, false)
  assert.deepEqual(run.snapshot().map(item => item.status), ['waiting', 'waiting'])
  run.finish()
})

test('stopping one host cancels only its action and blocks later work for that host', async () => {
  const run = new MultiHostRun(targets(), new AbortController().signal)
  const releaseA = deferred<string>()
  const releaseB = deferred<string>()
  let signalA: AbortSignal | undefined
  let signalB: AbortSignal | undefined
  const pendingA = run.execute('live-a', async signal => { signalA = signal; return releaseA.promise })
  const pendingB = run.execute('live-b', async signal => { signalB = signal; return releaseB.promise })
  const rejectedA = assert.rejects(pendingA, /Web A.*已停止此服务器/)
  run.stopTarget('live-a')
  assert.equal(signalA?.aborted, true)
  assert.equal(signalB?.aborted, false)
  let invoked = false
  await assert.rejects(run.execute('live-a', async () => { invoked = true }), /已停止此服务器/)
  assert.equal(invoked, false)
  releaseA.resolve('late output must not count as success')
  releaseB.resolve('B observation')
  await rejectedA
  assert.equal(await pendingB, 'B observation')
  assert.equal(state(run, 'live-a').status, 'stopped')
  assert.equal(state(run, 'live-a').completed, 0)
  assert.equal(state(run, 'live-a').failed, 0)
  assert.equal(state(run, 'live-b').status, 'complete')
  assert.equal(state(run, 'live-b').completed, 1)
  run.finish()
})

for (const upstream of [false, true]) {
  test(`${upstream ? 'upstream abort' : 'stopAll'} cancels active and waiting hosts without reporting success`, async () => {
    const controller = new AbortController()
    const run = new MultiHostRun(targets(), controller.signal)
    const release = deferred<string>()
    let signalA: AbortSignal | undefined
    const pending = run.execute('live-a', async signal => { signalA = signal; return release.promise })
    const rejected = assert.rejects(pending, /已停止此服务器/)
    if (upstream) controller.abort()
    else run.stopAll()
    assert.equal(signalA?.aborted, true)
    assert.equal(run.isStopped('live-b'), true)
    assert.deepEqual(run.snapshot().map(item => item.status), ['stopped', 'stopped'])
    let invoked = false
    await assert.rejects(run.execute('live-b', async () => { invoked = true }), /已停止此服务器/)
    assert.equal(invoked, false)
    release.resolve('late result')
    await rejected
    assert.deepEqual(run.snapshot().map(item => item.completed), [0, 0])
    run.finish()
  })
}

test('a disconnection remains unavailable and does not cancel a different server', async () => {
  const run = new MultiHostRun(targets(), new AbortController().signal)
  const releaseA = deferred<string>()
  const pendingA = run.execute('live-a', async () => releaseA.promise)
  const rejectedA = assert.rejects(pendingA, /服务器连接已断开/)
  run.stopTarget('live-a', true)
  releaseA.resolve('stale output')
  await rejectedA
  assert.equal(state(run, 'live-a').status, 'unavailable')
  assert.equal(state(run, 'live-a').error, '服务器连接已断开')
  assert.equal(state(run, 'live-a').completed, 0)
  assert.equal(state(run, 'live-a').failed, 0)
  assert.equal(await run.execute('live-b', async () => 'B is healthy'), 'B is healthy')
  assert.equal(state(run, 'live-b').status, 'complete')
  run.finish()
})

test('failed checks retain their error while the same host can provide other observations', async () => {
  const run = new MultiHostRun(targets(), new AbortController().signal)
  await assert.rejects(run.execute('live-a', async () => { throw new Error('free is unavailable') }), /Web A.*free is unavailable/)
  assert.equal(state(run, 'live-a').failed, 1)
  assert.equal(await run.execute('live-a', async () => 'Filesystem observations'), 'Filesystem observations')
  assert.deepEqual({
    status: state(run, 'live-a').status,
    completed: state(run, 'live-a').completed,
    failed: state(run, 'live-a').failed,
    error: state(run, 'live-a').error
  }, { status: 'error', completed: 1, failed: 1, error: 'free is unavailable' })
  assert.equal(await run.execute('live-b', async () => 'B observation'), 'B observation')
  run.finish()
})

test('finish marks untouched hosts skipped and preserves completed and failed evidence', async () => {
  const run = new MultiHostRun([...targets(), { id: 'live-c', name: 'C', host: 'c.fixture.invalid' }], new AbortController().signal)
  await run.execute('live-a', async () => 'A completed')
  await assert.rejects(run.execute('live-b', async () => { throw new Error('B check failed') }), /B check failed/)
  run.finish()
  run.finish()
  assert.deepEqual(run.snapshot().map(item => item.status), ['complete', 'error', 'skipped'])
  assert.deepEqual(run.snapshot().map(item => item.completed), [1, 0, 0])
  let invoked = false
  await assert.rejects(run.execute('live-c', async () => { invoked = true }), /已停止此服务器/)
  assert.equal(invoked, false)
})

test('a signal aborted before run creation immediately stops every selected host', async () => {
  const controller = new AbortController()
  controller.abort()
  const run = new MultiHostRun(targets(), controller.signal)
  assert.deepEqual(run.snapshot().map(item => item.status), ['stopped', 'stopped'])
  let invoked = false
  await assert.rejects(run.execute('live-a', async () => { invoked = true }), /已停止此服务器/)
  assert.equal(invoked, false)
  run.finish()
})

test('finishing while an action is in flight cancels it without changing stopped into an error', async () => {
  const controller = new AbortController()
  const run = new MultiHostRun(targets(), controller.signal)
  const release = deferred<string>()
  let activeSignal: AbortSignal | undefined
  const pending = run.execute('live-a', async signal => { activeSignal = signal; return release.promise })
  const rejected = assert.rejects(pending, /已停止此服务器/)
  run.finish()
  assert.equal(activeSignal?.aborted, true)
  assert.deepEqual(run.snapshot().map(item => item.status), ['stopped', 'skipped'])
  release.resolve('late observation')
  await rejected
  controller.abort()
  assert.deepEqual(run.snapshot().map(item => item.status), ['stopped', 'skipped'])
  assert.equal(state(run, 'live-a').failed, 0)
  assert.equal(state(run, 'live-a').completed, 0)
})

test('host phases publish scoped progress and cannot mutate stopped or finished hosts', () => {
  const published: HostRunState[][] = []
  const run = new MultiHostRun(targets(), new AbortController().signal, snapshot => published.push(snapshot))
  assert.throws(() => run.setPhase('unselected', 'executing', 'No access'), /不在本次选择范围/)
  run.setPhase('live-a', 'executing', '启动容器', '部署应用')
  assert.deepEqual({ ...state(run, 'live-a') }, {
    ...targets()[0], status: 'waiting', completed: 0, failed: 0,
    phase: 'executing', label: '启动容器', stageName: '部署应用'
  })
  assert.equal(published.at(-1)?.[0].phase, 'executing')
  assert.equal(state(run, 'live-b').phase, undefined)
  run.stopTarget('live-a')
  const stopped = state(run, 'live-a')
  run.setPhase('live-a', 'verifying', '不应发布')
  assert.deepEqual(state(run, 'live-a'), stopped)
  run.finish()
  const finished = run.snapshot()
  run.setPhase('live-b', 'inspecting', '迟到的检查')
  assert.deepEqual(run.snapshot(), finished)
})
