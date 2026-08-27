import { inject, provide, shallowRef, type InjectionKey, type ShallowRef } from 'vue'

// Which SessionTranscript a "jump to message i" call belongs to (ADR 0075).
//
// SessionTranscript mounts in TWO surfaces — SessionDetail and SshSessionPanel —
// and SshWorkspace deliberately keeps every terminal tab mounted with `v-show` so
// switching tabs never disconnects a live shell. Several transcripts of the SAME
// session can therefore be alive at once, sharing the same `data-mi` index range:
// a `document.querySelector` would happily return the copy inside a `display:none`
// tab, where scrollIntoView is a silent no-op.
//
// Scope is STRUCTURAL, not temporal: each surface provides its own entry ref, so
// every caller below it (anchor badge inside a message, follow-up card on the
// composer, bookmark bar, find bar) resolves to the transcript of the surface that
// contains it without knowing which surface that is. No module-level singleton,
// no activate/deactivate bookkeeping.
export type TranscriptEntry = {
  // The transcript's scroll container (`.msgs`) — the ONLY root a message query
  // may run against. null before mount / after unmount.
  root: () => HTMLElement | null
  // Grow the render window so message `msgIndex` is mounted (no-op when already
  // mounted). Resolves after the DOM settled and the viewport was re-anchored.
  reveal: (msgIndex: number) => Promise<void>
}

export type TranscriptSurface = ShallowRef<TranscriptEntry | null>

const KEY: InjectionKey<TranscriptSurface> = Symbol('transcriptSurface')

// Declare a transcript surface. Call ONCE in the setup of a component that hosts a
// SessionTranscript (today: SessionDetail, SshSessionPanel).
export function provideTranscriptSurface(): TranscriptSurface {
  const entry = shallowRef<TranscriptEntry | null>(null)
  provide(KEY, entry)
  return entry
}

// The entry ref of the nearest surface ancestor. Outside any surface each caller
// gets its own ref that stays null — a jump then fails loudly with 'not-found'
// instead of falling back to a document-wide query (ADR 0075 §1).
export function useTranscriptSurface(): TranscriptSurface {
  return inject(KEY, () => shallowRef<TranscriptEntry | null>(null), true)
}
