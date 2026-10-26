import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import { createPreviewModelFetch } from './model-fetch'
import { installPreviewModels, PREVIEW_PROVIDER } from './models'
import { LLMSession } from '../services/llm'
import { fetchModelsForProvider } from '../services/model-fetcher.service'
import { PREVIEW_SERVERS } from './servers'

const endpoint = 'https://models.prism-preview.invalid/v1'
const noNetwork: typeof fetch = async () => {
  throw new Error('Preview request escaped to the network')
}

test('preview fetch delegates unrelated requests without changing their input or options', async () => {
  const response = new Response('native response')
  const input = new Request('https://models.prism-preview.invalid.example/v1/models')
  const init = { headers: { 'X-Fixture': 'test' } }
  const seen: unknown[][] = []
  const previewFetch = createPreviewModelFetch(async (...args) => {
    seen.push(args)
    return response
  })
  assert.equal(await previewFetch(input, init), response)
  assert.equal(await previewFetch('/src/main.ts'), response)
  assert.deepEqual(seen, [
    [input, init],
    ['/src/main.ts', undefined]
  ])
})

test('preview catalog and JSON completion never use the network and report selected model and effort', async () => {
  const previewFetch = createPreviewModelFetch(noNetwork)
  const catalog = await (await previewFetch(`${endpoint}/models`)).json()
  assert.deepEqual(
    catalog.data.map((model: { id: string }) => model.id),
    PREVIEW_PROVIDER.models.map(model => model.id)
  )
  const model = PREVIEW_PROVIDER.models[0]
  const response = await previewFetch(
    new Request(`${endpoint}/chat/completions`, {
      method: 'POST',
      body: JSON.stringify({ model: model.id, reasoning_effort: 'high' })
    })
  )
  const completion = await response.json()
  assert.equal(completion.model, model.id)
  assert.ok(completion.choices[0].message.content.includes(model.name))
  assert.match(completion.choices[0].message.content, /推理强度：高/)
  assert.equal(completion.choices[0].finish_reason, 'stop')
})

test('preview stream is consumable by the actual terminal session and honors reasoning toggles', async context => {
  context.mock.method(globalThis, 'fetch', createPreviewModelFetch(noNetwork))
  const model = PREVIEW_PROVIDER.models.find(model => model.id === 'preview-think')
  assert.ok(model)
  const session = new LLMSession(
    PREVIEW_PROVIDER,
    model,
    [],
    'preview-server',
    undefined,
    undefined,
    undefined,
    'none'
  )
  const chunks = []
  for await (const chunk of session.stream([{ role: 'user', content: '测试模型' }]))
    chunks.push(chunk)
  const content = chunks
    .filter(chunk => chunk.type === 'text')
    .map(chunk => chunk.content)
    .join('')
  assert.match(content, /推理强度：关闭/)
  assert.match(content, /模拟回复/)
  assert.equal(chunks.filter(chunk => chunk.type === 'done').length, 1)
  assert.equal(
    chunks.some(chunk => chunk.type === 'tool-call'),
    false
  )
})

test('refreshing the preview model catalog preserves each reasoning capability', async context => {
  installPreviewModels({ getItem: () => null, setItem: () => undefined })
  context.mock.method(globalThis, 'fetch', createPreviewModelFetch(noNetwork))
  const result = await fetchModelsForProvider(
    PREVIEW_PROVIDER.id,
    PREVIEW_PROVIDER.apiKey,
    PREVIEW_PROVIDER.endpoint
  )
  assert.equal(result.success, true)
  assert.deepEqual(
    result.models?.map(model => ({ id: model.id, reasoning: model.reasoning })),
    PREVIEW_PROVIDER.models.map(model => ({ id: model.id, reasoning: model.reasoning }))
  )
})

test('preview rejects aborted and invalid requests locally', async () => {
  const previewFetch = createPreviewModelFetch(noNetwork)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(previewFetch(`${endpoint}/models`, { signal: controller.signal }), {
    name: 'AbortError'
  })
  assert.equal((await previewFetch(`${endpoint}/unknown`)).status, 404)
  assert.equal(
    (await previewFetch(`${endpoint}/chat/completions`, { method: 'POST', body: 'invalid' }))
      .status,
    400
  )
  assert.equal(
    (
      await previewFetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        body: JSON.stringify({ model: 'missing' })
      })
    ).status,
    400
  )
})

