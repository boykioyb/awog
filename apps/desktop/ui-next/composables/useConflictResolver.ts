import { computed, onMounted, ref } from 'vue'
import { SidecarError } from '~/composables/useSidecar'
import type { DiffLine } from '~/components/git/git-types'
import type { ReadConflictFileResult, SidecarMergeConflictBlock } from '~/composables/useGitApi'
import { useGitStore } from '~/stores/git'

// Which UI the resolver renders. `loading` while readConflictFile is in flight,
// `text` for a normal per-block 2-way pick, `binary` for a whole-side pick,
// `encoding` for the non-UTF-8 external-editor fallback, `gone` when the file is
// no longer in conflict (ENOENT / other). See spec Flows 1/4/5 + CR-02/09/10.
type ResolverMode = 'loading' | 'text' | 'binary' | 'encoding' | 'gone'

type Choice = 'ours' | 'theirs'

// Pull the sidecar gitCode (ENCODING_UNSUPPORTED / ENOENT / MERGE_CONFLICT) out of
// an error, when present. Mirrors the store's own gitCodeOf helper.
function gitCodeOf(err: unknown): string | null {
  if (err instanceof SidecarError && err.data && typeof err.data === 'object') {
    const c = (err.data as { gitCode?: unknown }).gitCode
    return typeof c === 'string' ? c : null
  }
  return null
}

// Map one side of a conflict block to diff lines the shared GitDiffLine renderer
// understands. OURS renders as deletions (var --del), THEIRS as additions
// (var --add) — reusing the existing add/del theming without hardcoded color.
// An empty side yields no lines; the template shows the emptySide placeholder.
export function toDiffLines(lines: string[], kind: Choice): DiffLine[] {
  return lines.map((s, i) => ({ t: kind === 'ours' ? '-' : '+', n: i + 1, s }))
}

export function useConflictResolver(path: () => string, onResolved: () => void) {
  const store = useGitStore()

  const mode = ref<ResolverMode>('loading')
  const blocks = ref<SidecarMergeConflictBlock[]>([])
  // Per-block choice, keyed by the block's own index (matches the sidecar's
  // blockIndex). Lives in the component only — never lifted into the store.
  const choices = ref<Map<number, Choice>>(new Map())
  // Inline error under the toolbar (desync/gone) so the resolver stays open.
  const errorKey = ref<string | null>(null)
  const isResolving = ref(false)

  const total = computed(() => blocks.value.length)
  const chosen = computed(() => choices.value.size)
  const allChosen = computed(() => total.value > 0 && chosen.value === total.value)

  const load = async () => {
    mode.value = 'loading'
    errorKey.value = null
    choices.value = new Map()
    blocks.value = []
    try {
      const res: ReadConflictFileResult = await store.loadConflictFile(path())
      if (res.isBinary) {
        mode.value = 'binary'
        return
      }
      blocks.value = res.blocks
      mode.value = 'text'
    } catch (err) {
      const code = gitCodeOf(err)
      if (code === 'ENCODING_UNSUPPORTED') mode.value = 'encoding'
      else mode.value = 'gone'
    }
  }

  const pick = (blockIndex: number, choice: Choice) => {
    const next = new Map(choices.value)
    next.set(blockIndex, choice)
    choices.value = next
  }

  const pickAll = (choice: Choice) => {
    const next = new Map<number, Choice>()
    for (const b of blocks.value) next.set(b.index, choice)
    choices.value = next
  }

  const markResolved = async () => {
    if (!allChosen.value || isResolving.value) return
    const resolutions = blocks.value.map((b) => ({
      blockIndex: b.index,
      choice: choices.value.get(b.index) as Choice,
    }))
    isResolving.value = true
    errorKey.value = null
    try {
      await store.resolveConflict(path(), resolutions)
      onResolved()
    } catch {
      // Store already reported (toast) + re-threw. Keep the resolver open and show
      // an inline desync hint with a reload affordance (CR-13).
      errorKey.value = 'git.conflict.error.desync'
    } finally {
      isResolving.value = false
    }
  }

  const resolveBinary = async (choice: Choice) => {
    if (isResolving.value) return
    isResolving.value = true
    errorKey.value = null
    try {
      await store.resolveConflictBinary(path(), choice)
      onResolved()
    } catch {
      errorKey.value = 'git.conflict.error.gone'
    } finally {
      isResolving.value = false
    }
  }

  const openExternal = () => store.openFile(path())
  const markStaged = async () => {
    await store.stageFile(path())
    onResolved()
  }
  const copyPath = () => navigator.clipboard?.writeText(path())

  // GitManager keys <GitConflictResolver> by path, so each path gets a fresh
  // instance — load once on mount, no need to watch path (avoids stale-response
  // race when switching conflicted files quickly).
  onMounted(load)

  return {
    mode,
    blocks,
    choices,
    errorKey,
    isResolving,
    total,
    chosen,
    allChosen,
    load,
    pick,
    pickAll,
    markResolved,
    resolveBinary,
    openExternal,
    markStaged,
    copyPath,
  }
}
