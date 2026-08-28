import { nextTick } from 'vue'
import {
  useTranscriptSurface,
  type TranscriptEntry,
  type TranscriptSurface,
} from './useTranscriptSurface'

// Scroll to + briefly flash a transcript message by its `data-mi` index (§8).
// Shared by follow-up anchors (on a source message), follow-up cards (on the
// composer) and any future jump caller (bookmark bar, find bar), so none of them
// needs a ref to the transcript component.
//
// The target usually is NOT mounted: the transcript only renders the last few
// turns. So a jump is a two-step contract (ADR 0074 §Q2): first ask the transcript
// that owns THIS surface to grow its render window (`reveal`), then query the row
// inside that transcript's own root (ADR 0075 — never `document`, which would pick
// the first copy in document order, possibly one hidden behind `v-show`).
// `surfaceOverride` is for the component that DECLARES the surface: `inject` resolves
// from the parent's provides, so a provider can never inject its own entry. SessionDetail
// keeps the ref `provideTranscriptSurface()` returned and hands it in; everyone below it
// (message rows, composer, find bar under those) just injects.
export function useSessionScroll(surfaceOverride?: TranscriptSurface) {
  const surface = surfaceOverride ?? useTranscriptSurface()

  // Called by SessionTranscript on mount. Returns an unregister function that only
  // clears the pointer when it still refers to this very entry.
  const registerTranscriptRevealer = (entry: TranscriptEntry): (() => void) => {
    surface.value = entry
    return () => {
      if (surface.value === entry) surface.value = null
    }
  }

  // 'not-found' means the jump did NOT happen (no transcript in this surface, the
  // row still isn't mounted, or it sits in a `display:none` subtree where
  // scrollIntoView is a silent no-op). Callers react — toast + dangling row for a
  // bookmark, skip-and-continue for find — instead of failing silently.
  const scrollToMessage = async (msgIndex: number): Promise<'ok' | 'not-found'> => {
    if (typeof document === 'undefined') return 'not-found'
    const entry = surface.value
    if (!entry) return 'not-found'
    await entry.reveal(msgIndex)
    await nextTick()
    const el = entry.root()?.querySelector<HTMLElement>(`[data-mi="${msgIndex}"]`)
    if (!el) return 'not-found'
    // Rendered but invisible (inside a hidden tab) → scrolling it is a no-op.
    if (el.getClientRects().length === 0) return 'not-found'
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // Self-contained flash (no CSS dependency): briefly tint the row background.
    const prev = el.style.backgroundColor
    const prevTransition = el.style.transition
    el.style.transition = 'background-color .25s ease'
    el.style.backgroundColor = 'color-mix(in srgb, var(--accent) 18%, transparent)'
    window.setTimeout(() => {
      el.style.backgroundColor = prev
      window.setTimeout(() => {
        el.style.transition = prevTransition
      }, 300)
    }, 850)
    return 'ok'
  }
  return { scrollToMessage, registerTranscriptRevealer }
}
