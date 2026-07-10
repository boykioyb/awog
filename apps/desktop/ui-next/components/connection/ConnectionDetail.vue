<template>
  <div class="cnd">
    <!-- hero: large avatar + name + tagline + transport tag + status pill + actions -->
    <div class="dh cnd-hero">
      <SourceAvatar :source="source" size="lg" />
      <div class="cnd-hero-main">
        <div class="dt cnd-hero-name">{{ source.name || source.slug }}</div>
        <div v-if="source.tagline" class="cnd-hero-tagline">{{ source.tagline }}</div>
        <div class="cnd-hero-meta">
          <span class="tag mono">{{ transport }}</span>
          <span class="chip cnd-status">
            <SourceStatusDot :status="status" :error-message="source.connectionError" />
            {{ t('connections.status.' + status) }}
          </span>
        </div>
      </div>
      <div class="cnd-actions">
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
            style="width: 13px; height: 13px"
          />
        </button>
        <button
          v-if="source.type === 'api'"
          class="iconbtn cnd-act"
          :title="t('connections.detail.setCredential')"
          @click="emit('edit')"
        >
          <Icon name="shield" style="width: 13px; height: 13px" />
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
            style="width: 13px; height: 13px"
          />
        </button>
        <button class="iconbtn cnd-act" :title="t('connections.detail.edit')" @click="emit('edit')">
          <Icon name="edit" style="width: 13px; height: 13px" />
        </button>
        <button
          class="iconbtn cnd-act cnd-danger"
          :title="t('connections.detail.delete')"
          @click="emit('delete')"
        >
          <Icon name="trash" style="width: 13px; height: 13px" />
        </button>
      </div>
    </div>

    <div class="dscroll">
      <p v-if="source.description" class="cnd-desc">{{ source.description }}</p>

      <!-- quick controls: enabled toggle + trust -->
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
      </div>

      <!-- OAuth in-flight: the sidecar opened the browser; wait for the callback. -->
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
          <Icon name="x" style="width: 13px; height: 13px" />
        </button>
      </div>

      <!-- transient test-result banner -->
      <div v-if="testResult" class="cnd-banner" :class="{ ok: bannerOk, err: !bannerOk }">
        <Icon
          :name="bannerOk ? 'check' : 'alert'"
          style="width: 13px; height: 13px; flex: 0 0 auto"
        />
        <div class="cnd-banner-body">
          <div class="cnd-banner-title">{{ bannerTitle }}</div>
          <div class="mono cnd-banner-sum">{{ testSummary }}</div>
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

      <!-- ── Connection ─────────────────────────────────────────────────── -->
      <div class="sech">{{ t('connections.section.connection') }}</div>
      <div class="cnd-info">
        <div class="cnd-info-row">
          <span class="cnd-info-key">{{ t('connections.info.type') }}</span>
          <span class="cnd-info-val">{{ source.type.toUpperCase() }}</span>
        </div>
        <div v-if="sourceUrl" class="cnd-info-row">
          <span class="cnd-info-key">{{ t('connections.info.' + urlLabel) }}</span>
          <span class="cnd-info-val mono">{{ sourceUrl }}</span>
        </div>
        <div v-for="row in configRows" :key="row.key" class="cnd-info-row">
          <span class="cnd-info-key mono">{{ row.key }}</span>
          <span class="cnd-info-val" :class="{ mono: row.mono }">{{ row.value }}</span>
        </div>
        <div class="cnd-info-row">
          <span class="cnd-info-key">{{ t('connections.info.lastTested') }}</span>
          <span class="cnd-info-val">{{ lastTestedRelative }}</span>
        </div>
        <div v-if="connectionError" class="cnd-info-err">
          <Icon name="alert" style="width: 13px; height: 13px; flex: 0 0 auto; margin-top: 2px" />
          <span class="mono">{{ connectionError }}</span>
        </div>
      </div>

      <!-- ── Tools (mcp + api) ──────────────────────────────────────────── -->
      <template v-if="showTools">
        <div class="sech">{{ t('connections.section.tools') }}</div>
        <div v-if="toolsLoading" class="fd cnd-loading">
          <span class="cnd-oauth-spin cnd-spin-sm" />
          {{ t('connections.tools.loading') }}
        </div>
        <div v-else-if="toolsError" class="cnd-banner err">
          <Icon name="alert" style="width: 13px; height: 13px; flex: 0 0 auto" />
          <div class="cnd-banner-body">
            <div class="cnd-banner-title">{{ t('connections.tools.errorTitle') }}</div>
            <div class="mono cnd-banner-sum">{{ toolsError }}</div>
          </div>
        </div>
        <div v-else-if="!tools.length" class="fd">{{ t('connections.tools.empty') }}</div>
        <div v-else class="cnd-tools">
          <div
            v-for="tool in tools"
            :key="tool.name"
            class="cnd-tool"
            :class="{ blocked: !tool.allowed }"
          >
            <Icon name="zap" style="width: 11px; height: 11px; flex: 0 0 auto; margin-top: 3px" />
            <div class="cnd-tool-body">
              <div class="cnd-tool-head">
                <span class="mono cnd-tool-name">{{ tool.display }}</span>
                <span class="tag" :class="tool.allowed ? 'cnd-allowed' : 'cnd-blocked'">
                  {{ t(tool.allowed ? 'connections.tools.allowed' : 'connections.tools.blocked') }}
                </span>
              </div>
              <div v-if="tool.description" class="cnd-tool-desc">{{ tool.description }}</div>
            </div>
          </div>
        </div>
      </template>

      <!-- ── Permissions ────────────────────────────────────────────────── -->
      <div class="sech">{{ t('connections.section.permissions') }}</div>
      <div v-if="permsLoading" class="fd cnd-loading">
        <span class="cnd-oauth-spin cnd-spin-sm" />
        {{ t('connections.perms.loading') }}
      </div>
      <div v-else-if="!hasPermissions" class="fd">{{ t('connections.perms.empty') }}</div>
      <div v-else class="cnd-perms">
        <div v-if="permissions?.allowedMcpPatterns?.length" class="cnd-perm-group">
          <div class="cnd-perm-label">{{ t('connections.perms.mcp') }}</div>
          <div v-for="p in permissions.allowedMcpPatterns" :key="p" class="cnd-perm-item mono">
            {{ p }}
          </div>
        </div>
        <div v-if="apiEndpointLines.length" class="cnd-perm-group">
          <div class="cnd-perm-label">{{ t('connections.perms.api') }}</div>
          <div v-for="p in apiEndpointLines" :key="p" class="cnd-perm-item mono">{{ p }}</div>
        </div>
        <div v-if="permissions?.allowedBashPatterns?.length" class="cnd-perm-group">
          <div class="cnd-perm-label">{{ t('connections.perms.bash') }}</div>
          <div v-for="p in permissions.allowedBashPatterns" :key="p" class="cnd-perm-item mono">
            {{ p }}
          </div>
        </div>
        <div v-if="permissions?.allowedWritePaths?.length" class="cnd-perm-group">
          <div class="cnd-perm-label">{{ t('connections.perms.write') }}</div>
          <div v-for="p in permissions.allowedWritePaths" :key="p" class="cnd-perm-item mono">
            {{ p }}
          </div>
        </div>
      </div>

      <!-- ── Documentation ──────────────────────────────────────────────── -->
      <LibraryMarkdownBody
        v-if="guide"
        :title="t('connections.section.documentation')"
        :content="guide"
      />
      <template v-else>
        <div class="sech">{{ t('connections.section.documentation') }}</div>
        <div v-if="guideLoading" class="fd cnd-loading">
          <span class="cnd-oauth-spin cnd-spin-sm" />
          {{ t('connections.doc.loading') }}
        </div>
        <div v-else class="fd">{{ t('connections.doc.empty') }}</div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
