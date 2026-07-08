<template>
  <div class="cnd">
    <!-- header: name + transport tag + status pill + actions -->
    <div class="dh">
      <span class="sdot" :style="{ background: statusColor }" />
      <div class="dt">{{ server.name || server.id }}</div>
      <span class="tag mono">{{ server.transport }}</span>
      <span class="chip cnd-status">
        <span class="cnd-statusdot" :style="{ background: statusColor }" />
        {{ t('connections.status.' + server.status) }}
      </span>
      <span style="flex: 1" />
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
      <button
        v-if="server.enabled"
        class="iconbtn cnd-act"
        :title="t('connections.detail.restart')"
        @click="emit('restart')"
      >
        <Icon name="refresh" style="width: 14px; height: 14px" />
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
      <p v-if="server.description" class="cnd-desc">{{ server.description }}</p>

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

      <!-- last error banner -->
      <div v-if="server.lastError" class="cnd-banner err">
        <Icon name="alert" style="width: 13px; height: 13px; flex: 0 0 auto" />
        <div class="cnd-banner-body">
          <div class="cnd-banner-title">{{ t('connections.detail.lastError') }}</div>
          <div class="mono cnd-banner-sum">{{ server.lastError }}</div>
        </div>
      </div>

      <!-- quick controls -->
      <div class="cnd-controls">
        <div class="cnd-ctl">
          <span class="cnd-ctl-label">{{ t('connections.detail.enabled') }}</span>
          <span
            class="tog2 sm"
            :class="{ off: !server.enabled }"
            :title="t('connections.enableToggle')"
            @click="emit('toggle')"
          />
        </div>
        <div class="cnd-ctl">
          <span class="cnd-ctl-label">{{ t('connections.detail.autoStart') }}</span>
          <span class="chip">
            {{ server.autoStart ? t('connections.detail.on') : t('connections.detail.onDemand') }}
          </span>
        </div>
        <div class="cnd-ctl">
          <span class="cnd-ctl-label">{{ t('connections.detail.trust') }}</span>
          <span class="chip">{{ server.trust }}</span>
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

      <!-- tools (per-tool deny) -->
      <div class="sech">{{ toolsTitle }}</div>
      <div v-if="server.tools.length === 0" class="fd">{{ t('connections.detail.noTools') }}</div>
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

      <!-- resources -->
      <template v-if="server.resources.length">
        <div class="sech">
          {{ t('connections.detail.resources', { n: server.resources.length }) }}
        </div>
        <div class="cnd-tools">
          <div v-for="res in server.resources" :key="res.uri" class="cnd-res">
            <Icon name="tag" style="width: 11px; height: 11px; flex: 0 0 auto" />
            <span class="mono cnd-res-uri">{{ res.uri }}</span>
            <span class="cnd-res-mime">{{ res.mime }}</span>
          </div>
        </div>
      </template>

      <!-- logs (stderr ring buffer) -->
      <template v-if="stderr.length">
        <div class="sech">{{ t('connections.detail.logs', { n: stderr.length }) }}</div>
        <pre class="cnd-pre cnd-logs">{{ stderr.join('\n') }}</pre>
      </template>

      <!-- secret note -->
      <div class="sech">{{ t('connections.sech.secret') }}</div>
      <div class="fd">
        {{ t('connections.secretNoteBefore') }}
        <span class="mono">secret:KEY</span>
        {{ t('connections.secretNoteAfter') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Connection (MCP) detail pane — port of the old UI McpDetail logic, rendered in
// prototype CSS (.dh header + .dscroll body, matching skills/agents detail).
// Status pill + transport tag in the header; per-server enable/restart/test +
// per-tool deny actions emit to the page; secret values are masked on display.
import { computed, ref, watch } from 'vue'
import type {
  ConnectionStatus,
  ConnectionTool,
  McpServer,
  McpTestResult,
} from '~/stores/connections'

const props = defineProps<{
  server: McpServer
  stderr: string[]
}>()

const emit = defineEmits<{
  edit: []
  delete: []
  toggle: []
  restart: []
  'toggle-tool': [toolName: string]
  test: [done: (result: McpTestResult) => void]
}>()

const { t } = useI18n()

const STATUS_COLORS: Record<ConnectionStatus, string> = {
  running: 'var(--green)',
  starting: 'var(--amber)',
  idle: 'var(--textDim)',
  error: 'var(--danger)',
  disabled: 'var(--textFaint)',
}
const statusColor = computed(() => STATUS_COLORS[props.server.status])

// --- configuration summary ------------------------------------------------
const configSummary = computed(() => {
  if (props.server.transport === 'stdio') {
    const cmd = props.server.command ?? ''
    const args = (props.server.args ?? []).join(' ')
    return [cmd, args].filter(Boolean).join(' ') || '—'
  }
  return props.server.url ?? '—'
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
  const rows: { key: string; value: string }[] = []
  if (props.server.transport === 'stdio') {
    if (props.server.cwd) rows.push({ key: 'cwd', value: props.server.cwd })
    for (const [k, v] of Object.entries(props.server.env ?? {})) {
      rows.push({ key: `env.${k}`, value: maskSecret(k, v) })
    }
  } else {
    for (const [k, v] of Object.entries(props.server.headers ?? {})) {
      rows.push({ key: `header.${k}`, value: maskSecret(k, v) })
    }
  }
  rows.push({ key: 'timeoutMs', value: String(props.server.timeoutMs) })
  return rows
})

// --- tools ----------------------------------------------------------------
const toolFilter = ref('')
const filteredTools = computed<ConnectionTool[]>(() => {
  const q = toolFilter.value.trim().toLowerCase()
  if (!q) return props.server.tools
  return props.server.tools.filter(
    (tool) => tool.name.toLowerCase().includes(q) || tool.description.toLowerCase().includes(q),
  )
})
const deniedCount = computed(() => props.server.deniedTools?.length ?? 0)
const toolsTitle = computed(() => {
  const total = props.server.tools.length
  if (deniedCount.value === 0) return t('connections.detail.toolsCount', { n: total })
  return t('connections.detail.toolsDenied', { n: total, d: deniedCount.value })
})
const isDenied = (name: string): boolean => props.server.deniedTools?.includes(name) ?? false

// --- test -----------------------------------------------------------------
const testing = ref(false)
const testResult = ref<McpTestResult | null>(null)
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
  emit('test', (result: McpTestResult) => {
    testResult.value = result
    testing.value = false
  })
}

// The detail pane is a single reused instance (LibraryView slot is not keyed),
// so transient per-connection state must reset when the shown server changes —
// otherwise one connection's "Connection OK" banner / tool filter leaks onto the next.
watch(
  () => props.server.id,
  () => {
    testResult.value = null
    testing.value = false
    toolFilter.value = ''
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
.cnd-logs {
  max-height: 12rem;
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
.cnd-res {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 11px;
  border-radius: 9px;
  background: var(--bgEl);
  border: 1px solid var(--border);
  color: var(--textDim);
}
.cnd-res-uri {
  flex: 1;
  min-width: 0;
  color: var(--text);
  font-size: 0.8846rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cnd-res-mime {
  font-size: 0.8462rem;
  color: var(--textDim);
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
