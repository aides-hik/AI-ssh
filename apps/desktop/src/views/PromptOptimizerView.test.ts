import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

async function loadSaveHandler(sessionId: string | null, fail = false) {
  const source = await readFile(new URL('./PromptOptimizerView.vue', import.meta.url), 'utf8')
  const script = source.slice(source.indexOf('<script setup lang="ts">') + 24, source.indexOf('</script>'))
  const parsed = ts.createSourceFile('optimizer.ts', script, ts.ScriptTarget.Latest, true)
  const declaration = parsed.statements.find(statement =>
    ts.isVariableStatement(statement) && statement.declarationList.declarations.some(item => item.name.getText(parsed) === 'savePrompt')
  )
  assert(declaration)
  const javascript = ts.transpileModule(declaration.getText(parsed), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText
  const updates: unknown[] = [], notices: string[] = [], events: Event[] = []
  const state = {
    generatedPrompt: { value: '优化后的提示词' },
    localStorage: { getItem: () => sessionId },
    chatService: { updateSession: async (...args: unknown[]) => {
      if (fail) throw new Error('storage unavailable')
      updates.push(args)
    } },
    window: { dispatchEvent: (event: Event) => events.push(event) },
    $alert: (message: string) => notices.push(message)
  }
  const run = new Function(...Object.keys(state), javascript + '\nreturn savePrompt')(...Object.values(state)) as () => Promise<void>
  return { run, updates, notices, events }
}

test('saving a prompt requires a current session and never reports a save without one', async () => {
  const state = await loadSaveHandler(null)
  await state.run()
  assert.equal(state.updates.length, 0)
  assert.equal(state.events.length, 0)
  assert.match(state.notices[0], /先打开.*会话/)
})

test('saving a prompt stores the session config and announces a local save only after success', async () => {
  const state = await loadSaveHandler('session-fixture')
  await state.run()
  const [sessionId, update] = state.updates[0] as [string, { config: { systemPrompt: string; updatedAt: string } }]
  assert.equal(sessionId, 'session-fixture')
  assert.equal(update.config.systemPrompt, '优化后的提示词')
  assert(Number.isFinite(Date.parse(update.config.updatedAt)))
  assert.equal(state.events[0].type, 'session-prompt-updated')
  assert.match(state.notices[0], /本地配置/)
  assert.doesNotMatch(state.notices[0], /数据库/)
})

test('a prompt storage failure reports failure and does not announce a session update', async () => {
  const state = await loadSaveHandler('session-fixture', true)
  await state.run()
  assert.equal(state.events.length, 0)
  assert.match(state.notices[0], /保存失败.*storage unavailable/)
})