test('multi-host preview emits one inspection per target that the real LLM stream can parse', async context => {
  context.mock.method(globalThis, 'fetch', createPreviewModelFetch(noNetwork))
  const targets = PREVIEW_SERVERS.map(({ id, name, host }) => ({ id, name, host }))
  const session = new LLMSession(PREVIEW_PROVIDER, PREVIEW_PROVIDER.models[0], [{ id: 'inspect_server', init: async () => ({ description: 'Fixture inspection', parameters: z.object({ targetId: z.string() }), execute: async () => { throw new Error('Model fixture does not execute tools') } }) }], 'preview-server')
  const chunks = []
  for await (const chunk of session.stream([
    { role: 'system', content: `<multi_host_targets>${JSON.stringify(targets)}</multi_host_targets>` },
    { role: 'user', content: '并行检查这三台主机' }
  ])) chunks.push(chunk)
  const calls = chunks.filter(chunk => chunk.type === 'tool-call')
  assert.deepEqual(calls.map(call => call.toolInput.targetId), targets.map(target => target.id))
  assert.ok(calls.every(call => call.toolName === 'inspect_server'))
  assert.ok(calls.every(call => call.toolInput.checks.includes('disk')))
  assert.equal(chunks.at(-1)?.finish, 'tool-calls')
})

test('multi-host preview summary preserves successful, failed, stopped and missing results', async () => {
  const previewFetch = createPreviewModelFetch(noNetwork)
  const targets: Array<{ id: string; name: string; host: string }> = PREVIEW_SERVERS.map(({ id, name, host }) => ({ id, name, host }))
  targets.push({ id: 'preview-missing', name: '未返回的服务器', host: 'missing.prism.local' })
  const calls = targets.map((target, index) => ({ id: `call-${index}`, type: 'function', function: { name: 'inspect_server', arguments: JSON.stringify({ targetId: target.id }) } }))
  const response = await previewFetch(`${endpoint}/chat/completions`, { method: 'POST', body: JSON.stringify({
    model: 'preview-pro',
    messages: [
      { role: 'system', content: `<multi_host_targets>${JSON.stringify(targets)}</multi_host_targets>` },
      { role: 'user', content: '检查所有主机' },
      { role: 'assistant', content: '', tool_calls: calls },
      { role: 'tool', tool_call_id: 'call-0', content: JSON.stringify({ targetId: targets[0].id, success: true, output: 'CPU usage: 12.4%\nMemory: 2.1 GiB / 8.0 GiB\n/dev/vda1 100G 28G 72G 28% /' }) },
      { role: 'tool', tool_call_id: 'call-1', content: `[${targets[1].name} / ${targets[1].id}] 服务器连接已断开` },
      { role: 'tool', tool_call_id: 'call-2', content: `[${targets[2].name} / ${targets[2].id}] 已停止此服务器的任务` }
    ]
  }) })
  const completion = await response.json()
  const content = completion.choices[0].message.content
  assert.equal(completion.choices[0].finish_reason, 'stop')
  assert.match(content, /1\/4 台完成/)
  assert.match(content, /演示服务器 · UI 测试 \| 已完成 \| CPU 12.4%/)
  assert.match(content, /Web 节点 02 · UI 测试 \| 未完成 \| .*已断开/)
  assert.match(content, /数据库节点 01 · UI 测试 \| 已停止/)
  assert.match(content, /未返回的服务器 \| 未执行/)
  assert.doesNotMatch(content, /磁盘占用较高/)
})

test('multi-host preview starts a new inspection after a new user message instead of reusing old results', async () => {
  const previewFetch = createPreviewModelFetch(noNetwork)
  const target = PREVIEW_SERVERS[0]
  const response = await previewFetch(`${endpoint}/chat/completions`, { method: 'POST', body: JSON.stringify({ model: 'preview-pro', tools: [{ type: 'function', function: { name: 'inspect_server' } }], messages: [
    { role: 'system', content: `<multi_host_targets>${JSON.stringify([target])}</multi_host_targets>` },
    { role: 'user', content: '上次请求' },
    { role: 'tool', tool_call_id: 'old-call', content: JSON.stringify({ targetId: target.id, success: true, output: '旧结果' }) },
    { role: 'assistant', content: '上次完成' },
    { role: 'user', content: '重新检查' }
  ] }) })
  const completion = await response.json()
  assert.equal(completion.choices[0].finish_reason, 'tool_calls')
  assert.equal(completion.choices[0].message.tool_calls.length, 1)
})

