<template>
  <div class="cnd">
    <!-- header card: large avatar + name + tagline + transport tag + status pill + actions -->
    <div class="cnd-hero">
      <SourceAvatar :source="source" size="lg" />
      <div class="cnd-hero-main">
        <div class="cnd-hero-name">{{ source.name || source.slug }}</div>
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
            style="width: var(--icon-sm); height: var(--icon-sm)"
          />
        </button>
        <button
          v-if="source.type === 'api'"
          class="iconbtn cnd-act"
          :title="t('connections.detail.setCredential')"
          @click="emit('edit')"
        >
          <Icon name="shield" style="width: var(--icon-sm); height: var(--icon-sm)" />
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
            style="width: var(--icon-sm); height: var(--icon-sm)"
          />
        </button>
        <button
          v-if="canReveal"
          class="iconbtn cnd-act"
          :title="t('connections.detail.showInFolder')"
          @click="emit('reveal')"
        >
          <Icon name="folder" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <button class="iconbtn cnd-act" :title="t('connections.detail.edit')" @click="emit('edit')">
          <Icon name="edit" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <button
          class="iconbtn cnd-act cnd-danger"
          :title="t('connections.detail.delete')"
          @click="emit('delete')"
        >
          <Icon name="trash" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
      </div>
    </div>

    <!-- transient feedback (Test/OAuth live in the hero, so keep their result visible
         on every tab, not buried inside one) -->
    <div v-if="oauthPending || testResult" class="cnd-feedback">
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
          <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
      </div>

      <!-- transient test-result banner -->
      <div v-if="testResult" class="cnd-banner" :class="{ ok: bannerOk, err: !bannerOk }">
        <Icon
          :name="bannerOk ? 'check' : 'alert'"
          style="width: var(--icon-sm); height: var(--icon-sm); flex: 0 0 auto"
        />
        <div class="cnd-banner-body">
          <div class="cnd-banner-title">{{ bannerTitle }}</div>
          <div class="mono cnd-banner-sum">{{ testSummary }}</div>
          <div v-if="testResult.probe" class="cnd-probe" :class="{ bad: !testResult.probe.ok }">
            <Icon
              :name="testResult.probe.ok ? 'check' : 'alert'"
              style="width: var(--icon-xs); height: var(--icon-xs); flex: 0 0 auto"
            />
            <span>{{ probeSummary }}</span>
          </div>
          <pre v-if="testResult.stderr?.length" class="cnd-pre">{{
            testResult.stderr.join('\n')
          }}</pre>
        </div>
      </div>
    </div>

    <!-- section tabs (fit the pane without scrolling the whole page) -->
    <div class="seg cnd-tabs">
      <span
        v-for="tab in tabs"
        :key="tab"
        :class="{ on: activeTab === tab }"
        @click="activeTab = tab"
      >
        {{ t('connections.section.' + tab) }}
      </span>
    </div>

    <div class="dscroll cnd-body">
      <!-- ── General (description + settings card + connection card) ──────── -->
      <template v-if="activeTab === 'general'">
        <p v-if="source.description" class="cnd-lead">{{ source.description }}</p>

        <!-- Settings card: enabled + trust as tidy rows -->
        <div class="cnd-card">
          <div class="cnd-card-row">
            <div class="cnd-row-text">
              <span class="cnd-row-label">{{ t('connections.detail.enabled') }}</span>
              <span class="cnd-row-hint">{{ t('connections.detail.enabledHint') }}</span>
            </div>
            <span
              class="tog2 sm"
              :class="{ off: !source.enabled }"
              :title="t('connections.enableToggle')"
              @click="emit('toggle')"
            />
          </div>
          <div class="cnd-card-sep" />
          <div class="cnd-card-row">
            <div class="cnd-row-text">
              <span class="cnd-row-label">{{ t('connections.detail.trust') }}</span>
              <span class="cnd-row-hint">{{ t('connections.detail.trustHint') }}</span>
            </div>
            <span class="chip cnd-trust">{{ source.trust }}</span>
          </div>
        </div>

        <!-- Connection card: config detail as a clean key/value list -->
        <div class="cnd-card">
          <div class="cnd-card-head">
            <Icon name="conn" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('connections.section.connection') }}
          </div>
          <div class="cnd-kv">
            <div class="cnd-kv-row">
              <span class="cnd-kv-k">{{ t('connections.info.type') }}</span>
              <span class="cnd-kv-v">{{ source.type.toUpperCase() }}</span>
            </div>
            <div v-if="sourceUrl" class="cnd-kv-row">
              <span class="cnd-kv-k">{{ t('connections.info.' + urlLabel) }}</span>
              <span class="cnd-kv-v mono">{{ sourceUrl }}</span>
            </div>
            <div v-for="row in configRows" :key="row.key" class="cnd-kv-row">
              <span class="cnd-kv-k mono">{{ row.key }}</span>
              <span class="cnd-kv-v" :class="{ mono: row.mono }">
                <span>{{ row.value }}</span>
                <span v-if="row.secretKey" class="cnd-kv-badge">
                  <Icon name="shield" style="width: 10px; height: 10px" />
                  {{ row.secretKey }}
                </span>
              </span>
            </div>
            <div class="cnd-kv-row">
              <span class="cnd-kv-k">{{ t('connections.info.lastTested') }}</span>
              <span class="cnd-kv-v">{{ lastTestedRelative }}</span>
            </div>
          </div>
          <div v-if="connectionError" class="cnd-card-err">
            <Icon
              name="alert"
              style="width: var(--icon-sm); height: var(--icon-sm); flex: 0 0 auto; margin-top: 2px"
            />
            <span class="mono">{{ connectionError }}</span>
          </div>
        </div>
      </template>

      <!-- ── Tools (mcp + api) ──────────────────────────────────────────── -->
      <template v-else-if="activeTab === 'tools'">
        <!-- Loading: header + live activity console (what the handshake is doing). -->
        <template v-if="toolsLoading">
          <div class="fd cnd-loading">
            <span class="cnd-oauth-spin cnd-spin-sm" />
            {{ t('connections.tools.loading') }}
          </div>
          <ConnectionToolsLog v-if="toolsLog.length" class="cnd-log" :lines="toolsLog" live />
        </template>

        <!-- Error: banner + the full transcript (it explains the failure). -->
        <template v-else-if="toolsError">
          <div class="cnd-banner err">
            <Icon
              name="alert"
              style="width: var(--icon-sm); height: var(--icon-sm); flex: 0 0 auto"
            />
            <div class="cnd-banner-body">
              <div class="cnd-banner-title">{{ t('connections.tools.errorTitle') }}</div>
              <div class="mono cnd-banner-sum">{{ toolsError }}</div>
            </div>
          </div>
          <ConnectionToolsLog v-if="toolsLog.length" class="cnd-log" :lines="toolsLog" />
        </template>

        <!-- No tools: empty note + collapsible transcript. -->
        <template v-else-if="!tools.length">
          <div class="fd">{{ t('connections.tools.empty') }}</div>
          <div v-if="toolsLog.length" class="cnd-log-foot">
            <button class="cnd-log-toggle" @click="logOpen = !logOpen">
              <Icon
                name="chev"
                class="cnd-log-chev"
                :class="{ closed: !logOpen }"
                style="width: var(--icon-xs); height: var(--icon-xs)"
              />
              {{ t(logOpen ? 'connections.tools.hideLog' : 'connections.tools.showLog') }}
            </button>
            <ConnectionToolsLog v-if="logOpen" class="cnd-log" :lines="toolsLog" />
          </div>
        </template>

        <!-- Tools listed: the list + a collapsible transcript beneath. -->
        <template v-else>
          <div class="cnd-tools">
            <div
              v-for="tool in tools"
              :key="tool.name"
              class="cnd-tool"
              :class="{ blocked: !tool.allowed }"
            >
              <Icon
                name="zap"
                style="
                  width: var(--icon-xs);
                  height: var(--icon-xs);
                  flex: 0 0 auto;
                  margin-top: 2px;
                "
              />
              <div class="cnd-tool-body">
                <div class="cnd-tool-head">
                  <span class="mono cnd-tool-name">{{ tool.display }}</span>
                  <span class="tag" :class="tool.allowed ? 'cnd-allowed' : 'cnd-blocked'">
                    {{
                      t(tool.allowed ? 'connections.tools.allowed' : 'connections.tools.blocked')
                    }}
                  </span>
                </div>
                <div v-if="tool.description" class="cnd-tool-desc">{{ tool.description }}</div>
              </div>
            </div>
          </div>
          <div v-if="toolsLog.length" class="cnd-log-foot">
            <button class="cnd-log-toggle" @click="logOpen = !logOpen">
              <Icon
                name="chev"
                class="cnd-log-chev"
                :class="{ closed: !logOpen }"
                style="width: var(--icon-xs); height: var(--icon-xs)"
              />
              {{ t(logOpen ? 'connections.tools.hideLog' : 'connections.tools.showLog') }}
            </button>
            <ConnectionToolsLog v-if="logOpen" class="cnd-log" :lines="toolsLog" />
          </div>
        </template>
      </template>

      <!-- ── Permissions ────────────────────────────────────────────────── -->
      <template v-else-if="activeTab === 'permissions'">
        <div v-if="!permsEditing" class="cnd-tab-actions">
          <button
            class="iconbtn cnd-sech-edit"
            :title="t('connections.perms.edit')"
            @click="startPermsEdit"
          >
            <Icon name="edit" style="width: var(--icon-xs); height: var(--icon-xs)" />
          </button>
        </div>

        <!-- permissions: edit (structured, line-based) -->
        <div v-if="permsEditing" class="cnd-edit">
          <div class="cnd-edit-field">
            <label class="cnd-edit-label">{{ t('connections.perms.mcp') }}</label>
            <textarea
              v-model="permsMcpText"
              class="cnd-edit-ta"
              spellcheck="false"
              :placeholder="t('connections.perms.mcpPh')"
            />
          </div>
          <div class="cnd-edit-field">
            <label class="cnd-edit-label">{{ t('connections.perms.api') }}</label>
            <textarea
              v-model="permsApiText"
              class="cnd-edit-ta"
              spellcheck="false"
              :placeholder="t('connections.perms.apiPh')"
            />
            <div class="cnd-edit-hint">{{ t('connections.perms.apiHint') }}</div>
          </div>
          <div class="cnd-edit-field">
            <label class="cnd-edit-label">{{ t('connections.perms.bash') }}</label>
            <textarea
              v-model="permsBashText"
              class="cnd-edit-ta"
              spellcheck="false"
              :placeholder="t('connections.perms.bashPh')"
            />
          </div>
          <div class="cnd-edit-field">
            <label class="cnd-edit-label">{{ t('connections.perms.write') }}</label>
            <textarea
              v-model="permsWriteText"
              class="cnd-edit-ta"
              spellcheck="false"
              :placeholder="t('connections.perms.writePh')"
            />
          </div>
          <div class="cnd-edit-hint">{{ t('connections.perms.editHint') }}</div>
          <div v-if="permsError" class="cnd-banner err">
            <Icon
              name="alert"
              style="width: var(--icon-sm); height: var(--icon-sm); flex: 0 0 auto"
            />
            <div class="cnd-banner-body">
              <div class="cnd-banner-title">{{ t('connections.perms.saveError') }}</div>
              <div class="mono cnd-banner-sum">{{ permsError }}</div>
            </div>
          </div>
          <div class="cnd-edit-actions">
            <button class="btn sm" :disabled="permsSaving" @click="cancelPermsEdit">
              {{ t('common.cancel') }}
            </button>
            <button class="btn sm pri" :disabled="permsSaving" @click="savePermsEdit">
              <Icon
                :name="permsSaving ? 'refresh' : 'check'"
                :class="{ spin: permsSaving }"
                style="width: var(--icon-xs); height: var(--icon-xs)"
              />
              {{ permsSaving ? t('connections.edit.saving') : t('common.save') }}
            </button>
          </div>
        </div>

        <!-- permissions: view -->
        <template v-else>
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
        </template>
      </template>

      <!-- ── Documentation ──────────────────────────────────────────────── -->
      <template v-else-if="activeTab === 'documentation'">
        <!-- documentation: edit (direct markdown textarea — no AI). The Edit
             trigger lives in the markdown toolbar row below (allow-edit), so view
             mode shows a single controls row (Render/Raw · Copy · Edit). -->
        <div v-if="guideEditing" class="cnd-edit">
          <textarea
            v-model="guideDraft"
            class="cnd-edit-ta lg"
            spellcheck="false"
            :placeholder="t('connections.doc.editPlaceholder')"
          />
          <div class="cnd-edit-hint">{{ t('connections.doc.editHint') }}</div>
          <div v-if="guideError" class="cnd-banner err">
            <Icon
              name="alert"
              style="width: var(--icon-sm); height: var(--icon-sm); flex: 0 0 auto"
            />
            <div class="cnd-banner-body">
              <div class="cnd-banner-title">{{ t('connections.doc.saveError') }}</div>
              <div class="mono cnd-banner-sum">{{ guideError }}</div>
            </div>
          </div>
          <div class="cnd-edit-actions">
            <button class="btn sm" :disabled="guideSaving" @click="cancelGuideEdit">
              {{ t('common.cancel') }}
            </button>
            <button class="btn sm pri" :disabled="guideSaving" @click="saveGuideEdit">
              <Icon
                :name="guideSaving ? 'refresh' : 'check'"
                :class="{ spin: guideSaving }"
                style="width: var(--icon-xs); height: var(--icon-xs)"
              />
              {{ guideSaving ? t('connections.edit.saving') : t('common.save') }}
            </button>
          </div>
        </div>

        <!-- documentation: view -->
        <div v-else-if="guideLoading" class="fd cnd-loading">
          <span class="cnd-oauth-spin cnd-spin-sm" />
          {{ t('connections.doc.loading') }}
        </div>
        <LibraryMarkdownBody
          v-else
          class="cnd-guide-body"
          :title="''"
          :content="guide"
          :empty-text="t('connections.doc.empty')"
          allow-edit
          :edit-label="t('connections.doc.edit')"
          :edit-title="t('connections.doc.edit')"
          @edit-body="startGuideEdit"
        />
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
import ConnectionToolsLog from '~/components/connection/ConnectionToolsLog.vue'
import SourceAvatar from '~/components/connection/SourceAvatar.vue'
import SourceStatusDot from '~/components/connection/SourceStatusDot.vue'
import { useConnectionDetail } from '~/composables/useConnectionDetail'
import { useSidecar } from '~/composables/useSidecar'
import type { Source, SourceOAuthResult, SourceTestOutcome } from '~/stores/connections'

