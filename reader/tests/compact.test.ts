// Run: claude plugin test ~/.claude/mods/reader
import { expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

const prompt = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
const reply = (text: string): SessionMessage => ({ role: 'assistant', text, toolUses: [] })
const toolCall: SessionMessage = {
  role: 'assistant',
  text: '',
  toolUses: [{ tool_use_id: 'tu1', tool: 'Bash', input: { command: 'ls' } }],
}
const toolResult: SessionMessage = {
  role: 'user',
  text: '',
  toolUses: [],
  toolResults: [{ tool_use_id: 'tu1', text: 'a.ts', isError: false }],
}

const CONVERSATION = [
  prompt('first'),
  reply('one'),
  prompt('second'),
  reply('two'),
  prompt('third'),
  reply('Checking.'),
  toolCall,
  toolResult,
  reply('Three.'),
  prompt('fourth'),
  reply('four'),
]

test('the last two exchanges come back whole after the summary, without tool calls', async ($, on) => {
  let summarized: readonly SessionMessage[] = []
  on('session.compact', (_, e) => {
    summarized = e.messages
    return { messages: [prompt('Summary')] }
  })

  const compacted = await $.session.compact({ trigger: 'auto', messages: CONVERSATION })

  expect(summarized.map(m => m.text)).toEqual(['first', 'one', 'second', 'two'])
  expect(compacted.messages?.map(m => [m.role, m.text])).toEqual([
    ['user', 'Summary'],
    ['user', 'third'],
    ['assistant', 'Checking.\n\nThree.'],
    ['user', 'fourth'],
    ['assistant', 'four'],
  ])
})

test('a precompute is skipped and a short conversation compacts whole', async ($, on) => {
  let summarized = 0
  on('session.compact', (_, e) => {
    summarized = e.messages.length
    return { messages: [prompt('Summary')] }
  })

  const ahead = await $.session.compact({ trigger: 'precompute', messages: CONVERSATION })
  expect(ahead.skip).toBeDefined()

  await $.session.compact({ trigger: 'manual', messages: CONVERSATION.slice(0, 4) })
  expect(summarized).toBe(4)
})
