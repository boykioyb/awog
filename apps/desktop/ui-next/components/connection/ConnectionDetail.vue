<template>
  <div class="cnd">
    <!-- header: name + transport tag + status pill + actions -->
    <div class="dh">
      <span class="sdot" :style="{ background: statusColor }" />
      <div class="dt">{{ source.name || source.slug }}</div>
      <span class="tag mono">{{ transport }}</span>
      <span class="chip cnd-status">
        <span class="cnd-statusdot" :style="{ background: statusColor }" />
        {{ t('connections.status.' + status) }}
      </span>
      <span style="flex: 1" />
      <button
        v-if="isOAuthSource"
        class="iconbtn cnd-act"
        :disabled="oauthPending"
        :title="oauthTitle"
        @click="onConnectOAuth"
      >
        <Icon
          :name="oauthPending ? 'refresh' : 'link'"
          :class="{ spin: oauthPending }"
          style="width: 14px; height: 14px"
        />
      </button>
      <button
        class="iconbtn cnd-act"
        :disabled="testing"
        :title="t('connections.detail.test')"
        @click="onTest"
      >
        <Icon
          :name="testing ? 'refresh' : 'check'"
          :class="{ spin: testing }"
          style="width: 14px; height: 14px"
        />
      </button>
      <button class="iconbtn cnd-act" :title="t('connections.detail.edit')" @click="emit('edit')">
        <Icon name="edit" style="width: 14px; height: 14px" />
      </button>
      <button
        class="iconbtn cnd-act cnd-danger"
        :title="t('connections.detail.delete')"
        @click="emit('delete')"
      >
        <Icon name="trash" style="width: 14px; height: 14px" />
      </button>
    </div>

    <div class="dscroll">
      <p v-if="source.description" class="cnd-desc">{{ source.description }}</p>

      <!-- OAuth in-flight: the sidecar opened the browser; wait for the callback.
           Cancel aborts the flow (source.cancelOAuth) and returns silently. -->
      <div v-if="oauthPending" class="cnd-banner cnd-oauth">
        <span class="cnd-oauth-spin" />
        <div class="cnd-banner-body">
          <div class="cnd-banner-title">{{ t('connections.detail.oauthWaitingTitle') }}</div>
          <div class="cnd-banner-sum">{{ t('connections.detail.oauthWaiting') }}</div>
        </div>
        <button
          class="iconbtn cnd-act cnd-danger"
          :title="t('connections.detail.oauthCancel')"
          @click="onCancelOAuth"
        >
          <Icon name="x" style="width: 14px; height: 14px" />
        </button>
      </div>

      <!-- test result banner -->
      <div v-if="testResult" class="cnd-banner" :class="{ ok: bannerOk, err: !bannerOk }">
        <Icon
          :name="bannerOk ? 'check' : 'alert'"
          style="width: 13px; height: 13px; flex: 0 0 auto"
        />
        <div class="cnd-banner-body">
          <div class="cnd-banner-title">{{ bannerTitle }}</div>
          <div class="mono cnd-banner-sum">{{ testSummary }}</div>
          <!-- auth probe outcome (only when a healthCheck is configured) -->
          <div v-if="testResult.probe" class="cnd-probe" :class="{ bad: !testResult.probe.ok }">
            <Icon
              :name="testResult.probe.ok ? 'check' : 'alert'"
              style="width: 12px; height: 12px; flex: 0 0 auto"
            />
            <span>{{ probeSummary }}</span>
          </div>
          <pre v-if="testResult.stderr?.length" class="cnd-pre">{{
            testResult.stderr.join('\n')
          }}</pre>
        </div>
      </div>

      <!-- persisted connection error (from the last test) -->
      <div v-if="source.connectionError" class="cnd-banner err">
        <Icon name="alert" style="width: 13px; height: 13px; flex: 0 0 auto" />
        <div class="cnd-banner-body">
          <div class="cnd-banner-title">{{ t('connections.detail.lastError') }}</div>
          <div class="mono cnd-banner-sum">{{ source.connectionError }}</div>
        </div>
      </div>

      <!-- quick controls -->
      <div class="cnd-controls">
        <div class="cnd-ctl">
          <span class="cnd-ctl-label">{{ t('connections.detail.enabled') }}</span>
          <span
            class="tog2 sm"
            :class="{ off: !source.enabled }"
            :title="t('connections.enableToggle')"
            @click="emit('toggle')"
          />
        </div>
        <div class="cnd-ctl">
          <span class="cnd-ctl-label">{{ t('connections.detail.trust') }}</span>
          <span class="chip">{{ source.trust }}</span>
        </div>
        <div class="cnd-ctl">
          <span class="cnd-ctl-label">{{ t('connections.detail.lastTested') }}</span>
          <span class="chip">{{ lastTestedLabel }}</span>
        </div>
      </div>

      <!-- configuration -->
      <div class="sech">{{ t('connections.sech.command') }}</div>
      <div class="codeblk">{{ configSummary }}</div>
      <div v-if="configRows.length" class="cnd-kv">
        <div v-for="row in configRows" :key="row.key" class="cnd-kv-row">
          <span class="cnd-kv-key mono">{{ row.key }}</span>
          <span class="cnd-kv-val mono">{{ row.value }}</span>
        </div>
      </div>

      <!-- tools (per-tool deny) — mcp only; an api source has no tool list -->
      <template v-if="source.type === 'mcp'">
        <div class="sech">{{ toolsTitle }}</div>
        <div v-if="toolRows.length === 0" class="fd">{{ t('connections.detail.noTools') }}</div>
        <template v-else>
          <div class="cnd-toolsearch">
            <Icon name="search" style="width: 13px; height: 13px; color: var(--textDim)" />
            <input
              v-model="toolFilter"
              :placeholder="t('connections.detail.filterTools')"
              spellcheck="false"
            />
            <button v-if="toolFilter" class="cnd-clear" @click="toolFilter = ''">
              <Icon name="x" style="width: 12px; height: 12px" />
            </button>
          </div>
          <div v-if="filteredTools.length === 0" class="fd">
            {{ t('connections.detail.noMatch') }}
          </div>
          <div v-else class="cnd-tools">
            <div
              v-for="tool in filteredTools"
              :key="tool.name"
              class="cnd-tool"
              :class="{ denied: isDenied(tool.name) }"
            >
              <Icon name="zap" style="width: 11px; height: 11px; flex: 0 0 auto; margin-top: 3px" />
              <div class="cnd-tool-body">
                <div class="cnd-tool-head">
                  <span class="mono cnd-tool-name">{{ tool.name }}</span>
                  <span v-if="isDenied(tool.name)" class="tag cnd-denied">
                    {{ t('connections.detail.denied') }}
                  </span>
                </div>
                <div v-if="tool.description" class="cnd-tool-desc">{{ tool.description }}</div>
              </div>
              <button
                class="iconbtn cnd-tool-btn"
                :class="{ denied: isDenied(tool.name) }"
                :title="
                  isDenied(tool.name)
                    ? t('connections.detail.allowTool')
                    : t('connections.detail.denyTool')
                "
                @click="emit('toggle-tool', tool.name)"
              >
                <Icon name="shield" style="width: 12px; height: 12px" />
              </button>
            </div>
          </div>
        </template>
      </template>

      <!-- credential (api) — the credential is write-only; edit to (re)set it -->
      <template v-if="source.type === 'api'">
        <div class="sech">{{ t('connections.sech.credential') }}</div>
        <div class="fd">{{ t('connections.detail.credentialNote') }}</div>
        <button class="btn sm cnd-cred-btn" @click="emit('edit')">
          <Icon name="shield" style="width: 12px; height: 12px" />
          {{ t('connections.detail.setCredential') }}
        </button>
      </template>

      <!-- secret note (mcp) -->
      <template v-else>
        <div class="sech">{{ t('connections.sech.secret') }}</div>
        <div class="fd">
          {{ t('connections.secretNoteBefore') }}
          <span class="mono">secret:KEY</span>
          {{ t('connections.secretNoteAfter') }}
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
// Source detail pane (ADR 0060 P1) — rewired from the old McpDetail. There is no
// live process: the status pill reflects the PERSISTED `connectionStatus` (last
// `source.test`/auth result), and there is no restart / stderr-logs section. The
// Test button runs `source.test` against the already-persisted source and, on a
// clean run, surfaces the detected tools so they can be denied per-tool.
import { computed, ref, watch } from 'vue'
import type {
  Source,
  SourceConnectionStatus,
  SourceOAuthResult,
  SourceTestOutcome,
} from '~/stores/connections'
import { sourceTransport } from '~/stores/connections'