const props = defineProps<{
  source: Source
}>()

const emit = defineEmits<{
  edit: []
  delete: []
  reveal: []
  toggle: []
  test: [done: (outcome: SourceTestOutcome) => void]
  oauth: [done: (result: SourceOAuthResult) => void]
  'cancel-oauth': []
}>()

const { t } = useI18n()

// "Show in folder" only works inside the Electron shell (main derives the path).
// In browser dev the bridge is absent, so hide the affordance rather than fail.
const canReveal = useSidecar().available

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
  toolsLog,
  permsLoading,
  permissions,
  hasPermissions,
  apiEndpointLines,
  permsEditing,
  permsSaving,
  permsError,
  permsMcpText,
  permsApiText,
  permsBashText,
  permsWriteText,
  startPermsEdit,
  cancelPermsEdit,
  savePermsEdit,
  guideLoading,
  guide,
  guideEditing,
  guideDraft,
  guideSaving,
  guideError,
  startGuideEdit,
  cancelGuideEdit,
  saveGuideEdit,
} = useConnectionDetail(() => props.source)

// The detail is tabbed (fits the pane without scrolling the whole page): General
// (description + controls + connection info), Tools, Permissions, Documentation.
// The Tools tab only exists for kinds that expose tools (mcp/api — `showTools`).
type CndTab = 'general' | 'tools' | 'permissions' | 'documentation'
const activeTab = ref<CndTab>('general')
const tabs = computed<CndTab[]>(() => [
  'general',
  ...(showTools.value ? (['tools'] as CndTab[]) : []),
  'permissions',
  'documentation',
])

