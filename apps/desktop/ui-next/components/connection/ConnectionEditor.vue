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
            :value="draft.id"
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
          :secret-mode="draft.id ? { serverId: draft.id } : undefined"
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
        <LibraryKvEditor
          v-model="headerEntries"
          :label="t('connections.editor.headers')"
          :secret-mode="draft.id ? { serverId: draft.id } : undefined"
        />
      </template>

      <div class="cne-grid">
        <button
          type="button"
          class="cne-toggle"
          :class="{ on: draft.enabled }"
          @click="draft.enabled = !draft.enabled"
        >
          <span class="tog2 sm" :class="{ off: !draft.enabled }" />
          {{ t('connections.editor.enabled') }}
        </button>
        <button
          type="button"
          class="cne-toggle"
          :class="{ on: draft.autoStart }"
          @click="draft.autoStart = !draft.autoStart"
        >
          <span class="tog2 sm" :class="{ off: !draft.autoStart }" />
          {{ t('connections.editor.autoStart') }}
        </button>
      </div>

      <!-- verify (stdio only) -->
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
// Connection (MCP) form editor — port of the old UI McpEditor, rendered in
// prototype CSS inside LibraryEntityModal. Slug is locked once the server
// exists (moving id = a new file). Env vars (stdio) / headers (http) use
// LibraryKvEditor in secret-mode so each row can move its value to the OS
// keychain (`mcp.setSecret` → `secret:KEY` placeholder). The Verify button
// runs an ephemeral `mcp.test` handshake (stdio only) and pre-fills detected
// tools/resources into the draft.
import { computed, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import LibraryKvEditor, { type KvEntry } from '~/components/library/LibraryKvEditor.vue'
import type {
  ConnectionTransport,
  ConnectionTrust,
  McpServer,
  McpServerInput,
  McpTestResult,
} from '~/stores/connections'

const props = defineProps<{
  open: boolean
  server: McpServer | null
  // Injected so the editor never imports the store (SoC) — runs an ephemeral
  // `mcp.test` and resolves the probe result.
  test: (data: McpServerInput) => Promise<McpTestResult>
}>()

const emit = defineEmits<{
  save: [server: McpServerInput]
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
  id: string
  name: string
  description: string
  transport: ConnectionTransport
  command: string
  cwd: string
  url: string
  enabled: boolean
  autoStart: boolean
  timeoutMs: number
  trust: ConnectionTrust
  tools: McpServer['tools']
  resources: McpServer['resources']
  deniedTools?: string[]
}

const makeDefaults = (): Draft => ({
  id: '',
  name: '',
  description: '',
  transport: 'stdio',
  command: 'npx',
  cwd: '',
  url: '',
  enabled: true,
  autoStart: true,
  timeoutMs: 30000,
  trust: 'prompt',
  tools: [],
  resources: [],
})

const fromServer = (s: McpServer): Draft => ({
  id: s.id,
  name: s.name,
  description: s.description,
  transport: s.transport === 'sse' ? 'http' : s.transport,
  command: s.command ?? '',
  cwd: s.cwd ?? '',
  url: s.url ?? '',
  enabled: s.enabled,
  autoStart: s.autoStart,
  timeoutMs: s.timeoutMs,
  trust: s.trust,
  tools: [...s.tools],
  resources: [...s.resources],
  deniedTools: s.deniedTools ? [...s.deniedTools] : undefined,
})

const initDraft = (s: McpServer | null): Draft => (s ? fromServer(s) : makeDefaults())

const draft = ref<Draft>(initDraft(props.server))
const argsText = ref(
  (props.server?.args ?? ['-y', '@modelcontextprotocol/server-filesystem']).join('\n'),
)
const envEntries = ref<KvEntry[]>(toEntries(props.server?.env))
const headerEntries = ref<KvEntry[]>(toEntries(props.server?.headers))

const verifying = ref(false)
const verifyResult = ref<{ ok: boolean; summary: string; stderr?: string[] } | null>(null)

const isExisting = computed(() => !!props.server)

// Bridge the union-typed draft fields to AppSelect's string model (mirror of
// AgentEditor's providerSelect pattern).
const transportSelect = computed<string>({
  get: () => draft.value.transport,
  set: (v) => {
    draft.value.transport = v as ConnectionTransport
  },
})
const trustSelect = computed<string>({
  get: () => draft.value.trust,
  set: (v) => {
    draft.value.trust = v as ConnectionTrust
  },
})

// Re-seed every time the modal opens or the target server changes.
watch(
  () => [props.open, props.server] as const,
  ([isOpen]) => {
    if (!isOpen) return
    draft.value = initDraft(props.server)
    argsText.value = (props.server?.args ?? ['-y', '@modelcontextprotocol/server-filesystem']).join(
      '\n',
    )
    envEntries.value = toEntries(props.server?.env)
    headerEntries.value = toEntries(props.server?.headers)
    verifyResult.value = null
  },
)

const onSlugInput = (e: Event) => {
  draft.value.id = (e.target as HTMLInputElement).value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const canSave = computed(() => {
  if (!draft.value.id || !draft.value.name.trim()) return false
  if (!/^[a-z0-9][a-z0-9-]*$/.test(draft.value.id)) return false
  if (draft.value.transport === 'stdio' && !draft.value.command.trim()) return false
  if (draft.value.transport === 'http' && !draft.value.url.trim()) return false
  return true
})

const canVerify = computed(
  () => draft.value.transport === 'stdio' && !!draft.value.command.trim() && !!draft.value.id,
)

// Assemble the config-only payload (runtime fields carried for the test probe;
// the store strips them before the RPC).
const buildPayload = (): McpServerInput => {
  const args = argsText.value.split('\n').filter((x) => x.length > 0)
  const base: McpServerInput = {
    id: draft.value.id,
    name: draft.value.name.trim(),
    description: draft.value.description.trim(),
    transport: draft.value.transport,
    enabled: draft.value.enabled,
    autoStart: draft.value.autoStart,
    timeoutMs: draft.value.timeoutMs,
    trust: draft.value.trust,
    status: props.server?.status ?? 'idle',
    tools: draft.value.tools,
    resources: draft.value.resources,
  }
  if (draft.value.deniedTools?.length) base.deniedTools = [...draft.value.deniedTools]
  if (draft.value.transport === 'stdio') {
    base.command = draft.value.command.trim()
    base.args = args
    if (draft.value.cwd.trim()) base.cwd = draft.value.cwd.trim()
    base.env = fromEntries(envEntries.value)
  } else {
    base.url = draft.value.url.trim()
    base.headers = fromEntries(headerEntries.value)
  }
  return base
}

const onVerify = async () => {
  if (!canVerify.value || verifying.value) return
  verifying.value = true
  verifyResult.value = null
  try {
    const res = await props.test(buildPayload())
    if (res.ok) {
      const tc = res.tools?.length ?? 0
      const rc = res.resources?.length ?? 0
      verifyResult.value = {
        ok: true,
        summary: t('connections.editor.verifyOk', { tools: tc, resources: rc }),
        stderr: res.stderr,
      }
      if (res.tools) draft.value.tools = res.tools
      if (res.resources) draft.value.resources = res.resources
    } else {
      verifyResult.value = {
        ok: false,
        summary: t('connections.editor.verifyFail', { error: res.error ?? '' }),
        stderr: res.stderr,
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
