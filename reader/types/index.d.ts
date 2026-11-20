export type Term = { term: string; definition: string }

/** What the Reader pane's Explain view shows: the subject asked about and the answer. */
export type Explanation = { subject: string; text: string }

export type ReaderView = 'explain' | 'terms'

declare module 'claude-code' {
  interface PluginState {
    reader: {
      view: ReaderView
      isExplaining: boolean
      isOffering: boolean
      explanation: Shaped<Explanation | null>
      glossary: Shaped<Term[]>
    }
  }
}
