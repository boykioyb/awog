import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'

// Cross-session full-text search (docs/features/cross-session-search.md).
//
// Thin client over the sidecar's `sessions.search`, which folds EVERY session's
// JSONL and returns one hit per matching message. The list column's own filter box
// keeps doing what it always did — an instant, local title filter — and this adds
// the second, asynchronous half: "where in the transcripts does this text appear?".
//
// Two rules the caller relies on:
//   • DEBOUNCED — one RPC per pause, not per keystroke; each run folds every session
//     on disk, so it is far too expensive to fire on every character.
//   • RACE-GUARDED — a late answer to an older query is dropped. Without the
//     sequence check, typing "auth" then "author" could end with the results of
//     "auth" painted under the query "author", which reads as a wrong answer rather
//     than a slow one.

// The sidecar's zod schema rejects anything shorter (sessions.search.ts).
export const SESSION_SEARCH_MIN_CHARS = 2
const DEBOUNCE_MS = 250
const RESULT_LIMIT = 50

// One matching message — mirrors the sidecar's SessionSearchResult.
export type SessionSearchHit = {
  // Engine id of the session that holds the match (ses-… slug).
  sessionId: string
  sessionTitle: string
  projectId: string | null
  // Persisted message id — the anchor a jump resolves through (ADR 0074 §Q1).
  messageId: string
  role: 'user' | 'agent' | 'system'
  at: string
  snippet: string
}

// A snippet cut into alternating plain / matched runs. Rendered as spans so the
// match can be emphasised without `v-html` (the snippet is L1 data: it is model and
// user text straight off disk).
export type SnippetPart = { text: string; hit: boolean }

export function highlightSnippet(snippet: string, query: string): SnippetPart[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [{ text: snippet, hit: false }]
  const parts: SnippetPart[] = []
  const hay = snippet.toLowerCase()
  let from = 0
  for (;;) {
    const idx = hay.indexOf(needle, from)
    if (idx < 0) break
    if (idx > from) parts.push({ text: snippet.slice(from, idx), hit: false })
    parts.push({ text: snippet.slice(idx, idx + needle.length), hit: true })
    from = idx + needle.length // needle is non-empty → always advances
  }
  if (from < snippet.length) parts.push({ text: snippet.slice(from), hit: false })
  return parts
}

type SearchResponse = {
  results?: SessionSearchHit[]
  truncated?: boolean
  // Số PHIÊN đã lưu trữ có khớp nhưng bị giấu. Sidecar mặc định loại chúng khỏi
  // kết quả (archive = giấu đi, và `sessions.list` cũng đã giấu) — con số này để
  // người dùng biết mình đang không nhìn thấy hết, thay vì tìm mãi không ra vì
  // quên là đã lưu trữ. Cận dưới: vòng lặp phía sidecar thoát sớm khi đủ kết quả.
  archivedHidden?: number
}

export function useSessionSearch(query: () => string) {
  const sc = useSidecar()
  const { t } = useI18n()

  // Hits never mutate in place (each run replaces the array) → shallow is enough and
  // keeps a 50-row result set out of the deep-proxy path.
  const results = shallowRef<SessionSearchHit[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const truncated = ref(false)
  const archivedHidden = ref(0)
  // The query the current `results` belong to — highlighting reads THIS, not the
  // live input, so the emphasis can never disagree with the rows on screen.
  const matchedQuery = ref('')

  let timer: ReturnType<typeof setTimeout> | null = null
  let seq = 0

  function cancelTimer() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function reset() {
    seq++ // invalidate any in-flight run
    cancelTimer()
    results.value = []
    matchedQuery.value = ''
    truncated.value = false
    archivedHidden.value = 0
    loading.value = false
    error.value = null
  }

  async function run(q: string) {
    const mine = ++seq
    loading.value = true
    error.value = null
    try {
      const res = await sc.request<SearchResponse>('sessions.search', {
        query: q,
        limit: RESULT_LIMIT,
      })
      if (mine !== seq) return
      results.value = Array.isArray(res.results) ? res.results : []
      truncated.value = res.truncated === true
      archivedHidden.value = typeof res.archivedHidden === 'number' ? res.archivedHidden : 0
      matchedQuery.value = q
    } catch (err) {
      if (mine !== seq) return
      results.value = []
      matchedQuery.value = q
      truncated.value = false
      archivedHidden.value = 0
      console.warn('[sessions] sessions.search failed', err)
      error.value = t('sessionsSearch.error')
    } finally {
      if (mine === seq) loading.value = false
    }
  }

  watch(
    query,
    (raw) => {
      const q = raw.trim()
      // Below the minimum the feature is simply off — no RPC, no stale rows.
      // Without the shell there is no engine to ask (browser dev): stay silent
      // rather than showing an error the user cannot act on.
      if (q.length < SESSION_SEARCH_MIN_CHARS || !sc.available) {
        reset()
        return
      }
      // Old rows belong to an old question: drop them now so the section never
      // shows answers to a query the user already moved past.
      seq++
      cancelTimer()
      results.value = []
      matchedQuery.value = ''
      truncated.value = false
      archivedHidden.value = 0
      error.value = null
      loading.value = true
      timer = setTimeout(() => {
        timer = null
        void run(q)
      }, DEBOUNCE_MS)
    },
    { immediate: true },
  )

  onBeforeUnmount(reset)

  return { results, loading, error, truncated, archivedHidden, matchedQuery }
}
