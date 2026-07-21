import { computed, nextTick, ref, useTemplateRef, watch, type Ref } from 'vue'
import {
  useSshApi,
  type SftpEntry,
  type SftpMeta,
  type CompressFormat,
} from '~/composables/useSshApi'
import { useSidecar } from '~/composables/useSidecar'
import { useTextPrompt } from '~/composables/useTextPrompt'
import { useConfirm } from '~/composables/useConfirm'
import { useToasts } from '~/composables/useToasts'
import { usePreview, previewKindFromPath } from '~/composables/usePreview'
import { hasBridge, saveFilePath } from '~/composables/useFolderPicker'

// SFTP browser controller (page-controller pattern). Owns cwd / listing / multi-
// select / column state and every remote op, orchestrating the sidecar ssh.sftp.*
// RPCs. The component stays a thin template; the right-click menu is built by
// useSftpContextMenu(browser) on top of this. SoC: this only talks IPC — never fs.

export const ALL_SFTP_COLUMNS = [
  'size',
  'perms',
  'owner',
  'group',
  'modified',
  'accessed',
  'changed',
] as const
export type SftpColumn = (typeof ALL_SFTP_COLUMNS)[number]
const DEFAULT_COLUMNS: SftpColumn[] = ['size', 'perms', 'modified']
const COLS_KEY = 'awog-sftp-columns'

export type SortKey = 'name' | 'size' | 'modified'

// Enrichment columns (owner/group names + ctime) are only worth fetching when a
// column that needs them is visible.
const ENRICH_COLS: SftpColumn[] = ['owner', 'group', 'changed']

const ARCHIVE_RE = /\.(zip|tar|tgz|tbz2?|txz|tar\.gz|tar\.bz2|tar\.xz|rar|7z|gz|bz2|xz)$/i
export function isArchive(name: string): boolean {
  return ARCHIVE_RE.test(name)
}

// Permission bits → `drwxr-xr-x` string (fully client-side from the SFTP mode).
export function permString(mode: number, type: SftpEntry['type']): string {
  const t = type === 'dir' ? 'd' : type === 'symlink' ? 'l' : '-'
  const rwx = (m: number): string => `${m & 4 ? 'r' : '-'}${m & 2 ? 'w' : '-'}${m & 1 ? 'x' : '-'}`
  return t + rwx((mode >> 6) & 7) + rwx((mode >> 3) & 7) + rwx(mode & 7)
}
export function permOctal(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(3, '0')
}

function readColumns(): SftpColumn[] {
  if (typeof localStorage === 'undefined') return [...DEFAULT_COLUMNS]
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(COLS_KEY) ?? 'null')
    if (!Array.isArray(raw)) return [...DEFAULT_COLUMNS]
    return raw.filter((c): c is SftpColumn =>
      (ALL_SFTP_COLUMNS as readonly string[]).includes(c as string),
    )
  } catch {
    return [...DEFAULT_COLUMNS]
  }
}

function decodeUtf8(b64: string): string {
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

const IMG_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  ico: 'image/x-icon',
}