const deploymentTargets = PREVIEW_SERVERS.map(({ id, name, host }) => ({ id, name, host }))
const deploymentTools = ['inspect_server', 'execute_deployment_stage'].map(name => ({ type: 'function', function: { name } }))
const deploymentMessages = () => [
  { role: 'system', content: `<multi_host_targets>${JSON.stringify(deploymentTargets)}</multi_host_targets>` },
  { role: 'user', content: '用 Docker Compose 部署演示项目' }
]
const inspectionMessages = (failed = false) => [
  { role: 'assistant', content: '', tool_calls: deploymentTargets.map((target, index) => ({ id: `inspect-${index}`, type: 'function', function: { name: 'inspect_server', arguments: JSON.stringify({ targetId: target.id }) } })) },
  ...deploymentTargets.map((target, index) => ({ role: 'tool', tool_call_id: `inspect-${index}`, content: JSON.stringify({ targetId: target.id, success: !failed || index !== 1, output: failed && index === 1 ? '检查失败' : '模拟检查完成' }) }))
]
const stageCallMessage = { role: 'assistant', content: '', tool_calls: [{ id: 'stage-call', type: 'function', function: { name: 'execute_deployment_stage', arguments: '{}' } }] }

async function deploymentCompletion(messages: unknown[], tools = deploymentTools) {
  const response = await createPreviewModelFetch(noNetwork)(`${endpoint}/chat/completions`, { method: 'POST', body: JSON.stringify({ model: 'preview-pro', tools, messages }) })
  return (await response.json()).choices[0]
}

test('Compose preview inspects first, then proposes one rolling stage with exact selected targets', async () => {
  const initial = await deploymentCompletion(deploymentMessages())
  assert.equal(initial.finish_reason, 'tool_calls')
  assert.ok(initial.message.tool_calls.every((call: { function: { name: string } }) => call.function.name === 'inspect_server'))
  assert.match(initial.message.content, /确认的 Compose 部署阶段/)
  const prepared = await deploymentCompletion([...deploymentMessages(), ...inspectionMessages()])
  assert.equal(prepared.message.tool_calls.length, 1)
  assert.equal(prepared.message.tool_calls[0].function.name, 'execute_deployment_stage')
  const stage = JSON.parse(prepared.message.tool_calls[0].function.arguments)
  assert.equal(stage.strategy, 'rolling')
  assert.equal(stage.kind, 'deploy')
  assert.deepEqual(stage.steps.map((step: { targetId: string }) => step.targetId), deploymentTargets.map(target => target.id))
  assert.ok(stage.steps.every((step: { command: string; verifyCommand: string }) => step.command.includes('docker compose up -d') && step.verifyCommand.includes('docker compose ps') && step.verifyCommand.includes('curl --fail') && step.verifyCommand.includes('--max-time 15')))
})

test('Compose preview planning and read-only requests never submit a deployment stage', async () => {
  for (const request of ['只规划 Docker Compose 部署', '部署先分析可行性', '部署只读检查，不要修改服务器', 'Docker Compose 部署计划，不要执行']) {
    const base = deploymentMessages()
    base[1].content = request
    const prepared = await deploymentCompletion([...base, ...inspectionMessages()])
    assert.equal(prepared.finish_reason, 'stop')
    assert.equal(prepared.message.tool_calls, undefined)
    assert.doesNotMatch(prepared.message.content, /确认后才逐台执行/)
  }
})

test('Compose preview does not propose deployment when inspection fails or the stage tool is unavailable', async () => {
  const failed = await deploymentCompletion([...deploymentMessages(), ...inspectionMessages(true)])
  assert.equal(failed.finish_reason, 'stop')
  assert.match(failed.message.content, /部署准备未通过/)
  assert.match(failed.message.content, /尚未提交部署命令/)
  assert.equal(failed.message.tool_calls, undefined)
  const unavailable = await deploymentCompletion(deploymentMessages(), deploymentTools.slice(0, 1))
  assert.equal(unavailable.finish_reason, 'stop')
  assert.match(unavailable.message.content, /没有可用的多服务器部署工具/)
})

