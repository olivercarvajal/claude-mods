// Run: claude plugin test ~/.claude/mods/reader
import { expect, test } from 'claude-code/testing'

import { modelLabel } from '../hooks/model'

// Stands for the engine: an empty answer to any request.
async function* engineStep(_: unknown, e: { turnId: string; index: number }) {
  yield* []

  return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
}

const usage = (percent?: number) => ({ value: { startedAt: 0, context: { window: 200000, percent }, rateLimits: [] } })

const SUMMARY = { role: 'user' as const, text: 'Summary of the conversation so far', toolUses: [] }

const FOOTER = {
  plugin: 'reader',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 78,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('model ids read as their names', () => {
  expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelLabel('claude-fable-5-2[1m]')).toBe('Fable 5.2')
  expect(modelLabel('claude-opus-5-20260101')).toBe('Opus 5')
  expect(modelLabel('opus')).toBe('opus')
})

test('the row shows the saved effort until a request says otherwise, and the context used', async ($, on) => {
  let percent: number | undefined
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('settings.read', () => ({ value: { effortLevel: 'high', modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' } } } }))
  on('session.usage', () => usage(percent))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.get', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('turn.step', engineStep)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(FOOTER)
  expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▰▰▱▱▱ medium/ })).toBeDefined()
  // No reading before the first request: no context pill.
  expect(await ui.find({ type: 'Text', text: /%/ })).toBeUndefined()

  percent = 84
  for await (const chunk of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 })) {
    void chunk
  }
  expect(await ui.find({ type: 'Text', text: /▰▰▰▱▱ high/ })).toBeDefined()
  const context = (await ui.findAll({ type: 'Text', text: '84%' })).at(-1)
  expect(context?.props.color).toBe('#e86a6a')
  await ui.unmount()
})

test("a subagent's request leaves the row alone", async ($, on) => {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'high' } }))
  on('session.usage', () => usage(12))
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
  expect(await ui.find({ type: 'Text', text: /▰▰▰▱▱ high/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '12%' })).toBeDefined()
  await ui.unmount()
})

test('a model without effort shows no effort pill', async ($, on) => {
  on('session.model', () => ({ value: 'claude-haiku-4-5' }))
  on('settings.read', () => ({ value: {} }))
  on('session.usage', () => usage(30))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.get', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(FOOTER)
  expect(await ui.find({ type: 'Text', text: 'Haiku 4.5' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▰/ })).toBeUndefined()
  await ui.unmount()
})

test('an idle xhigh lights no letter, and compaction drops the context reading', async ($, on) => {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
  on('session.usage', () => usage(64))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.compact', () => ({ messages: [SUMMARY] }))
  on('store.get', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(FOOTER)
  const letters = await ui.findAll({ type: 'Text', text: /^[xhig]$/ })
  expect(letters.map(letter => letter.props.color)).toEqual(['#af87ff', '#af87ff', '#af87ff', '#af87ff', '#af87ff'])
  expect(await ui.find({ type: 'Text', text: '64%' })).toBeDefined()

  await $.session.compact({ trigger: 'manual', messages: [SUMMARY, SUMMARY] })
  expect(await ui.find({ type: 'Text', text: /%/ })).toBeUndefined()
  await ui.unmount()
})

test('the context turns yellow from 30% and red from 60%', async ($, on) => {
  let percent = 29
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('session.usage', () => usage(percent))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.get', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('turn.step', engineStep)
  const colorAt = async (value: number) => {
    percent = value
    for await (const chunk of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) {
      void chunk
    }
    const ui = await $.ui.mount(FOOTER)
    const color = (await ui.findAll({ type: 'Text', text: `${value}%` })).at(-1)?.props.color
    await ui.unmount()

    return color
  }
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(await colorAt(29)).toBe('#4eba65')
  expect(await colorAt(30)).toBe('#ffc107')
  expect(await colorAt(59)).toBe('#ffc107')
  expect(await colorAt(60)).toBe('#e86a6a')
})
