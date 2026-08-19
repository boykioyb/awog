import { computed, onMounted, ref, watch } from 'vue'
import {
  useWikiStore,
  wikiKey,
  type WikiPage,
  type WikiPageContent,
  type WikiSearchHit,
  type WikiSource,
} from '~/stores/wiki'
import { useProjectsStore } from '~/stores/projects'
import { pickFiles, pickFolders } from '~/composables/useFolderPicker'

// Page controller for /wiki (nuxt-vue rule: a page over ~250 lines pushes ALL
// state + handlers into a useXxxManager composable and keeps the SFC to markup).
//
// Holds: the tree (from the store), the open page's content, editor draft state,
// search, and the import flow. The tree is metadata-only; a page body is fetched
// when it is opened — a wiki can be thousands of pages (ADR 0073).

export type WikiViewMode = 'read' | 'edit'

export interface WikiTreeNode {
  // '' for the synthetic root group holding top-level pages.
  space: string
  title: string
  description: string
  source: WikiSource
  projectId?: string
  pages: WikiPage[]
}

const DRAFT_TEMPLATE = '# {title}\n\n'

export function useWikiManager() {
  const store = useWikiStore()
  const projects = useProjectsStore()

  const selectedKey = ref('')
  const content = ref<WikiPageContent | null>(null)
  const loadingPage = ref(false)
  const mode = ref<WikiViewMode>('read')
  const collapsedSpaces = ref<Record<string, boolean>>({})

  // Sidebar width, persisted locally (a layout preference, not engine state — so
  // localStorage, not the settings blob).
  const SIDEBAR_KEY = 'awog.wiki.sidebarWidth'
  const sidebarWidth = ref(260)
  if (typeof window !== 'undefined') {
    const saved = Number(window.localStorage.getItem(SIDEBAR_KEY))
    if (Number.isFinite(saved) && saved >= 200 && saved <= 480) sidebarWidth.value = saved
  }
  function setSidebarWidth(width: number): void {
    sidebarWidth.value = width
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(SIDEBAR_KEY, String(width))
      } catch {
        // Quota/availability errors are non-fatal — the width stays in memory.
      }
    }
  }

  // Search is transient (never persisted): a query is a momentary lens on the
  // tree, and restoring a stale one on reload only confuses.
  const query = ref('')
  const hits = ref<WikiSearchHit[]>([])
  const searching = ref(false)

  // Editor draft — mirrors the open page until saved.
  const draft = ref({ title: '', description: '', tags: '', context: true, body: '' })
  const draftPath = ref('')
  const saving = ref(false)
  const dirty = computed(() => {
    if (mode.value !== 'edit' || !content.value) return false
    const p = content.value.page
    return (
      draft.value.title !== p.title ||
      draft.value.description !== p.description ||
      draft.value.tags !== p.tags.join(', ') ||
      draft.value.context !== p.context ||
      draft.value.body !== content.value.body
    )
  })

  const projectIds = computed(() => projects.projects.map((p) => p.id))
  const selectedPage = computed(() =>
    selectedKey.value ? store.pageByKey(selectedKey.value) : undefined,
  )

  // Tree grouped by (source, projectId, space) so a global and a project wiki with
  // the same space name stay separate rows.
  const tree = computed<WikiTreeNode[]>(() => {
    const groups = new Map<string, WikiTreeNode>()
    for (const page of store.pages) {
      const key = `${page.source}|${page.projectId ?? ''}|${page.space}`
      let node = groups.get(key)
      if (!node) {
        const space = store.spaces.find(
          (s) =>
            s.id === page.space &&
            s.source === page.source &&
            (s.projectId ?? '') === (page.projectId ?? ''),
        )
        node = {
          space: page.space,
          title: space?.title || page.space,
          description: space?.description ?? '',
          source: page.source,
          pages: [],
          ...(page.projectId ? { projectId: page.projectId } : {}),
        }
        groups.set(key, node)
      }
      node.pages.push(page)
    }
    const nodes = [...groups.values()]
    for (const node of nodes) node.pages.sort((a, b) => a.title.localeCompare(b.title))
    // Root pages last: they are the exception, spaces are the structure.
    return nodes.sort((a, b) => {
      if (a.space === '') return 1
      if (b.space === '') return -1
      return a.space.localeCompare(b.space)
    })
  })

  const spaceKey = (node: WikiTreeNode): string =>
    `${node.source}|${node.projectId ?? ''}|${node.space}`
  const isCollapsed = (node: WikiTreeNode): boolean =>
    collapsedSpaces.value[spaceKey(node)] === true
  const toggleSpace = (node: WikiTreeNode): void => {
    collapsedSpaces.value[spaceKey(node)] = !isCollapsed(node)
  }

  // Space ids available as import targets, for the current scope.
  const spaceOptions = computed(() =>
    [...new Set(store.spaces.map((s) => s.id))].sort((a, b) => a.localeCompare(b)),
  )

  async function open(page: Pick<WikiPage, 'path' | 'source' | 'projectId'>): Promise<void> {
    selectedKey.value = wikiKey(page)
    mode.value = 'read'
    loadingPage.value = true
    try {
      content.value = await store.readPage(page)
    } finally {
      loadingPage.value = false
    }
  }

  function startEdit(): void {
    const c = content.value
    if (!c) return
    draft.value = {
      title: c.page.title,
      description: c.page.description,
      tags: c.page.tags.join(', '),
      context: c.page.context,
      body: c.body,
    }
    draftPath.value = c.page.path
    mode.value = 'edit'
  }

  function cancelEdit(): void {
    mode.value = 'read'
  }

  async function save(): Promise<boolean> {
    const c = content.value
    if (!c) return false
    saving.value = true
    try {
      const saved = await store.savePage({
        source: c.page.source,
        ...(c.page.projectId ? { projectId: c.page.projectId } : {}),
        path: draftPath.value || c.page.path,
        title: draft.value.title.trim() || c.page.path,
        description: draft.value.description.trim(),
        tags: draft.value.tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0),
        context: draft.value.context,
        body: draft.value.body,
        mode: 'update',
      })
      if (!saved) return false
      mode.value = 'read'
      await open(saved)
      return true
    } finally {
      saving.value = false
    }
  }

  // Create a page at `path` in the given tier and open it in the editor.
  async function createPage(input: {
    source: WikiSource
    projectId?: string
    path: string
    title?: string
  }): Promise<WikiPage | null> {
    const title = (input.title ?? input.path.split('/').pop() ?? input.path).trim()
    const page = await store.savePage({
      source: input.source,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      path: input.path,
      title,
      description: '',
      context: true,
      body: DRAFT_TEMPLATE.replace('{title}', title),
      mode: 'create',
    })
    if (!page) return null
    await store.loadTree()
    await open(page)
    startEdit()
    return page
  }

  // Rename = move on disk. Backlinks are NOT rewritten (ADR 0073 spec, out of
  // scope v1) — the caller warns with the count first.
  async function renamePage(page: WikiPage, to: string): Promise<boolean> {
    const moved = await store.movePage(page, to)
    if (!moved) return false
    await open(moved)
    return true
  }

  async function backlinkCount(page: WikiPage): Promise<number> {
    const content = await store.readPage(page)
    return content?.backlinks.length ?? 0
  }

  async function removePage(page: WikiPage): Promise<void> {
    const ok = await store.deletePage(page)
    if (ok && wikiKey(page) === selectedKey.value) {
      selectedKey.value = ''
      content.value = null
    }
  }

  async function toggleContext(page: WikiPage): Promise<void> {
    // The flag lives in the page's frontmatter, so flipping it is a save. Read the
    // body first: a save writes the whole file and must not blank it.
    const current = await store.readPage(page, false)
    if (!current) return
    await store.savePage({
      source: page.source,
      ...(page.projectId ? { projectId: page.projectId } : {}),
      path: page.path,
      title: page.title,
      description: page.description,
      tags: page.tags,
      context: !page.context,
      body: current.body,
      mode: 'update',
    })
    if (wikiKey(page) === selectedKey.value) content.value = await store.readPage(page)
  }

  async function runSearch(): Promise<void> {
    const q = query.value.trim()
    if (q === '') {
      hits.value = []
      return
    }
    searching.value = true
    try {
      hits.value = await store.search(q)
    } finally {
      searching.value = false
    }
  }

  // ── Import ────────────────────────────────────────────────────────────────
  // Three entry points, one RPC: the OS file dialog, the OS folder dialog, and
  // drag-drop (paths resolved through the Electron bridge). The sidecar copies
  // the files in and reports what it skipped (ADR 0073 D-8).
  const importing = ref(false)
  const importTarget = ref<{ source: WikiSource; projectId?: string; space: string }>({
    source: 'global',
    space: '',
  })
  const lastImport = ref<{ imported: number; skipped: { name: string; reason: string }[] } | null>(
    null,
  )

  async function importPaths(paths: string[], overwrite = false): Promise<void> {
    if (paths.length === 0) return
    importing.value = true
    try {
      const report = await store.importDocs({
        source: importTarget.value.source,
        ...(importTarget.value.projectId ? { projectId: importTarget.value.projectId } : {}),
        ...(importTarget.value.space ? { space: importTarget.value.space } : {}),
        paths,
        overwrite,
      })
      lastImport.value = report
        ? { imported: report.imported.length, skipped: report.skipped }
        : null
    } finally {
      importing.value = false
    }
  }

  async function importFilesViaDialog(): Promise<void> {
    const paths = await pickFiles({
      title: 'Import Markdown into the wiki',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdx', 'txt'] }],
    })
    await importPaths(paths)
  }

  async function importFolderViaDialog(): Promise<void> {
    const paths = await pickFolders({ title: 'Import a folder of Markdown into the wiki' })
    await importPaths(paths)
  }

  // Drag-drop: Electron ≥32 removed File.path, so the absolute path comes from the
  // preload bridge (webUtils.getPathForFile). A drop from outside the filesystem
  // (browser dev) yields '' and is ignored.
  async function importDrop(files: FileList | File[]): Promise<void> {
    const bridge = typeof window !== 'undefined' ? window.awog : undefined
    if (!bridge?.getPathForFile) return
    const paths: string[] = []
    for (const file of Array.from(files)) {
      const path = bridge.getPathForFile(file)
      if (path) paths.push(path)
    }
    await importPaths(paths)
  }

  // Follow a `[[wikilink]]` the reader clicked: resolve against the loaded tree
  // the same way the sidecar does (exact slug → sibling in the space → unique last
  // segment) and open it. Returns false when the link is dead, so the caller can
  // offer to create the page.
  function resolveLink(target: string): WikiPage | null {
    const wanted = target.replace(/\.md$/i, '').toLowerCase()
    const from = selectedPage.value
    const scoped = store.pages.filter(
      (p) => !from || (p.source === from.source && (p.projectId ?? '') === (from.projectId ?? '')),
    )
    const exact = scoped.find((p) => p.path.toLowerCase() === wanted)
    if (exact) return exact ?? null
    if (from?.space) {
      const sibling = scoped.find(
        (p) => p.path.toLowerCase() === `${from.space.toLowerCase()}/${wanted}`,
      )
      if (sibling) return sibling
    }
    const suffix = scoped.filter((p) => p.path.split('/').pop()?.toLowerCase() === wanted)
    return suffix.length === 1 ? (suffix[0] ?? null) : null
  }

  onMounted(() => {
    void projects.hydrate()
    void store.loadTree(projectIds.value)
  })

  // Projects arrive asynchronously; re-scan once so project-tier wikis appear.
  watch(projectIds, (ids) => {
    if (ids.length > 0) void store.loadTree(ids)
  })

  return {
    store,
    // tree + selection
    tree,
    spaceOptions,
    selectedKey,
    selectedPage,
    content,
    loadingPage,
    isCollapsed,
    toggleSpace,
    open,
    sidebarWidth,
    setSidebarWidth,
    // editing
    mode,
    draft,
    draftPath,
    dirty,
    saving,
    startEdit,
    cancelEdit,
    save,
    createPage,
    renamePage,
    backlinkCount,
    removePage,
    toggleContext,
    resolveLink,
    // search
    query,
    hits,
    searching,
    runSearch,
    // import
    importing,
    importTarget,
    lastImport,
    importFilesViaDialog,
    importFolderViaDialog,
    importDrop,
  }
}