const props = defineProps<{
  source: Source
}>()

const emit = defineEmits<{
  edit: []
  delete: []
  toggle: []
  'toggle-tool': [toolName: string]
  test: [done: (outcome: SourceTestOutcome) => void]
  oauth: [done: (result: SourceOAuthResult) => void]
  'cancel-oauth': []
}>()

const { t } = useI18n()

const STATUS_COLORS: Record<SourceConnectionStatus, string> = {
  connected: 'var(--green)',
  needs_auth: 'var(--amber)',
  failed: 'var(--danger)',
  untested: 'var(--textDim)',
  local_disabled: 'var(--textFaint)',
}
const status = computed<SourceConnectionStatus>(() => props.source.connectionStatus ?? 'untested')
const statusColor = computed(() => STATUS_COLORS[status.value])
const transport = computed(() => sourceTransport(props.source))

const lastTestedLabel = computed(() => {
  const at = props.source.lastTestedAt
  if (!at) return t('connections.detail.testedNever')
  return new Date(at).toLocaleString()
})

// --- configuration summary ------------------------------------------------
const configSummary = computed(() => {
  const s = props.source
  if (s.type === 'mcp') {
    if ((s.mcp.transport ?? 'http') === 'stdio') {
      const cmd = s.mcp.command ?? ''
      const args = (s.mcp.args ?? []).join(' ')
      return [cmd, args].filter(Boolean).join(' ') || '—'
    }
    return s.mcp.url ?? '—'
  }
  if (s.type === 'api') return s.api.baseUrl || '—'
  return s.local.path || '—'
})

