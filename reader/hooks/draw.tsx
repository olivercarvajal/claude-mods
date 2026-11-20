import type { Color, Elements, RenderNode } from 'claude-code'

import { inlineRuns, LIMIT_LABEL, textWidth } from './blocks'
import type { Align, Bar, Block, DiagramPart, FlowNode, FlowStep, ProseLine, Run, StatusItem } from './blocks'
import type { Term } from '../types'

type Table = Elements['terminal']

type Tone = 'body' | 'title'

// Codex's pastel palette on a dark background: pink titles, blue subtitles.
export const CARD_BACKGROUND = '#383b45'
export const TITLE_COLOR = '#f49ad6'
export const BOLD_COLOR = '#89b4fa'
export const EDGE_LABEL_COLOR = '#f0e2b6'
export const INLINE_CODE_COLOR = '#f0e2b6'
export const SUCCESS_COLOR = '#b5d99c'
export const ERROR_COLOR = '#e86a6a'
export const DEPLOYED_COLOR = '#cba6f7'
export const LINE_COLOR = 'subtle'

const COLUMN_GAP = ' │ '
const MAX_RULE_WIDTH = 60
const MAX_BAR_WIDTH = 40
const MIN_BAR_WIDTH = 10
// Eighths of a cell, so a bar's end lands between whole cells.
const PARTIAL_CELLS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
// `+51` and `-1` in a diff-size line, not the `-11` inside a date.
const SIGNED_COUNT = /((?<=^|[\s/(,])[+-]\d+)/
// Emoji marks take two cells; the narrow ones get a space so the states line up.
type StatusLook = { mark: string; color: Color; wide?: boolean }
const STATUS_LOOKS: Record<string, StatusLook> = {
  done: { mark: '✅', color: SUCCESS_COLOR, wide: true },
  deployed: { mark: '🚀', color: DEPLOYED_COLOR, wide: true },
  'in progress': { mark: '⏳', color: EDGE_LABEL_COLOR, wide: true },
  'needs you': { mark: '👉', color: TITLE_COLOR, wide: true },
  open: { mark: '📂', color: BOLD_COLOR, wide: true },
  blocked: { mark: '⛔', color: ERROR_COLOR, wide: true },
  todo: { mark: '📝', color: LINE_COLOR, wide: true },
  // Not taught anymore; kept so older replies still draw.
  wait: { mark: '◷', color: EDGE_LABEL_COLOR },
}
const UNKNOWN_STATUS: StatusLook = { mark: '•', color: LINE_COLOR }

/** Draws parsed reply blocks into `room` columns, one blank row between blocks. */
export function drawBlocks(table: Table, blocks: Block[], room: number): RenderNode {
  const { Box, Code, Link, Markdown, Text } = table

  const drawRun = (run: Run, tone: Tone): RenderNode => {
    if (run.style === 'link') {
      return <Link href={run.href} label={run.text} />
    }
    if (run.style === 'code') {
      return <Text color={INLINE_CODE_COLOR}>{run.text}</Text>
    }
    if (run.style === 'pick') {
      return <Text bold color={SUCCESS_COLOR}>{run.text}</Text>
    }
    if (tone === 'title') {
      return <Text bold color={TITLE_COLOR}>{run.text}</Text>
    }
    if (run.style === 'bold') {
      return <Text bold color={BOLD_COLOR}>{run.text}</Text>
    }

    return run.text
  }

  const drawRuns = (runs: Run[], tone: Tone) => runs.map(run => drawRun(run, tone))

  const card = (label: string, children: RenderNode[]) => (
    <Box flexDirection="column" backgroundColor={CARD_BACKGROUND} paddingX={1}>
      {label === '' ? null : <Text color={LINE_COLOR}>{label}</Text>}
      {children}
    </Box>
  )

  const drawProseLine = (line: ProseLine) => {
    switch (line.kind) {
      case 'blank':
        return <Text> </Text>
      case 'rule':
        return <Text color={LINE_COLOR}>{'─'.repeat(Math.min(room, MAX_RULE_WIDTH))}</Text>
      case 'title':
        return <Text>{drawRuns(line.runs, 'title')}</Text>
      case 'quote':
        return (
          <Box flexDirection="row">
            <Text color={LINE_COLOR}>▎ </Text>
            <Text italic>{drawRuns(line.runs, 'body')}</Text>
          </Box>
        )
      case 'item':
        // The marker sits in its own column so wrapped lines hang under the text.
        return (
          <Box flexDirection="row" marginLeft={line.indent}>
            <Text color={LINE_COLOR}>{line.marker} </Text>
            <Box flexShrink={1}>
              <Text>{drawRuns(line.runs, 'body')}</Text>
            </Box>
          </Box>
        )
      case 'text':
        return (
          <Box marginLeft={line.indent}>
            <Text>{drawRuns(line.runs, 'body')}</Text>
          </Box>
        )
    }
  }

  const drawDiagramPart = (part: DiagramPart): RenderNode => {
    switch (part.role) {
      case 'line':
        return <Text color={LINE_COLOR}>{part.text}</Text>
      case 'node':
        return <Text bold color={BOLD_COLOR}>{part.text}</Text>
      case 'label':
        return <Text italic color={EDGE_LABEL_COLOR}>{part.text}</Text>
      case 'plain':
        return part.text
    }
  }

  const drawRow = (row: string[], widths: number[], aligns: Align[], tone: Tone) => {
    const parts: RenderNode[] = []

    widths.forEach((width, column) => {
      const runs = inlineRuns(row[column] ?? '')
      const [before, after] = padding(width - textWidth(runs), aligns[column] ?? 'left')

      if (column > 0) {
        parts.push(<Text color={LINE_COLOR}>{COLUMN_GAP}</Text>)
      }
      parts.push(before, ...drawRuns(runs, tone), after)
    })

    return <Text wrap="truncate-end">{parts}</Text>
  }

  const drawTable = (block: Extract<Block, { kind: 'table' }>) => {
    const widths = columnWidths([block.header, ...block.rows], block.header.length)
    const tableWidth = sum(widths) + COLUMN_GAP.length * (widths.length - 1)

    // Too wide to line up: the engine's own table wraps it.
    if (tableWidth > room) {
      return <Markdown text={block.source} />
    }
    const rule = widths.map(width => '─'.repeat(width)).join('─┼─')

    return (
      <Box flexDirection="column">
        {drawRow(block.header, widths, block.aligns, 'title')}
        <Text color={LINE_COLOR}>{rule}</Text>
        {block.rows.map(row => drawRow(row, widths, block.aligns, 'body'))}
      </Box>
    )
  }

  const drawEdge = (label: string) => (
    <Box flexDirection="column" marginLeft={2}>
      <Text>
        <Text color={LINE_COLOR}>│</Text>
        {label === '' ? null : <Text italic color={EDGE_LABEL_COLOR}>{`  ${label}`}</Text>}
      </Text>
      <Text color={LINE_COLOR}>▼</Text>
    </Box>
  )

  const drawNode = (node: FlowNode) => (
    <Box flexDirection="column" alignSelf="flex-start" borderStyle="round" borderColor={LINE_COLOR} paddingX={1}>
      <Text bold color={BOLD_COLOR}>{node.title}</Text>
      {node.body.map(line => <Text>{drawRuns(inlineRuns(line), 'body')}</Text>)}
    </Box>
  )

  const drawFlow = (steps: FlowStep[]) => {
    const rows: RenderNode[] = []

    steps.forEach((step, index) => {
      if (step.kind === 'edge') {
        rows.push(drawEdge(step.label))
        return
      }
      // Two nodes in a row still get an arrow between them.
      if (steps[index - 1]?.kind === 'node') {
        rows.push(drawEdge(''))
      }
      rows.push(drawNode(step.node))
    })

    return <Box flexDirection="column">{rows}</Box>
  }

  // With a limit, bars past it turn red and a marker row shows where it sits.
  const drawBars = (bars: Bar[], limit: number | null) => {
    if (bars.length === 0) {
      return null
    }
    const unit = bars[0]?.unit ?? ''
    const values = bars.map(bar => withUnit(bar.value, bar.unit))
    const limitValue = limit === null ? '' : withUnit(limit, unit)
    const labelWidth = Math.max(...bars.map(bar => bar.label.length), limit === null ? 0 : LIMIT_LABEL.length)
    const valueWidth = Math.max(...values.map(value => value.length), limitValue.length)
    const barWidth = clamp(room - labelWidth - valueWidth - 6, MIN_BAR_WIDTH, MAX_BAR_WIDTH)
    const scale = Math.max(...bars.map(bar => bar.value), limit ?? 0)
    const cellsOf = (value: number) => (scale > 0 ? (Math.max(0, value) / scale) * barWidth : 0)

    const rows = bars.map((bar, index) => {
      const isOver = limit !== null && bar.value > limit

      return (
        <Text>
          {bar.label.padEnd(labelWidth)}
          {'  '}
          <Text color={isOver ? ERROR_COLOR : BOLD_COLOR}>{barOf(cellsOf(bar.value)).padEnd(barWidth)}</Text>
          {' '}
          <Text color={LINE_COLOR}>{values[index]}</Text>
        </Text>
      )
    })

    if (limit !== null) {
      const marker = `${'─'.repeat(Math.max(0, Math.round(cellsOf(limit)) - 1))}┤`

      rows.push(
        <Text color={LINE_COLOR}>
          {LIMIT_LABEL.padEnd(labelWidth)}
          {'  '}
          <Text color={EDGE_LABEL_COLOR}>{marker.padEnd(barWidth)}</Text>
          {' '}
          {limitValue}
        </Text>,
      )
    }

    return card('', rows)
  }

  const drawStatus = (items: StatusItem[]) => {
    const stateWidth = Math.max(...items.map(item => item.state.length), 0)

    const rows = items.map((item, index) => {
      const look = STATUS_LOOKS[item.state] ?? UNKNOWN_STATUS

      return (
        <Box flexDirection="row">
          <Text color={LINE_COLOR}>{`${index + 1}.`.padStart(3)} </Text>
          <Text color={look.color}>
            {look.mark}{look.wide ? '' : ' '} {item.state.padEnd(stateWidth)}{' '}
          </Text>
          <Box flexShrink={1}>
            <Text>{drawRuns(inlineRuns(item.text), 'body')}</Text>
          </Box>
        </Box>
      )
    })

    return <Box flexDirection="column">{rows}</Box>
  }

  const drawStatsRow = (row: string) => {
    // A split on a capturing group puts the counts at the odd indices.
    const parts = row.split(SIGNED_COUNT).map((part, index) => {
      if (index % 2 === 0) {
        return part
      }

      return <Text color={part.startsWith('+') ? SUCCESS_COLOR : ERROR_COLOR}>{part}</Text>
    })

    return <Text>{parts}</Text>
  }

  const drawTerms = (terms: Term[]) => {
    const rows = terms.map(term => (
      <Text>
        <Text bold color={TITLE_COLOR}>{term.term}</Text>
        {': '}
        {drawRuns(inlineRuns(term.definition), 'body')}
      </Text>
    ))

    return card('Terms', rows)
  }

  const drawBlock = (block: Block) => {
    switch (block.kind) {
      case 'prose':
        return <Box flexDirection="column">{block.lines.map(drawProseLine)}</Box>
      case 'code':
        return card(block.language, [<Code source={block.source} language={block.language || undefined} />])
      case 'diagram':
        return card('', block.rows.map(row => <Text>{row.map(drawDiagramPart)}</Text>))
      case 'table':
        return drawTable(block)
      case 'flow':
        return drawFlow(block.steps)
      case 'bars':
        return drawBars(block.bars, block.limit)
      case 'status':
        return drawStatus(block.items)
      case 'stats':
        return card('', block.rows.map(drawStatsRow))
      case 'terms':
        return drawTerms(block.terms)
    }
  }

  return (
    <Box flexDirection="column" gap={1}>
      {blocks.map(drawBlock)}
    </Box>
  )
}

function withUnit(value: number, unit: string): string {
  return unit === '' ? String(value) : `${value} ${unit}`
}

function barOf(cells: number): string {
  const whole = Math.floor(cells)
  const eighths = Math.round((cells - whole) * 8)

  if (eighths === 8) {
    return '█'.repeat(whole + 1)
  }
  // A value above zero always shows at least a sliver.
  const tip = PARTIAL_CELLS[eighths] || (cells > 0 && whole === 0 ? '▏' : '')

  return '█'.repeat(whole) + tip
}

function padding(room: number, align: Align): [string, string] {
  if (align === 'right') {
    return [' '.repeat(room), '']
  }
  if (align === 'center') {
    const left = Math.floor(room / 2)

    return [' '.repeat(left), ' '.repeat(room - left)]
  }

  return ['', ' '.repeat(room)]
}

function columnWidths(rows: string[][], count: number): number[] {
  const widths = new Array<number>(count).fill(0)

  for (const row of rows) {
    for (let column = 0; column < count; column += 1) {
      const width = textWidth(inlineRuns(row[column] ?? ''))
      widths[column] = Math.max(widths[column] ?? 0, width)
    }
  }

  return widths
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
