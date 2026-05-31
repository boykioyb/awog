<template>
  <div class="p-4 md:p-6 max-w-3xl">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-start gap-3 mb-6">
      <div
        class="w-10 h-10 rounded flex items-center justify-center"
        :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
      >
        <Zap :size="18" :style="{ color: t.textMuted }" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1 flex-wrap">
          <h1 class="text-lg font-semibold" :style="{ color: t.text }">{{ hook.name }}</h1>
          <span
            class="text-[1em] px-1.5 py-0.5 rounded font-mono"
            :style="{
              background: t.bgInput,
              color: t.textMuted,
              border: `1px solid ${t.border}`,
            }"
          >
            {{ hook.event }}
          </span>
          <span class="text-[1em] px-1.5 py-0.5 rounded uppercase" :style="modeBadgeStyle">
            {{ hook.runMode }}
          </span>
        </div>
        <div class="text-[1em] leading-relaxed" :style="{ color: t.textMuted }">
          {{ hook.description }}
        </div>
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        <button
          class="px-3 py-1.5 text-[1em] rounded inline-flex items-center gap-1.5 transition"
          :style="{ color: t.text, border: `1px solid ${t.borderStrong}` }"
          @click="ws.runHookOnce(hook.id)"
        >
          <Play :size="11" />
          Run once
        </button>
        <button
          class="px-3 py-1.5 text-[1em] rounded inline-flex items-center gap-1.5 transition"
          :style="{ color: t.text, border: `1px solid ${t.borderStrong}` }"
          @click="emit('edit')"
        >
          <Edit3 :size="11" />
          Edit
        </button>
        <button
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          @click="emit('delete')"
        >
          <Trash2 :size="13" />
        </button>
      </div>
    </div>

    <!-- Quick controls -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
      <ToggleCard label="Enabled" :value="hook.enabled" @toggle="ws.toggleHook(hook.id)" />
      <KeyValueCard label="Run mode" :value="hook.runMode" />
      <KeyValueCard label="Timeout" :value="`${hook.timeoutMs}ms`" />
    </div>

    <!-- Matcher -->
    <Section title="Matcher">
      <div
        v-if="Object.keys(hook.matcher).length === 0"
        class="text-[1em]"
        :style="{ color: t.textFaint }"
      >
        Không có filter — chạy cho mọi payload của event này.
      </div>
      <div v-else class="space-y-1.5">
        <KeyRow
          v-for="(value, key) in hook.matcher"
          :key="String(key)"
          :label="String(key)"
          :value="String(value)"
          mono
        />
      </div>
    </Section>

    <!-- Command -->
    <Section title="Command">
      <pre
        class="text-[1em] font-mono whitespace-pre-wrap leading-relaxed p-3 rounded"
        :style="{
          color: t.textMuted,
          background: t.bgInput,
          border: `1px solid ${t.border}`,
          margin: 0,
        }"
        >{{ hook.command }}</pre
      >
      <div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <KeyValueCard label="cwd" :value="hook.cwd" />
        <KeyValueCard label="env" :value="`${Object.keys(hook.env ?? {}).length} vars`" />
      </div>
    </Section>

    <!-- Recent runs -->
    <Section :title="`Recent runs · ${hook.recentRuns.length}`">
      <div v-if="hook.recentRuns.length === 0" class="text-[1em]" :style="{ color: t.textFaint }">
        Chưa chạy lần nào.
      </div>
      <div v-else class="space-y-1">
        <div
          v-for="(run, i) in hook.recentRuns"
          :key="i"
          class="flex items-center gap-3 p-2 rounded text-[1em] flex-wrap"
          :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
        >
          <span
            class="w-1.5 h-1.5 rounded-full flex-shrink-0"
            :style="{ background: run.exitCode === 0 ? '#22c55e' : '#ef4444' }"
          />
          <span class="font-mono" :style="{ color: t.text, minWidth: '50px' }">
            {{ run.exitCode === 0 ? 'OK' : `EXIT ${run.exitCode}` }}
          </span>
          <span :style="{ color: t.textDim, minWidth: '80px' }">{{ run.durationMs }}ms</span>
          <span v-if="run.stderr" class="flex-1 truncate font-mono" :style="{ color: t.danger }">
            {{ run.stderr }}
          </span>
          <span v-else class="flex-1" />
          <span :style="{ color: t.textDim }">{{ run.at }}</span>
        </div>
      </div>
    </Section>
  </div>
</template>

<script setup lang="ts">
import { Zap, Edit3, Trash2, Play } from 'lucide-vue-next'
import type { Hook } from '~/types'

const props = defineProps<{ hook: Hook }>()
const emit = defineEmits<{ edit: []; delete: [] }>()

const { t } = useTheme()
const ws = useWorkspaceStore()

const modeBadgeStyle = computed(() => ({
  background: props.hook.runMode === 'blocking' ? t.value.warningBg : t.value.bgInput,
  color: props.hook.runMode === 'blocking' ? t.value.warning : t.value.textMuted,
  border: `1px solid ${props.hook.runMode === 'blocking' ? t.value.warningBorder : t.value.border}`,
}))
</script>