test('Compose preview completion requires successful command and verification evidence for every node', async () => {
  const steps = deploymentTargets.map(target => ({ targetId: target.id, targetName: target.name, host: target.host, label: '部署', status: 'completed', verified: true, commandResult: { success: true, output: '启动完成' }, verificationResult: { success: true, output: 'healthy' } }))
  const outcome = await deploymentCompletion([...deploymentMessages(), ...inspectionMessages(), stageCallMessage,
    { role: 'tool', tool_call_id: 'stage-call', content: JSON.stringify({ stage: { name: '演示部署', kind: 'deploy', strategy: 'rolling' }, status: 'completed', steps }) }
  ])
  assert.equal(outcome.finish_reason, 'stop')
  assert.equal(outcome.message.tool_calls, undefined)
  assert.match(outcome.message.content, /3\/3 台完成/)
  assert.match(outcome.message.content, /不会访问真实服务器/)
  // A status label alone cannot turn an unverified operation into a success.
  delete (steps[1] as Partial<typeof steps[number]>).verificationResult
  const unverified = await deploymentCompletion([...deploymentMessages(), ...inspectionMessages(), stageCallMessage,
    { role: 'tool', tool_call_id: 'stage-call', content: JSON.stringify({ status: 'completed', steps }) }
  ])
  assert.match(unverified.message.content, /2\/3 台完成/)
  assert.match(unverified.message.content, /Web 节点 02 · UI 测试 \| 未完成/)
})

test('Compose preview preserves failed, skipped and stopped nodes without resubmitting the stage', async () => {
  const steps = [
    { targetId: deploymentTargets[0].id, status: 'failed', error: '镜像拉取失败' },
    { targetId: deploymentTargets[1].id, status: 'skipped' },
    { targetId: deploymentTargets[2].id, status: 'stopped' }
  ]
  const outcome = await deploymentCompletion([...deploymentMessages(), ...inspectionMessages(), stageCallMessage,
    { role: 'tool', tool_call_id: 'stage-call', content: JSON.stringify({ status: 'failed', steps }) }
  ])
  assert.equal(outcome.finish_reason, 'stop')
  assert.equal(outcome.message.tool_calls, undefined)
  assert.match(outcome.message.content, /0\/3 台完成/)
  assert.match(outcome.message.content, /镜像拉取失败/)
  assert.match(outcome.message.content, /Web 节点 02 · UI 测试 \| 未执行/)
  assert.match(outcome.message.content, /数据库节点 01 · UI 测试 \| 已停止/)
  assert.match(outcome.message.content, /未自动回滚/)
})

test('Compose preview rejection and invalid stage results never become a new deployment call or success', async () => {
  for (const content of [JSON.stringify({ status: 'rejected', steps: [] }), 'Request aborted', '{malformed']) {
    const outcome = await deploymentCompletion([...deploymentMessages(), ...inspectionMessages(), stageCallMessage,
      { role: 'tool', tool_call_id: 'stage-call', content }
    ])
    assert.equal(outcome.finish_reason, 'stop')
    assert.equal(outcome.message.tool_calls, undefined)
    assert.match(outcome.message.content, /0\/3 台完成/)
    assert.match(outcome.message.content, /未执行/)
  }
})

test('a single selected host preserves ordinary model and reasoning previews without triggering inspection', async () => {
  for (const content of ['你好', '测试字体大小', '测试模型切换和推理强度']) {
    const response = await createPreviewModelFetch(noNetwork)(`${endpoint}/chat/completions`, { method: 'POST', body: JSON.stringify({
      model: 'preview-pro', reasoning_effort: 'high', tools: deploymentTools,
      messages: [{ role: 'system', content: `<multi_host_targets>${JSON.stringify([deploymentTargets[0]])}</multi_host_targets>` }, { role: 'user', content }]
    }) })
    const result = (await response.json()).choices[0]
    assert.equal(result.finish_reason, 'stop')
    assert.equal(result.message.tool_calls, undefined)
    assert.match(result.message.content, /推理强度：高/)
    assert.match(result.message.content, /未执行服务器命令/)
  }
})

