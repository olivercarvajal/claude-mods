import type { Term } from '../types'

export type Align = 'left' | 'right' | 'center'

export type Run =
  | { style: 'plain' | 'bold' | 'code' | 'pick'; text: string }
  | { style: 'link'; text: string; href: string }

export type ProseLine =
  | { kind: 'blank' }
  | { kind: 'rule' }
  | { kind: 'title'; runs: Run[] }
  | { kind: 'quote'; runs: Run[] }
  | { kind: 'item'; indent: number; marker: string; runs: Run[] }
  | { kind: 'text'; indent: number; runs: Run[] }

export type DiagramPart = { role: 'line' | 'node' | 'label' | 'plain'; text: string }

export type FlowNode = { title: string; body: string[] }

export type FlowStep = { kind: 'node'; node: FlowNode } | { kind: 'edge'; label: string }

export type Bar = { label: string; value: number; unit: string }

export type StatusItem = { state: string; text: string }

export type Block =
  | { kind: 'prose'; lines: ProseLine[] }
  | { kind: 'code'; language: string; source: string }
  | { kind: 'diagram'; rows: DiagramPart[][] }
  | { kind: 'table'; header: string[]; rows: string[][]; aligns: Align[]; source: string }
  | { kind: 'flow'; steps: FlowStep[] }
  | { kind: 'bars'; bars: Bar[]; limit: number | null }
  | { kind: 'status'; items: StatusItem[] }
  | { kind: 'stats'; rows: string[] }
  | { kind: 'terms'; terms: Term[] }

const OPENING_FENCE = /^\s*```\s*([\w+#.-]*)\s*$/
const CLOSING_FENCE = /^\s*```\s*$/
const RULE_CELL = /^:?-+:?$/
// Claude's own pick in a list of options reads as `Mía:` in this user's replies.
const INLINE_MARK = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|(?:Mía|Mi recomendación):)/
const PICK = /^(?:Mía|Mi recomendación):$/
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/
const HEADING = /^#{1,6}\s+(.*)$/
const ONLY_BOLD = /^\*\*([^*]+)\*\*:?$/
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const RULE_LINE = /^\s*([-*_])(\s*\1){2,}\s*$/
const QUOTE = /^\s*>\s?(.*)$/
const BAR_LINE = /^(.+?):\s*(-?\d[\d.,]*)\s*(.*)$/
export const LIMIT_LABEL = 'limit'
// A diff-size line: `This change  +51 -1  2 files`.
const DIFF_COUNT = /\+\d+\s*\/?,?\s*-\d+/
// Box drawing, arrows and geometric shapes: what a text diagram is drawn with.
const CONNECTOR = /([─-╿←-⇿■-◿]+)/
const PLAIN_LANGUAGES = ['', 'text', 'txt']

/**
 * Splits a reply into prose, fenced blocks and pipe tables, in order.
 * A fence still open (the reply is streaming) runs to the end.
 */
export function splitReply(text: string): Block[] {
  const lines = text.split('\n')
  const at = (index: number) => lines[index] ?? ''
  const blocks: Block[] = []
  let prose: string[] = []

  const flushProse = () => {
    const joined = prose.join('\n').trim()

    if (joined !== '') {
      blocks.push({ kind: 'prose', lines: joined.split('\n').map(parseProseLine) })
    }
    prose = []
  }

  let i = 0

  while (i < lines.length) {
    const fence = OPENING_FENCE.exec(at(i))

    if (fence !== null) {
      flushProse()
      const body: string[] = []
      i += 1

      while (i < lines.length && !CLOSING_FENCE.test(at(i))) {
        body.push(at(i))
        i += 1
      }
      i += 1
      blocks.push(fencedBlock(fence[1] ?? '', body))
      continue
    }

    if (isTableStart(at(i), lines[i + 1])) {
      flushProse()
      const start = i
      const header = cells(at(i))
      const aligns = cells(at(i + 1)).map(alignOf)
      const rows: string[][] = []
      i += 2

      while (i < lines.length && at(i).trimStart().startsWith('|')) {
        rows.push(cells(at(i)))
        i += 1
      }
      const source = lines.slice(start, i).join('\n')
      blocks.push({ kind: 'table', header, rows, aligns, source })
      continue
    }

    prose.push(at(i))
    i += 1
  }
  flushProse()

  return blocks
}

