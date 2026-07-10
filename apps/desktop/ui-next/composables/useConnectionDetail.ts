import { computed, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import {
  deriveStatus,
  SOURCE_STATUS_COLORS,
  sourceTransport,
  useConnectionsStore,
  type Source,
  type SourceConnectionStatus,
  type SourcePermissions,
  type SourceToolInfo,
} from '~/stores/connections'

// Detail-pane controller for ConnectionDetail.vue (ADR 0060 P5) — owns the derived
// display state (status/url/relative-time/masked config rows) plus the three
// read-only Craft-style sections that lazy-fetch on open: Tools (`source.tools`),
// Permissions (`source.permissions`), Documentation (`source.guide`). Keeps the SFC
// a thin template. All three are pure reads — no config mutation, no secret. The
// Test/OAuth/Edit/Delete flows stay in the component (they emit to the page).

// A tool row with its `mcp__<id>__` prefix stripped for display.
export type DisplayTool = SourceToolInfo & { display: string }

// One row of the Connection info table.
export type ConnectionRow = { key: string; value: string; mono?: boolean }

// Mask secret-ish values on display (placeholder refs + token-named keys).
const SECRET_KEY_RE = /(token|secret|password|passwd|pwd|api[_-]?key|access[_-]?key|pat|auth)/i
function maskSecret(key: string, raw: string): string {
  if (!raw) return ''
  if (raw.startsWith('secret:')) return `•••••• (keychain · ${raw.slice('secret:'.length)})`
  let v = raw.replace(/Bearer\s+[A-Za-z0-9_-]{8,}/g, 'Bearer ••••••')
  if (SECRET_KEY_RE.test(key)) {
    v =
      v.length <= 4
        ? '•'.repeat(v.length)
        : `${'•'.repeat(Math.min(8, v.length - 4))}${v.slice(-4)}`
  }
  return v
}

export function useConnectionDetail(getSource: () => Source) {
  const store = useConnectionsStore()
  const { t } = useI18n()

  const source = computed(() => getSource())

  // --- status / connection ---------------------------------------------------
  const status = computed<SourceConnectionStatus>(() => deriveStatus(source.value))
  const statusColor = computed(() => SOURCE_STATUS_COLORS[status.value])
  const transport = computed(() => sourceTransport(source.value))

  // The primary endpoint per kind (mcp url / api baseUrl / local path).
  const sourceUrl = computed<string>(() => {
    const s = source.value
    if (s.type === 'mcp') {
      if ((s.mcp.transport ?? 'http') === 'stdio') {
        return [s.mcp.command ?? '', (s.mcp.args ?? []).join(' ')].filter(Boolean).join(' ')
      }
      return s.mcp.url ?? ''
    }
    if (s.type === 'api') return s.api.baseUrl
    return s.local.path
  })
  const urlLabel = computed(() => {
    const s = source.value
    if (s.type === 'mcp') return (s.mcp.transport ?? 'http') === 'stdio' ? 'command' : 'url'
    if (s.type === 'api') return 'baseUrl'
    return 'path'
  })

  const lastTestedRelative = computed(() => formatRelative(source.value.lastTestedAt, t))
  const connectionError = computed(() => source.value.connectionError ?? '')

  // Extra config rows (masked secrets) shown beneath the primary endpoint.
  const configRows = computed<ConnectionRow[]>(() => {
    const s = source.value
    const rows: ConnectionRow[] = []
    if (s.type === 'mcp') {
      if ((s.mcp.transport ?? 'http') === 'stdio') {
        if (s.mcp.cwd) rows.push({ key: 'cwd', value: s.mcp.cwd, mono: true })
        for (const [k, v] of Object.entries(s.mcp.env ?? {})) {
          rows.push({ key: `env.${k}`, value: maskSecret(k, v), mono: true })
        }
      } else {
        rows.push({ key: 'authType', value: s.mcp.authType ?? 'none', mono: true })
        for (const [k, v] of Object.entries(s.mcp.headers ?? {})) {
          rows.push({ key: `header.${k}`, value: maskSecret(k, v), mono: true })
        }
      }
    } else if (s.type === 'api') {
      rows.push({ key: 'authType', value: s.api.authType, mono: true })
      if (s.api.headerName) rows.push({ key: 'headerName', value: s.api.headerName, mono: true })
      if (s.api.headerNames?.length) {
        rows.push({ key: 'headerNames', value: s.api.headerNames.join(', '), mono: true })
      }
      if (s.api.queryParam) rows.push({ key: 'queryParam', value: s.api.queryParam, mono: true })
      if (s.api.testEndpoint) {
        rows.push({
          key: 'testEndpoint',
          value: `${s.api.testEndpoint.method} ${s.api.testEndpoint.path}`,
          mono: true,
        })
      }
    } else if (s.type === 'local' && s.local.format) {
      rows.push({ key: 'format', value: s.local.format, mono: true })
    }
    rows.push({ key: 'timeoutMs', value: String(s.timeoutMs), mono: true })
    return rows
  })

  // --- Tools section (mcp + api) --------------------------------------------
  const showTools = computed(() => source.value.type !== 'local')
  const toolsLoading = ref(false)
  const toolsError = ref<string | null>(null)
  const tools = ref<DisplayTool[]>([])

  const stripPrefix = (name: string): string => {
    const prefix = `mcp__${source.value.id}__`
    return name.startsWith(prefix) ? name.slice(prefix.length) : name
  }

  async function loadTools(): Promise<void> {
    if (!showTools.value) {
      tools.value = []
      return
    }
    toolsLoading.value = true
    toolsError.value = null
    tools.value = []
    try {
      const res = await store.fetchTools(source.value.slug)
      tools.value = res.tools.map((tool) => ({ ...tool, display: stripPrefix(tool.name) }))
      toolsError.value = res.error ?? null
    } catch (err) {
      toolsError.value = err instanceof Error ? err.message : String(err)
    } finally {
      toolsLoading.value = false
    }
  }

  // --- Permissions section ---------------------------------------------------
  const permsLoading = ref(false)
  const permissions = ref<SourcePermissions | null>(null)
  const hasPermissions = computed(() => {
    const p = permissions.value
    if (!p) return false
    return !!(
      p.allowedMcpPatterns?.length ||
      p.allowedApiEndpoints?.length ||
      p.allowedBashPatterns?.length ||
      p.allowedWritePaths?.length
    )
  })
  const apiEndpointLines = computed(() =>
    (permissions.value?.allowedApiEndpoints ?? []).map((e) => `${e.method} ${e.path}`),
  )

  async function loadPermissions(): Promise<void> {
    permsLoading.value = true
    permissions.value = null
    try {
      permissions.value = await store.fetchPermissions(source.value.slug)
    } catch {
      permissions.value = null
    } finally {
      permsLoading.value = false
    }
  }

  // --- Documentation section -------------------------------------------------
  const guideLoading = ref(false)
  const guide = ref<string>('')

  async function loadGuide(): Promise<void> {
    guideLoading.value = true
    guide.value = ''
    try {
      guide.value = (await store.fetchGuide(source.value.slug)) ?? ''
    } catch {
      guide.value = ''
    } finally {
      guideLoading.value = false
    }
  }

  // Refetch every section whenever the shown source changes (the detail pane is a
  // single reused instance — LibraryView does not key the slot).
  watch(
    () => source.value.slug,
    () => {
      void loadTools()
      void loadPermissions()
      void loadGuide()
    },
    { immediate: true },
  )

  return {
    status,
    statusColor,
    transport,
    sourceUrl,
    urlLabel,
    lastTestedRelative,
    connectionError,
    configRows,
    // tools
    showTools,
    toolsLoading,
    toolsError,
    tools,
    // permissions
    permsLoading,
    permissions,
    hasPermissions,
    apiEndpointLines,
    // guide
    guideLoading,
    guide,
  }
}

// Format a timestamp as a coarse relative time using the connections namespace.
function formatRelative(
  ts: number | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!ts) return t('connections.detail.testedNever')
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 1) return t('connections.time.justNow')
  if (minutes < 60) return t('connections.time.minutesAgo', { n: minutes })
  if (hours < 24) return t('connections.time.hoursAgo', { n: hours })
  return t('connections.time.daysAgo', { n: days })
}
