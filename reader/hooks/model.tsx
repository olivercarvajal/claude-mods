import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, On, Timer } from 'claude-code'

type Table = Elements['terminal']

// What `/effort` steps through, lowest first, in the colors its picker draws (read off a recording of it).
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
const LEVEL_COLOR: Record<string, string> = { low: '#ffc107', medium: '#4eba65', high: '#b1b9f9', xhigh: '#af87ff' }
// The picker's xhigh sweeps this lighter purple across the word; max cycles this rainbow, one letter ahead of the next.
const XHIGH_LIGHT = '#d0b4ff'
const RAINBOW = ['#eb5f57', '#f58b57', '#fac35f', '#91c882', '#82aadc', '#9b82c8', '#c882b4']
const DIM = '#999999'
const FRAME_MS = 150
// Answers get worse well before the window fills: yellow means think about /compact, red means do it.
const CONTEXT_OK = '#4eba65'
const CONTEXT_WATCH = '#ffc107'
const CONTEXT_COMPACT = '#e86a6a'
const WATCH_FROM = 30
const COMPACT_FROM = 60
// A terminal cannot blend, so each pill's tint is its color mixed by hand into a dark theme's background.
const PILL_BASE = '#2c2e39'
const NUMBER_PILL = '#3d4050'
// Nerd Font half circles (U+E0B6, U+E0B4) drawn in the pill's tint round its ends.
const CAP_LEFT = '\ue0b6'
const CAP_RIGHT = '\ue0b4'
// `claude-opus-5-5`, `claude-haiku-4-5-20251001`: family, major, minor. Not the date.
const MODEL_ID = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/

const info = atom({ plugin: 'reader', key: 'model' } as const, null, { shape: 'model-1' })
const contextUsed = atom({ plugin: 'reader', key: 'contextUsed' } as const, null)
// null at rest: nothing lit.
const frame = atom({ plugin: 'reader', key: 'frame' } as const, null)

// Animates xhigh and max only while a turn runs: the spinner redraws then anyway, and an idle footer stays still.
let ticking: Timer | undefined

/** Keeps the model, the effort and the context used current; `modelRow` draws them. */
export function registerModel(on: On): void {
  // Each request says what it asked for, past `--effort`, env vars and per-model settings.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      return yield* next(e)
    }
    const effort = e.effort === undefined ? null : String(e.effort)
    await update($, info, () => ({ id: e.model, effort }))
    await animate($, effort === 'xhigh' || effort === 'max')

    const result = yield* next(e)
    await readContext($)

    return result
  })

  // A compacted or cleared conversation has no reading until its next request.
  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)

    if (e.agentId === undefined && e.trigger !== 'precompute') {
      await update($, contextUsed, () => null)
    }

    return compacted
  })

  on('session.end', async ($, e, next) => {
    const ended = await next(e)

    if (e.reason === 'clear') {
      await update($, contextUsed, () => null)
    }

    return ended
  })
}

/** The model, the effort as `/effort` colors it and the context used, in one row; null before anything is known. */
export async function modelRow($: EngineInterface, table: Table) {
  const shown = await read($, info)

  if (shown === null) {
    return null
  }
  const { Box, Text } = table
  const percent = await read($, contextUsed)
  const tick = await read($, frame)

  return (
    <Box flexDirection="row" gap={1} flexShrink={0}>
      <Text color={DIM}>{modelLabel(shown.id)}</Text>
      {shown.effort === null ? null : effortPill(table, shown.effort, tick)}
      {percent === null ? null : contextPill(table, percent)}
    </Box>
  )
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
  await readContext($)
}

/** Stops the xhigh and max animation and puts out the lit letter; the turn that needed it is over. */
export async function stopModelFrames($: EngineInterface): Promise<void> {
  ticking?.cancel()
  ticking = undefined
  await update($, frame, () => null)
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

function effortPill(table: Table, effort: string, tick: number | null) {
  const { Text } = table
  const level = LEVELS.indexOf(effort)

  // A number, which only internal builds send: no step of the picker to light.
  if (level === -1) {
    return pill(table, NUMBER_PILL, <Text>{effort}</Text>)
  }
  const tint = mix(LEVEL_COLOR[effort] ?? RAINBOW[0] ?? DIM, PILL_BASE, 0.16)
  const steps = [...'▰'.repeat(level + 1)]

  return pill(
    table,
    tint,
    <Text>
      {steps.map((step, i) => <Text color={letterColor(effort, i, tick)}>{step}</Text>)}
      <Text color={DIM}>{'▱'.repeat(LEVELS.length - level - 1)}</Text>
      {' '}
      {[...effort].map((letter, i) => <Text bold color={letterColor(effort, i, tick)}>{letter}</Text>)}
    </Text>,
  )
}

function contextPill(table: Table, percent: number) {
  const { Text } = table
  const color = contextColor(percent)

  return pill(table, mix(color, PILL_BASE, 0.18), <Text color={color}>{`${percent}%`}</Text>)
}

function pill({ Text }: Table, tint: string, content: ReturnType<Table['Text']>) {
  return (
    <Text>
      <Text color={tint}>{CAP_LEFT}</Text>
      <Text backgroundColor={tint}>{content}</Text>
      <Text color={tint}>{CAP_RIGHT}</Text>
    </Text>
  )
}

function letterColor(effort: string, index: number, tick: number | null): string {
  if (effort === 'max') {
    return RAINBOW[((tick ?? 0) + index) % RAINBOW.length] ?? DIM
  }
  // One letter lit at a time, with a short pause after the sweep.
  if (effort === 'xhigh' && tick !== null && tick % (effort.length + 3) === index) {
    return XHIGH_LIGHT
  }

  return LEVEL_COLOR[effort] ?? DIM
}

function contextColor(percent: number): string {
  if (percent >= COMPACT_FROM) {
    return CONTEXT_COMPACT
  }
  if (percent >= WATCH_FROM) {
    return CONTEXT_WATCH
  }

  return CONTEXT_OK
}

async function animate($: EngineInterface, isAnimated: boolean): Promise<void> {
  if (!isAnimated) {
    await stopModelFrames($)
    return
  }
  ticking ??= $.clock.every(FRAME_MS, () => void update($, frame, tick => (tick ?? 0) + 1))
}

async function readContext($: EngineInterface): Promise<void> {
  const { context } = await $.session.usage()
  await update($, contextUsed, () => context.percent ?? null)
}

function mix(color: string, base: string, amount: number): string {
  const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16)
  const mixed = [1, 3, 5].map(at => Math.round(channel(color, at) * amount + channel(base, at) * (1 - amount)))

  return `#${mixed.map(value => value.toString(16).padStart(2, '0')).join('')}`
}

function asText(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
