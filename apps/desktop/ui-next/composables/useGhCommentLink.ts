// Bare GitHub comment/review references ("comment 5949627309", "issuecomment-…",
// "discussion_r…", "pullrequestreview-…") rendered in transcripts/board threads →
// click resolves the id to its html_url via `gh.commentUrl` and opens the OS
// browser. Provided per-context like provideFilePreview: the nearest ancestor
// declares which project's repo the id resolves against — SessionDetail passes
// its session's project id, the board thread passes the item's projectId — so a
// link inside the board modal resolves against the BOARD's repo, not whichever
// session happens to be active underneath.
//
// No pre-verification: the chip renders on shape alone and the resolution
// happens on click (1–3 `gh api` probes, result cached per project+id). A
// failure surfaces as a toast — matching the "could not load" convention rather
// than a dead-looking link.
import { inject, provide, toValue, type InjectionKey, type MaybeRefOrGetter } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useSidecar } from '~/composables/useSidecar'
import { useToast } from '~/composables/useToast'

// Keyword + ≥4 digits. The lookbehind keeps `comment` inside `issuecomment`
// from double-matching; `bình luận` covers Vietnamese prose agents write.
export const GH_COMMENT_RE =
  /(?<![\p{L}\p{N}_])(?:issuecomment|discussion_r|pullrequestreview|comment|bình luận)[-_\s]*#?(\d{4,})/giu

type Opener = (commentId: string) => void
const KEY: InjectionKey<Opener> = Symbol('ghCommentLink')

// Resolved id → html_url, per project — a second click skips the API probes.
const cache = new Map<string, string>()
const CACHE_MAX = 200

export function provideGhCommentLink(projectRef: MaybeRefOrGetter<string | undefined>): void {
  const sc = useSidecar()
  const { t } = useI18n()

  provide(KEY, (commentId) => {
    const projectId = toValue(projectRef)
    if (!projectId || !sc.available) return
    const key = `${projectId}::${commentId}`
    const cached = cache.get(key)
    if (cached) {
      void sc.openExternal(cached)
      return
    }
    void sc
      .request<{ url: string }>('gh.commentUrl', { projectId, commentId })
      .then(async (res) => {
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
        cache.set(key, res.url)
        await sc.openExternal(res.url)
      })
      .catch((err: unknown) => {
        useToast().add({
          title: t('github.comment.openFailed', { id: commentId }),
          description: err instanceof Error ? err.message : String(err),
          color: 'error',
        })
      })
  })
}

// Leaf side: null when no ancestor provided a project context — callers leave
// the mention as plain text then.
export function useGhCommentLink(): Opener | null {
  return inject(KEY, null)
}
