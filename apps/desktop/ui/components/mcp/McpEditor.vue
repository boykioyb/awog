<template>
  <EditorShell
    :title="server?.id ? tr('connections.editor.edit_title') : tr('connections.editor.new_title')"
    :dirty="dirty"
    :can-save="!!draft.id && !!draft.name"
    @save="onSave"
    @cancel="emit('cancel')"
  >
    <div class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="ID (slug)">
          <input
            :value="draft.id"
            placeholder="e.g. gitnexus"
            class="w-full rounded px-2 py-1.5 text-[1em] font-mono"
            :style="inputStyle"
            @input="(e: Event) => (draft.id = slugify((e.target as HTMLInputElement).value))"
          />
        </Field>
        <Field label="Display name">
          <input
            v-model="draft.name"
            class="w-full rounded px-2 py-1.5 text-[1em]"
            :style="inputStyle"
          />
        </Field>
      </div>

      <Field label="Description">
        <textarea
          v-model="draft.description"
          :rows="2"
          class="w-full rounded px-2 py-1.5 text-[1em] resize-y min-h-[3rem]"
          :style="inputStyle"
        />
      </Field>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Transport">
          <AppSelect v-model="draft.transport">
            <option value="stdio">stdio</option>
            <option value="http">http</option>
            <option value="sse">sse</option>
          </AppSelect>
        </Field>
        <Field label="Trust">
          <AppSelect v-model="draft.trust">
            <option value="allow">allow (auto)</option>
            <option value="prompt">prompt (approval)</option>
            <option value="deny">deny</option>
          </AppSelect>
        </Field>
        <Field label="Timeout (ms)">
          <input
            v-model.number="draft.timeoutMs"
            type="number"
            class="w-full rounded px-2 py-1.5 text-[1em] font-mono"
            :style="inputStyle"
          />
        </Field>
      </div>

      <!-- stdio config -->
      <div v-if="draft.transport === 'stdio'" class="space-y-3">
        <Field label="Command">
          <input
            v-model="draft.command"
            placeholder="npx, uvx, /path/to/bin"
            class="w-full rounded px-2 py-1.5 text-[1em] font-mono"
            :style="inputStyle"
          />
        </Field>
        <Field label="Args (one per line)">
          <textarea
            v-model="argsText"
            :rows="3"
            class="w-full rounded px-2 py-1.5 text-[1em] font-mono resize-y min-h-[4rem]"
            :style="inputStyle"
          />
        </Field>
        <Field label="cwd (optional)">
          <input
            v-model="draft.cwd"
            placeholder="${workspace}"
            class="w-full rounded px-2 py-1.5 text-[1em] font-mono"
            :style="inputStyle"
          />
        </Field>
        <KvEditor
          v-model="envEntries"
          label="Env vars"
          :secret-mode="draft.id ? { serverId: draft.id } : undefined"
        />
      </div>

      <!-- http config -->
      <div v-else class="space-y-3">
        <Field label="URL">
          <input
            v-model="draft.url"
            placeholder="https://mcp.example.com/v1"
            class="w-full rounded px-2 py-1.5 text-[1em] font-mono"
            :style="inputStyle"
          />
        </Field>
        <KvEditor
          v-model="headerEntries"
          label="Headers"
          :secret-mode="draft.id ? { serverId: draft.id } : undefined"
        />
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ToggleField v-model="draft.enabled" label="Enabled" />
        <ToggleField v-model="draft.autoStart" label="Auto-start" />
      </div>

      <div class="flex items-center gap-2 pt-2" :style="{ borderTop: `1px solid ${t.border}` }">
        <button
          class="inline-flex items-center gap-1.5 px-2.5 py-1 text-[1em] rounded font-medium transition disabled:opacity-50"
          :style="{
            background: t.bgInput,
            color: t.text,
            border: `1px solid ${t.border}`,
          }"
          :disabled="!canVerify || verifying"
          @click="onVerify"
        >
          <Loader2 v-if="verifying" :size="11" class="animate-spin" />
          <CheckCircle2 v-else :size="11" />
          {{ verifying ? 'Testing…' : 'Verify connection' }}
        </button>
        <span v-if="verifyResult" class="text-[1em]" :style="{ color: verifyTextColor }">
          {{ verifyResult.summary }}
        </span>
      </div>
      <pre
        v-if="verifyResult && verifyResult.stderr && verifyResult.stderr.length > 0"
        class="text-[1em] font-mono p-2 rounded max-h-32 overflow-y-auto"
        :style="{ background: t.bgInput, color: t.textDim, border: `1px solid ${t.border}` }"
        >{{ verifyResult.stderr.join('\n') }}</pre
      >
    </div>
  </EditorShell>
</template>

<script setup lang="ts">
import { Loader2, CheckCircle2 } from 'lucide-vue-next'
import type { MCPServer, MCPTool, MCPTransport, MCPTrust, MCPResource } from '~/types'
import type { McpDraft } from '~/composables/useMcpGenerator'

const props = defineProps<{ server: MCPServer | null; initialDraft?: McpDraft | null }>()
const emit = defineEmits<{ save: [server: MCPServer]; cancel: [] }>()

const { t } = useTheme()
const { t: tr } = useI18n()

interface VerifyState {
  ok: boolean
  summary: string
  stderr?: string[]
}

