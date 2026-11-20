export type Term = { term: string; definition: string }

/** What the Reader pane's Explain view shows: the subject asked about and the answer. */
export type Explanation = { subject: string; text: string }

export type ReaderView = 'explain' | 'terms'

/** The main loop's model id and the effort its last request sent, or the one `/effort` just saved; null when there is none. */
export type ModelInfo = { id: string; effort: string | null }

declare module 'claude-code' {
  interface PluginState {
    reader: {
      view: ReaderView
      isExplaining: boolean
      explanation: Shaped<Explanation | null>
      glossary: Shaped<Term[]>
      model: Shaped<ModelInfo | null>
      contextUsed: number | null
      frame: number | null
    }
  }
}
