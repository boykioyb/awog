<template>
  <div class="flex-1 overflow-y-auto p-4 md:p-6 w-full">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-start gap-3 mb-6">
      <div
        class="w-10 h-10 rounded flex items-center justify-center"
        :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
      >
        <Plug :size="18" :style="{ color: t.textMuted }" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1 flex-wrap">
          <h1 class="text-lg font-mono font-semibold" :style="{ color: t.text }">
            {{ server.id }}
          </h1>
          <span
            class="text-[1em] px-1.5 py-0.5 rounded uppercase"
            :style="{
              background: t.bgInput,
              color: t.textMuted,
              border: `1px solid ${t.border}`,
            }"
          >
            {{ server.transport }}
          </span>
          <span
            class="text-[1em] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
            :style="statusStyle"
          >
            <span class="w-1.5 h-1.5 rounded-full" :style="{ background: statusColor }" />
            {{ server.status }}
          </span>
        </div>
        <div class="text-[1em] leading-relaxed mb-1" :style="{ color: t.text }">
          {{ server.name }}
        </div>
        <div class="text-[1em] leading-relaxed" :style="{ color: t.textMuted }">
          {{ server.description }}
        </div>
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        <button
          class="p-1.5 rounded transition disabled:opacity-50"
          :style="{ color: t.textDim }"
          :disabled="testing"
          :title="testing ? 'Testing…' : 'Test connection (spawn ephemeral MCP handshake)'"
          @click="onTest"
          @mouseenter="
            (e: MouseEvent) => {
              if (testing) return
              const el = e.currentTarget as HTMLElement
              el.style.background = t.bgHover
              el.style.color = t.text
            }
          "
          @mouseleave="
            (e: MouseEvent) => {
              const el = e.currentTarget as HTMLElement
              el.style.background = 'transparent'
              el.style.color = t.textDim
            }
          "
        >
          <Loader2 v-if="testing" :size="13" class="animate-spin" />
          <CheckCircle2 v-else :size="13" />
        </button>
        <button
          v-if="server.enabled"
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          title="Restart server"
          @click="ws.restartMCPServer(server.id)"
          @mouseenter="
            (e: MouseEvent) => {
              const el = e.currentTarget as HTMLElement
              el.style.background = t.bgHover
              el.style.color = t.text
            }
          "
          @mouseleave="
            (e: MouseEvent) => {
              const el = e.currentTarget as HTMLElement
              el.style.background = 'transparent'
              el.style.color = t.textDim
            }
          "
        >
          <RotateCw :size="13" />
        </button>
        <button
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          title="Edit"
          @click="emit('edit')"
          @mouseenter="
            (e: MouseEvent) => {
              const el = e.currentTarget as HTMLElement
              el.style.background = t.bgHover
              el.style.color = t.text
            }
          "
          @mouseleave="
            (e: MouseEvent) => {
              const el = e.currentTarget as HTMLElement
              el.style.background = 'transparent'
              el.style.color = t.textDim
            }
          "
        >
          <Edit3 :size="13" />
        </button>
        <button
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          title="Delete server"
          @click="emit('delete')"
          @mouseenter="
            (e: MouseEvent) => {
              const el = e.currentTarget as HTMLElement
              el.style.background = t.dangerBg
              el.style.color = t.danger
            }
          "
          @mouseleave="
            (e: MouseEvent) => {
              const el = e.currentTarget as HTMLElement
              el.style.background = 'transparent'
              el.style.color = t.textDim
            }
          "
        >
          <Trash2 :size="13" />
        </button>
      </div>
    </div>

    <!-- Test result banner -->
    <div v-if="testResult" class="rounded p-3 mb-4 text-[1em]" :style="testBannerStyle">
      <div class="flex items-start gap-2">
        <component
          :is="testResult.ok ? CheckCircle2 : AlertCircle"
          :size="13"
          class="flex-shrink-0 mt-0.5"
        />
        <div class="flex-1 min-w-0">
          <div class="font-medium mb-0.5">
            {{ testResult.ok ? 'Connection OK' : 'Connection failed' }}
          </div>
          <div class="font-mono break-words">{{ testResult.summary }}</div>
          <pre
            v-if="testResult.stderr && testResult.stderr.length > 0"
            class="text-[1em] font-mono mt-2 p-2 rounded max-h-28 overflow-y-auto"
            :style="{ background: t.bgPanel, color: t.textDim }"
            >{{ testResult.stderr.join('\n') }}</pre
          >
        </div>
      </div>
    </div>

    <!-- Last error banner -->
    <div
      v-if="server.lastError"
      class="rounded p-3 mb-4 text-[1em]"
      :style="{
        background: t.dangerBg,
        border: `1px solid ${t.dangerBorder}`,
        color: t.danger,
      }"
    >
      <div class="flex items-start gap-2">
        <AlertCircle :size="13" class="flex-shrink-0 mt-0.5" />
        <div>
          <div class="font-medium mb-0.5">Last error</div>
          <div class="font-mono">{{ server.lastError }}</div>
        </div>
      </div>
    </div>

    <!-- Quick controls -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
      <ToggleCard label="Enabled" :value="server.enabled" @toggle="ws.toggleMCPServer(server.id)" />
      <KeyValueCard label="Auto-start" :value="server.autoStart ? 'on' : 'on-demand'" />
      <KeyValueCard label="Trust" :value="server.trust" />
    </div>

    <!-- Configuration -->
    <Section title="Configuration">
      <div v-if="server.transport === 'stdio'" class="space-y-2">
        <KeyRow label="command" :value="server.command ?? ''" mono />
        <KeyRow label="args" :value="(server.args ?? []).join(' ')" mono />
        <KeyRow v-if="server.cwd" label="cwd" :value="server.cwd" mono />
        <KeyRow
          v-for="(v, k) in server.env ?? {}"
          :key="`env-${k}`"
          :label="`env.${k}`"
          :value="maskSecret(k, v)"
          mono
        />
      </div>
      <div v-else class="space-y-2">
        <KeyRow label="url" :value="server.url ?? ''" mono />
        <KeyRow
          v-for="(v, k) in server.headers ?? {}"
          :key="`hdr-${k}`"
          :label="`header.${k}`"
          :value="maskSecret(k, v)"
          mono
        />
      </div>
      <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <KeyValueCard label="timeoutMs" :value="String(server.timeoutMs)" />
        <KeyValueCard label="trust" :value="server.trust" />
      </div>
    </Section>

    <!-- Tools -->
    <Section :title="toolsSectionTitle">
      <div v-if="server.tools.length === 0" class="text-[1em]" :style="{ color: t.textFaint }">
        Chưa detect được tool — server chưa initialize.
      </div>
      <template v-else>
        <div class="mb-2 flex items-center gap-2">
          <div
            class="flex-1 flex items-center gap-2 rounded px-2 py-1.5"
            :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
          >
            <Search :size="11" :style="{ color: t.textDim }" />
            <input
              v-model="toolFilter"
              type="text"
              placeholder="Filter tools by name or description…"
              class="flex-1 bg-transparent text-[1em] outline-none"
              :style="{ color: t.text }"
            />
            <button
              v-if="toolFilter"
              type="button"
              class="text-[1em]"
              :style="{ color: t.textDim }"
              @click="toolFilter = ''"
            >
              clear
            </button>
          </div>
        </div>

        <div
          v-if="filteredTools.length === 0"
          class="text-[1em] py-2"
          :style="{ color: t.textFaint }"
        >
          Không có tool nào khớp filter.
        </div>

        <div v-else class="space-y-1.5">
          <div
            v-for="tool in filteredTools"
            :key="tool.name"
            class="flex items-start gap-2.5 p-2.5 rounded transition"
            :style="{
              background: t.bgElevated,
              border: `1px solid ${isToolDenied(tool.name) ? t.dangerBorder : t.border}`,
              opacity: isToolDenied(tool.name) ? 0.6 : 1,
            }"
          >
            <Wrench
              :size="11"
              class="flex-shrink-0 mt-0.5"
              :style="{ color: isToolDenied(tool.name) ? t.danger : t.textDim }"
            />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <div class="text-[1em] font-mono truncate" :style="{ color: t.text }">
                  {{ tool.name }}
                </div>
                <span
                  v-if="isToolDenied(tool.name)"
                  class="text-[1em] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded"
                  :style="{
                    background: t.dangerBg,
                    color: t.danger,
                    border: `1px solid ${t.dangerBorder}`,
                  }"
                >
                  denied
                </span>
              </div>
              <div class="text-[1em] mt-0.5" :style="{ color: t.textMuted }">
                {{ tool.description }}
              </div>
            </div>
            <button
              type="button"
              class="flex-shrink-0 p-1.5 rounded transition"
              :style="{
                background: isToolDenied(tool.name) ? t.dangerBg : 'transparent',
                color: isToolDenied(tool.name) ? t.danger : t.textDim,
                border: `1px solid ${isToolDenied(tool.name) ? t.dangerBorder : t.border}`,
              }"
              :title="isToolDenied(tool.name) ? 'Allow this tool' : 'Deny this tool'"
              @click="onToggleToolDeny(tool.name)"
            >
              <ShieldOff v-if="isToolDenied(tool.name)" :size="12" />
              <Shield v-else :size="12" />
            </button>
          </div>
        </div>
      </template>
    </Section>

    <!-- Resources -->
    <Section v-if="server.resources.length > 0" :title="`Resources · ${server.resources.length}`">
      <div class="space-y-1.5">
        <div
          v-for="res in server.resources"
          :key="res.uri"
          class="flex items-center gap-2.5 p-2 rounded"
          :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
        >
          <FileText :size="11" :style="{ color: t.textDim }" />
          <div class="text-[1em] font-mono flex-1 truncate" :style="{ color: t.text }">
            {{ res.uri }}
          </div>
          <div class="text-[1em]" :style="{ color: t.textDim }">{{ res.mime }}</div>
        </div>
      </div>
    </Section>

    <!-- Logs (stderr ring buffer) -->
    <Section v-if="stderrLines.length > 0" :title="`Logs · ${stderrLines.length} line(s)`">
      <pre
        class="text-[1em] font-mono p-2.5 rounded max-h-48 overflow-y-auto"
        :style="{ background: t.bgElevated, color: t.textDim, border: `1px solid ${t.border}` }"
        >{{ stderrLines.join('\n') }}</pre
      >
    </Section>

    <!-- Used by agents -->
    <Section :title="`Used by · ${agentsUsing.length} agents`">
      <div v-if="agentsUsing.length === 0" class="text-[1em]" :style="{ color: t.textFaint }">
        Chưa có agent nào whitelist server này.
      </div>
      <div v-else class="flex flex-wrap gap-1.5">
        <span
          v-for="ag in agentsUsing"
          :key="ag.id"
          class="text-[1em] px-2 py-1 rounded"
          :style="{
            background: t.bgInput,
            color: t.text,
            border: `1px solid ${t.border}`,
          }"
        >
          {{ ag.name }}
        </span>
      </div>
    </Section>
  </div>