// After a successful/empty run the activity transcript collapses behind a toggle
// (it stays expanded while loading and on error, where it's the primary content).
const logOpen = ref(false)

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
    logOpen.value = false
    activeTab.value = 'general'
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
/* Header card: avatar + name + tagline + meta on the left, action buttons docked
   top-right on ONE row. A floating card (matches the content cards) with the pane
   gutter around it, not a flat header bar. */
.cnd-hero {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin: 14px 14px 0;
  padding: 14px 16px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
}
.cnd-hero-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cnd-hero-name {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
  color: var(--text);
  word-break: break-word;
}
.cnd-hero-tagline {
  font-size: var(--fs-sm);
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
/* Transient Test/OAuth feedback — fixed above the tabs so it shows on any tab. */
.cnd-feedback {
  flex: 0 0 auto;
  padding: 0 14px;
}
/* Section tab bar (reuses .seg but on a card surface): hugs content, sits between
   the header card + the scroll body, aligned to the same gutter. */
.cnd-tabs {
  flex: 0 0 auto;
  align-self: flex-start;
  margin: 12px 14px 0;
  max-width: calc(100% - 28px);
  overflow-x: auto;
  background: var(--bgInput);
}
/* The scroll body owns the vertical space left after hero + tabs; only its content
   scrolls, so the page itself never does. Same 14px gutter as the header/tabs. */
.cnd-body {
  padding: 14px;
}
/* Right-aligned edit affordance for the Permissions tab (the tab label already
   names the section, so no redundant header text). Documentation folds its Edit
   into the markdown toolbar row instead. */
.cnd-tab-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
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
.cnd-lead {
  font-size: var(--fs-md);
  color: var(--textMuted);
  line-height: 1.6;
  margin: 0 0 14px;
}
/* ── Card system (General tab + shared) ─────────────────────────────────────
   Subtle surface + hairline border + radius (flat, no heavy shadow) — the app's
   card language (shadcn-style neutral). */
.cnd-card {
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--bgInput);
  overflow: hidden;
}
.cnd-card + .cnd-card {
  margin-top: 12px;
}
/* Card header: icon + uppercase mono label, hairline underline. */
.cnd-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  border-bottom: 1px solid var(--border);
}
/* A settings row: label + hint on the left, control on the right. */
.cnd-card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px;
}
.cnd-card-sep {
  height: 1px;
  background: var(--border);
}
.cnd-row-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.cnd-row-label {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 550;
  color: var(--text);
}
.cnd-row-hint {
  font-size: var(--fs-xs);
  color: var(--textDim);
  line-height: 1.4;
}
.cnd-trust {
  text-transform: capitalize;
}
/* Key/value list inside a card. */
.cnd-kv {
  display: flex;
  flex-direction: column;
}
.cnd-kv-row {
  display: flex;
  gap: 14px;
  padding: 10px 14px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.cnd-kv-row + .cnd-kv-row {
  border-top: 1px solid var(--border);
}
.cnd-kv-k {
  flex: 0 0 auto;
  min-width: 104px;
  color: var(--textDim);
}
.cnd-kv-v {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  color: var(--text);
  word-break: break-word;
}
/* Keychain reference badge — accent-tinted pill naming the stored key. */
.cnd-kv-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  border-radius: var(--r-pill);
  border: 1px solid var(--accentBorder);
  color: var(--accent);
  font-size: 12px;
  line-height: 1.5;
}
.cnd-card-err {
  display: flex;
  gap: 8px;
  padding: 10px 14px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--danger);
  background: var(--dangerDim);
  border-top: 1px solid var(--dangerBorder);
}
.cnd-banner {
  display: flex;
  gap: 8px;
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: var(--r-btn);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
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
  /* mono-ok: JSON / env block */
  font-family: var(--code);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: var(--r-sm);
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
.cnd-tools {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
/* Activity console (ConnectionToolsLog) placement: a small gap under whatever it
   follows (loading row / error banner / tools list). */
.cnd-log {
  margin-top: 8px;
}
.cnd-log-foot {
  margin-top: 8px;
}
.cnd-log-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  margin-left: -6px;
  border: 0;
  background: transparent;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
  border-radius: var(--r-xs);
}
.cnd-log-toggle:hover {
  color: var(--text);
  background: var(--bgHover);
}
.cnd-log-chev {
  transition: transform 0.15s ease;
}
.cnd-log-chev.closed {
  transform: rotate(-90deg);
}
.cnd-tool {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--r-sm);
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
  gap: 6px;
}
.cnd-tool-name {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 500;
  color: var(--text);
}
.cnd-tool-desc {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
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
  gap: 4px;
}
.cnd-perm-label {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.cnd-perm-item {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
  padding: 6px 10px;
  border-radius: var(--r-sm);
  background: var(--bgInput);
  border: 1px solid var(--border);
  word-break: break-all;
}
/* Icon-only edit affordance in the Permissions / Documentation tab-action row. */
.cnd-sech-edit {
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
}
/* The reused markdown viewer sits at the top of the Documentation tab, so drop its
   built-in top margin (its empty title is hidden). */
.cnd-guide-body :deep(.lmb-head) {
  margin-top: 0;
}
.cnd-guide-body :deep(.lmb-title) {
  display: none;
}
/* Inline direct editors (guide markdown / permissions arrays). */
.cnd-edit {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cnd-edit-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cnd-edit-label {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.cnd-edit-ta {
  width: 100%;
  min-height: 4.5rem;
  resize: vertical;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 8px 10px;
  color: var(--text);
  /* mono-ok: JSON config editor */
  font-family: var(--code);
  font-size: var(--fs-sm);
  line-height: 1.55;
  outline: none;
}
.cnd-edit-ta.lg {
  min-height: 18rem;
}
.cnd-edit-ta:focus {
  border-color: var(--accentBorder);
}
.cnd-edit-hint {
  font-size: var(--fs-xs);
  color: var(--textFaint);
  line-height: 1.5;
}
.cnd-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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