// Source detail pane (ADR 0060 P1 + P5) — Craft-style sections
// (Connection / Tools / Permissions / Documentation). There is no live process:
// the status pill reflects the PERSISTED derived status. The Test button runs
// `source.test` (persist + auto-enable) and surfaces a transient banner; the
// three read-only sections lazy-fetch on open via useConnectionDetail. Test/OAuth
// stay here (they emit to the page-controller); section reads go through the store.
import { computed, ref, watch } from 'vue'
import LibraryMarkdownBody from '~/components/library/LibraryMarkdownBody.vue'
import SourceAvatar from '~/components/connection/SourceAvatar.vue'
import SourceStatusDot from '~/components/connection/SourceStatusDot.vue'
import { useConnectionDetail } from '~/composables/useConnectionDetail'
import type { Source, SourceOAuthResult, SourceTestOutcome } from '~/stores/connections'

const props = defineProps<{
  source: Source
}>()

const emit = defineEmits<{
  edit: []
  delete: []
  toggle: []
  test: [done: (outcome: SourceTestOutcome) => void]
  oauth: [done: (result: SourceOAuthResult) => void]
  'cancel-oauth': []
}>()

const { t } = useI18n()

// Derived display + the three read-only sections (Connection/Tools/Permissions/Doc).
const {
  status,
  transport,
  sourceUrl,
  urlLabel,
  lastTestedRelative,
  connectionError,
  configRows,
  showTools,
  toolsLoading,
  toolsError,
  tools,
  permsLoading,
  permissions,
  hasPermissions,
  apiEndpointLines,
  guideLoading,
  guide,
} = useConnectionDetail(() => props.source)

