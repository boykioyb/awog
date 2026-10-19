<template>
  <LibraryEntityModal
    :open="open"
    :title="isExisting ? t('connections.editor.editTitle') : t('connections.editor.newTitle')"
    :width="640"
    @close="emit('cancel')"
  >
    <div class="flex flex-col gap-4">
      <!-- Preset setup hint — shown only when a catalog provider seeded this new
           form (never on edit). Provider-specific guidance from the catalog. -->
      <div
        v-if="setupHint && !isExisting"
        class="flex items-start gap-2 rounded-md border border-primary bg-selected px-3 py-2.5 text-foreground"
      >
        <Icon name="bulb" class="size-3.5 flex-none" />
        <div class="flex flex-col gap-0.5 text-sm">
          <span class="font-semibold">{{ t('connections.editor.setupTitle') }}</span>
          <span>{{ setupHint }}</span>
        </div>
      </div>

      <!-- top-level source type: switches the whole form (mcp vs api). Locked on
           edit — changing an existing source's kind would orphan its config. -->
      <div class="flex flex-col gap-1.5">
        <Label class="text-sm font-medium text-foreground">
          {{ t('connections.editor.sourceType') }}
        </Label>
        <AppSelect
          v-model="typeSelect"
          :options="typeOptions"
          :disabled="isExisting"
          width="100%"
        />
      </div>

      <div class="grid grid-cols-2 gap-3.5">
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">
            {{ t('connections.editor.slug') }}
          </Label>
          <Input
            :model-value="draft.slug"
            placeholder="e.g. github"
            spellcheck="false"
            class="font-mono"
            @update:model-value="onSlugInput"
          />
          <div class="text-xs text-muted-foreground">
            {{
              isExisting ? t('connections.editor.slugRenameHint') : t('connections.editor.slugHint')
            }}
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">
            {{ t('connections.editor.name') }}
          </Label>
          <Input v-model="draft.name" :placeholder="t('connections.editor.namePh')" />
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <Label class="text-sm font-medium text-foreground">
          {{ t('connections.editor.description') }}
        </Label>
        <Textarea
          v-model="draft.description"
          class="min-h-12 resize-y"
          rows="2"
          :placeholder="t('connections.editor.descPh')"
        />
      </div>

      <div class="grid grid-cols-2 gap-3.5">
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">
            {{ t('connections.editor.icon') }}
          </Label>
          <Input
            v-model="draft.icon"
            :placeholder="t('connections.editor.iconPh')"
            spellcheck="false"
          />
          <div class="text-xs text-muted-foreground">{{ t('connections.editor.iconHint') }}</div>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">
            {{ t('connections.editor.tagline') }}
          </Label>
          <Input v-model="draft.tagline" :placeholder="t('connections.editor.taglinePh')" />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3.5">
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">
            {{ t('connections.editor.trust') }}
          </Label>
          <AppSelect v-model="trustSelect" :options="trustOptions" width="100%" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">
            {{ t('connections.editor.timeout') }}
          </Label>
          <Input v-model.number="draft.timeoutMs" type="number" class="font-mono" />
        </div>
      </div>

      <!-- ── MCP source ────────────────────────────────────────────────── -->
      <template v-if="draft.type === 'mcp'">
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">
            {{ t('connections.editor.transport') }}
          </Label>
          <AppSelect v-model="transportSelect" :options="transportOptions" width="100%" />
        </div>

        <!-- stdio config -->
        <template v-if="draft.transport === 'stdio'">
          <div class="flex flex-col gap-1.5">
            <Label class="text-sm font-medium text-foreground">
              {{ t('connections.editor.command') }}
            </Label>
            <Input v-model="draft.command" placeholder="npx, uvx, /path/to/bin" class="font-mono" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label class="text-sm font-medium text-foreground">
              {{ t('connections.editor.args') }}
            </Label>
            <Textarea
              v-model="argsText"
              class="min-h-12 resize-y font-mono"
              rows="3"
              :placeholder="t('connections.editor.argsPh')"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label class="text-sm font-medium text-foreground">
              {{ t('connections.editor.cwd') }}
            </Label>
            <Input
              v-model="draft.cwd"
              :placeholder="t('connections.editor.cwdPh')"
              class="font-mono"
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
          <div class="flex flex-col gap-1.5">
            <Label class="text-sm font-medium text-foreground">
              {{ t('connections.editor.url') }}
            </Label>
            <Input v-model="draft.url" placeholder="https://mcp.example.com/v1" class="font-mono" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label class="text-sm font-medium text-foreground">
              {{ t('connections.editor.authType') }}
            </Label>
            <AppSelect v-model="authTypeSelect" :options="authTypeOptions" width="100%" />
            <div class="text-xs text-muted-foreground">
              {{ t('connections.editor.authTypeHint') }}
            </div>
          </div>
          <!-- Bearer: a single Token field — the user pastes only the token and
               AWOG sends `Authorization: Bearer <token>` (the scheme is added at
               the send layer). 'none': raw header rows for custom auth. 'oauth':
               tokens come from the sign-in flow (Connect on the detail pane). -->
          <div v-if="draft.authType === 'bearer'" class="flex flex-col gap-1.5">
            <Label class="text-sm font-medium text-foreground">
              {{ t('connections.editor.credentialToken') }}
            </Label>
            <Input
              v-model="mcpBearerToken"
              type="password"
              :placeholder="t('connections.editor.mcpBearerPh')"
              spellcheck="false"
              autocomplete="off"
              class="font-mono"
            />
            <div class="text-xs text-muted-foreground">{{ mcpBearerHint }}</div>
          </div>
          <LibraryKvEditor
            v-else-if="draft.authType !== 'oauth'"
            v-model="headerEntries"
            :label="t('connections.editor.headers')"
            :secret-mode="secretMode"
          />
          <template v-else>
            <div class="text-xs text-muted-foreground">
              {{ t('connections.editor.oauthHeadersNote') }}
            </div>
            <!-- BYO OAuth app creds — chỉ cần khi provider không có Dynamic
                 Client Registration (Slack): user tự đăng ký app rồi nhập
                 client_id/secret. Provider có DCR (Linear, Notion) bỏ trống. -->
            <div class="flex flex-col gap-1.5">
              <Label class="text-sm font-medium text-foreground">
                {{ t('connections.editor.oauthClientId') }}
              </Label>
              <Input
                v-model="oauthClientId"
                :placeholder="t('connections.editor.oauthClientIdPh')"
                spellcheck="false"
                class="font-mono"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <Label class="text-sm font-medium text-foreground">
                {{ t('connections.editor.oauthClientSecret') }}
              </Label>
              <Input
                v-model="oauthClientSecret"
                type="password"
                :placeholder="t('connections.editor.oauthClientSecretPh')"
                spellcheck="false"
                autocomplete="off"
                class="font-mono"
              />
              <div class="text-xs text-muted-foreground">{{ oauthClientSecretHint }}</div>
            </div>
          </template>
        </template>

        <!-- auth probe (optional) — Verify calls this tool after the handshake to
             check the token actually authenticates (handshake alone never does). -->
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">
            {{ t('connections.editor.healthCheck') }}
          </Label>
          <div class="text-xs text-muted-foreground">{{ t('connections.editor.healthHint') }}</div>
          <AppSelect
            v-if="hasDetectedTools"
            v-model="healthTool"
            :options="toolOptions"
            width="100%"
          />
          <Input
            v-else
            v-model="healthTool"
            :placeholder="t('connections.editor.healthToolPh')"
            spellcheck="false"
            class="font-mono"
          />
          <template v-if="healthTool">
            <Textarea
              v-model="healthArgsText"
              class="min-h-12 resize-y font-mono"
              rows="3"
              :placeholder="t('connections.editor.healthArgsPh')"
            />
            <div v-if="!healthArgsValid" class="text-xs text-destructive">
              {{ t('connections.editor.healthArgsInvalid') }}
            </div>
          </template>
        </div>
      </template>

      <!-- ── API source ────────────────────────────────────────────────── -->
      <template v-else-if="draft.type === 'api'">
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">
            {{ t('connections.editor.baseUrl') }}
          </Label>
          <Input
            v-model="draft.apiBaseUrl"
            placeholder="https://api.example.com/"
            spellcheck="false"
            class="font-mono"
          />
          <div class="text-xs text-muted-foreground">{{ t('connections.editor.baseUrlHint') }}</div>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">
            {{ t('connections.editor.authType') }}
          </Label>
          <AppSelect v-model="apiAuthTypeSelect" :options="apiAuthTypeOptions" width="100%" />
          <div v-if="draft.apiAuthType === 'oauth'" class="text-xs text-muted-foreground">
            {{ t('connections.editor.apiOAuthNote') }}
          </div>
        </div>

        <!-- auth-dependent config + credential entry -->
        <template v-if="draft.apiAuthType === 'bearer'">
          <div class="flex flex-col gap-1.5">
            <Label class="text-sm font-medium text-foreground">
              {{ t('connections.editor.authScheme') }}
            </Label>
            <Input v-model="draft.apiAuthScheme" placeholder="Bearer" class="font-mono" />
            <div class="text-xs text-muted-foreground">
              {{ t('connections.editor.authSchemeHint') }}
            </div>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label class="text-sm font-medium text-foreground">
              {{ t('connections.editor.credentialToken') }}
            </Label>
            <Input
              v-model="credValue"
              type="password"
              :placeholder="t('connections.editor.credentialTokenPh')"
              spellcheck="false"
              autocomplete="off"
              class="font-mono"
            />
            <div class="text-xs text-muted-foreground">{{ credentialHint }}</div>
          </div>
        </template>

        <template v-else-if="draft.apiAuthType === 'header'">
          <div class="flex flex-col gap-1.5">
            <Label class="text-sm font-medium text-foreground">
              {{ t('connections.editor.headerMode') }}
            </Label>
            <AppSelect v-model="headerModeSelect" :options="headerModeOptions" width="100%" />
          </div>
          <template v-if="draft.apiHeaderMode === 'single'">
            <div class="flex flex-col gap-1.5">
              <Label class="text-sm font-medium text-foreground">
                {{ t('connections.editor.headerName') }}
              </Label>
              <Input
                v-model="draft.apiHeaderName"
                :placeholder="t('connections.editor.headerNamePh')"
                spellcheck="false"
                class="font-mono"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <Label class="text-sm font-medium text-foreground">
                {{ t('connections.editor.credentialApiKey') }}
              </Label>
              <Input
                v-model="credValue"
                type="password"
                :placeholder="t('connections.editor.credentialApiKeyPh')"
                spellcheck="false"
                autocomplete="off"
                class="font-mono"
              />
              <div class="text-xs text-muted-foreground">{{ credentialHint }}</div>
            </div>
          </template>
          <template v-else>
            <LibraryKvEditor
              v-model="multiHeaderEntries"
              :label="t('connections.editor.multiHeaders')"
            />
            <div class="text-xs text-muted-foreground">{{ credentialHint }}</div>
          </template>
        </template>

        <template v-else-if="draft.apiAuthType === 'query'">
          <div class="flex flex-col gap-1.5">
            <Label class="text-sm font-medium text-foreground">
              {{ t('connections.editor.queryParam') }}
            </Label>
            <Input
              v-model="draft.apiQueryParam"
              :placeholder="t('connections.editor.queryParamPh')"
              spellcheck="false"
              class="font-mono"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label class="text-sm font-medium text-foreground">
              {{ t('connections.editor.credentialApiKey') }}
            </Label>
            <Input
              v-model="credValue"
              type="password"
              :placeholder="t('connections.editor.credentialApiKeyPh')"
              spellcheck="false"
              autocomplete="off"
              class="font-mono"
            />
            <div class="text-xs text-muted-foreground">{{ credentialHint }}</div>
          </div>
        </template>

        <template v-else-if="draft.apiAuthType === 'basic'">
          <div class="grid grid-cols-2 gap-3.5">
            <div class="flex flex-col gap-1.5">
              <Label class="text-sm font-medium text-foreground">
                {{ t('connections.editor.credentialUsername') }}
              </Label>
              <Input
                v-model="credUsername"
                spellcheck="false"
                autocomplete="off"
                class="font-mono"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <Label class="text-sm font-medium text-foreground">
                {{ t('connections.editor.credentialPassword') }}
              </Label>
              <Input
                v-model="credPassword"
                type="password"
                spellcheck="false"
                autocomplete="off"
                class="font-mono"
              />
            </div>
          </div>
          <div class="text-xs text-muted-foreground">{{ credentialHint }}</div>
        </template>

        <!-- optional default headers sent on every request (non-secret) -->
        <LibraryKvEditor
          v-model="defaultHeaderEntries"
          :label="t('connections.editor.defaultHeaders')"
        />

        <!-- test endpoint sub-form — used by Verify to check the credential -->
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">
            {{ t('connections.editor.testEndpoint') }}
          </Label>
          <div class="text-xs text-muted-foreground">
            {{ t('connections.editor.testEndpointHint') }}
          </div>
          <div class="grid grid-cols-[minmax(5.625rem,0.4fr)_1fr] gap-2.5">
            <AppSelect v-model="apiTestMethodSelect" :options="testMethodOptions" width="100%" />
            <Input
              v-model="draft.apiTestPath"
              :placeholder="t('connections.editor.testPathPh')"
              spellcheck="false"
              class="font-mono"
            />
          </div>
          <template v-if="draft.apiTestMethod === 'POST'">
            <Textarea
              v-model="apiTestBodyText"
              class="min-h-12 resize-y font-mono"
              rows="3"
              :placeholder="t('connections.editor.testBodyPh')"
            />
            <div v-if="!apiTestBodyValid" class="text-xs text-destructive">
              {{ t('connections.editor.testBodyInvalid') }}
            </div>
          </template>
        </div>
      </template>

      <!-- ── Local source ──────────────────────────────────────────────── -->
      <template v-else-if="draft.type === 'local'">
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">
            {{ t('connections.editor.path') }}
          </Label>
          <Input
            v-model="draft.localPath"
            :placeholder="t('connections.editor.pathPh')"
            spellcheck="false"
            class="font-mono"
          />
          <div class="text-xs text-muted-foreground">{{ t('connections.editor.pathHint') }}</div>
        </div>
      </template>

      <!-- Cả hàng là nhãn của Switch: bấm chữ cũng lật công tắc. -->
      <Label
        class="cursor-pointer gap-2 rounded-md border bg-card px-3 py-2 text-sm leading-normal font-normal"
        :class="draft.enabled ? 'text-foreground' : 'text-muted-foreground'"
      >
        <Switch v-model:checked="draft.enabled" />
        {{ t('connections.editor.enabled') }}
      </Label>

      <!-- verify (save-first: source.test operates on the persisted source) -->
      <div class="flex items-center gap-2.5 border-t pt-1">
        <Button
          :disabled="!canVerify || verifying"
          variant="outline"
          size="sm"
          class="[&_svg]:size-3"
          @click="onVerify"
        >
          <Icon :name="verifying ? 'refresh' : 'check'" :class="verifying && 'animate-spin'" />
          {{ verifying ? t('connections.editor.testing') : t('connections.editor.verify') }}
        </Button>
        <span
          v-if="verifyResult"
          class="text-sm"
          :class="verifyResult.ok ? 'text-success' : 'text-destructive'"
        >
          {{ verifyResult.summary }}
        </span>
      </div>
      <div
        v-if="verifyProbe"
        class="-mt-1.5 flex items-center gap-1.5 text-sm [&_svg]:size-3 [&_svg]:flex-none"
        :class="verifyProbe.ok ? 'text-success' : 'text-destructive'"
      >
        <Icon :name="verifyProbe.ok ? 'check' : 'alert'" />
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
      <!-- Preview mode: the actual data the probe tool returned, so the user can
           confirm the token yields real content (not just a non-error). JSON ⇒ mono. -->
      <Collapsible v-if="verifyProbe?.ok && verifyProbe.preview">
        <CollapsibleTrigger
          class="cursor-pointer py-0.5 text-xs text-muted-foreground select-none hover:text-foreground"
        >
          {{ t('connections.editor.probePreview', { tool: verifyProbe.tool }) }}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre
            class="mt-1.5 max-h-56 overflow-y-auto rounded-md border bg-muted px-2.5 py-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground"
            >{{ verifyProbe.preview }}</pre
          >
        </CollapsibleContent>
      </Collapsible>
      <pre
        v-if="verifyResult?.stderr?.length"
        class="max-h-32 overflow-y-auto rounded-md border bg-muted px-2.5 py-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground"
        >{{ verifyResult.stderr.join('\n') }}</pre
      >
    </div>

    <template #footer>
      <Button
        v-if="isExisting"
        :title="t('connections.editor.refineAiHint')"
        class="[&_svg]:size-3.5"
        variant="outline"
        @click="emit('refine-ai')"
      >
        <Icon name="sparkles" />
        {{ t('connections.editor.refineAi') }}
      </Button>
      <span class="flex-1" />
      <Button variant="outline" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
      <Button :disabled="!canSave" variant="default" @click="onSave">
        {{ t('connections.editor.save') }}
      </Button>
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
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
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
  // Preset draft that PREFILLS the form for a NEW connection (UI-parity area 3).
  // Distinct from `source` (the edit target): a seed keeps the source "new"
  // (editable slug, generated id) while pre-filling every field from a catalog
  // provider. `source` wins when both are set (edit path). null → a blank form.
  seed?: Source | null
  // One line of provider-specific guidance shown as a banner when a preset seeded
  // the form (from the catalog meta). Empty/absent → no banner.
  setupHint?: string
  // Injected so the editor never imports the store (SoC). Save-first: persists the
  // draft (+ api credential), then runs `source.test` by slug and resolves it.
  verify: (data: SourceInput, credential?: ApiCredentialInput) => Promise<SourceTestOutcome>
}>()

