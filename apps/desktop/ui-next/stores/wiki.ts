import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSidecar, type UnlistenFn } from '~/composables/useSidecar'

// Wiki store (ADR 0073) — the in-app documentation surface that doubles as the
// LLM's context source. Two tiers of Markdown files scanned by the sidecar:
//   global  → ~/.awog/wiki/<space>/**/*.md
//   project → {project}/.awog/wiki/<space>/**/*.md
//
// The store holds the TREE (metadata only) plus the currently open page's
// content — a wiki can be thousands of pages, so page bodies are fetched on
// demand and never cached wholesale. `wiki.fs-changed` re-hydrates the tree when
// a page is edited outside the app (own editor, git pull). Mirrors the dual-path
// pattern of stores/rules.ts: without the Electron bridge everything stays empty.

export type WikiSource = 'global' | 'project'

// Mirror of the sidecar WikiPage (apps/desktop/sidecar/src/types/shared.ts).
export type WikiPage = {
  // Slug: root-relative path without `.md` — 'architecture/system-overview'.
  path: string
  source: WikiSource
  projectId?: string
  // First path segment, '' for a page at the wiki root.
  space: string
  title: string
  description: string
  tags: string[]
  // False = hidden from the LLM (index + search); still readable in the app.
  context: boolean
  bytes: number
  updatedAt: number
}

export type WikiSpace = {
  id: string
  source: WikiSource
  projectId?: string
  title: string
  description: string
  pageCount: number
}

export type WikiScanReport = {
  dir: string
  source: WikiSource
  projectId?: string
  found: number
}

export type WikiPageContent = {
  page: WikiPage
  // File verbatim (frontmatter included) — what the editor round-trips.
  raw: string
  // Content below the frontmatter — what the reader renders.
  body: string
  truncated: boolean
  backlinks: WikiPage[]
}

export type WikiSearchHit = {
  path: string
  source: WikiSource
  projectId?: string
  title: string
  line: number
  preview: string
}

export type WikiImportReport = {
  imported: string[]
  skipped: { name: string; reason: string }[]
}

export type WikiPageInput = {
  source: WikiSource
  projectId?: string
  path: string
  title: string
  description?: string
  tags?: string[]
  context?: boolean
  body: string
  mode?: 'create' | 'update'
}

type WikiTreeResponse = { spaces: WikiSpace[]; pages: WikiPage[]; reports?: WikiScanReport[] }

// Composite identity — (source, projectId, path). A global and a project wiki may
// hold the same slug.
export const wikiKey = (p: Pick<WikiPage, 'path' | 'source' | 'projectId'>): string =>
  `${p.source}|${p.projectId ?? ''}|${p.path}`

