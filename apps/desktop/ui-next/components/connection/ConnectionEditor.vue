<template>
  <LibraryEntityModal
    :open="open"
    :title="isExisting ? t('connections.editor.editTitle') : t('connections.editor.newTitle')"
    :width="640"
    @close="emit('cancel')"
  >
    <div class="cne">
      <div class="cne-grid">
        <div class="cne-field">
          <label class="cne-label">{{ t('connections.editor.slug') }}</label>
          <input
            class="cne-input mono"
            :value="draft.slug"
            placeholder="e.g. github"
            spellcheck="false"
            :disabled="isExisting"
            @input="onSlugInput"
          />
          <div class="cne-hint">{{ t('connections.editor.slugHint') }}</div>
        </div>
        <div class="cne-field">
          <label class="cne-label">{{ t('connections.editor.name') }}</label>
          <input
            v-model="draft.name"
            class="cne-input"
            :placeholder="t('connections.editor.namePh')"
          />
        </div>
      </div>

      <div class="cne-field">
        <label class="cne-label">{{ t('connections.editor.description') }}</label>
        <textarea
          v-model="draft.description"
          class="cne-input cne-ta"
          rows="2"
          :placeholder="t('connections.editor.descPh')"
        />
      </div>

      <div class="cne-grid3">
        <div class="cne-field">
          <label class="cne-label">{{ t('connections.editor.transport') }}</label>
          <AppSelect v-model="transportSelect" :options="transportOptions" width="100%" />
        </div>
        <div class="cne-field">
          <label class="cne-label">{{ t('connections.editor.trust') }}</label>
          <AppSelect v-model="trustSelect" :options="trustOptions" width="100%" />
        </div>
        <div class="cne-field">
          <label class="cne-label">{{ t('connections.editor.timeout') }}</label>
          <input v-model.number="draft.timeoutMs" type="number" class="cne-input mono" />
        </div>
      </div>

      <!-- stdio config -->
      <template v-if="draft.transport === 'stdio'">
        <div class="cne-field">
          <label class="cne-label">{{ t('connections.editor.command') }}</label>
          <input
            v-model="draft.command"
            class="cne-input mono"
            placeholder="npx, uvx, /path/to/bin"
          />
        </div>
        <div class="cne-field">
          <label class="cne-label">{{ t('connections.editor.args') }}</label>
          <textarea
            v-model="argsText"
            class="cne-input cne-ta mono"
            rows="3"
            :placeholder="t('connections.editor.argsPh')"
          />
        </div>
        <div class="cne-field">
          <label class="cne-label">{{ t('connections.editor.cwd') }}</label>
          <input
            v-model="draft.cwd"
            class="cne-input mono"
            :placeholder="t('connections.editor.cwdPh')"
          />
        </div>
        <LibraryKvEditor
          v-model="envEntries"
          :label="t('connections.editor.env')"
          :secret-mode="secretMode"
        />
      </template>

      <!-- http config -->
      <template v-else>
        <div class="cne-field">
          <label class="cne-label">{{ t('connections.editor.url') }}</label>
          <input
            v-model="draft.url"
            class="cne-input mono"
            placeholder="https://mcp.example.com/v1"
          />
        </div>
        <div class="cne-field">
          <label class="cne-label">{{ t('connections.editor.authType') }}</label>
          <AppSelect v-model="authTypeSelect" :options="authTypeOptions" width="100%" />
          <div class="cne-hint">{{ t('connections.editor.authTypeHint') }}</div>
        </div>
        <!-- oauth tokens come from the sign-in flow (Connect on the detail pane),
             so the manual header/token rows are hidden for authType:'oauth'. -->
        <LibraryKvEditor
          v-if="draft.authType !== 'oauth'"
          v-model="headerEntries"
          :label="t('connections.editor.headers')"
          :secret-mode="secretMode"
        />
        <div v-else class="cne-hint">{{ t('connections.editor.oauthHeadersNote') }}</div>
      </template>

      <button
        type="button"
        class="cne-toggle"
        :class="{ on: draft.enabled }"
        @click="draft.enabled = !draft.enabled"
      >
        <span class="tog2 sm" :class="{ off: !draft.enabled }" />
        {{ t('connections.editor.enabled') }}
      </button>

      <!-- auth probe (optional) — the Verify calls this tool after the handshake to
           check the token actually authenticates (handshake alone never does). -->
      <div class="cne-field">
        <label class="cne-label">{{ t('connections.editor.healthCheck') }}</label>
        <div class="cne-hint">{{ t('connections.editor.healthHint') }}</div>
        <AppSelect
          v-if="hasDetectedTools"
          v-model="healthTool"
          :options="toolOptions"
          width="100%"
        />
        <input
          v-else
          v-model="healthTool"
          class="cne-input mono"
          :placeholder="t('connections.editor.healthToolPh')"
          spellcheck="false"
        />
        <template v-if="healthTool">
          <textarea
            v-model="healthArgsText"
            class="cne-input cne-ta mono"
            rows="3"
            :placeholder="t('connections.editor.healthArgsPh')"
          />
          <div v-if="!healthArgsValid" class="cne-err">
            {{ t('connections.editor.healthArgsInvalid') }}
          </div>
        </template>
      </div>

      <!-- verify (save-first: source.test operates on the persisted source) -->
      <div class="cne-verify">
        <button class="btn sm" :disabled="!canVerify || verifying" @click="onVerify">
          <Icon
            :name="verifying ? 'refresh' : 'check'"
            :class="{ spin: verifying }"
            style="width: 12px; height: 12px"
          />
          {{ verifying ? t('connections.editor.testing') : t('connections.editor.verify') }}
        </button>
        <span v-if="verifyResult" class="cne-verify-sum" :class="{ ok: verifyResult.ok }">
          {{ verifyResult.summary }}
        </span>
      </div>
      <div v-if="verifyProbe" class="cne-verify-sum cne-probe" :class="{ ok: verifyProbe.ok }">
        <Icon
          :name="verifyProbe.ok ? 'check' : 'alert'"
          style="width: 12px; height: 12px; flex: 0 0 auto"
        />
        <span>
          {{
            verifyProbe.ok
              ? t('connections.editor.authOk', { tool: verifyProbe.tool })
              : t('connections.editor.authFail', {
                  tool: verifyProbe.tool,
                  error: verifyProbe.error ?? '',
                })
          }}
        </span>
      </div>
      <pre v-if="verifyResult?.stderr?.length" class="cne-pre">{{
        verifyResult.stderr.join('\n')
      }}</pre>
    </div>

    <template #footer>
      <button class="btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button class="btn pri" :disabled="!canSave" @click="onSave">
        {{ t('connections.editor.save') }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Source form editor (ADR 0060 P1) — rewired from the old McpEditor. Builds a
// `SourceConfig` with type:'mcp' (P1 handles the mcp kind only; api/local land in
// later phases). The transport now lives INSIDE the `mcp` block. There is no
// `autoStart` toggle. Env vars (stdio) / headers (http) use LibraryKvEditor in
// secret-mode, keyed by the source's STABLE id so `source.setSecret` persists to
// the OS keychain and only the `secret:KEY` placeholder reaches the config.
//
// Verify is SAVE-FIRST: `source.test` operates on a persisted source (by slug),
// so the injected `verify` handler saves the draft, then tests it — never an
// in-memory draft. Detected tools populate the health-check picker.
import { computed, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import LibraryKvEditor, {
  type KvEntry,
  type KvSecretMode,
} from '~/components/library/LibraryKvEditor.vue'
import type {
  McpSource,
  McpSourceBlock,
  Source,
  SourceInput,
  SourceProbeResult,
  SourceTestOutcome,
  SourceTrust,
} from '~/stores/connections'

// Transport variants the form edits (sse is folded into http on load).
type EditorTransport = 'http' | 'stdio'
// Auth mode for http/sse sources (mirror of McpSourceBlock.authType).
type EditorAuthType = 'none' | 'bearer' | 'oauth'

const props = defineProps<{
  open: boolean
  source: Source | null
  // Injected so the editor never imports the store (SoC). Save-first: persists the
  // draft, then runs `source.test` by slug and resolves the outcome.
  verify: (data: SourceInput) => Promise<SourceTestOutcome>
}>()

const emit = defineEmits<{
  save: [source: SourceInput]
  cancel: []
}>()

const { t } = useI18n()

const transportOptions: AppSelectOption[] = [
  { value: 'stdio', label: 'stdio' },
  { value: 'http', label: 'http' },
]
const trustOptions: AppSelectOption[] = [
  { value: 'allow', label: 'allow (auto)' },
  { value: 'prompt', label: 'prompt (approval)' },
  { value: 'deny', label: 'deny' },
]

type Draft = {
  slug: string
  name: string
  provider: string
  description: string
  transport: EditorTransport
  authType: EditorAuthType
  command: string
  cwd: string
  url: string
  enabled: boolean
  timeoutMs: number
  trust: SourceTrust
  deniedTools?: string[]
}

const makeDefaults = (): Draft => ({
  slug: '',
  name: '',
  provider: '',
  description: '',
  transport: 'stdio',
  authType: 'none',
  command: 'npx',
  cwd: '',
  url: '',
  enabled: true,
  timeoutMs: 30000,
  trust: 'prompt',
})

const fromSource = (s: Source): Draft => ({
  slug: s.slug,
  name: s.name,
  provider: s.provider,
  description: s.description ?? '',
  transport: s.type === 'mcp' && s.mcp.transport === 'stdio' ? 'stdio' : 'http',
  authType: s.type === 'mcp' ? (s.mcp.authType ?? 'none') : 'none',
  command: s.type === 'mcp' ? (s.mcp.command ?? '') : '',
  cwd: s.type === 'mcp' ? (s.mcp.cwd ?? '') : '',
  url: s.type === 'mcp' ? (s.mcp.url ?? '') : '',
  enabled: s.enabled,
  timeoutMs: s.timeoutMs,
  trust: s.trust,
  deniedTools: s.deniedTools ? [...s.deniedTools] : undefined,
})

const initDraft = (s: Source | null): Draft => (s ? fromSource(s) : makeDefaults())

const mcpArgsOf = (s: Source | null): string[] =>
  s && s.type === 'mcp' ? (s.mcp.args ?? []) : ['-y', '@modelcontextprotocol/server-filesystem']
const mcpEnvOf = (s: Source | null): Record<string, string> =>
  s && s.type === 'mcp' ? (s.mcp.env ?? {}) : {}
const mcpHeadersOf = (s: Source | null): Record<string, string> =>
  s && s.type === 'mcp' ? (s.mcp.headers ?? {}) : {}

const draft = ref<Draft>(initDraft(props.source))
const argsText = ref(mcpArgsOf(props.source).join('\n'))
const envEntries = ref<KvEntry[]>(toEntries(mcpEnvOf(props.source)))
const headerEntries = ref<KvEntry[]>(toEntries(mcpHeadersOf(props.source)))

// Optional auth probe (healthCheck): a tool name + JSON args Verify runs after the
// handshake to verify the token actually authenticates.
const healthTool = ref<string>(props.source?.healthCheck?.tool ?? '')
const healthArgsText = ref<string>(healthArgsToText(props.source?.healthCheck?.args))

// Tools detected by the last Verify — populate the health-check picker (a source
// carries no persisted tools list).
const detectedTools = ref<{ name: string; description: string }[]>([])

const verifying = ref(false)
const verifyResult = ref<{ ok: boolean; summary: string; stderr?: string[] } | null>(null)
const verifyProbe = ref<SourceProbeResult | null>(null)

const isExisting = computed(() => !!props.source)

// A new source needs a stable id (`${slug}_${8hex}`) BEFORE save, because
// source.setSecret keys the keychain by id and the saved config must reuse the
// same id. Generated once (frozen) so changing the slug later never orphans a
// stored secret. Existing sources keep their id.
const generatedId = ref<string | null>(null)
function rand8hex(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}
const ensureSourceId = (): string => {
  if (props.source) return props.source.id
  if (!generatedId.value) generatedId.value = `${draft.value.slug || 'source'}_${rand8hex()}`
  return generatedId.value
}
const sourceId = computed(() => props.source?.id ?? generatedId.value ?? '')
const secretMode = computed<KvSecretMode | undefined>(() =>
  sourceId.value ? { sourceId: sourceId.value } : undefined,
)

// Freeze the generated id as soon as a slug is entered for a new source.
watch(
  () => draft.value.slug,
  (slug) => {
    if (!props.source && slug && !generatedId.value) generatedId.value = `${slug}_${rand8hex()}`
  },
)

// Bridge the union-typed draft fields to AppSelect's string model.
const transportSelect = computed<string>({
  get: () => draft.value.transport,
  set: (v) => {
    draft.value.transport = v as EditorTransport
  },
})
const trustSelect = computed<string>({
  get: () => draft.value.trust,
  set: (v) => {
    draft.value.trust = v as SourceTrust
  },
})
const authTypeOptions = computed<AppSelectOption[]>(() => [
  { value: 'none', label: t('connections.editor.authNone') },
  { value: 'bearer', label: t('connections.editor.authBearer') },
  { value: 'oauth', label: t('connections.editor.authOAuth') },
])
const authTypeSelect = computed<string>({
  get: () => draft.value.authType,
  set: (v) => {
    draft.value.authType = v as EditorAuthType
  },
})

// Re-seed every time the modal opens or the target source changes.
watch(
  () => [props.open, props.source] as const,
  ([isOpen]) => {
    if (!isOpen) return
    draft.value = initDraft(props.source)
    argsText.value = mcpArgsOf(props.source).join('\n')
    envEntries.value = toEntries(mcpEnvOf(props.source))
    headerEntries.value = toEntries(mcpHeadersOf(props.source))
    healthTool.value = props.source?.healthCheck?.tool ?? ''
    healthArgsText.value = healthArgsToText(props.source?.healthCheck?.args)
    detectedTools.value = []
    verifyResult.value = null
    verifyProbe.value = null
    generatedId.value = null
  },
)

const onSlugInput = (e: Event) => {
  draft.value.slug = (e.target as HTMLInputElement).value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Auth-probe tool picker: the detected tools (populated after Verify) plus a
// "none" option. The currently-configured tool is kept even if it's not detected.
const hasDetectedTools = computed(() => detectedTools.value.length > 0)
const toolOptions = computed<AppSelectOption[]>(() => {
  const names = new Set(detectedTools.value.map((tool) => tool.name))
  if (healthTool.value) names.add(healthTool.value)
  const opts = [...names].sort().map((n) => ({ value: n, label: n }))
  return [{ value: '', label: t('connections.editor.healthNone') }, ...opts]
})

// Parse the args textarea → a JSON object (empty text = {}). Returns null on
// invalid JSON or a non-object so callers can block save/verify.
const parsedHealthArgs = computed<Record<string, unknown> | null>(() => {
  const raw = healthArgsText.value.trim()
  if (!raw) return {}
  try {
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
})
const healthArgsValid = computed(() => !healthTool.value || parsedHealthArgs.value !== null)

const canSave = computed(() => {
  if (!draft.value.slug || !draft.value.name.trim()) return false
  if (!/^[a-z0-9][a-z0-9-]*$/.test(draft.value.slug)) return false
  if (draft.value.transport === 'stdio' && !draft.value.command.trim()) return false
  if (draft.value.transport === 'http' && !draft.value.url.trim()) return false
  if (!healthArgsValid.value) return false
  return true
})

// Verify is save-first, so it works for both transports once the draft is valid.
const canVerify = computed(() => canSave.value)

// Assemble the SourceConfig payload (type:'mcp'). Persisted status fields are
// carried over on edit so a save doesn't wipe the last-test result.
const buildPayload = (): SourceInput => {
  const slug = draft.value.slug
  const transport = draft.value.transport
  const mcp: McpSourceBlock = { transport }
  if (transport === 'stdio') {
    mcp.command = draft.value.command.trim()
    mcp.args = argsText.value.split('\n').filter((x) => x.length > 0)
    if (draft.value.cwd.trim()) mcp.cwd = draft.value.cwd.trim()
    const env = fromEntries(envEntries.value)
    if (Object.keys(env).length > 0) mcp.env = env
  } else {
    mcp.url = draft.value.url.trim()
    mcp.authType = draft.value.authType
    // OAuth tokens come from the sign-in flow, not manual header rows.
    if (draft.value.authType !== 'oauth') {
      const headers = fromEntries(headerEntries.value)
      if (Object.keys(headers).length > 0) mcp.headers = headers
    }
    // Preserve the (non-secret) OAuth client id across edits so refresh reuses it.
    if (props.source?.type === 'mcp' && props.source.mcp.clientId) {
      mcp.clientId = props.source.mcp.clientId
    }
  }

  const now = Date.now()
  const src: McpSource = {
    id: ensureSourceId(),
    slug,
    name: draft.value.name.trim(),
    provider: draft.value.provider.trim() || slug,
    type: 'mcp',
    enabled: draft.value.enabled,
    timeoutMs: draft.value.timeoutMs,
    trust: draft.value.trust,
    mcp,
    createdAt: props.source?.createdAt ?? now,
    updatedAt: now,
  }
  if (draft.value.description.trim()) src.description = draft.value.description.trim()
  if (draft.value.deniedTools?.length) src.deniedTools = [...draft.value.deniedTools]
  // Preserve persisted last-test status on edit (a fresh test overwrites it).
  if (props.source) {
    if (props.source.connectionStatus) src.connectionStatus = props.source.connectionStatus
    if (props.source.isAuthenticated !== undefined)
      src.isAuthenticated = props.source.isAuthenticated
    if (props.source.connectionError) src.connectionError = props.source.connectionError
    if (props.source.lastTestedAt) src.lastTestedAt = props.source.lastTestedAt
  }
  const tool = healthTool.value.trim()
  if (tool) {
    const args = parsedHealthArgs.value ?? {}
    src.healthCheck = Object.keys(args).length > 0 ? { tool, args } : { tool }
  }
  return src
}

const onVerify = async () => {
  if (!canVerify.value || verifying.value) return
  verifying.value = true
  verifyResult.value = null
  verifyProbe.value = null
  try {
    const outcome = await props.verify(buildPayload())
    verifyProbe.value = outcome.probe ?? null
    if (outcome.tools) detectedTools.value = outcome.tools
    if (outcome.ok) {
      const tc = outcome.tools?.length ?? 0
      const rc = outcome.resources?.length ?? 0
      verifyResult.value = {
        ok: true,
        summary: t('connections.editor.verifyOk', { tools: tc, resources: rc }),
        stderr: outcome.stderr,
      }
    } else {
      verifyResult.value = {
        ok: false,
        summary: t('connections.editor.verifyFail', { error: outcome.error ?? '' }),
        stderr: outcome.stderr,
      }
    }
  } catch (err) {
    verifyResult.value = {
      ok: false,
      summary: err instanceof Error ? err.message : 'verify failed',
    }
  } finally {
    verifying.value = false
  }
}

const onSave = () => {
  if (!canSave.value) return
  emit('save', buildPayload())
}

function healthArgsToText(args: Record<string, unknown> | undefined): string {
  return args && Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : ''
}
function toEntries(record: Record<string, string> | undefined): KvEntry[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({ key, value }))
}
function fromEntries(entries: KvEntry[]): Record<string, string> {
  return Object.fromEntries(
    entries.filter((e) => e.key.trim().length > 0).map((e) => [e.key, e.value]),
  )
}
</script>

<style scoped>
.cne {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.cne-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.cne-grid3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 14px;
}
.cne-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cne-label {
  font-size: 0.8846rem;
  font-weight: 550;
  color: var(--text);
}
.cne-input {
  width: 100%;
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 0.9615rem;
  font-family: var(--sans);
  outline: none;
}
.cne-input.mono {
  font-family: var(--code);
}
.cne-input:focus {
  border-color: var(--accent);
}
.cne-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.cne-ta {
  resize: vertical;
  min-height: 3rem;
  line-height: 1.55;
}
.cne-hint {
  font-size: 0.8462rem;
  color: var(--textDim);
}
.cne-toggle {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 11px;
  border-radius: 8px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--textMuted);
  font-size: 0.9615rem;
  cursor: pointer;
}
.cne-toggle.on {
  color: var(--text);
}
.cne-verify {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
}
.cne-verify-sum {
  font-size: 0.9231rem;
  color: var(--danger);
}
.cne-verify-sum.ok {
  color: var(--green);
}
.cne-probe {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: -6px;
}
.cne-err {
  font-size: 0.8462rem;
  color: var(--danger);
}
.cne-pre {
  font-family: var(--code);
  font-size: 0.8462rem;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--textDim);
  max-height: 8rem;
  overflow-y: auto;
  white-space: pre-wrap;
}
.spin {
  animation: cne-spin 0.9s linear infinite;
}
@keyframes cne-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