</template>

<script setup lang="ts">
import {
  Plug,
  Edit3,
  Trash2,
  RotateCw,
  Wrench,
  FileText,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Search,
  Shield,
  ShieldOff,
} from 'lucide-vue-next'
import type { Agent, MCPServer, MCPStatus, MCPTool, MCPResource } from '~/types'

const props = defineProps<{ server: MCPServer }>()
const emit = defineEmits<{ edit: []; delete: [] }>()

const { t } = useTheme()
const ws = useWorkspaceStore()

interface TestResult {
  ok: boolean
  summary: string
  stderr?: string[]
}

interface TestResponse {
  ok: boolean
  tools?: MCPTool[]
  resources?: MCPResource[]
  error?: string
  stderr?: string[]
}

const testing = ref(false)
const testResult = ref<TestResult | null>(null)

const stderrLines = computed<string[]>(() => ws.mcpStderr[props.server.id] ?? [])

const testBannerStyle = computed(() => {
  const ok = testResult.value?.ok ?? false
  return ok
    ? { background: t.value.infoBg, color: t.value.info, border: `1px solid ${t.value.infoBorder}` }
    : {
        background: t.value.dangerBg,
        color: t.value.danger,
        border: `1px solid ${t.value.dangerBorder}`,
      }
})

const RUNTIME_KEYS = ['status', 'tools', 'resources', 'lastError'] as const

