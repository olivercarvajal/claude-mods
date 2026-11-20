import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { BOLD_COLOR, LINE_COLOR, TITLE_COLOR } from './draw'
import type { ModelInfo } from '../types'

// What `/effort` steps through, lowest first. A level outside it draws as text alone.
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
const FILLED = '▰'
const EMPTY = '▱'
// `claude-opus-5-5`, `claude-haiku-4-5-20251001`: family, major, minor. Not the date.
const MODEL_ID = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/

const info = atom({ plugin: 'reader', key: 'model' } as const, null, { shape: 'model-1' })

/** Draws the model and effort at the right of the prompt footer: `Opus 5.5  ▰▰▰▰▱ xhigh`. */
export function registerModel(on: On): void {
  // Each request says what it really sent, past `--effort`, env vars and per-model settings.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const effort = e.effort === undefined ? null : String(e.effort)
      await update($, info, () => ({ id: e.model, effort }))
    }

    return yield* next(e)
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const shown = await read($, info)

    if (e.surface !== 'terminal' || shown === null) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    const level = LEVELS.indexOf(shown.effort ?? '')
    const meter = level === -1 ? null : (
      <Text>
        {'  '}
        <Text color={TITLE_COLOR}>{FILLED.repeat(level + 1)}</Text>
        <Text color={LINE_COLOR}>{EMPTY.repeat(LEVELS.length - level - 1)}</Text>
      </Text>
    )

    return (
      <Box flexDirection="row" gap={2}>
        {await next(e)}
        <Text>
          <Text bold color={BOLD_COLOR}>{modelLabel(shown.id)}</Text>
          {meter}
          {shown.effort === null ? null : <Text color={TITLE_COLOR}>{` ${shown.effort}`}</Text>}
        </Text>
      </Box>
    )
  })
}

/** `claude-opus-5-5` reads `Opus 5.5`; anything else stays as given. */
export function modelLabel(id: string): string {
  const match = MODEL_ID.exec(id)

  if (match === null) {
    return id
  }
  const [, family = '', major = '', minor] = match
  const name = family.charAt(0).toUpperCase() + family.slice(1)

  return minor === undefined ? `${name} ${major}` : `${name} ${major}.${minor}`
}

/** Until the first request: the effort `/effort` saved for this model, else the global one. */
export async function startModel($: EngineInterface): Promise<void> {
  const id = await $.session.model()
  // `modelSettings` keys carry no context suffix: `claude-opus-5-5`, not `claude-opus-5-5[1m]`.
  const key = id.replace(/\[.*\]$/, '')
  const perModel = await $.settings.read({ key: 'modelSettings' })
  const shared = await $.settings.read({ key: 'effortLevel' })
  const saved = isRecord(perModel) && isRecord(perModel[key]) ? perModel[key].effortLevel : undefined
  const effort = asText(saved) ?? asText(shared)

  // A request since, or before a reload, knows better.
  await update($, info, current => current ?? { id, effort })
}

function asText(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