export function useSftpBrowser(connId: Ref<string>) {
  const { t } = useI18n()
  const api = useSshApi()
  const sc = useSidecar()
  const { prompt } = useTextPrompt()
  const { confirm } = useConfirm()
  const { pushToast } = useToasts()
  const preview = usePreview()

  const cwd = ref('.')
  const entries = ref<SftpEntry[]>([])
  const meta = ref<Record<string, SftpMeta>>({})
  const loading = ref(false)
  const error = ref<string | null>(null)
  const tools = ref<string[]>([])

  const selected = ref<Set<string>>(new Set())
  const anchorIndex = ref(-1)

  const columns = ref<SftpColumn[]>(readColumns())
  watch(
    columns,
    (c) => {
      if (typeof localStorage !== 'undefined') localStorage.setItem(COLS_KEY, JSON.stringify(c))
    },
    { deep: true },
  )
  const hasCol = (c: SftpColumn): boolean => columns.value.includes(c)
  function toggleColumn(c: SftpColumn): void {
    columns.value = hasCol(c) ? columns.value.filter((x) => x !== c) : [...columns.value, c]
    if (ENRICH_COLS.includes(c) && hasCol(c)) void loadMeta()
  }

  const sortKey = ref<SortKey>('name')
  const sortAsc = ref(true)
  function setSort(key: SortKey): void {
    if (sortKey.value === key) sortAsc.value = !sortAsc.value
    else {
      sortKey.value = key
      sortAsc.value = true
    }
  }

  // ── path bar ──
  const editingPath = ref(false)
  const pathDraft = ref('')
  const pathInput = useTemplateRef<HTMLInputElement>('pathInput')
  const displayPath = computed(() => {
    if (cwd.value === '.') return '~'
    if (cwd.value.startsWith('/')) return cwd.value
    return `~/${cwd.value}`
  })
  function startEditPath(): void {
    pathDraft.value = displayPath.value
    editingPath.value = true
    void nextTick(() => {
      pathInput.value?.focus()
      pathInput.value?.select()
    })
  }
  function commitPath(): void {
    const s = pathDraft.value.trim()
    editingPath.value = false
    let next = '.'
    if (s && s !== '~') next = s.startsWith('~/') ? s.slice(2) || '.' : s
    navigate(next)
  }

  const filtered = computed(() => entries.value.filter((e) => e.name !== '.' && e.name !== '..'))
  const sorted = computed(() => {
    const dir = sortAsc.value ? 1 : -1
    return [...filtered.value].sort((a, b) => {
      const ad = a.type === 'dir' ? 0 : 1
      const bd = b.type === 'dir' ? 0 : 1
      if (ad !== bd) return ad - bd // dirs always first, regardless of sort dir
      let cmp = 0
      if (sortKey.value === 'size') cmp = a.size - b.size
      else if (sortKey.value === 'modified') cmp = a.mtime - b.mtime
      else cmp = a.name.localeCompare(b.name)
      return cmp === 0 ? a.name.localeCompare(b.name) : cmp * dir
    })
  })

  const crumbs = computed(() => {
    if (cwd.value === '.') return [] as { name: string; path: string }[]
    const abs = cwd.value.startsWith('/')
    const parts = cwd.value.split('/').filter(Boolean)
    const out: { name: string; path: string }[] = []
    let acc = ''
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : abs ? `/${p}` : p
      out.push({ name: p, path: acc })
    }
    return out
  })
  const parentPath = computed(() => {
    if (cwd.value === '.') return '.'
    const idx = cwd.value.lastIndexOf('/')
    return idx < 0 ? '.' : cwd.value.slice(0, idx)
  })

  const join = (name: string): string => (cwd.value === '.' ? name : `${cwd.value}/${name}`)
  const basename = (p: string): string => p.split('/').filter(Boolean).pop() ?? p
  const metaFor = (name: string): SftpMeta | undefined => meta.value[name]

  const selectedEntries = computed(() => filtered.value.filter((e) => selected.value.has(e.name)))
  const hasSelection = computed(() => selected.value.size > 0)
  const isSelected = (name: string): boolean => selected.value.has(name)
  function clearSelection(): void {
    selected.value = new Set()
    anchorIndex.value = -1
  }
  function selectAll(): void {
    selected.value = new Set(sorted.value.map((e) => e.name))
  }
  // Toggle one row's membership (used by the right-click "Select"/"Deselect").
  function selectToggle(name: string): void {
    const next = new Set(selected.value)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    selected.value = next
  }
  // A PLAIN click opens the row (dir → navigate, file → preview) — it does NOT
  // select, so browsing never accidentally raises the bulk bar. Building a
  // selection is an explicit gesture: Ctrl/⌘-click toggles, Shift-click ranges
  // (or via the right-click "Select"). Mirrors a native file manager.
  function onRowClick(entry: SftpEntry, index: number, ev: MouseEvent): void {
    if (ev.shiftKey && anchorIndex.value >= 0) {
      const lo = Math.min(anchorIndex.value, index)
      const hi = Math.max(anchorIndex.value, index)
      const next = new Set(selected.value)
      for (let i = lo; i <= hi; i += 1) {
        const row = sorted.value[i]
        if (row) next.add(row.name)
      }
      selected.value = next
    } else if (ev.metaKey || ev.ctrlKey) {
      selectToggle(entry.name)
      anchorIndex.value = index
    } else {
      anchorIndex.value = index
      onRowOpen(entry)
    }
  }
  function onRowOpen(entry: SftpEntry): void {
    if (entry.type === 'dir' || entry.type === 'symlink') navigate(join(entry.name))
    else void previewFile(entry)
  }

  // ── listing ──
  async function load(): Promise<void> {
    if (!connId.value) return
    if (!sc.available) {
      error.value = t('ssh.sftp.offline')
      return
    }
    loading.value = true
    error.value = null
    try {
      const res = await api.sftpList(connId.value, cwd.value)
      entries.value = res.entries
      meta.value = {}
      void loadMeta()
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      entries.value = []
    } finally {
      loading.value = false
    }
  }
  // Best-effort enrichment — only when an enrichment column is visible.
  async function loadMeta(): Promise<void> {
    if (!connId.value || !ENRICH_COLS.some(hasCol) || !filtered.value.length) return
    try {
      const res = await api.sftpStatx(
        connId.value,
        cwd.value,
        filtered.value.map((e) => e.name),
      )
      meta.value = res.meta
    } catch {
      // Enrichment is optional — keep numeric uid/gid fallback silently.
    }
  }
  function navigate(path: string): void {
    cwd.value = path || '.'
    clearSelection()
    void load()
  }
  async function loadTools(): Promise<void> {
    if (!connId.value) return
    try {
      const res = await api.sftpToolcheck(connId.value)
      tools.value = res.tools
    } catch {
      tools.value = []
    }
  }
  const toolReady = (tool: string): boolean => tools.value.includes(tool)

  // Missing-tool → install hint. The archive tools map to their common package
  // names; we copy an install command to the clipboard (installs need the user's
  // own sudo, so we don't auto-run it) and toast a nudge to paste it in the shell.
  const TOOL_PKG: Record<string, string> = {
    zip: 'zip',
    unzip: 'unzip',
    tar: 'tar',
    gzip: 'gzip',
    bzip2: 'bzip2',
    xz: 'xz-utils',
    rar: 'rar',
    unrar: 'unrar',
    '7z': 'p7zip-full',
    '7za': 'p7zip-full',
  }
  async function suggestInstall(tool: string): Promise<void> {
    const pkg = TOOL_PKG[tool] ?? tool
    const cmd = `sudo apt-get install -y ${pkg}`
    try {
      await navigator.clipboard.writeText(cmd)
    } catch {
      // clipboard blocked — the toast still tells the user what to run
    }
    pushToast(t('ssh.sftp.installCopied', { pkg }), 'info')
  }

  function fail(err: unknown): void {
    pushToast(t('ssh.sftp.opFailed', { error: err instanceof Error ? err.message : '' }), 'error')
  }

  // ── ops ──
  async function mkdir(): Promise<void> {
    const name = await prompt({ title: t('ssh.sftp.mkdirTitle'), placeholder: 'new-folder' })
    if (!name?.trim()) return
    try {
      await api.sftpMkdir(connId.value, join(name.trim()))
      await load()
    } catch (err) {
      fail(err)
    }
  }
  async function newFile(): Promise<void> {
    const name = await prompt({ title: t('ssh.sftp.newFileTitle'), placeholder: 'file.txt' })
    if (!name?.trim()) return
    try {
      await api.sftpCreateFile(connId.value, join(name.trim()))
      await load()
    } catch (err) {
      fail(err)
    }
  }
  async function rename(e: SftpEntry): Promise<void> {
    const name = await prompt({ title: t('ssh.sftp.renameTitle'), value: e.name })
    if (!name?.trim() || name.trim() === e.name) return
    try {
      await api.sftpRename(connId.value, join(e.name), join(name.trim()))
      await load()
    } catch (err) {
      fail(err)
    }
  }
  async function del(targets: SftpEntry[]): Promise<void> {
    if (!targets.length) return
    const ok = await confirm({
      title: t('ssh.sftp.deleteTitle'),
      description:
        targets.length === 1
          ? t('ssh.sftp.deleteHint', { name: targets[0]?.name ?? '' })
          : t('ssh.sftp.deleteHintMany', { count: targets.length }),
      kind: 'danger',
    })
    if (!ok) return
    try {
      for (const e of targets) {
        await api.sftpDelete(connId.value, join(e.name), e.type === 'dir')
      }
      clearSelection()
      await load()
    } catch (err) {
      fail(err)
    }
  }
  async function download(e: SftpEntry): Promise<void> {
    // Native save dialog when the desktop bridge is present; text-prompt fallback
    // in browser dev. Destination must resolve inside the home dir (sidecar guard).
    let local: string | null
    if (hasBridge()) {
      local = await saveFilePath({
        title: t('ssh.sftp.downloadTitle', { name: e.name }),
        defaultPath: e.name,
      })
      if (local === null) return // cancelled
    } else {
      local = await prompt({
        title: t('ssh.sftp.downloadTitle', { name: e.name }),
        value: `~/${e.name}`,
        placeholder: '~/Downloads/file',
      })
    }
    if (!local?.trim()) return
    pushToast(t('ssh.sftp.transferring', { name: e.name }), 'info')
    try {
      const res = await api.sftpDownload(connId.value, join(e.name), local.trim())
      pushToast(t('ssh.sftp.downloaded', { name: e.name, bytes: res.bytes }), 'success')
    } catch (err) {
      fail(err)
    }
  }
  // Upload one or more LOCAL files (absolute paths — e.g. resolved from an OS
  // drag-drop via webUtils) into the current directory. Streams via fastPut; the
  // source path must be inside the home dir (sidecar guard) — a drop from outside
  // home surfaces a clear error per file, the rest continue.
  async function uploadPaths(localPaths: string[]): Promise<void> {
    if (!connId.value || !localPaths.length) return
    let ok = 0
    for (const lp of localPaths) {
      const name = basename(lp)
      pushToast(t('ssh.sftp.transferring', { name }), 'info')
      try {
        const res = await api.sftpUpload(connId.value, lp, join(name))
        pushToast(t('ssh.sftp.uploaded', { name, bytes: res.bytes }), 'success')
        ok += 1
      } catch (err) {
        fail(err)
      }
    }
    if (ok) await load()
  }
  async function upload(): Promise<void> {
    const local = await prompt({ title: t('ssh.sftp.uploadTitle'), placeholder: '~/path/to/file' })
    if (!local?.trim()) return
    const remote = join(basename(local.trim()))
    pushToast(t('ssh.sftp.transferring', { name: basename(local.trim()) }), 'info')
    try {
      const res = await api.sftpUpload(connId.value, local.trim(), remote)
      pushToast(t('ssh.sftp.uploaded', { name: basename(remote), bytes: res.bytes }), 'success')
      await load()
    } catch (err) {
      fail(err)
    }
  }
  async function duplicate(e: SftpEntry): Promise<void> {
    // Copy alongside with a " copy" suffix (before the extension for files).
    const dot = e.type === 'file' ? e.name.lastIndexOf('.') : -1
    const dup = dot > 0 ? `${e.name.slice(0, dot)} copy${e.name.slice(dot)}` : `${e.name} copy`
    try {
      await api.sftpCopy(connId.value, [join(e.name)], join(dup))
      await load()
    } catch (err) {
      fail(err)
    }
  }
  // destDir is a full remote path chosen via the path picker.
  async function copyTo(targets: SftpEntry[], destDir: string): Promise<void> {
    if (!targets.length) return
    try {
      await api.sftpCopy(
        connId.value,
        targets.map((e) => join(e.name)),
        destDir,
      )
      pushToast(t('ssh.sftp.copied', { count: targets.length }), 'success')
      await load()
    } catch (err) {
      fail(err)
    }
  }
  async function moveTo(targets: SftpEntry[], destDir: string): Promise<void> {
    if (!targets.length) return
    try {
      for (const e of targets) {
        const to = destDir === '.' ? e.name : `${destDir}/${e.name}`
        await api.sftpRename(connId.value, join(e.name), to)
      }
      pushToast(t('ssh.sftp.moved', { count: targets.length }), 'success')
      clearSelection()
      await load()
    } catch (err) {
      fail(err)
    }
  }
  async function compress(targets: SftpEntry[], format: CompressFormat): Promise<void> {
    if (!targets.length) return
    const ext =
      format === 'zip' ? 'zip' : format === 'rar' ? 'rar' : format === '7z' ? '7z' : format
    const base = targets.length === 1 ? (targets[0]?.name ?? 'archive') : 'archive'
    const name = await prompt({
      title: t('ssh.sftp.compressTitle'),
      value: `${base}.${ext}`,
      submitLabel: t('ssh.sftp.compress'),
    })
    if (!name?.trim()) return
    pushToast(t('ssh.sftp.compressing'), 'info')
    try {
      await api.sftpCompress(
        connId.value,
        cwd.value,
        format,
        targets.map((e) => e.name),
        name.trim(),
      )
      pushToast(t('ssh.sftp.compressed', { name: name.trim() }), 'success')
      await load()
    } catch (err) {
      fail(err)
    }
  }
  async function extract(e: SftpEntry): Promise<void> {
    pushToast(t('ssh.sftp.extracting', { name: e.name }), 'info')
    try {
      await api.sftpExtract(connId.value, cwd.value, e.name)
      pushToast(t('ssh.sftp.extracted', { name: e.name }), 'success')
      await load()
    } catch (err) {
      fail(err)
    }
  }
  async function applyChmod(targets: SftpEntry[], mode: number): Promise<void> {
    try {
      for (const e of targets) await api.sftpChmod(connId.value, join(e.name), mode)
      pushToast(t('ssh.sftp.chmodDone'), 'success')
      await load()
    } catch (err) {
      fail(err)
    }
  }
  async function applyChown(
    targets: SftpEntry[],
    owner: string,
    group: string,
    recursive: boolean,
  ): Promise<void> {
    try {
      await api.sftpChown(
        connId.value,
        targets.map((e) => join(e.name)),
        owner,
        group || undefined,
        recursive,
      )
      pushToast(t('ssh.sftp.chownDone'), 'success')
      await load()
    } catch (err) {
      fail(err)
    }
  }
  // "Open terminal here" — types a cd into the shell on this connection (the same
  // one the terminal drives). Path is single-quoted so a spaced name can't break.
  async function openTerminalHere(e: SftpEntry): Promise<void> {
    const dir = e.type === 'dir' ? join(e.name) : cwd.value
    const q = `'${dir.replace(/'/g, `'\\''`)}'`
    try {
      await api.write(connId.value, `cd ${q}\n`)
      pushToast(t('ssh.sftp.cdSent'), 'success')
    } catch (err) {
      fail(err)
    }
  }
  async function previewFile(e: SftpEntry): Promise<void> {
    const kind = previewKindFromPath(e.name)
    try {
      const res = await api.sftpRead(connId.value, join(e.name))
      if (kind === 'image' || kind === 'pdf') {
        const extn = e.name.split('.').pop()?.toLowerCase() ?? ''
        const mime =
          kind === 'pdf' ? 'application/pdf' : (IMG_MIME[extn] ?? 'application/octet-stream')
        preview.open({
          name: e.name,
          kind,
          src: `data:${mime};base64,${res.contentBase64}`,
          size: e.size,
        })
      } else {
        preview.open({ name: e.name, kind, text: decodeUtf8(res.contentBase64), size: e.size })
      }
    } catch (err) {
      fail(err)
    }
  }

  // ── modals (open-state; component renders + calls the op on confirm) ──
  const chmodTargets = ref<SftpEntry[] | null>(null)
  const chownTargets = ref<SftpEntry[] | null>(null)
  const pathPicker = ref<{ mode: 'move' | 'copy'; targets: SftpEntry[] } | null>(null)

  function openChmod(targets: SftpEntry[]): void {
    if (targets.length) chmodTargets.value = targets
  }
  function openChown(targets: SftpEntry[]): void {
    if (targets.length) chownTargets.value = targets
  }
  function openPathPicker(mode: 'move' | 'copy', targets: SftpEntry[]): void {
    if (targets.length) pathPicker.value = { mode, targets }
  }
  function onPathPicked(dest: string): void {
    const p = pathPicker.value
    pathPicker.value = null
    if (!p) return
    if (p.mode === 'move') void moveTo(p.targets, dest)
    else void copyTo(p.targets, dest)
  }

  // Reset to the login dir + reload when pointed at a different connection.
  watch(connId, () => {
    cwd.value = '.'
    clearSelection()
    void load()
    void loadTools()
  })

  return {
    // state
    cwd,
    loading,
    error,
    columns,
    hasCol,
    toggleColumn,
    sortKey,
    sortAsc,
    setSort,
    editingPath,
    pathDraft,
    displayPath,
    startEditPath,
    commitPath,
    // data
    sorted,
    crumbs,
    parentPath,
    metaFor,
    // selection
    selected,
    selectedEntries,
    hasSelection,
    isSelected,
    onRowClick,
    onRowOpen,
    clearSelection,
    selectAll,
    selectToggle,
    // ops
    load,
    navigate,
    loadTools,
    toolReady,
    suggestInstall,
    mkdir,
    newFile,
    rename,
    del,
    download,
    upload,
    uploadPaths,
    duplicate,
    copyTo,
    moveTo,
    compress,
    extract,
    applyChmod,
    applyChown,
    openTerminalHere,
    previewFile,
    // modals
    chmodTargets,
    chownTargets,
    pathPicker,
    openChmod,
    openChown,
    openPathPicker,
    onPathPicked,
  }
}

export type SftpBrowser = ReturnType<typeof useSftpBrowser>
