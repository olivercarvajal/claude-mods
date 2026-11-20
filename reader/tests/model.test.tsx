// Run: claude plugin test ~/.claude/mods/reader
import { expect, test } from 'claude-code/testing'

import { modelLabel } from '../hooks/model'

// Stands for the engine: an empty answer to any request.
async function* engineStep(_: unknown, e: { turnId: string; index: number }) {
  yield* []

  return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
}

const FOOTER = { plugin: 'reader', surface: 'terminal', component: 'SessionMode', props: { modes: [] } } as const

test('model ids read as their names', () => {
  expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelLabel('claude-fable-5-2[1m]')).toBe('Fable 5.2')
  expect(modelLabel('claude-opus-5-20260101')).toBe('Opus 5')
  expect(modelLabel('opus')).toBe('opus')
})

test('the footer shows the effort saved for the model until a request says otherwise', async ($, on) => {
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('settings.read', () => ({ value: { effortLevel: 'high', modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } } } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.get', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('turn.step', engineStep)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(FOOTER)
  expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '▰▰▰▰' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' xhigh' })).toBeDefined()

  for await (const chunk of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'max', messageCount: 1 })) {
    void chunk
  }
  expect(await ui.find({ type: 'Text', text: '▰▰▰▰▰' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' max' })).toBeDefined()
  await ui.unmount()
})

test("a subagent's request leaves the footer alone", async ($, on) => {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'high' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.get', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('turn.step', engineStep)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for await (const chunk of $.turn.step({ turnId: 't1', index: 0, model: 'claude-haiku-4-5', effort: 'low', messageCount: 1, agentId: 'a1' })) {
    void chunk
  }
  const ui = await $.ui.mount(FOOTER)
  expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' high' })).toBeDefined()
  await ui.unmount()
})