test('single-host inspection and Compose deployment use the same explicit-target tools as multi-host operations', async () => {
  const target = deploymentTargets[0]
  const system = { role: 'system', content: `<multi_host_targets>${JSON.stringify([target])}</multi_host_targets>` }
  const inspection = await deploymentCompletion([system, { role: 'user', content: '检查当前主机的 CPU 和内存' }])
  assert.equal(inspection.message.tool_calls.length, 1)
  assert.equal(inspection.message.tool_calls[0].function.name, 'inspect_server')
  assert.equal(JSON.parse(inspection.message.tool_calls[0].function.arguments).targetId, target.id)
  const ready = await deploymentCompletion([system, { role: 'user', content: '部署 Docker Compose 演示项目' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'single-inspect', type: 'function', function: { name: 'inspect_server', arguments: JSON.stringify({ targetId: target.id }) } }] },
    { role: 'tool', tool_call_id: 'single-inspect', content: JSON.stringify({ targetId: target.id, success: true, output: '模拟检查完成' }) }
  ])
  const stage = JSON.parse(ready.message.tool_calls[0].function.arguments)
  assert.equal(stage.steps.length, 1)
  assert.equal(stage.steps[0].targetId, target.id)
  assert.match(stage.name, /单机/)
  assert.equal(stage.timeoutSeconds, 300)
})

test('explicit Docker version requests propose the same confirmed command for one or several hosts', async () => {
  const tools = [{ type: 'function', function: { name: 'execute_ssh_command' } }]
  for (const targets of [deploymentTargets.slice(0, 1), deploymentTargets]) {
    const initial = await deploymentCompletion([
      { role: 'system', content: `<multi_host_targets>${JSON.stringify(targets)}</multi_host_targets>` },
      { role: 'user', content: '执行 docker version，查看 Docker 版本' }
    ], tools)
    assert.equal(initial.finish_reason, 'tool_calls')
    assert.deepEqual(initial.message.tool_calls.map((call: { function: { name: string; arguments: string } }) => ({
      name: call.function.name, ...JSON.parse(call.function.arguments)
    })), targets.map(target => ({ name: 'execute_ssh_command', targetId: target.id, command: 'docker version', label: '查看 Docker 版本', timeoutSeconds: 60 })))
    assert.match(initial.message.content, /确认后执行/)
  }
  const planning = await deploymentCompletion([
    { role: 'system', content: `<multi_host_targets>${JSON.stringify(deploymentTargets.slice(0, 1))}</multi_host_targets>` },
    { role: 'user', content: '先分析 docker version，不要执行命令' }
  ], tools)
  assert.equal(planning.finish_reason, 'stop')
  assert.equal(planning.message.tool_calls, undefined)
})

test('command preview reports only received confirmed execution results and never retries rejection or failure', async () => {
  const target = deploymentTargets[0]
  const tools = [{ type: 'function', function: { name: 'execute_ssh_command' } }]
  const base = [
    { role: 'system', content: `<multi_host_targets>${JSON.stringify([target])}</multi_host_targets>` },
    { role: 'user', content: '执行 docker version' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'version-command', type: 'function', function: { name: 'execute_ssh_command', arguments: JSON.stringify({ targetId: target.id, command: 'docker version' }) } }] }
  ]
  for (const result of [
    { status: 'completed', steps: [{ targetId: target.id, status: 'completed', verified: false, commandResult: { success: true, exitCode: 0, output: 'Docker Engine (UI preview)' } }] },
    { status: 'rejected', steps: [] },
    { status: 'stopped', steps: [{ targetId: target.id, status: 'stopped' }] },
    { status: 'failed', steps: [{ targetId: target.id, status: 'failed', error: 'Docker 未安装' }] },
    { status: 'completed', steps: [{ targetId: target.id, status: 'completed', commandResult: { success: true, output: '缺少退出码' } }] }
  ]) {
    const response = await deploymentCompletion([...base, { role: 'tool', tool_call_id: 'version-command', content: JSON.stringify(result) }], tools)
    assert.equal(response.finish_reason, 'stop')
    assert.equal(response.message.tool_calls, undefined)
    const firstStep = result.steps[0]
    const commandResult = firstStep && 'commandResult' in firstStep ? firstStep.commandResult : undefined
    const success = result.status === 'completed' && commandResult && 'exitCode' in commandResult && commandResult.exitCode === 0
    assert.match(response.message.content, new RegExp(`${success ? 1 : 0}/1 台完成`))
    if (result.status === 'rejected') assert.match(response.message.content, /未获确认，未执行命令/)
  }
})
