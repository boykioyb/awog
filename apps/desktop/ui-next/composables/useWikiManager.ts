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

// One row of the wiki tree. A node is a page, a container, or BOTH — the store
// allows `a/b.md` to coexist with `a/b/*.md`, which is exactly the Notion shape:
// any page can have children. `page` is undefined for a pure container (a folder
// with children but no page of its own — reachable on disk, not creatable in the UI).
export interface WikiTreeNode {
  // Stable identity across re-scans: tier + slug.
  key: string
  // Slug of this node ('architecture', 'architecture/adr/why-sidecar').
  path: string
  // Last path segment's display name.
  title: string
  description: string
  source: WikiSource
  projectId?: string
  // Depth from the tier root (0 = space / root-level page).
  depth: number
  page?: WikiPage
  children: WikiTreeNode[]
  // Pages at or below this node — what the row's count badge shows.
  pageCount: number
}

const DRAFT_TEMPLATE = '# {title}\n\n'

// A typed name is a TITLE; the path segment is its slug ("Kiến trúc hệ thống" →
// `kien-truc-he-thong`). Shared by the new-space and new-child flows.
export function slugifySegment(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .toLowerCase()
}

export function useWikiManager() {
  const store = useWikiStore()
  const projects = useProjectsStore()

  const selectedKey = ref('')
  const content = ref<WikiPageContent | null>(null)
  const loadingPage = ref(false)
  const mode = ref<WikiViewMode>('read')
  // node key → explicitly expanded (true) / collapsed (false). Absent = the default
  // for that depth (see isCollapsed).
  const EXPANDED_KEY = 'awog.wiki.expanded'
  const expanded = ref<Record<string, boolean>>({})
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(EXPANDED_KEY)
      const parsed = raw ? (JSON.parse(raw) as unknown) : null
      if (parsed && typeof parsed === 'object') expanded.value = parsed as Record<string, boolean>
    } catch {
      // Corrupt entry → start from defaults rather than failing the page.
    }
  }
  function persistExpanded(): void {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(EXPANDED_KEY, JSON.stringify(expanded.value))
    } catch {
      // Quota/availability errors are non-fatal — expansion stays in memory.
    }
  }

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
  // Derived description of the open page, surfaced as the editor's placeholder so the
  // user can see what the LLM index currently shows without it being a saved value.
  const derivedDescription = computed(() =>
    content.value?.page.descriptionDerived === true ? content.value.page.description : '',
  )
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
    // Build from slugs: every ancestor segment becomes a node, so `a/b/c` creates
    // `a` → `a/b` → `a/b/c` even when `a.md` / `a/b.md` do not exist. Keyed per tier
    // so a global and a project wiki sharing a slug stay separate branches.
    const roots: WikiTreeNode[] = []
    const byKey = new Map<string, WikiTreeNode>()
    const nodeKey = (page: Pick<WikiPage, 'source' | 'projectId'>, path: string): string =>
      `${page.source}|${page.projectId ?? ''}|${path}`

    const ensure = (page: WikiPage, path: string, depth: number): WikiTreeNode => {
      const key = nodeKey(page, path)
      const existing = byKey.get(key)
      if (existing) return existing
      // A top-level node's display name comes from the space's `_index.md` when it
      // has one; deeper nodes fall back to their own segment.
      const space =
        depth === 0
          ? store.spaces.find(
              (sp) =>
                sp.id === path &&
                sp.source === page.source &&
                (sp.projectId ?? '') === (page.projectId ?? ''),
            )
          : undefined
      const segment = path.slice(path.lastIndexOf('/') + 1)
      const node: WikiTreeNode = {
        key,
        path,
        title: space?.title || segment,
        description: space?.description ?? '',
        source: page.source,
        depth,
        children: [],
        pageCount: 0,
        ...(page.projectId ? { projectId: page.projectId } : {}),
      }
      byKey.set(key, node)
      if (depth === 0) roots.push(node)
      else {
        const parentPath = path.slice(0, path.lastIndexOf('/'))
        ensure(page, parentPath, depth - 1).children.push(node)
      }
      return node
    }

    for (const page of store.pages) {
      const segments = page.path.split('/')
      const node = ensure(page, page.path, segments.length - 1)
      node.page = page
      // A real page overrides the placeholder title derived from its segment.
      node.title = page.title || node.title
      node.description = page.description || node.description
      // Count this page against itself and every ancestor.
      for (let i = segments.length; i > 0; i--) {
        const ancestor = byKey.get(nodeKey(page, segments.slice(0, i).join('/')))
        if (ancestor) ancestor.pageCount += 1
      }
    }

    // Containers first, then pages — a folder-ish node reads as structure. Within a
    // group, by title.
    const sortRec = (nodes: WikiTreeNode[]): void => {
      nodes.sort((a, b) => {
        const ac = a.children.length > 0 ? 0 : 1
        const bc = b.children.length > 0 ? 0 : 1
        return ac - bc || a.title.localeCompare(b.title)
      })
      for (const n of nodes) sortRec(n.children)
    }
    sortRec(roots)
    return roots
  })

  // Expansion is per node and remembered across restarts — a documentation tree the
  // user re-expands every launch is a tree they stop using. Top level starts open,
  // deeper levels closed (Notion's default reading), and opening a page always
  // expands its ancestors so the selection is never hidden inside a closed branch.
  const isCollapsed = (node: WikiTreeNode): boolean => {
    const explicit = expanded.value[node.key]
    if (explicit !== undefined) return !explicit
    return node.depth > 0
  }
  const toggleSpace = (node: WikiTreeNode): void => {
    expanded.value = { ...expanded.value, [node.key]: isCollapsed(node) }
    persistExpanded()
  }
  function expandAncestors(page: Pick<WikiPage, 'path' | 'source' | 'projectId'>): void {
    const segments = page.path.split('/')
    const patch: Record<string, boolean> = {}
    for (let i = 1; i < segments.length; i++) {
      patch[`${page.source}|${page.projectId ?? ''}|${segments.slice(0, i).join('/')}`] = true
    }
    if (Object.keys(patch).length === 0) return
    expanded.value = { ...expanded.value, ...patch }
    persistExpanded()
  }

  // Space ids available as import targets, for the current scope.
  const spaceOptions = computed(() =>
    [...new Set(store.spaces.map((s) => s.id))].sort((a, b) => a.localeCompare(b)),
  )
  // Projects offered as an import tier / new-space tier.
  const projectOptions = computed(() => projects.projects.map((p) => ({ id: p.id, name: p.name })))

  async function open(page: Pick<WikiPage, 'path' | 'source' | 'projectId'>): Promise<void> {
    selectedKey.value = wikiKey(page)
    expandAncestors(page)
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
      // A derived description starts EMPTY in the editor, with the derived text shown
      // as the placeholder: otherwise any edit+save would quietly promote the body's
      // first line into real frontmatter the user never wrote.
      description: c.page.descriptionDerived === true ? '' : c.page.description,
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

  // A space is a top-level folder, so "create a space" means creating its intro page
  // at `<space>/_index.md` — that gives the space a real title/description instead of
  // one humanised from the folder name, and leaves something to open when the user
  // clicks the top node. Returns the space id.
  async function createSpace(input: {
    name: string
    source: WikiSource
    projectId?: string
  }): Promise<string | null> {
    const id = slugifySegment(input.name)
    if (!id) return null
    const title = input.name.trim()
    const page = await store.savePage({
      source: input.source,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      path: `${id}/_index`,
      title,
      description: '',
      context: true,
      body: `# ${title}\n\n`,
      mode: 'create',
    })
    if (!page) return null
    await store.loadTree()
    // Open by the slug the SCAN reports for a folder-index page (`<space>`), not the
    // `<space>/_index` path we wrote — the tree keys on the former.
    await open({
      source: input.source,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      path: id,
    })
    startEdit()
    return id
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

  // The destination is now CHOSEN (WikiImportModal), not inferred from whatever page
  // happened to be selected — inference is what silently dropped an imported file at
  // the wiki root.
  async function importFilesViaDialog(target?: {
    source: WikiSource
    projectId?: string
    space: string
  }): Promise<void> {
    if (target) importTarget.value = { ...target }
    const paths = await pickFiles({
      title: 'Import Markdown into the wiki',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdx', 'txt'] }],
    })
    await importPaths(paths)
  }

  async function importFolderViaDialog(target?: {
    source: WikiSource
    projectId?: string
    space: string
  }): Promise<void> {
    if (target) importTarget.value = { ...target }
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
    expandAncestors,
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
    derivedDescription,
    save,
    createPage,
    createSpace,
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
    projectOptions,
    importDrop,
  }
}