/** Every term a reply's `terms` blocks define, in order. */
export function termsIn(text: string): Term[] {
  const terms: Term[] = []

  for (const block of splitReply(text)) {
    if (block.kind === 'terms') {
      terms.push(...block.terms)
    }
  }

  return terms
}

/** Bold, inline code and links; every other mark stays as written. */
export function inlineRuns(text: string): Run[] {
  const runs: Run[] = []
  // A split on a capturing group puts the matches at the odd indices.
  const parts = text.split(INLINE_MARK)

  parts.forEach((part, index) => {
    if (part === '') {
      return
    }
    const link = LINK.exec(part)

    if (index % 2 === 0) {
      runs.push({ style: 'plain', text: part })
    } else if (PICK.test(part)) {
      runs.push({ style: 'pick', text: part })
    } else if (part.startsWith('**')) {
      runs.push({ style: 'bold', text: part.slice(2, -2) })
    } else if (link !== null) {
      runs.push({ style: 'link', text: link[1] ?? '', href: link[2] ?? '' })
    } else {
      runs.push({ style: 'code', text: part.slice(1, -1) })
    }
  })

  return runs
}

export function textWidth(runs: Run[]): number {
  let width = 0

  for (const run of runs) {
    width += [...run.text].length
  }

  return width
}

/**
 * Tags each piece of a diagram row: connectors, a node's name (a row that starts at
 * column 0, up to its colon), and edge labels (the text after a lone connector, or
 * text glued between two connectors as in `──pnpm poster──▶`).
 */
export function diagramParts(row: string): DiagramPart[] {
  const tokens = row.split(CONNECTOR)
  const isEdgeRow = tokens.length === 3 && (tokens[0] ?? '').trim() === ''
  const parts: DiagramPart[] = []

  tokens.forEach((token, index) => {
    if (token === '') {
      return
    }
    const isConnector = index % 2 === 1
    const isGluedLabel = index > 0 && index < tokens.length - 1 && token === token.trim()

    if (isConnector) {
      parts.push({ role: 'line', text: token })
    } else if (isEdgeRow || isGluedLabel) {
      parts.push({ role: 'label', text: token })
    } else if (index === 0 && !token.startsWith(' ')) {
      parts.push(...nodeParts(token))
    } else {
      parts.push({ role: 'plain', text: token })
    }
  })

  return parts
}

function nodeParts(token: string): DiagramPart[] {
  const colon = token.indexOf(':')

  if (colon === -1) {
    return [{ role: 'node', text: token }]
  }

  return [
    { role: 'node', text: token.slice(0, colon + 1) },
    { role: 'plain', text: token.slice(colon + 1) },
  ]
}

function fencedBlock(language: string, body: string[]): Block {
  switch (language) {
    case 'flow':
      return { kind: 'flow', steps: parseFlow(body) }
    case 'bars':
      return parseBars(body)
    case 'status':
      return { kind: 'status', items: parseStatus(body) }
    case 'terms':
      return { kind: 'terms', terms: parseTerms(body) }
  }
  const isDiagram = PLAIN_LANGUAGES.includes(language) && body.some(line => CONNECTOR.test(line))

  if (isDiagram) {
    return { kind: 'diagram', rows: body.map(diagramParts) }
  }
  if (language === '' && body.some(line => DIFF_COUNT.test(line))) {
    return { kind: 'stats', rows: body }
  }

  return { kind: 'code', language: language || guessLanguage(body), source: body.join('\n') }
}