// Mask secret-ish values on display (placeholder refs + token-named keys).
const SECRET_KEY_RE = /(token|secret|password|passwd|pwd|api[_-]?key|access[_-]?key|pat|auth)/i
const maskSecret = (key: string, raw: string): string => {
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

const configRows = computed<{ key: string; value: string }[]>(() => {
  const s = props.source
  const rows: { key: string; value: string }[] = []
  if (s.type === 'mcp') {
    if ((s.mcp.transport ?? 'http') === 'stdio') {
      if (s.mcp.cwd) rows.push({ key: 'cwd', value: s.mcp.cwd })
      for (const [k, v] of Object.entries(s.mcp.env ?? {})) {
        rows.push({ key: `env.${k}`, value: maskSecret(k, v) })
      }
    } else {
      for (const [k, v] of Object.entries(s.mcp.headers ?? {})) {
        rows.push({ key: `header.${k}`, value: maskSecret(k, v) })
      }
    }
  } else if (s.type === 'api') {
    rows.push({ key: 'authType', value: s.api.authType })
    if (s.api.headerName) rows.push({ key: 'headerName', value: s.api.headerName })
    if (s.api.headerNames?.length) {
      rows.push({ key: 'headerNames', value: s.api.headerNames.join(', ') })
    }
    if (s.api.queryParam) rows.push({ key: 'queryParam', value: s.api.queryParam })
    if (s.api.testEndpoint) {
      rows.push({
        key: 'testEndpoint',
        value: `${s.api.testEndpoint.method} ${s.api.testEndpoint.path}`,
      })
    }
  }
  rows.push({ key: 'timeoutMs', value: String(s.timeoutMs) })
  return rows
})

// --- tools ----------------------------------------------------------------
// A source has no persisted tools list — the deny-list shows tools detected by
// the most recent Test in this session, unioned with any already-denied names so
// an existing deny is always visible/reversible even before a fresh test.
const detectedTools = ref<{ name: string; description: string }[]>([])
const toolRows = computed<{ name: string; description: string }[]>(() => {
  const byName = new Map<string, { name: string; description: string }>()
  for (const tool of detectedTools.value) byName.set(tool.name, tool)
  for (const name of props.source.deniedTools ?? []) {
    if (!byName.has(name)) byName.set(name, { name, description: '' })
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
})

const toolFilter = ref('')
const filteredTools = computed(() => {
  const q = toolFilter.value.trim().toLowerCase()
  if (!q) return toolRows.value
  return toolRows.value.filter(
    (tool) => tool.name.toLowerCase().includes(q) || tool.description.toLowerCase().includes(q),
  )
})
const deniedCount = computed(() => props.source.deniedTools?.length ?? 0)
const toolsTitle = computed(() => {
  const total = toolRows.value.length
  if (deniedCount.value === 0) return t('connections.detail.toolsCount', { n: total })
  return t('connections.detail.toolsDenied', { n: total, d: deniedCount.value })
})
const isDenied = (name: string): boolean => props.source.deniedTools?.includes(name) ?? false

// --- test -----------------------------------------------------------------
const testing = ref(false)
const testResult = ref<SourceTestOutcome | null>(null)
const testSummary = computed(() => {
  const r = testResult.value
  if (!r) return ''
  if (r.ok) {
    const tc = r.tools?.length ?? 0
    const rc = r.resources?.length ?? 0
    return t('connections.detail.testSummary', { tools: tc, resources: rc })
  }
  return r.error ?? t('connections.detail.testUnknown')
})

// Banner is "good" only when the handshake succeeded AND (no auth probe was run
// OR it authenticated). A connected-but-token-rejected result reads as an error.
const bannerOk = computed(() => {
  const r = testResult.value
  if (!r) return false
  return r.ok && (!r.probe || r.probe.ok)
})
const bannerTitle = computed(() => {
  const r = testResult.value
  if (!r) return ''
  if (!r.ok) return t('connections.detail.testFail')
  if (r.probe && !r.probe.ok) return t('connections.detail.authFail')
  return t('connections.detail.testOk')
})
const probeSummary = computed(() => {
  const p = testResult.value?.probe
  if (!p) return ''
  return p.ok
    ? t('connections.detail.authOk', { tool: p.tool })
    : t('connections.detail.authFailSum', { tool: p.tool, error: p.error ?? '' })
})
const onTest = () => {
  if (testing.value) return
  testing.value = true
  testResult.value = null
  emit('test', (outcome: SourceTestOutcome) => {
    testResult.value = outcome
    if (outcome.tools) detectedTools.value = outcome.tools
    testing.value = false
  })
}

// --- OAuth (ADR 0060 P2) --------------------------------------------------
// Only http/sse MCP sources configured for OAuth show the Connect button; the
// long-lived flow keeps `oauthPending` true (spinner + Cancel) until it resolves.
// Success/failure surface via the PERSISTED connectionStatus/connectionError
// (the store refreshes the source), so this component only tracks pending.
const isOAuthSource = computed(
  () => props.source.type === 'mcp' && props.source.mcp.authType === 'oauth',
)
const oauthPending = ref(false)
const oauthTitle = computed(() =>
  status.value === 'connected'
    ? t('connections.detail.oauthReconnect')
    : t('connections.detail.oauthConnect'),
)
const onConnectOAuth = () => {
  if (oauthPending.value) return
  oauthPending.value = true
  emit('oauth', () => {
    oauthPending.value = false
  })
}
const onCancelOAuth = () => {
  // Keep pending until the start flow resolves as CANCELED (done clears it).
  emit('cancel-oauth')
}

// The detail pane is a single reused instance (LibraryView slot is not keyed),
// so transient per-source state must reset when the shown source changes —
// otherwise one source's banner / detected tools leak onto the next.
watch(
  () => props.source.slug,
  () => {
    testResult.value = null
    testing.value = false
    toolFilter.value = ''
    detectedTools.value = []
    oauthPending.value = false
  },
)
</script>

<style scoped>
.cnd {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.cnd-act {
  width: 28px;
  height: 28px;
}
.cnd-act:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.cnd-danger:hover {
  color: var(--danger);
  border-color: var(--danger);
}
.cnd-status {
  text-transform: capitalize;
}
.cnd-statusdot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
  flex: 0 0 auto;
}
.cnd-desc {
  font-size: 1rem;
  color: var(--textMuted);
  line-height: 1.6;
  margin: 0 0 4px;
}
.cnd-cred-btn {
  margin-top: 10px;
  align-self: flex-start;
}
.cnd-banner {
  display: flex;
  gap: 9px;
  margin-top: 14px;
  padding: 11px 13px;
  border-radius: 10px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--textMuted);
  font-size: 0.9231rem;
}
.cnd-banner.ok {
  border-color: var(--accentBorder);
  color: var(--accent);
}
.cnd-oauth {
  align-items: center;
  color: var(--textMuted);
}
.cnd-oauth-spin {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  animation: cnd-spin 0.7s linear infinite;
}
.cnd-banner.err {
  border-color: var(--dangerBorder);
  color: var(--danger);
}
.cnd-banner-body {
  flex: 1;
  min-width: 0;
}
.cnd-banner-title {
  font-weight: 600;
  margin-bottom: 2px;
}
.cnd-banner-sum {
  word-break: break-word;
}
.cnd-probe {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  color: var(--green);
  word-break: break-word;
}
.cnd-probe.bad {
  color: var(--danger);
}
.cnd-pre {
  font-family: var(--code);
  font-size: 0.8462rem;
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--bgPanel);
  color: var(--textDim);
  max-height: 8rem;
  overflow-y: auto;
  white-space: pre-wrap;
}
.cnd-controls {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 16px;
}
.cnd-ctl {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 11px 13px;
  border-radius: 10px;
  background: var(--bgInput);
  border: 1px solid var(--border);
}
.cnd-ctl-label {
  font-size: 0.8462rem;
  color: var(--textDim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-family: var(--code);
}
.cnd-kv {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 9px;
}
.cnd-kv-row {
  display: flex;
  gap: 10px;
  font-size: 0.8846rem;
}
.cnd-kv-key {
  color: var(--textDim);
  flex: 0 0 auto;
  min-width: 120px;
}
.cnd-kv-val {
  color: var(--textMuted);
  word-break: break-all;
}
.cnd-toolsearch {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--bgInput);
  border: 1px solid var(--border);
}
.cnd-toolsearch input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: none;
  color: var(--text);
  font-size: 0.9231rem;
}
.cnd-clear {
  display: inline-flex;
  border: 0;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  padding: 0;
}
.cnd-clear:hover {
  color: var(--text);
}
.cnd-tools {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 9px;
}
.cnd-tool {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 9px 11px;
  border-radius: 9px;
  background: var(--bgEl);
  border: 1px solid var(--border);
  color: var(--textDim);
}
.cnd-tool.denied {
  border-color: var(--dangerBorder);
  opacity: 0.65;
}
.cnd-tool-body {
  flex: 1;
  min-width: 0;
}
.cnd-tool-head {
  display: flex;
  align-items: center;
  gap: 7px;
}
.cnd-tool-name {
  font-size: 0.9231rem;
  color: var(--text);
}
.cnd-tool-desc {
  font-size: 0.8846rem;
  color: var(--textMuted);
  margin-top: 2px;
}
.cnd-denied {
  color: var(--danger);
  border-color: var(--dangerBorder);
  text-transform: uppercase;
}
.cnd-tool-btn {
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
}
.cnd-tool-btn.denied {
  color: var(--danger);
  border-color: var(--dangerBorder);
}
.spin {
  animation: cnd-spin 0.9s linear infinite;
}
@keyframes cnd-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