const emit = defineEmits<{
  save: [source: SourceInput, credential?: ApiCredentialInput]
  cancel: []
  // Hand the current (existing) source off to the chat creator to refine with AI.
  'refine-ai': []
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

// The source that PREFILLS the form: the edit target (`source`) wins; else the
// preset `seed` (a new source). Used for every field seed below + the re-seed
// watch. `isExisting` still keys off `source` alone, so a seeded preset stays new.
const seedOf = (): Source | null => props.source ?? props.seed ?? null

const draft = ref<Draft>(initDraft(seedOf()))
const argsText = ref(mcpArgsOf(seedOf()).join('\n'))
const envEntries = ref<KvEntry[]>(toEntries(mcpEnvOf(seedOf())))
const headerEntries = ref<KvEntry[]>(toEntries(mcpHeadersOf(seedOf())))

// Api form working state.
const defaultHeaderEntries = ref<KvEntry[]>(toEntries(apiDefaultHeadersOf(seedOf())))
const multiHeaderEntries = ref<KvEntry[]>(namesToEntries(apiHeaderNamesOf(seedOf())))
const apiTestBodyText = ref<string>(apiTestBodyOf(seedOf()))
// Write-only credential inputs — always blank on open (a stored credential is
// never readable), so a non-empty value means the user intends to (over)write.
const credValue = ref('')
const credUsername = ref('')
const credPassword = ref('')

// Write-only bearer token for an mcp http/sse source (mirrors the api `credValue`
// pattern): blank on open, a non-empty value overwrites, blank keeps the stored
// token. Stored as the BARE token in `headers.Authorization`; the `Bearer ` scheme
// is added at the send layer (sidecar applyBearerScheme).
const mcpBearerToken = ref('')

// BYO OAuth app creds for providers without Dynamic Client Registration (Slack —
// "MCP clients must be backed by a registered Slack app"). clientId is public
// config → seeds from the source and round-trips; clientSecret follows the
// bearer pattern (write-only, blank keeps the stored keychain ref).
const mcpClientIdOf = (s: Source | null): string =>
  s && s.type === 'mcp' ? (s.mcp.clientId ?? '') : ''
const oauthClientId = ref<string>(mcpClientIdOf(seedOf()))
const oauthClientSecret = ref('')

// Optional mcp auth probe (healthCheck): a tool name + JSON args Verify runs after
// the handshake to verify the token actually authenticates.
const healthTool = ref<string>(seedOf()?.healthCheck?.tool ?? '')
const healthArgsText = ref<string>(healthArgsToText(seedOf()?.healthCheck?.args))

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

// Re-seed every time the modal opens, the target source changes, or a preset seed
// changes (start-from-scratch vs pick-a-provider both open the same editor).
watch(
  () => [props.open, props.source, props.seed] as const,
  ([isOpen]) => {
    if (!isOpen) return
    const seed = seedOf()
    draft.value = initDraft(seed)
    argsText.value = mcpArgsOf(seed).join('\n')
    envEntries.value = toEntries(mcpEnvOf(seed))
    headerEntries.value = toEntries(mcpHeadersOf(seed))
    defaultHeaderEntries.value = toEntries(apiDefaultHeadersOf(seed))
    multiHeaderEntries.value = namesToEntries(apiHeaderNamesOf(seed))
    apiTestBodyText.value = apiTestBodyOf(seed)
    credValue.value = ''
    credUsername.value = ''
    credPassword.value = ''
    oauthClientId.value = mcpClientIdOf(seed)
    oauthClientSecret.value = ''
    healthTool.value = seed?.healthCheck?.tool ?? ''
    healthArgsText.value = healthArgsToText(seed?.healthCheck?.args)
    detectedTools.value = []
    verifyResult.value = null
    verifyProbe.value = null
    generatedId.value = null
  },
)

const onSlugInput = (v: string) => {
  draft.value.slug = v
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

// Bearer token hint: "keep" variant when a token is already stored on this source.
const mcpBearerStored = computed(
  () => props.source?.type === 'mcp' && !!props.source.mcp.headers?.Authorization,
)
const mcpBearerHint = computed(() =>
  mcpBearerStored.value
    ? t('connections.editor.mcpBearerHintKeep')
    : t('connections.editor.mcpBearerHint'),
)

// Same "blank keeps" hint for the OAuth client secret (write-only field).
const oauthClientSecretStored = computed(
  () => props.source?.type === 'mcp' && !!props.source.mcp.clientSecret,
)
const oauthClientSecretHint = computed(() =>
  oauthClientSecretStored.value
    ? t('connections.editor.oauthClientSecretHintKeep')
    : t('connections.editor.oauthClientSecretHint'),
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
    if (draft.value.authType === 'bearer') {
      // Store the BARE token (strip any scheme the user pasted out of habit); the
      // `Bearer ` prefix is added at the send layer. A typed value overwrites; a
      // blank field on an existing source keeps the stored token untouched.
      const typed = mcpBearerToken.value.trim().replace(/^bearer\s+/i, '')
      if (typed) {
        mcp.headers = { Authorization: typed }
      } else if (props.source?.type === 'mcp' && props.source.mcp.headers?.Authorization) {
        mcp.headers = { Authorization: props.source.mcp.headers.Authorization }
      }
    } else if (draft.value.authType !== 'oauth') {
      // None / custom auth: raw header rows. OAuth tokens come from the sign-in
      // flow, not manual header rows.
      const headers = fromEntries(headerEntries.value)
      if (Object.keys(headers).length > 0) mcp.headers = headers
    }
    // OAuth client identity: a typed value wins (BYO app — Slack); blank keeps
    // the stored one so a DCR-registered or previously saved id/secret is never
    // silently dropped. clientSecret plaintext is keychainized by saveSource —
    // config persists only `secret:OAUTH_CLIENT_SECRET`.
    if (draft.value.authType === 'oauth') {
      const cid = oauthClientId.value.trim()
      if (cid) mcp.clientId = cid
      const csec = oauthClientSecret.value.trim()
      if (csec) mcp.clientSecret = csec
    }
    if (props.source?.type === 'mcp') {
      if (!mcp.clientId && props.source.mcp.clientId) mcp.clientId = props.source.mcp.clientId
      if (!mcp.clientSecret && props.source.mcp.clientSecret) {
        mcp.clientSecret = props.source.mcp.clientSecret
      }
      // Round-trip fields the form doesn't own (e.g. oauthParams.user_scope).
      if (props.source.mcp.oauthParams) mcp.oauthParams = props.source.mcp.oauthParams
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