function stripRuntime(
  s: MCPServer,
): Omit<MCPServer, 'status' | 'tools' | 'resources' | 'lastError'> {
  const entries = (Object.keys(s) as Array<keyof MCPServer>)
    .filter((k) => !(RUNTIME_KEYS as readonly string[]).includes(k))
    .map((k) => [k, s[k]] as const)
  return Object.fromEntries(entries) as Omit<
    MCPServer,
    'status' | 'tools' | 'resources' | 'lastError'
  >
}

const onTest = async () => {
  testing.value = true
  testResult.value = null
  try {
    const sidecar = useSidecar()
    if (!sidecar.available) {
      testResult.value = { ok: false, summary: 'Sidecar offline — cannot test' }
      return
    }
    const res = await sidecar.request<TestResponse>('mcp.test', {
      server: stripRuntime(props.server),
    })
    if (res.ok) {
      const tCount = res.tools?.length ?? 0
      const rCount = res.resources?.length ?? 0
      testResult.value = {
        ok: true,
        summary: `${tCount} tool${tCount === 1 ? '' : 's'} · ${rCount} resource${rCount === 1 ? '' : 's'}`,
        stderr: res.stderr,
      }
    } else {
      testResult.value = {
        ok: false,
        summary: res.error ?? 'unknown error',
        stderr: res.stderr,
      }
    }
  } catch (err) {
    testResult.value = {
      ok: false,
      summary: err instanceof Error ? err.message : 'test failed',
    }
  } finally {
    testing.value = false
  }
}