interface VerifyResponse {
  ok: boolean
  tools?: MCPTool[]
  resources?: MCPResource[]
  error?: string
  stderr?: string[]
}

type Draft = Omit<MCPServer, 'tools' | 'resources' | 'status'> & {
  tools: MCPTool[]
  resources: MCPServer['resources']
  status: MCPServer['status']
}

const RUNTIME_KEYS: ReadonlyArray<keyof MCPServer> = ['status', 'tools', 'resources', 'lastError']

// Mirror of stripRuntimeFields in stores/workspace.ts — keep config-only shape
// for `mcp.test` (sidecar zod schema rejects runtime fields).
const stripRuntime = (
  d: Draft,
): Omit<MCPServer, 'status' | 'tools' | 'resources' | 'lastError'> => {
  const entries = (Object.keys(d) as Array<keyof MCPServer>)
    .filter((k) => !RUNTIME_KEYS.includes(k))
    .map((k) => [k, (d as MCPServer)[k]] as const)
  return Object.fromEntries(entries) as Omit<
    MCPServer,
    'status' | 'tools' | 'resources' | 'lastError'
  >
}

const makeDefaults = (): Draft => ({
  id: '',
  name: '',
  description: '',
  transport: 'stdio' as MCPTransport,
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem'],
  env: {},
  cwd: '',
  url: '',
  headers: {},
  enabled: true,
  autoStart: true,
  timeoutMs: 30000,
  trust: 'prompt' as MCPTrust,
  status: 'idle',
  tools: [],
  resources: [],
})

const cloneDraft = (d: McpDraft): Draft => ({
  ...d,
  args: [...(d.args ?? [])],
  env: { ...(d.env ?? {}) },
  headers: { ...(d.headers ?? {}) },
  tools: [...d.tools],
  resources: [...d.resources],
})

const initDraft = (s: MCPServer | null, seed: McpDraft | null | undefined): Draft => {
  if (s) {
    return {
      ...s,
      args: [...(s.args ?? [])],
      env: { ...(s.env ?? {}) },
      headers: { ...(s.headers ?? {}) },
      tools: [...s.tools],
      resources: [...s.resources],
    }
  }
  return seed ? cloneDraft(seed) : makeDefaults()
}

const draft = ref<Draft>(initDraft(props.server, props.initialDraft))
const original = ref<Draft>(initDraft(props.server, props.initialDraft))

const verifying = ref(false)
const verifyResult = ref<VerifyState | null>(null)

const canVerify = computed(
  () => draft.value.transport === 'stdio' && !!draft.value.command && !!draft.value.id,
)

const verifyTextColor = computed(() => (verifyResult.value?.ok ? t.value.success : t.value.danger))

const onVerify = async () => {
  if (!canVerify.value) return
  verifying.value = true
  verifyResult.value = null
  try {
    const sidecar = useSidecar()
    if (!sidecar.available) {
      verifyResult.value = { ok: false, summary: 'Sidecar offline — cannot verify' }
      return
    }
    const res = await sidecar.request<VerifyResponse>('mcp.test', {
      server: stripRuntime(draft.value),
    })
    if (res.ok) {
      const toolCount = res.tools?.length ?? 0
      const resCount = res.resources?.length ?? 0
      verifyResult.value = {
        ok: true,
        summary: `Connected — ${toolCount} tool${toolCount === 1 ? '' : 's'}, ${resCount} resource${resCount === 1 ? '' : 's'}`,
        stderr: res.stderr,
      }
      if (res.tools) draft.value.tools = res.tools
      if (res.resources) draft.value.resources = res.resources
    } else {
      verifyResult.value = {
        ok: false,
        summary: `Failed — ${res.error ?? 'unknown error'}`,
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

const argsText = ref((draft.value.args ?? []).join('\n'))
watch(argsText, (v) => {
  draft.value.args = v.split('\n').filter((x) => x.length > 0)
})

const envEntries = ref<Array<{ key: string; value: string }>>(
  Object.entries(draft.value.env ?? {}).map(([key, value]) => ({ key, value })),
)
watch(
  envEntries,
  (entries) => {
    draft.value.env = Object.fromEntries(
      entries.filter((e) => e.key.length > 0).map((e) => [e.key, e.value]),
    )
  },
  { deep: true },
)

const headerEntries = ref<Array<{ key: string; value: string }>>(
  Object.entries(draft.value.headers ?? {}).map(([key, value]) => ({ key, value })),
)
watch(
  headerEntries,
  (entries) => {
    draft.value.headers = Object.fromEntries(
      entries.filter((e) => e.key.length > 0).map((e) => [e.key, e.value]),
    )
  },
  { deep: true },
)

watch(
  () => props.server,
  (s) => {
    draft.value = initDraft(s, props.initialDraft)
    original.value = initDraft(s, props.initialDraft)
    argsText.value = (draft.value.args ?? []).join('\n')
    envEntries.value = Object.entries(draft.value.env ?? {}).map(([key, value]) => ({
      key,
      value,
    }))
    headerEntries.value = Object.entries(draft.value.headers ?? {}).map(([key, value]) => ({
      key,
      value,
    }))
  },
)

const inputStyle = computed(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none',
}))

const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(original.value))

const slugify = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')

const onSave = () => {
  if (!draft.value.id || !draft.value.name) return
  emit('save', { ...draft.value } as MCPServer)
}
</script>
