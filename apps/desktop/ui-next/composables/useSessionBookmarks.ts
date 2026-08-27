import { computed, ref, watch } from 'vue'
import type { Session } from '~/composables/useSessionsData'
import { searchableSegments } from '~/utils/transcript-text'
import { pushActionToast } from '~/composables/useActionToasts'

// State behind the "Bookmarked (N)" bar (docs/features/session-transcript-navigation.md
// §A1). Bookmarks are READING anchors: they never enter the prompt and never leave
// ~/.awog.
//
// INVARIANT (ADR 0074 §Q1): a bookmark resolves through `map.get(b.id)` and nothing
// else. `undefined` ⇒ the row is dangling and does nothing when clicked. There is no
// fallback to a remembered index and no "closest message" — jumping to the WRONG
// message is the one failure mode this feature may never produce.
//
// Excerpts are DERIVED here, never persisted: the session header is read with an 8KB
// probe, and 30 stored excerpts would eat it on their own (spec §7.1).

// One line in the bar: ≤100 chars.
const EXCERPT_CHARS = 100

export type BookmarkRow = {
  // The bookmarked message's persisted engine id (SessionMessage.eid).
  id: string
  at: string
  // Runtime address in `s.msgs`; -1 while the anchor does not resolve.
  msgIndex: number
  excerpt: string
  dangling: boolean
}

export function useSessionBookmarks(session: () => Session) {
  const store = useSessionsStore()
  const { t } = useI18n()
  const { scrollToMessage } = useSessionScroll()

  // Anchors that resolved in data but could not be revealed in the DOM just now
  // (transcript reloading, row inside a hidden subtree). Shown as dangling for THIS
  // view only and never written to disk — an auto-delete here would turn a transient
  // miss into unrecoverable data loss (spec §5.3).
  const unreachable = ref(new Set<string>())
  // Ephemeral by design (spec §14): reopening a session starts collapsed.
  const expanded = ref(false)

  watch(
    () => session().id,
    () => {
      expanded.value = false
      unreachable.value = new Set()
    },
  )

  // O(1) resolve for every row: `s.msgs` can hold hundreds of markRaw()'d messages and
  // the bar re-renders on every turn, so a findIndex per row inside a v-for is out.
  const indexByEid = computed(() => {
    const map = new Map<string, number>()
    session().msgs.forEach((m, i) => {
      if (m.eid && !map.has(m.eid)) map.set(m.eid, i)
    })
    return map
  })

  // First non-empty prose segment of the turn, cut to one line. Same surface find uses,
  // so what the bar shows is what a reader recognises as "what was said" — tool steps,
  // thinking and diffs are not prose and stay out.
  function excerptOf(msgIndex: number): string {
    const m = session().msgs[msgIndex]
    const seg = m ? searchableSegments(m)[0] : undefined
    if (!seg) return ''
    return seg.text.length > EXCERPT_CHARS ? `${seg.text.slice(0, EXCERPT_CHARS)}…` : seg.text
  }

  function atMs(at: string): number {
    const ms = Date.parse(at)
    return Number.isNaN(ms) ? 0 : ms
  }

  const rows = computed<BookmarkRow[]>(() => {
    const map = indexByEid.value
    const list = (session().bookmarks ?? []).map<BookmarkRow>((b) => {
      const found = map.get(b.id)
      const dangling = found === undefined || unreachable.value.has(b.id)
      const msgIndex = found ?? -1
      return {
        id: b.id,
        at: b.at,
        msgIndex,
        dangling,
        excerpt: dangling
          ? t('sessions.bookmark.dangling')
          : excerptOf(msgIndex) || t('sessions.bookmark.noText'),
      }
    })
    // MESSAGE time ascending — the reading order — not the order the user clicked
    // (AC-B4). Ties break on the resolved index so the order is deterministic, and
    // dangling rows sink to the bottom where they can't be mistaken for navigation.
    return list.sort((a, b) => {
      if (a.dangling !== b.dangling) return a.dangling ? 1 : -1
      const d = atMs(a.at) - atMs(b.at)
      return d !== 0 ? d : a.msgIndex - b.msgIndex
    })
  })

  const count = computed(() => rows.value.length)

  // The one row the collapsed bar shows: the newest by MESSAGE time (AC-B5). Computed
  // over `at` rather than "last row" because dangling rows sort last regardless of age.
  const latest = computed<BookmarkRow | null>(() => {
    let best: BookmarkRow | null = null
    for (const r of rows.value) if (!best || atMs(r.at) >= atMs(best.at)) best = r
    return best
  })

  async function jump(row: BookmarkRow): Promise<void> {
    if (row.dangling) return
    const res = await scrollToMessage(row.msgIndex)
    if (res === 'ok') return
    // Fail loud, and only within this view: the row goes dangling so the next click
    // can't scroll somewhere else, but the anchor stays on disk.
    unreachable.value = new Set(unreachable.value).add(row.id)
    pushActionToast(t('sessions.bookmark.notFound'), 'error')
  }

  function remove(row: BookmarkRow): void {
    store.removeBookmark(session().id, row.id)
  }

  return { rows, count, latest, expanded, jump, remove }
}
