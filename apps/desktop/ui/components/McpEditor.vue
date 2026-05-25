<template>
  <div class="p-4 md:p-6 max-w-3xl">
    <div class="flex items-center justify-between mb-6">
      <div class="text-sm font-medium" :style="{ color: t.text }">
        {{ server?.id ? 'Edit MCP Server' : 'New MCP Server' }}
      </div>
      <div class="flex gap-2">
        <button class="px-3 py-1.5 text-xs" :style="{ color: t.textMuted }" @click="emit('cancel')">
          Cancel
        </button>
        <button
          class="px-3 py-1.5 text-xs rounded font-medium inline-flex items-center gap-1.5"
          :disabled="!draft.id || !draft.name"
          :style="{
            background: !draft.id || !draft.name ? t.bgInput : t.accent,
            color: !draft.id || !draft.name ? t.textFaint : t.accentText,
          }"
          @click="onSave"
        >
          <Save :size="11" />
          Save
        </button>
      </div>
    </div>

    <div class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="ID (slug)">
          <input
            :value="draft.id"
            placeholder="e.g. gitnexus"
            class="w-full rounded px-2 py-1.5 text-xs font-mono"
            :style="inputStyle"
            @input="(e: Event) => (draft.id = slugify((e.target as HTMLInputElement).value))"
          />
        </Field>
        <Field label="Display name">
          <input
            v-model="draft.name"
            class="w-full rounded px-2 py-1.5 text-xs"
            :style="inputStyle"
          />
        </Field>
      </div>

      <Field label="Description">
        <textarea
          v-model="draft.description"
          :rows="2"
          class="w-full rounded px-2 py-1.5 text-[12px] resize-none"
          :style="inputStyle"
        />
      </Field>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Transport">
          <select
            v-model="draft.transport"
            class="w-full rounded px-2 py-1.5 text-xs"
            :style="inputStyle"
          >
            <option value="stdio">stdio</option>
            <option value="http">http</option>
            <option value="sse">sse</option>
          </select>
        </Field>
        <Field label="Trust">
          <select
            v-model="draft.trust"
            class="w-full rounded px-2 py-1.5 text-xs"
            :style="inputStyle"
          >
            <option value="allow">allow (auto)</option>
            <option value="prompt">prompt (approval)</option>
            <option value="deny">deny</option>
          </select>
        </Field>
        <Field label="Timeout (ms)">
          <input
            v-model.number="draft.timeoutMs"
            type="number"
            class="w-full rounded px-2 py-1.5 text-xs font-mono"
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
            class="w-full rounded px-2 py-1.5 text-xs font-mono"
            :style="inputStyle"
          />
        </Field>
        <Field label="Args (one per line)">
          <textarea
            v-model="argsText"
            :rows="3"
            class="w-full rounded px-2 py-1.5 text-[11px] font-mono resize-none"
            :style="inputStyle"
          />
        </Field>
        <Field label="cwd (optional)">
          <input
            v-model="draft.cwd"
            placeholder="${workspace}"
            class="w-full rounded px-2 py-1.5 text-xs font-mono"
            :style="inputStyle"
          />
        </Field>
        <KvEditor v-model="envEntries" label="Env vars" />
      </div>

      <!-- http config -->
      <div v-else class="space-y-3">
        <Field label="URL">
          <input
            v-model="draft.url"
            placeholder="https://mcp.example.com/v1"
            class="w-full rounded px-2 py-1.5 text-xs font-mono"
            :style="inputStyle"
          />
        </Field>
        <KvEditor v-model="headerEntries" label="Headers" />
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ToggleField v-model="draft.enabled" label="Enabled" />
        <ToggleField v-model="draft.autoStart" label="Auto-start" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Save } from 'lucide-vue-next'
import type { MCPServer, MCPTool, MCPTransport, MCPTrust } from '~/types'
import type { McpDraft } from '~/composables/useMcpGenerator'

const props = defineProps<{ server: MCPServer | null; initialDraft?: McpDraft | null }>()
const emit = defineEmits<{ save: [server: MCPServer]; cancel: [] }>()

const { t } = useTheme()

type Draft = Omit<MCPServer, 'tools' | 'resources' | 'status'> & {
  tools: MCPTool[]
  resources: MCPServer['resources']
  status: MCPServer['status']
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
