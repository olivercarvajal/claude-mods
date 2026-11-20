// Run: claude plugin test ~/.claude/mods/reader
import { expect, test } from 'claude-code/testing'

import { diagramParts, splitReply, termsIn } from '../hooks/blocks'

const REPLY = { plugin: 'reader', surface: 'terminal', component: 'AssistantMessage' } as const

const MIXED = [
  'Two files:',
  '',
  '| File | Lines |',
  '| --- | ---: |',
  '| `blocks.ts` | 120 |',
  '| **register.tsx** | 9 |',
  '',
  '```json',
  '{ "ok": true }',
  '```',
].join('\n')

test('a table and a fence get their own drawing', async $ => {
  const ui = await $.ui.mount({ ...REPLY, props: { text: MIXED, isFirstOfReply: true } })

  expect((await ui.find({ type: 'Code' }))?.props).toMatchObject({ language: 'json' })
  expect(await ui.find({ type: 'Text', text: /blocks\.ts\s+│\s+120/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /─┼─/ })).toBeDefined()
  await ui.unmount()
})

test('titles and bold get their own colors, the first block its bullet', async $ => {
  const text = '**Steps**\n\n1. **Create:** the [builder](https://urdi.ai) draws it'
  const ui = await $.ui.mount({ ...REPLY, props: { text, isFirstOfReply: true } })
  // The innermost Text carries the color; the row's Text around it matches the same text.
  const colorOf = async (shown: string) => (await ui.findAll({ type: 'Text', text: shown })).at(-1)?.props.color

  expect(await colorOf('Steps')).toBe('#f49ad6')
  expect(await colorOf('Create:')).toBe('#89b4fa')
  expect(await ui.find({ type: 'Link' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '⏺' })).toBeDefined()
  await ui.unmount()
})

test('a flow draws each node in its own box with the arrow label between', async $ => {
  const text = ['```flow', 'repo: src/Poster.tsx', '  + the PNGs', '-> urdi release', 'os: uploads to S3', '```'].join('\n')
  const ui = await $.ui.mount({ ...REPLY, props: { text, isFirstOfReply: true } })
  const boxes = await ui.findAll({ type: 'Box' })

  expect(boxes.filter(box => box.props.borderStyle === 'round')).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: /urdi release/ })).toBeDefined()
  await ui.unmount()
})

test('bars scale to the largest value', async $ => {
  const text = '```bars\nbefore: 800 KB\nafter: 400 KB\n```'
  const ui = await $.ui.mount({ ...REPLY, props: { text, isFirstOfReply: true } })
  // Bars are padded to one width so the values line up.
  const bars = (await ui.findAll({ type: 'Text', text: /^█+\s*$/ })).map(bar => bar.text.trim().length)

  expect(bars).toHaveLength(2)
  expect(bars[0]).toBe((bars[1] ?? 0) * 2)
  await ui.unmount()
})

test('a flow parses nodes, continuations and edges', () => {
  const [flow] = splitReply('```flow\nrepo: src\n  + more\n-> release\nos\n```')

  expect(flow).toEqual({
    kind: 'flow',
    steps: [
      { kind: 'node', node: { title: 'repo', body: ['src', '+ more'] } },
      { kind: 'edge', label: 'release' },
      { kind: 'node', node: { title: 'os', body: [] } },
    ],
  })
})

test('terms come out of every terms block', () => {
  const text = 'Intro\n```terms\nfork: a side question over the same chat\n```\nMore\n```terms\npane: a panel next to the chat\n```'

  expect(termsIn(text).map(term => term.term)).toEqual(['fork', 'pane'])
})

test('the rule row sets each column alignment', () => {
  const [, table] = splitReply(MIXED)

  expect(table).toMatchObject({ kind: 'table', aligns: ['left', 'right'] })
})

test('a fence still streaming runs to the end, unlabeled JSON included', () => {
  const [, code] = splitReply('Here:\n```\n[1, 2')

  expect(code).toEqual({ kind: 'code', language: 'json', source: '[1, 2' })
})

test('a diagram row splits into nodes, connectors and edge labels', () => {
  expect(diagramParts('os: copy the build')).toEqual([
    { role: 'node', text: 'os:' },
    { role: 'plain', text: ' copy the build' },
  ])
  expect(diagramParts('  src ──pnpm poster──▶ public')).toEqual([
    { role: 'plain', text: '  src ' },
    { role: 'line', text: '──' },
    { role: 'label', text: 'pnpm poster' },
    { role: 'line', text: '──▶' },
    { role: 'plain', text: ' public' },
  ])
  expect(diagramParts('│ a │ b │').map(part => part.role)).not.toContain('label')
})

test('status, diff sizes, limits and picks get their colors', async $ => {
  const text = [
    '- Zoom: ajustado o igual. Mía: ajustado.',
    '',
    '```status',
    'done: os#1414',
    'wait: TestFlight 0.67.0',
    'deployed: app#500',
    'in progress: web deploy 7c4a9c60',
    'needs you: pick a variant',
    '```',
    '',
    '```',
    'This change    +51 -1   2 files',
    '```',
    '',
    '```bars',
    'step 1: 20000 tokens',
    'step 4: 110000 tokens',
    'limit: 64000',
    '```',
  ].join('\n')
  const ui = await $.ui.mount({ ...REPLY, props: { text, isFirstOfReply: true } })
  const colorOf = async (shown: string | RegExp) => (await ui.findAll({ type: 'Text', text: shown })).at(-1)?.props.color

  expect(await colorOf('Mía:')).toBe('#b5d99c')
  expect(await colorOf(/✅ done/)).toBe('#b5d99c')
  expect(await colorOf(/◷ {2}wait/)).toBe('#f0e2b6')
  expect(await colorOf(/🚀 deployed/)).toBe('#cba6f7')
  expect(await colorOf(/⏳ in progress/)).toBe('#f0e2b6')
  expect(await colorOf(/👉 needs you/)).toBe('#f49ad6')
  expect(await colorOf('+51')).toBe('#b5d99c')
  expect(await colorOf('-1')).toBe('#e86a6a')
  expect(await colorOf(/^█+\s*$/)).toBe('#e86a6a')
  expect(await ui.find({ type: 'Text', text: /┤/ })).toBeDefined()
  await ui.unmount()
})

test('a date in a diff-size block stays plain', () => {
  const [stats] = splitReply('```\nBranch 2026-11-18  +12 -3\n```')

  expect(stats).toEqual({ kind: 'stats', rows: ['Branch 2026-11-18  +12 -3'] })
})
