import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const componentUrl = new URL('./DeploymentApproval.vue', import.meta.url)

async function decisions() {
  const source = await readFile(componentUrl, 'utf8')
  const script = source.slice(source.indexOf('>') + 1, source.indexOf('</script>'))
  const parsed = ts.createSourceFile('approval.ts', script, ts.ScriptTarget.Latest, true)
  const declarations = ['decide', 'stopRequest'].map(name => {
    const declaration = parsed.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name)
    assert.ok(declaration)
    return declaration.getText(parsed)
  })
  const javascript = ts.transpileModule(declarations.join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const settled = { value: false }
  const events: string[] = []
  const functions = new Function('settled', 'emit', `${javascript}\nreturn { decide, stopRequest }`)(settled, (event: string) => events.push(event)) as {
    decide: (approved: boolean) => void
    stopRequest: () => void
  }
  return { source, settled, events, ...functions }
}

test('approval stop emits only a whole-request stop, while cancelling still rejects only the stage', async () => {
  const stopped = await decisions()
  stopped.stopRequest()
  stopped.decide(true)
  stopped.decide(false)
  stopped.stopRequest()
  assert.deepEqual(stopped.events, ['stop'])
  assert.equal(stopped.settled.value, true)

  const cancelled = await decisions()
  cancelled.decide(false)
  cancelled.stopRequest()
  assert.deepEqual(cancelled.events, ['reject'])

  const approved = await decisions()
  approved.decide(true)
  approved.stopRequest()
  assert.deepEqual(approved.events, ['approve'])
})

test('the modal offers a focusable localized request stop and retains Escape as stage cancellation', async () => {
  const { source } = await decisions()
  assert.match(source, /<button[^>]*type="button"[^>]*class="oc-deployment-approval-stop"[^>]*:disabled="settled"[^>]*@click="stopRequest"/)
  assert.match(source, /'停止本次请求' : 'Stop this request'/)
  assert.match(source, /'取消本阶段' : 'Cancel stage'/)
  assert.match(source, /@keydown\.esc\.stop\.prevent="decide\(false\)"/)
})
