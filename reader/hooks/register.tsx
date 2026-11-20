import { atom, read, update } from 'claude-code'
import type { CommandSpec, EngineInterface, ModelEffort, Register } from 'claude-code'

import { splitReply, termsIn } from './blocks'
import { drawBlocks } from './draw'
import { modelRow, registerModel, startModel, stopModelFrames } from './model'
import type { Term } from '../types'

const PANE = 'reader'
const PANE_TITLE = 'Reader'
const GLOSSARY_KEY = 'glossary'
const MAX_TERMS = 300
// The engine's own reply row: a bullet on the first block, two columns of margin.
const BULLET = '⏺'
const BULLET_WIDTH = 2
const FENCE = '```'

// Change a tag when its value's fields change: it declines what an older version stored.
const view = atom({ plugin: 'reader', key: 'view' } as const, 'explain')
const isExplaining = atom({ plugin: 'reader', key: 'isExplaining' } as const, false)
const explanation = atom({ plugin: 'reader', key: 'explanation' } as const, null, { shape: 'explanation-1' })
const glossary = atom({ plugin: 'reader', key: 'glossary' } as const, [], { shape: 'glossary-1' })

const FORMATS = [
  'The user reads your replies in a terminal that draws extra fenced blocks. Use them where they fit; everything else stays plain markdown (pipe tables, bold, lists and code fences render well).',
  `- ${FENCE}flow whenever something moves across two or more systems or steps (os, app, sdk, S3, a release), in place of prose or box-drawing art. One node per line as \`name: what happens\`; an indented line continues that node; \`-> label\` between nodes names the arrow (what triggers the next step). Each place where something is stored is its own node, so the user can count the places.`,
  `- ${FENCE}bars for three or more numbers to compare (sizes, costs, tokens, percentages). One \`label: number unit\` per line, digits with a dot for decimals. A \`limit: number\` line draws a cap and marks the bars past it.`,
  `- ${FENCE}status for four or more PRs, tasks or releases with a state, in the order they go. One \`state: item\` per line. States: done; deployed (live in production); in progress (moving on its own: a deploy, a build, an agent working); needs you (waits on the user's answer or action); open; blocked; todo. Never \`wait\`: say whether it moves on its own or needs the user.`,
  `- ${FENCE}terms for each identifier or coined name a reply leans on that the user has not seen yet (a field, a function, a name like "Fila Póster"). One \`term: plain definition\` per line. The user keeps them in a glossary.`,
  '- Options with tradeoffs go in a pipe table, one row per option.',
].join('\n')

const SHORT_PROMPT = [
  'Rewrite your last reply as the very simple version: the answer in one line, then at most four short lines.',
  "Plain words; no identifier unless you define it in passing. The user's language.",
].join('\n')

const FROM_ZERO_PROMPT = [
  'The user did not follow your last reply. Explain it again from zero, as if they had never seen this code.',
  'First what we are trying to achieve. Then one concrete, simple example with real names, before and after.',
  'A flow block if anything moves between systems. End with a terms block for every identifier you used.',
  "Under 30 lines, the user's language.",
].join('\n')

const RECAP_PROMPT = [
  'The user lost the thread of this session. Recap it from the start: the goal in one line, what is decided,',
  'what is still open (numbered, so they can answer by number), PRs, branches, releases or tasks in a status block',
  "in the order they go, and what comes next. Under 25 lines, the user's language.",
].join('\n')

// Not `recap`: Claude Code has a built-in /recap.
const COMMANDS: CommandSpec[] = [
  {
    name: 'explain',
    description: 'Explain the selected text, or a question, in the Reader pane',
    argumentHint: '[question]',
    immediate: true,
  },
  {
    name: 'catchup',
    description: 'Catch up on this session from the start in the Reader pane: goal, decisions, open items, PRs',
    immediate: true,
  },
  {
    name: 'terms',
    description: 'Show the glossary kept from every session in the Reader pane',
  },
  {
    name: 'short',
    description: 'The last reply again in a few lines, in the Reader pane',
    immediate: true,
  },
  {
    name: 'zero',
    description: 'The last reply explained from zero with an example, in the Reader pane',
    immediate: true,
  },
]