// --- test (transient banner) ----------------------------------------------
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

// Banner is "good" only when the handshake succeeded AND (no probe OR it passed).
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
    testing.value = false
  })
}

// --- OAuth (ADR 0060 P2 mcp · P6 api) ---------------------------------------
// The Connect flow is shared: `source.startOAuth {slug}` now authorizes both a
// remote MCP source (mcp.authType 'oauth') and a REST API source (api.authType
// 'oauth', endpoints from an explicit api.oauth block or auto-discovered).
const isOAuthSource = computed(() => {
  const s = props.source
  if (s.type === 'mcp') return s.mcp.authType === 'oauth'
  if (s.type === 'api') return s.api.authType === 'oauth'
  return false
})
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
  emit('cancel-oauth')
}

// The detail pane is a single reused instance, so transient per-source state must
// reset when the shown source changes (the sections reset inside the composable).
watch(
  () => props.source.slug,
  () => {
    testResult.value = null
    testing.value = false
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
/* Hero header (Craft SourceInfoPage parity): the shared 50px `.dh` bar is
   overridden to an auto-height block so the large avatar + name + tagline + meta
   fit; actions dock top-right. */
.cnd-hero {
  height: auto;
  align-items: flex-start;
  padding: 16px;
  gap: 13px;
}
.cnd-hero-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cnd-hero-name {
  word-break: break-word;
}
.cnd-hero-tagline {
  font-size: 0.9231rem;
  color: var(--textMuted);
  line-height: 1.5;
}
.cnd-hero-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 2px;
}
.cnd-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
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
.cnd-desc {
  font-size: 1rem;
  color: var(--textMuted);
  line-height: 1.6;
  margin: 0 0 4px;
}
.cnd-controls {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-top: 14px;
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
.cnd-spin-sm {
  width: 12px;
  height: 12px;
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
.cnd-loading {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cnd-info {
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  overflow: hidden;
}
.cnd-info-row {
  display: flex;
  gap: 12px;
  padding: 9px 13px;
  font-size: 0.9231rem;
  border-bottom: 1px solid var(--border);
}
.cnd-info-row:last-child {
  border-bottom: 0;
}
.cnd-info-key {
  color: var(--textDim);
  flex: 0 0 auto;
  min-width: 110px;
}
.cnd-info-val {
  color: var(--textMuted);
  word-break: break-all;
}
.cnd-info-err {
  display: flex;
  gap: 8px;
  padding: 9px 13px;
  font-size: 0.8846rem;
  color: var(--danger);
  background: var(--dangerDim);
  border-top: 1px solid var(--dangerBorder);
}
.cnd-tools {
  display: flex;
  flex-direction: column;
  gap: 7px;
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
.cnd-tool.blocked {
  opacity: 0.7;
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
.cnd-allowed {
  color: var(--green);
  border-color: var(--green);
  text-transform: uppercase;
}
.cnd-blocked {
  color: var(--danger);
  border-color: var(--dangerBorder);
  text-transform: uppercase;
}
.cnd-perms {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cnd-perm-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.cnd-perm-label {
  font-size: 0.8462rem;
  color: var(--textDim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-family: var(--code);
}
.cnd-perm-item {
  font-size: 0.8846rem;
  color: var(--textMuted);
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  word-break: break-all;
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
