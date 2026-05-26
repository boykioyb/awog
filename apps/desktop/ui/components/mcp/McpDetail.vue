<template>
  <div class="p-4 md:p-6 max-w-3xl">
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
            class="text-[11px] px-1.5 py-0.5 rounded uppercase"
            :style="{
              background: t.bgInput,
              color: t.textMuted,
              border: `1px solid ${t.border}`,
            }"
          >
            {{ server.transport }}
          </span>
          <span
            class="text-[11px] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
            :style="statusStyle"
          >
            <span class="w-1.5 h-1.5 rounded-full" :style="{ background: statusColor }" />
            {{ server.status }}
          </span>
        </div>
        <div class="text-[13px] leading-relaxed mb-1" :style="{ color: t.text }">
          {{ server.name }}
        </div>
        <div class="text-[12px] leading-relaxed" :style="{ color: t.textMuted }">
          {{ server.description }}
        </div>
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        <button
          v-if="server.enabled"
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          title="Restart"
          @click="ws.restartMCPServer(server.id)"
        >
          <RotateCw :size="13" />
        </button>
        <button
          class="px-3 py-1.5 text-xs rounded inline-flex items-center gap-1.5 transition"
          :style="{ color: t.text, border: `1px solid ${t.borderStrong}` }"
          @click="emit('edit')"
        >
          <Edit3 :size="11" />
          Edit
        </button>
        <button
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          title="Delete"
          @click="emit('delete')"
        >
          <Trash2 :size="13" />
        </button>
      </div>
    </div>

    <!-- Last error banner -->
    <div
      v-if="server.lastError"
      class="rounded p-3 mb-4 text-[12px]"
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
          :value="maskSecret(v)"
          mono
        />
      </div>
      <div v-else class="space-y-2">
        <KeyRow label="url" :value="server.url ?? ''" mono />
        <KeyRow
          v-for="(v, k) in server.headers ?? {}"
          :key="`hdr-${k}`"
          :label="`header.${k}`"
          :value="maskSecret(v)"
          mono
        />
      </div>
      <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <KeyValueCard label="timeoutMs" :value="String(server.timeoutMs)" />
        <KeyValueCard label="trust" :value="server.trust" />
      </div>
    </Section>

    <!-- Tools -->
    <Section :title="`Tools · ${server.tools.length}`">
      <div v-if="server.tools.length === 0" class="text-[11px]" :style="{ color: t.textFaint }">
        Chưa detect được tool — server chưa initialize.
      </div>
      <div v-else class="space-y-1.5">
        <div
          v-for="tool in server.tools"
          :key="tool.name"
          class="flex items-start gap-2.5 p-2.5 rounded"
          :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
        >
          <Wrench :size="11" class="flex-shrink-0 mt-0.5" :style="{ color: t.textDim }" />
          <div class="flex-1 min-w-0">
            <div class="text-[12px] font-mono" :style="{ color: t.text }">{{ tool.name }}</div>
            <div class="text-[11px] mt-0.5" :style="{ color: t.textMuted }">
              {{ tool.description }}
            </div>
          </div>
        </div>
      </div>
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
          <div class="text-[11px] font-mono flex-1 truncate" :style="{ color: t.text }">
            {{ res.uri }}
          </div>
          <div class="text-[10px]" :style="{ color: t.textDim }">{{ res.mime }}</div>
        </div>
      </div>
    </Section>

    <!-- Used by agents -->
    <Section :title="`Used by · ${agentsUsing.length} agents`">
      <div v-if="agentsUsing.length === 0" class="text-[11px]" :style="{ color: t.textFaint }">
        Chưa có agent nào whitelist server này.
      </div>
      <div v-else class="flex flex-wrap gap-1.5">
        <span
          v-for="ag in agentsUsing"
          :key="ag.id"
          class="text-[11px] px-2 py-1 rounded"
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
import { Plug, Edit3, Trash2, RotateCw, Wrench, FileText, AlertCircle } from 'lucide-vue-next'
import type { Agent, MCPServer, MCPStatus } from '~/types'

const props = defineProps<{ server: MCPServer }>()
const emit = defineEmits<{ edit: []; delete: [] }>()

const { t } = useTheme()
const ws = useWorkspaceStore()

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

const maskSecret = (v: string): string =>
  v.replace(/\$\{secret:[^}]+\}/g, '••••••').replace(/Bearer\s+[A-Za-z0-9_-]{8,}/g, 'Bearer ••••••')
</script>
