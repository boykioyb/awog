<template>
  <LibraryEntityModal
    :open="open"
    :title="isExisting ? t('connections.editor.editTitle') : t('connections.editor.newTitle')"
    :width="640"
    @close="emit('cancel')"
  >
    <div class="cne">
      <!-- top-level source type: switches the whole form (mcp vs api). Locked on
           edit — changing an existing source's kind would orphan its config. -->
      <div class="cne-field">
        <label class="cne-label">{{ t('connections.editor.sourceType') }}</label>
        <AppSelect
          v-model="typeSelect"
          :options="typeOptions"
          :disabled="isExisting"
          width="100%"
        />
      </div>

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

      <div class="cne-grid">
        <div class="cne-field">
          <label class="cne-label">{{ t('connections.editor.icon') }}</label>
          <input
            v-model="draft.icon"
            class="cne-input"
            :placeholder="t('connections.editor.iconPh')"
            spellcheck="false"
          />
          <div class="cne-hint">{{ t('connections.editor.iconHint') }}</div>
        </div>
        <div class="cne-field">
          <label class="cne-label">{{ t('connections.editor.tagline') }}</label>
          <input
            v-model="draft.tagline"
            class="cne-input"
            :placeholder="t('connections.editor.taglinePh')"
          />
        </div>
      </div>

      <div class="cne-grid">
        <div class="cne-field">
          <label class="cne-label">{{ t('connections.editor.trust') }}</label>
          <AppSelect v-model="trustSelect" :options="trustOptions" width="100%" />
        </div>
        <div class="cne-field">
          <label class="cne-label">{{ t('connections.editor.timeout') }}</label>
          <input v-model.number="draft.timeoutMs" type="number" class="cne-input mono" />
        </div>
      </div>

      <!-- ── MCP source ────────────────────────────────────────────────── -->
      <template v-if="draft.type === 'mcp'">
        <div class="cne-field">
          <label class="cne-label">{{ t('connections.editor.transport') }}</label>
          <AppSelect v-model="transportSelect" :options="transportOptions" width="100%" />
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

        <!-- auth probe (optional) — Verify calls this tool after the handshake to
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
      </template>

      <!-- ── API source ────────────────────────────────────────────────── -->
      <template v-else-if="draft.type === 'api'">
        <div class="cne-field">
          <label class="cne-label">{{ t('connections.editor.baseUrl') }}</label>
          <input
            v-model="draft.apiBaseUrl"
            class="cne-input mono"
            placeholder="https://api.example.com/"
            spellcheck="false"
          />
          <div class="cne-hint">{{ t('connections.editor.baseUrlHint') }}</div>
        </div>

        <div class="cne-field">
          <label class="cne-label">{{ t('connections.editor.authType') }}</label>
          <AppSelect v-model="apiAuthTypeSelect" :options="apiAuthTypeOptions" width="100%" />
          <div v-if="draft.apiAuthType === 'oauth'" class="cne-hint">
            {{ t('connections.editor.apiOAuthNote') }}
          </div>
        </div>

        <!-- auth-dependent config + credential entry -->
        <template v-if="draft.apiAuthType === 'bearer'">
          <div class="cne-field">
            <label class="cne-label">{{ t('connections.editor.authScheme') }}</label>
            <input v-model="draft.apiAuthScheme" class="cne-input mono" placeholder="Bearer" />
            <div class="cne-hint">{{ t('connections.editor.authSchemeHint') }}</div>
          </div>
          <div class="cne-field">
            <label class="cne-label">{{ t('connections.editor.credentialToken') }}</label>
            <input
              v-model="credValue"
              type="password"
              class="cne-input mono"
              :placeholder="t('connections.editor.credentialTokenPh')"
              spellcheck="false"
              autocomplete="off"
            />
            <div class="cne-hint">{{ credentialHint }}</div>
          </div>
        </template>

        <template v-else-if="draft.apiAuthType === 'header'">
          <div class="cne-field">
            <label class="cne-label">{{ t('connections.editor.headerMode') }}</label>
            <AppSelect v-model="headerModeSelect" :options="headerModeOptions" width="100%" />
          </div>
          <template v-if="draft.apiHeaderMode === 'single'">
            <div class="cne-field">
              <label class="cne-label">{{ t('connections.editor.headerName') }}</label>
              <input
                v-model="draft.apiHeaderName"
                class="cne-input mono"
                :placeholder="t('connections.editor.headerNamePh')"
                spellcheck="false"
              />
            </div>
            <div class="cne-field">
              <label class="cne-label">{{ t('connections.editor.credentialApiKey') }}</label>
              <input
                v-model="credValue"
                type="password"
                class="cne-input mono"
                :placeholder="t('connections.editor.credentialApiKeyPh')"
                spellcheck="false"
                autocomplete="off"
              />
              <div class="cne-hint">{{ credentialHint }}</div>
            </div>
          </template>
          <template v-else>
            <LibraryKvEditor
              v-model="multiHeaderEntries"
              :label="t('connections.editor.multiHeaders')"
            />
            <div class="cne-hint">{{ credentialHint }}</div>
          </template>
        </template>

        <template v-else-if="draft.apiAuthType === 'query'">
          <div class="cne-field">
            <label class="cne-label">{{ t('connections.editor.queryParam') }}</label>
            <input
              v-model="draft.apiQueryParam"
              class="cne-input mono"
              :placeholder="t('connections.editor.queryParamPh')"
              spellcheck="false"
            />
          </div>
          <div class="cne-field">
            <label class="cne-label">{{ t('connections.editor.credentialApiKey') }}</label>
            <input
              v-model="credValue"
              type="password"
              class="cne-input mono"
              :placeholder="t('connections.editor.credentialApiKeyPh')"
              spellcheck="false"
              autocomplete="off"
            />
            <div class="cne-hint">{{ credentialHint }}</div>
          </div>
        </template>

        <template v-else-if="draft.apiAuthType === 'basic'">
          <div class="cne-grid">
            <div class="cne-field">
              <label class="cne-label">{{ t('connections.editor.credentialUsername') }}</label>
              <input
                v-model="credUsername"
                class="cne-input mono"
                spellcheck="false"
                autocomplete="off"
              />
            </div>
            <div class="cne-field">
              <label class="cne-label">{{ t('connections.editor.credentialPassword') }}</label>
              <input
                v-model="credPassword"
                type="password"
                class="cne-input mono"
                spellcheck="false"
                autocomplete="off"
              />
            </div>
          </div>
          <div class="cne-hint">{{ credentialHint }}</div>
        </template>

        <!-- optional default headers sent on every request (non-secret) -->
        <LibraryKvEditor
          v-model="defaultHeaderEntries"
          :label="t('connections.editor.defaultHeaders')"
        />

        <!-- test endpoint sub-form — used by Verify to check the credential -->
        <div class="cne-field">
          <label class="cne-label">{{ t('connections.editor.testEndpoint') }}</label>
          <div class="cne-hint">{{ t('connections.editor.testEndpointHint') }}</div>
          <div class="cne-grid-te">
            <AppSelect v-model="apiTestMethodSelect" :options="testMethodOptions" width="100%" />
            <input
              v-model="draft.apiTestPath"
              class="cne-input mono"
              :placeholder="t('connections.editor.testPathPh')"
              spellcheck="false"
            />
          </div>
          <template v-if="draft.apiTestMethod === 'POST'">
            <textarea
              v-model="apiTestBodyText"
              class="cne-input cne-ta mono"
              rows="3"
              :placeholder="t('connections.editor.testBodyPh')"
            />
            <div v-if="!apiTestBodyValid" class="cne-err">
              {{ t('connections.editor.testBodyInvalid') }}
            </div>
          </template>
        </div>
      </template>

      <!-- ── Local source ──────────────────────────────────────────────── -->
      <template v-else-if="draft.type === 'local'">
        <div class="cne-field">
          <label class="cne-label">{{ t('connections.editor.path') }}</label>
          <input
            v-model="draft.localPath"
            class="cne-input mono"
            :placeholder="t('connections.editor.pathPh')"
            spellcheck="false"
          />
          <div class="cne-hint">{{ t('connections.editor.pathHint') }}</div>
        </div>
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
// Source form editor (ADR 0060 P1 + P3) — builds a `SourceConfig`. A top-level
// type selector switches the form between the `mcp` kind (transport + stdio/http +
// health probe) and the `api` kind (baseUrl + REST auth + testEndpoint); `local`
// lands in P4 and shows as a disabled "coming soon" option. The type is locked on
// edit so a source never changes its kind out from under its stored config/secret.
//
// SECRETS. MCP env/header secrets go through LibraryKvEditor's secret-mode
// (`source.setSecret` → `secret:KEY` ref in config). An `api` source authenticates
// with a WRITE-ONLY credential that never enters the config: it is emitted
// alongside the save/verify and persisted via `store.setApiCredential` (injected
// through the parent). The credential fields start BLANK every open (it can't be
// read back) and are OMITTED from the emit when left blank, so an empty submit
// never clobbers an existing keychain credential.
//
// Verify is SAVE-FIRST: `source.test` operates on a persisted source (by slug), so
// the injected `verify` handler saves the draft (+ the credential, so an authed
// api source can authenticate during the probe), then tests it.
import { computed, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import LibraryKvEditor, {
  type KvEntry,
  type KvSecretMode,
} from '~/components/library/LibraryKvEditor.vue'
import type {
  ApiCredentialInput,
  ApiSource,
  ApiSourceBlock,
  LocalSource,
  LocalSourceBlock,
  McpSource,
  McpSourceBlock,
  Source,
  SourceBase,
  SourceInput,
  SourceProbeResult,
  SourceTestOutcome,
  SourceTrust,
} from '~/stores/connections'

// Kinds the form can build.
type EditorSourceType = 'mcp' | 'api' | 'local'
// Transport variants the mcp form edits (sse is folded into http on load).
type EditorTransport = 'http' | 'stdio'
// Auth mode for mcp http/sse sources (mirror of McpSourceBlock.authType).
type EditorAuthType = 'none' | 'bearer' | 'oauth'
// Auth mode for api sources (mirror of ApiSourceBlock.authType).
type ApiAuthType = 'bearer' | 'header' | 'query' | 'basic' | 'oauth' | 'none'
// Single api-key header vs a set of header→value pairs (multi-header credential).
type HeaderMode = 'single' | 'multi'

const props = defineProps<{
  open: boolean
  source: Source | null
  // Injected so the editor never imports the store (SoC). Save-first: persists the
  // draft (+ api credential), then runs `source.test` by slug and resolves it.
  verify: (data: SourceInput, credential?: ApiCredentialInput) => Promise<SourceTestOutcome>
}>()

const emit = defineEmits<{
  save: [source: SourceInput, credential?: ApiCredentialInput]
  cancel: []
}>()

const { t } = useI18n()

const typeOptions = computed<AppSelectOption[]>(() => [
  { value: 'mcp', label: t('connections.type.mcp') },
  { value: 'api', label: t('connections.type.api') },
  { value: 'local', label: t('connections.type.local') },
])
const transportOptions: AppSelectOption[] = [
  { value: 'stdio', label: 'stdio' },
  { value: 'http', label: 'http' },
]
const trustOptions: AppSelectOption[] = [
  { value: 'allow', label: 'allow (auto)' },
  { value: 'prompt', label: 'prompt (approval)' },
  { value: 'deny', label: 'deny' },
]
const testMethodOptions: AppSelectOption[] = [
  { value: 'GET', label: 'GET' },
  { value: 'POST', label: 'POST' },
]

type Draft = {
  type: EditorSourceType
  slug: string
  name: string
  provider: string
  description: string
  icon: string
  tagline: string
  // mcp
  transport: EditorTransport
  authType: EditorAuthType
  command: string
  cwd: string
  url: string
  // api
  apiBaseUrl: string
  apiAuthType: ApiAuthType
  apiHeaderMode: HeaderMode
  apiHeaderName: string
  apiQueryParam: string
  apiAuthScheme: string
  apiTestMethod: 'GET' | 'POST'
  apiTestPath: string
  // local
  localPath: string
  // shared
  enabled: boolean
  timeoutMs: number
  trust: SourceTrust
  deniedTools?: string[]
}

const makeDefaults = (): Draft => ({
  type: 'mcp',
  slug: '',
  name: '',
  provider: '',
  description: '',
  icon: '',
  tagline: '',
  transport: 'stdio',
  authType: 'none',
  command: 'npx',
  cwd: '',
  url: '',
  apiBaseUrl: '',
  apiAuthType: 'bearer',
  apiHeaderMode: 'single',
  apiHeaderName: 'x-api-key',
  apiQueryParam: 'api_key',
  apiAuthScheme: 'Bearer',
  apiTestMethod: 'GET',
  apiTestPath: '',
  localPath: '',
  enabled: true,
  timeoutMs: 30000,
  trust: 'prompt',
})

const fromSource = (s: Source): Draft => {
  const d = makeDefaults()
  d.type = s.type
  d.slug = s.slug
  d.name = s.name
  d.provider = s.provider
  d.description = s.description ?? ''
  d.icon = s.icon ?? ''
  d.tagline = s.tagline ?? ''
  d.enabled = s.enabled
  d.timeoutMs = s.timeoutMs
  d.trust = s.trust
  d.deniedTools = s.deniedTools ? [...s.deniedTools] : undefined
  if (s.type === 'mcp') {
    d.transport = s.mcp.transport === 'stdio' ? 'stdio' : 'http'
    d.authType = s.mcp.authType ?? 'none'
    d.command = s.mcp.command ?? ''
    d.cwd = s.mcp.cwd ?? ''
    d.url = s.mcp.url ?? ''
  } else if (s.type === 'api') {
    d.apiBaseUrl = s.api.baseUrl
    d.apiAuthType = s.api.authType
    d.apiHeaderMode = (s.api.headerNames?.length ?? 0) > 0 ? 'multi' : 'single'
    d.apiHeaderName = s.api.headerName ?? 'x-api-key'
    d.apiQueryParam = s.api.queryParam ?? 'api_key'
    d.apiAuthScheme = s.api.authScheme ?? 'Bearer'
    d.apiTestMethod = s.api.testEndpoint?.method ?? 'GET'
    d.apiTestPath = s.api.testEndpoint?.path ?? ''
  } else if (s.type === 'local') {
    d.localPath = s.local.path
  }
  return d
}

const initDraft = (s: Source | null): Draft => (s ? fromSource(s) : makeDefaults())

const mcpArgsOf = (s: Source | null): string[] =>
  s && s.type === 'mcp' ? (s.mcp.args ?? []) : ['-y', '@modelcontextprotocol/server-filesystem']
const mcpEnvOf = (s: Source | null): Record<string, string> =>
  s && s.type === 'mcp' ? (s.mcp.env ?? {}) : {}
const mcpHeadersOf = (s: Source | null): Record<string, string> =>
  s && s.type === 'mcp' ? (s.mcp.headers ?? {}) : {}
// Api default headers round-trip (non-secret); a multi-header credential's NAMES
// round-trip (values are write-only → always blank on open).
const apiDefaultHeadersOf = (s: Source | null): Record<string, string> =>
  s && s.type === 'api' ? (s.api.defaultHeaders ?? {}) : {}
const apiHeaderNamesOf = (s: Source | null): string[] =>
  s && s.type === 'api' ? (s.api.headerNames ?? []) : []
const apiTestBodyOf = (s: Source | null): string => {
  const body = s && s.type === 'api' ? s.api.testEndpoint?.body : undefined
  return body && Object.keys(body).length > 0 ? JSON.stringify(body, null, 2) : ''
}

const draft = ref<Draft>(initDraft(props.source))
const argsText = ref(mcpArgsOf(props.source).join('\n'))
const envEntries = ref<KvEntry[]>(toEntries(mcpEnvOf(props.source)))
const headerEntries = ref<KvEntry[]>(toEntries(mcpHeadersOf(props.source)))

// Api form working state.
const defaultHeaderEntries = ref<KvEntry[]>(toEntries(apiDefaultHeadersOf(props.source)))
const multiHeaderEntries = ref<KvEntry[]>(namesToEntries(apiHeaderNamesOf(props.source)))
const apiTestBodyText = ref<string>(apiTestBodyOf(props.source))
// Write-only credential inputs — always blank on open (a stored credential is
// never readable), so a non-empty value means the user intends to (over)write.
const credValue = ref('')
const credUsername = ref('')
const credPassword = ref('')

// Optional mcp auth probe (healthCheck): a tool name + JSON args Verify runs after
// the handshake to verify the token actually authenticates.
const healthTool = ref<string>(props.source?.healthCheck?.tool ?? '')
const healthArgsText = ref<string>(healthArgsToText(props.source?.healthCheck?.args))

// Tools detected by the last Verify — populate the mcp health-check picker (a
// source carries no persisted tools list).
const detectedTools = ref<{ name: string; description: string }[]>([])

const verifying = ref(false)
const verifyResult = ref<{ ok: boolean; summary: string; stderr?: string[] } | null>(null)
const verifyProbe = ref<SourceProbeResult | null>(null)

const isExisting = computed(() => !!props.source)

// A new source needs a stable id (`${slug}_${8hex}`) BEFORE save, because
// source.setSecret / setApiCredential key the keychain by id and the saved config
// must reuse the same id. Generated once (frozen) so changing the slug later never
// orphans a stored secret. Existing sources keep their id.
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
const typeSelect = computed<string>({
  get: () => draft.value.type,
  set: (v) => {
    draft.value.type = v as EditorSourceType
  },
})
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
const apiAuthTypeOptions = computed<AppSelectOption[]>(() => [
  { value: 'bearer', label: t('connections.editor.apiAuthBearer') },
  { value: 'header', label: t('connections.editor.apiAuthHeader') },
  { value: 'query', label: t('connections.editor.apiAuthQuery') },
  { value: 'basic', label: t('connections.editor.apiAuthBasic') },
  { value: 'none', label: t('connections.editor.apiAuthNone') },
  { value: 'oauth', label: t('connections.editor.apiAuthOAuth') },
])
const apiAuthTypeSelect = computed<string>({
  get: () => draft.value.apiAuthType,
  set: (v) => {
    draft.value.apiAuthType = v as ApiAuthType
  },
})
const headerModeOptions = computed<AppSelectOption[]>(() => [
  { value: 'single', label: t('connections.editor.headerModeSingle') },
  { value: 'multi', label: t('connections.editor.headerModeMulti') },
])
const headerModeSelect = computed<string>({
  get: () => draft.value.apiHeaderMode,
  set: (v) => {
    draft.value.apiHeaderMode = v as HeaderMode
  },
})
const apiTestMethodSelect = computed<string>({
  get: () => draft.value.apiTestMethod,
  set: (v) => {
    draft.value.apiTestMethod = v as 'GET' | 'POST'
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
    defaultHeaderEntries.value = toEntries(apiDefaultHeadersOf(props.source))
    multiHeaderEntries.value = namesToEntries(apiHeaderNamesOf(props.source))
    apiTestBodyText.value = apiTestBodyOf(props.source)
    credValue.value = ''
    credUsername.value = ''
    credPassword.value = ''
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

// Credential hint — reminds the user a blank field keeps the existing credential.
const credentialHint = computed(() =>
  isExisting.value
    ? t('connections.editor.credentialHintKeep')
    : t('connections.editor.credentialHint'),
)

// mcp auth-probe tool picker: the detected tools (populated after Verify) plus a
// "none" option. The currently-configured tool is kept even if it's not detected.
const hasDetectedTools = computed(() => detectedTools.value.length > 0)
const toolOptions = computed<AppSelectOption[]>(() => {
  const names = new Set(detectedTools.value.map((tool) => tool.name))
  if (healthTool.value) names.add(healthTool.value)
  const opts = [...names].sort().map((n) => ({ value: n, label: n }))
  return [{ value: '', label: t('connections.editor.healthNone') }, ...opts]
})

// Parse a textarea → a JSON object (empty text = {}). Returns null on invalid JSON
// or a non-object so callers can block save/verify. Shared by mcp health args +
// api test body.
function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  if (!trimmed) return {}
  try {
    const value: unknown = JSON.parse(trimmed)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}
const parsedHealthArgs = computed<Record<string, unknown> | null>(() =>
  parseJsonObject(healthArgsText.value),
)
const healthArgsValid = computed(() => !healthTool.value || parsedHealthArgs.value !== null)
const parsedApiTestBody = computed<Record<string, unknown> | null>(() =>
  parseJsonObject(apiTestBodyText.value),
)
const apiTestBodyValid = computed(
  () => draft.value.apiTestMethod !== 'POST' || parsedApiTestBody.value !== null,
)

const canSave = computed(() => {
  if (!draft.value.slug || !draft.value.name.trim()) return false
  if (!/^[a-z0-9][a-z0-9-]*$/.test(draft.value.slug)) return false
  if (draft.value.type === 'mcp') {
    if (draft.value.transport === 'stdio' && !draft.value.command.trim()) return false
    if (draft.value.transport === 'http' && !draft.value.url.trim()) return false
    if (!healthArgsValid.value) return false
  } else if (draft.value.type === 'api') {
    if (!draft.value.apiBaseUrl.trim()) return false
    if (!apiTestBodyValid.value) return false
  } else if (draft.value.type === 'local') {
    if (!draft.value.localPath.trim()) return false
  }
  return true
})

// Verify is save-first, so it works once the draft is valid.
const canVerify = computed(() => canSave.value)

// Build the write-only api credential from the entered fields, or undefined when
// nothing was entered (so an empty submit never clobbers a stored credential).
const buildCredential = (): ApiCredentialInput | undefined => {
  if (draft.value.type !== 'api') return undefined
  const at = draft.value.apiAuthType
  if (at === 'none' || at === 'oauth') return undefined
  if (at === 'basic') {
    const username = credUsername.value.trim()
    const password = credPassword.value
    // The RPC requires BOTH — a partial entry is treated as "no change".
    if (!username || !password) return undefined
    return { mode: 'basic', username, password }
  }
  if (at === 'header' && draft.value.apiHeaderMode === 'multi') {
    const headers: Record<string, string> = {}
    for (const e of multiHeaderEntries.value) {
      if (e.key.trim() && e.value.trim()) headers[e.key.trim()] = e.value
    }
    if (Object.keys(headers).length === 0) return undefined
    return { mode: 'multi-header', headers }
  }
  const value = credValue.value.trim()
  if (!value) return undefined
  return { mode: at, value }
}

// Assemble the mcp `SourceConfig` payload.
const buildMcpPayload = (): McpSource => {
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

  const src: McpSource = { ...baseFields('mcp'), type: 'mcp', mcp }
  const tool = healthTool.value.trim()
  if (tool) {
    const args = parsedHealthArgs.value ?? {}
    src.healthCheck = Object.keys(args).length > 0 ? { tool, args } : { tool }
  }
  return src
}

// Assemble the api `SourceConfig` payload. The credential is NOT part of the
// config — it is emitted separately. Non-form fields (oauth/renewEndpoint/P6
// presets) round-trip via the spread so an edit never drops them.
const buildApiPayload = (): ApiSource => {
  const prevApi = props.source?.type === 'api' ? props.source.api : undefined
  const api: ApiSourceBlock = {
    ...(prevApi ?? {}),
    baseUrl: draft.value.apiBaseUrl.trim(),
    authType: draft.value.apiAuthType,
  }
  // Recompute the form-owned auth fields (clear stale, set current).
  delete api.headerName
  delete api.headerNames
  delete api.queryParam
  delete api.authScheme
  delete api.testEndpoint
  delete api.defaultHeaders

  if (draft.value.apiAuthType === 'header') {
    if (draft.value.apiHeaderMode === 'multi') {
      const names = [...new Set(multiHeaderEntries.value.map((e) => e.key.trim()).filter(Boolean))]
      if (names.length > 0) api.headerNames = names
    } else {
      const hn = draft.value.apiHeaderName.trim()
      if (hn) api.headerName = hn
    }
  } else if (draft.value.apiAuthType === 'query') {
    const qp = draft.value.apiQueryParam.trim()
    if (qp) api.queryParam = qp
  } else if (draft.value.apiAuthType === 'bearer') {
    // '' is meaningful (raw token, no prefix) — store the trimmed scheme as-is.
    api.authScheme = draft.value.apiAuthScheme.trim()
  }

  const testPath = draft.value.apiTestPath.trim()
  if (testPath) {
    const testEndpoint: NonNullable<ApiSourceBlock['testEndpoint']> = {
      method: draft.value.apiTestMethod,
      path: testPath,
    }
    if (draft.value.apiTestMethod === 'POST') {
      const body = parsedApiTestBody.value
      if (body && Object.keys(body).length > 0) testEndpoint.body = body
    }
    api.testEndpoint = testEndpoint
  }

  const defaults = fromEntries(defaultHeaderEntries.value)
  if (Object.keys(defaults).length > 0) api.defaultHeaders = defaults

  return { ...baseFields('api'), type: 'api', api }
}

// Assemble the local `SourceConfig` payload. `format` (if any) round-trips via
// the spread so an edit never drops it.
const buildLocalPayload = (): LocalSource => {
  const prevLocal = props.source?.type === 'local' ? props.source.local : undefined
  const local: LocalSourceBlock = { ...(prevLocal ?? {}), path: draft.value.localPath.trim() }
  return { ...baseFields('local'), type: 'local', local }
}

// Shared base fields for every kind. Persisted last-test status is carried over on
// edit so a save doesn't wipe the last-test result.
function baseFields(type: EditorSourceType): SourceBase {
  const slug = draft.value.slug
  const now = Date.now()
  const base: SourceBase = {
    id: ensureSourceId(),
    slug,
    name: draft.value.name.trim(),
    provider: draft.value.provider.trim() || slug,
    enabled: draft.value.enabled,
    timeoutMs: draft.value.timeoutMs,
    trust: draft.value.trust,
    createdAt: props.source?.createdAt ?? now,
    updatedAt: now,
  }
  if (draft.value.description.trim()) base.description = draft.value.description.trim()
  if (draft.value.icon.trim()) base.icon = draft.value.icon.trim()
  if (draft.value.tagline.trim()) base.tagline = draft.value.tagline.trim()
  // deniedTools only apply to mcp (api has no tool list).
  if (type === 'mcp' && draft.value.deniedTools?.length) {
    base.deniedTools = [...draft.value.deniedTools]
  }
  if (props.source) {
    if (props.source.connectionStatus) base.connectionStatus = props.source.connectionStatus
    if (props.source.isAuthenticated !== undefined)
      base.isAuthenticated = props.source.isAuthenticated
    if (props.source.connectionError) base.connectionError = props.source.connectionError
    if (props.source.lastTestedAt) base.lastTestedAt = props.source.lastTestedAt
  }
  return base
}

const buildPayload = (): SourceInput => {
  if (draft.value.type === 'api') return buildApiPayload()
  if (draft.value.type === 'local') return buildLocalPayload()
  return buildMcpPayload()
}

const onVerify = async () => {
  if (!canVerify.value || verifying.value) return
  verifying.value = true
  verifyResult.value = null
  verifyProbe.value = null
  try {
    const outcome = await props.verify(buildPayload(), buildCredential())
    verifyProbe.value = outcome.probe ?? null
    if (outcome.tools) detectedTools.value = outcome.tools
    if (outcome.ok) {
      verifyResult.value = {
        ok: true,
        summary:
          draft.value.type === 'api'
            ? t('connections.editor.verifyApiOk')
            : t('connections.editor.verifyOk', {
                tools: outcome.tools?.length ?? 0,
                resources: outcome.resources?.length ?? 0,
              }),
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
  emit('save', buildPayload(), buildCredential())
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
// Seed a multi-header credential editor with the persisted header NAMES; values
// are write-only so they start blank (the stored credential can't be read back).
function namesToEntries(names: string[]): KvEntry[] {
  return names.map((key) => ({ key, value: '' }))
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
.cne-grid-te {
  display: grid;
  grid-template-columns: minmax(90px, 0.4fr) 1fr;
  gap: 10px;
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
