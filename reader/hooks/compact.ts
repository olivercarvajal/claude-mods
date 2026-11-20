import type { On, SessionMessage } from 'claude-code'

// The newest exchanges a compaction keeps word for word after the summary, tool calls left out.
const KEPT_EXCHANGES = 2

/** Summarizes all but the last exchanges and puts those back as plain text. */
export function registerCompact(on: On): void {
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }
    // A summary computed ahead would cover the exchanges this keeps, and the real compaction asks again anyway.
    if (e.trigger === 'precompute') {
      return { skip: 'reader summarizes when the compaction runs' }
    }
    const starts = promptIndexes(e.messages)

    // Nothing older than the kept exchanges: a summary would only repeat them.
    if (starts.length <= KEPT_EXCHANGES) {
      return next(e)
    }
    const cut = starts[starts.length - KEPT_EXCHANGES] ?? 0
    const compacted = await next({ ...e, messages: e.messages.slice(0, cut) })

    if (compacted.skip !== undefined) {
      return compacted
    }

    return { ...compacted, messages: [...compacted.messages, ...asText(e.messages.slice(cut))] }
  })
}

function promptIndexes(messages: readonly SessionMessage[]): number[] {
  const starts: number[] = []

  messages.forEach((message, i) => {
    if (isPrompt(message)) {
      starts.push(i)
    }
  })

  return starts
}

/** A user message with text, not one that only carries tool results. */
function isPrompt(message: SessionMessage): boolean {
  return message.role === 'user' && message.text.trim() !== '' && (message.toolResults ?? []).length === 0
}

/** Each prompt, then everything Claude wrote before the next one in one message; tool calls and results dropped. */
function asText(messages: readonly SessionMessage[]): SessionMessage[] {
  const kept: SessionMessage[] = []
  let reply: string[] = []

  const closeReply = () => {
    if (reply.length > 0) {
      kept.push({ role: 'assistant', text: reply.join('\n\n'), toolUses: [] })
    }
    reply = []
  }

  for (const message of messages) {
    if (message.role === 'assistant' && message.text.trim() !== '') {
      reply.push(message.text)
    }
    if (isPrompt(message)) {
      closeReply()
      kept.push({ role: 'user', text: message.text, toolUses: [] })
    }
  }
  closeReply()

  return kept
}