export const useWikiStore = defineStore('wiki', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  const pages = ref<WikiPage[]>([])
  const spaces = ref<WikiSpace[]>([])
  const scanReports = ref<WikiScanReport[]>([])
  const loaded = ref(false)
  const lastError = ref('')

  // Project scope of the last load, so an fs-changed re-hydrate keeps it.
  let lastProjectIds: string[] = []
  let unlisten: UnlistenFn | null = null

  const pageByKey = (key: string): WikiPage | undefined =>
    pages.value.find((p) => wikiKey(p) === key)

  // Total characters the LLM index costs, estimated the same way the sidecar
  // builds it (one line per visible page). Shown in the toolbar so the cost of a
  // growing wiki stays visible instead of surfacing as a mysterious token bill.
  const indexChars = computed(() =>
    pages.value
      .filter((p) => p.context)
      .reduce((sum, p) => sum + p.path.length + p.description.length + 6, 0),
  )
  const contextPageCount = computed(() => pages.value.filter((p) => p.context).length)

  async function loadTree(projectIds?: string[]): Promise<void> {
    if (!available.value) {
      loaded.value = true
      return
    }
    lastProjectIds = projectIds ?? lastProjectIds
    try {
      const ids = lastProjectIds
      const res = await sc.request<WikiTreeResponse>(
        'wiki.tree',
        ids.length > 0 ? { projectIds: ids } : {},
      )
      pages.value = Array.isArray(res.pages) ? res.pages : []
      spaces.value = Array.isArray(res.spaces) ? res.spaces : []
      scanReports.value = Array.isArray(res.reports) ? res.reports : []
      lastError.value = ''
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      console.warn('[wiki] loadTree failed', err)
    } finally {
      loaded.value = true
      void subscribe()
    }
  }

  async function readPage(
    page: Pick<WikiPage, 'path' | 'source' | 'projectId'>,
    withBacklinks = true,
  ): Promise<WikiPageContent | null> {
    if (!available.value) return null
    try {
      const params: Record<string, unknown> = {
        source: page.source,
        path: page.path,
        withBacklinks,
      }
      if (page.projectId) params.projectId = page.projectId
      const res = await sc.request<WikiPageContent>('wiki.readPage', params)
      lastError.value = ''
      return { ...res, backlinks: Array.isArray(res.backlinks) ? res.backlinks : [] }
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      return null
    }
  }

  async function savePage(input: WikiPageInput): Promise<WikiPage | null> {
    if (!available.value) return null
    try {
      const res = await sc.request<{ page: WikiPage }>('wiki.savePage', input)
      const existing = pages.value.find((p) => wikiKey(p) === wikiKey(res.page))
      if (existing) Object.assign(existing, res.page)
      else pages.value.push(res.page)
      lastError.value = ''
      return res.page
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      return null
    }
  }

  async function deletePage(
    page: Pick<WikiPage, 'path' | 'source' | 'projectId'>,
  ): Promise<boolean> {
    if (!available.value) return false
    const key = wikiKey(page)
    try {
      const params: Record<string, unknown> = { source: page.source, path: page.path }
      if (page.projectId) params.projectId = page.projectId
      await sc.request('wiki.deletePage', params)
      pages.value = pages.value.filter((p) => wikiKey(p) !== key)
      lastError.value = ''
      return true
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      return false
    }
  }

  async function movePage(
    page: Pick<WikiPage, 'path' | 'source' | 'projectId'>,
    to: string,
  ): Promise<WikiPage | null> {
    if (!available.value) return null
    try {
      const params: Record<string, unknown> = { source: page.source, from: page.path, to }
      if (page.projectId) params.projectId = page.projectId
      const res = await sc.request<{ page: WikiPage }>('wiki.movePage', params)
      await loadTree()
      lastError.value = ''
      return res.page
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      return null
    }
  }

  async function deleteSpace(
    space: Pick<WikiSpace, 'id' | 'source' | 'projectId'>,
  ): Promise<boolean> {
    if (!available.value) return false
    try {
      const params: Record<string, unknown> = { source: space.source, space: space.id }
      if (space.projectId) params.projectId = space.projectId
      await sc.request('wiki.deleteSpace', params)
      await loadTree()
      lastError.value = ''
      return true
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      return false
    }
  }

  // Import Markdown the user picked (OS dialog / drag-drop). `paths` are absolute
  // on-disk paths; the sidecar copies them into the wiki (ADR 0073 D-8).
  async function importDocs(input: {
    source: WikiSource
    projectId?: string
    space?: string
    paths: string[]
    overwrite?: boolean
  }): Promise<WikiImportReport | null> {
    if (!available.value) return null
    try {
      const res = await sc.request<WikiImportReport>('wiki.import', input)
      await loadTree()
      lastError.value = ''
      return res
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      return null
    }
  }

  async function search(query: string, space?: string): Promise<WikiSearchHit[]> {
    if (!available.value || query.trim() === '') return []
    try {
      const params: Record<string, unknown> = { query, projectIds: lastProjectIds }
      if (space) params.space = space
      const res = await sc.request<{ hits: WikiSearchHit[] }>('wiki.search', params)
      lastError.value = ''
      return Array.isArray(res.hits) ? res.hits : []
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      return []
    }
  }

  async function subscribe(): Promise<void> {
    if (!available.value || unlisten) return
    try {
      unlisten = await sc.onEvent((evt) => {
        if (!evt || evt.type !== 'wiki.fs-changed') return
        void loadTree()
      })
    } catch {
      unlisten = null
    }
  }

  return {
    // state
    pages,
    spaces,
    scanReports,
    loaded,
    available,
    lastError,
    // getters
    pageByKey,
    indexChars,
    contextPageCount,
    // actions
    loadTree,
    readPage,
    savePage,
    deletePage,
    movePage,
    deleteSpace,
    importDocs,
    search,
  }
})