const statusColor = computed<string>(() => {
  const map: Record<MCPStatus, string> = {
    running: '#22c55e',
    starting: '#f59e0b',
    idle: '#737373',
    error: '#ef4444',
    disabled: '#404040',
  }
  return map[props.server.status]
})

const statusStyle = computed(() => ({
  background: t.value.bgInput,
  color: t.value.textMuted,
  border: `1px solid ${t.value.border}`,
}))

const agentsUsing = computed<Agent[]>(() =>
  ws.agents.filter((a) => a.context.includes(props.server.id)),
)

const toolFilter = ref('')

const filteredTools = computed<MCPTool[]>(() => {
  const q = toolFilter.value.trim().toLowerCase()
  if (!q) return props.server.tools
  return props.server.tools.filter(
    (tool) => tool.name.toLowerCase().includes(q) || tool.description.toLowerCase().includes(q),
  )
})

const deniedCount = computed<number>(() => props.server.deniedTools?.length ?? 0)

const toolsSectionTitle = computed<string>(() => {
  const total = props.server.tools.length
  const denied = deniedCount.value
  if (denied === 0) return `Tools · ${total}`
  return `Tools · ${total} (${denied} denied)`
})

const isToolDenied = (name: string): boolean => props.server.deniedTools?.includes(name) ?? false

const onToggleToolDeny = async (name: string) => {
  try {
    await ws.toggleMCPToolDeny(props.server.id, name)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[mcp] toggle tool deny failed', err)
  }
}

// Mask values whose key looks like a secret (token / key / password / pat /
// secret / auth). We keep the last 4 chars so the user can tell which token
// is configured, but never reveal enough to leak. Empty values stay as '—'.
const SECRET_KEY_RE = /(token|secret|password|passwd|pwd|api[_-]?key|access[_-]?key|pat|auth)/i

const maskSecret = (key: string, raw: string): string => {
  if (!raw) return ''
  // Inline placeholder + Bearer still get masked regardless of key name.
  let v = raw
    .replace(/\$\{secret:[^}]+\}/g, '••••••')
    .replace(/Bearer\s+[A-Za-z0-9_-]{8,}/g, 'Bearer ••••••')
  if (SECRET_KEY_RE.test(key)) {
    if (v.length <= 4) {
      v = '•'.repeat(v.length)
    } else {
      v = `${'•'.repeat(Math.min(8, v.length - 4))}${v.slice(-4)}`
    }
  }
  return v
}
</script>