export const register: Register = on => {
  registerModel(on)

  on('session.start', async ($, e, next) => {
    const stored = await $.store.get(GLOSSARY_KEY)

    if (isTermList(stored)) {
      await update($, glossary, () => stored)
    }

    // One at a time: a name a later Claude Code makes built-in is refused alone.
    for (const command of COMMANDS) {
      try {
        await $.command.register(command)
      } catch (error) {
        $.ui.log(`reader: /${command.name} is not available: ${String(error)}`)
      }
    }
    await startModel($)

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    if (!e.surfaces.includes('terminal')) {
      return composed
    }

    return { sections: [...composed.sections, { id: 'reader:formats', text: FORMATS, scope: 'session' }] }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId === undefined) {
      await stopModelFrames($)
    }
    if (e.agentId === undefined && e.reason === 'answer') {
      await addTerms($, termsIn(e.answer))
    }

    return result
  })

  on('command.run', { command: 'explain' }, async ($, e) => {
    const question = e.args.trim()
    const selected = question === '' ? (await $.ui.selection())?.text.trim() : undefined
    const subject = question || selected

    if (subject === undefined || subject === '') {
      return { text: 'Select text in the chat first, or ask: /explain <question>' }
    }
    await askAside($, subject, explainPrompt(subject, question === ''), 'low')

    return { text: 'Explained in the Reader pane.' }
  })

  on('command.run', { command: 'catchup' }, async $ => {
    await askAside($, 'Recap of this session', RECAP_PROMPT, 'medium')

    return { text: 'Recap in the Reader pane.' }
  })

  on('command.run', { command: 'short' }, async $ => {
    await askAside($, 'Short version of the last reply', SHORT_PROMPT, 'low')

    return { text: 'Short version in the Reader pane.' }
  })

  on('command.run', { command: 'zero' }, async $ => {
    await askAside($, 'The last reply, from zero', FROM_ZERO_PROMPT, 'medium')

    return { text: 'From zero in the Reader pane.' }
  })

  on('command.run', { command: 'terms' }, async $ => {
    await update($, view, () => 'terms')
    await $.ui.open({ id: PANE, title: PANE_TITLE })

    return { text: 'Glossary in the Reader pane.' }
  })

  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isSummary) {
      return next(e)
    }
    const table = $.ui.resolve(e)
    const { Box, Text } = table
    const room = (e.viewport?.columns ?? 80) - BULLET_WIDTH - 2

    return (
      <Box flexDirection="row">
        <Box width={BULLET_WIDTH} flexShrink={0}>
          <Text>{e.props.isFirstOfReply ? BULLET : ' '}</Text>
        </Box>
        <Box flexDirection="column" flexShrink={1}>
          {drawBlocks(table, splitReply(e.props.text), room)}
        </Box>
      </Box>
    )
  })

  // Our row above the prompt: the model, the effort and the context used.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) {
      return next(e)
    }
    const table = $.ui.resolve(e)
    const model = await modelRow($, table)

    if (model === null) {
      return next(e)
    }
    const { Box } = table

    // The engine leaves a blank row under the band but none above it, so the row hugged the reply.
    return <Box marginTop={1}>{model}</Box>
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)

      return <Text>The Reader draws in the terminal.</Text>
    }
    const table = $.ui.resolve(e)
    const { Box, Button, Progress, Text } = table
    const room = e.props.bodyColumns
    const current = await read($, view)

    const tab = (key: 'explain' | 'terms', label: string) => (
      <Button
        key={key}
        label={label}
        hotkey={key[0]}
        variant={current === key ? 'primary' : 'secondary'}
        onPress={() => void update($, view, () => key)}
      />
    )

    const explainView = async () => {
      if (await read($, isExplaining)) {
        return <Progress label="Explaining" />
      }
      const shown = await read($, explanation)

      if (shown === null) {
        return (
          <Text dimColor>
            {'Select text in the chat and run /explain, ask /explain <question>, or run /catchup.'}
          </Text>
        )
      }

      return (
        <Box flexDirection="column" gap={1}>
          <Text dimColor maxLines={3}>{shown.subject}</Text>
          {drawBlocks(table, splitReply(shown.text), room)}
        </Box>
      )
    }

    const termsView = async () => {
      const terms = await read($, glossary)

      if (terms.length === 0) {
        return <Text dimColor>No terms yet. They come from replies with a terms block and from /explain.</Text>
      }

      return drawBlocks(table, [{ kind: 'terms', terms }], room)
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          {tab('explain', 'Explain')}
          {tab('terms', 'Terms')}
        </Box>
        {current === 'terms' ? await termsView() : await explainView()}
      </Box>
    )
  })
}

/** Asks a side question over the session's transcript and shows the answer in the pane. */
async function askAside($: EngineInterface, subject: string, prompt: string, effort: ModelEffort): Promise<void> {
  await update($, view, () => 'explain')
  await update($, isExplaining, () => true)
  await $.ui.open({ id: PANE, title: PANE_TITLE })

  try {
    const answer = await $.model.fork({ prompt: asideFrame(prompt), effort })
    const text = answer.isAnswered ? answer.text : `No answer (${answer.reason}). Try again.`
    await update($, explanation, () => ({ subject, text }))

    if (answer.isAnswered) {
      await addTerms($, termsIn(answer.text))
    }
  } finally {
    await update($, isExplaining, () => false)
  }
}

function asideFrame(prompt: string): string {
  return [
    'Side question, answered in a pane next to the chat; the main thread never sees your answer. No preamble, no closing offer.',
    prompt,
  ].join('\n')
}

function explainPrompt(subject: string, isSelection: boolean): string {
  const what = isSelection ? 'the part of the conversation the user selected' : 'the question below'

  return [
    `Explain ${what} in plain words, in the user's language.`,
    'The answer goes in the first line or two. Then one concrete example, and each new term defined once in one plain line.',
    'Use a flow block when a flow crosses layers. Under 15 lines. End with a terms block listing the terms you defined, if any.',
    '',
    '<subject>',
    subject,
    '</subject>',
  ].join('\n')
}

async function addTerms($: EngineInterface, added: Term[]): Promise<void> {
  if (added.length === 0) {
    return
  }
  const merged = await update($, glossary, current => mergeTerms(current, added))
  await $.store.set(GLOSSARY_KEY, merged)
}

// Newest first; a term defined again replaces its older definition.
function mergeTerms(current: Term[], added: Term[]): Term[] {
  const addedKeys = new Set(added.map(term => term.term.toLowerCase()))
  const kept = current.filter(term => !addedKeys.has(term.term.toLowerCase()))

  return [...added, ...kept].slice(0, MAX_TERMS)
}

function isTermList(value: unknown): value is Term[] {
  if (!Array.isArray(value)) {
    return false
  }

  return value.every(item => typeof item?.term === 'string' && typeof item?.definition === 'string')
}