// `name: what happens` opens a node, an indented line continues it, `-> label` is the arrow.
function parseFlow(body: string[]): FlowStep[] {
  const steps: FlowStep[] = []
  let current: FlowNode | undefined

  for (const line of body) {
    const trimmed = line.trim()

    if (trimmed === '') {
      continue
    }
    if (trimmed.startsWith('->')) {
      steps.push({ kind: 'edge', label: trimmed.slice(2).trim() })
      current = undefined
    } else if (current !== undefined && /^\s/.test(line)) {
      current.body.push(trimmed)
    } else {
      current = splitTitle(trimmed)
      steps.push({ kind: 'node', node: current })
    }
  }

  return steps
}

function splitTitle(line: string): FlowNode {
  // `: ` and not `:`, so a URL in the title stays whole.
  const colon = line.indexOf(': ')

  if (colon === -1) {
    return { title: line, body: [] }
  }

  return { title: line.slice(0, colon), body: [line.slice(colon + 2)] }
}

// A `limit: N` line is the cap the other bars are measured against.
function parseBars(body: string[]): Block {
  const bars: Bar[] = []
  let limit: number | null = null

  for (const line of body) {
    const match = BAR_LINE.exec(line.trim())

    if (match === null) {
      continue
    }
    const [, label = '', value = '', unit = ''] = match
    const bar = { label: label.trim(), value: Number(value.replace(',', '.')), unit: unit.trim() }

    if (bar.label.toLowerCase() === LIMIT_LABEL) {
      limit = bar.value
    } else {
      bars.push(bar)
    }
  }

  return { kind: 'bars', bars, limit }
}

function parseStatus(body: string[]): StatusItem[] {
  const items: StatusItem[] = []

  for (const line of body) {
    const colon = line.indexOf(': ')

    if (colon > 0) {
      items.push({ state: line.slice(0, colon).trim().toLowerCase(), text: line.slice(colon + 2).trim() })
    }
  }

  return items
}

function parseTerms(body: string[]): Term[] {
  const terms: Term[] = []

  for (const line of body) {
    const colon = line.indexOf(': ')

    if (colon > 0) {
      terms.push({ term: line.slice(0, colon).trim(), definition: line.slice(colon + 2).trim() })
    }
  }

  return terms
}

// An unlabeled fence that opens like JSON still gets JSON colors.
function guessLanguage(body: string[]): string {
  const first = body.find(line => line.trim() !== '')?.trim() ?? ''

  return first.startsWith('{') || first.startsWith('[') ? 'json' : ''
}

function parseProseLine(line: string): ProseLine {
  if (line.trim() === '') {
    return { kind: 'blank' }
  }
  // Before ITEM: `- - -` is a rule, not a list item.
  if (RULE_LINE.test(line)) {
    return { kind: 'rule' }
  }
  const title = HEADING.exec(line.trim()) ?? ONLY_BOLD.exec(line.trim())

  if (title !== null) {
    return { kind: 'title', runs: inlineRuns(title[1] ?? '') }
  }
  const quote = QUOTE.exec(line)

  if (quote !== null) {
    return { kind: 'quote', runs: inlineRuns(quote[1] ?? '') }
  }
  const item = ITEM.exec(line)

  if (item !== null) {
    const [, indent = '', marker = '', rest = ''] = item

    return { kind: 'item', indent: indent.length, marker, runs: inlineRuns(rest) }
  }
  const indent = line.length - line.trimStart().length

  return { kind: 'text', indent, runs: inlineRuns(line.trim()) }
}

function cells(row: string): string[] {
  const inner = row.trim().replace(/^\|/, '').replace(/\|$/, '')

  return inner.split(/(?<!\\)\|/).map(cell => cell.trim().replaceAll('\\|', '|'))
}

function isTableStart(line: string, next: string | undefined): boolean {
  if (!line.trimStart().startsWith('|') || next === undefined) {
    return false
  }

  return cells(next).every(cell => RULE_CELL.test(cell))
}

function alignOf(rule: string): Align {
  const isLeft = rule.startsWith(':')
  const isRight = rule.endsWith(':')

  if (isLeft && isRight) {
    return 'center'
  }

  return isRight ? 'right' : 'left'
}
