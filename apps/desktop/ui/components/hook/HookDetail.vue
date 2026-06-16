<template>
  <div class="p-4 md:p-6 w-full">
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
          <span
            v-if="hook.source && hook.source !== 'global'"
            class="text-[1em] px-1.5 py-0.5 rounded font-mono"
            :style="{
              background: t.bgInput,
              color: isProjectScoped ? t.accent : t.textDim,
              border: `1px solid ${isProjectScoped ? t.accent : t.border}`,
            }"
          >
            {{ sourceLabel }}
          </span>
          <span
            v-if="isImported"
            class="text-[1em] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
            :style="{ background: t.bgInput, color: t.textDim, border: `1px solid ${t.border}` }"
          >
            <Lock :size="10" />
            {{ tr('hooks.detail.imported') }}
          </span>
        </div>
        <div class="text-[1em] leading-relaxed" :style="{ color: t.textMuted }">
          {{ hook.description }}
        </div>
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        <button
          v-if="!isImported"
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          :title="tr('hooks.detail.run_once')"
          @click="ws.runHookOnce(hook)"
        >
          <Play :size="13" />
        </button>
        <button
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          :title="tr('common.edit')"
          @click="emit('edit')"
        >
          <Edit3 :size="13" />
        </button>
        <button
          v-if="!isImported"
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          :title="tr('common.delete')"
          @click="emit('delete')"
        >
          <Trash2 :size="13" />
        </button>
      </div>
    </div>

    <!-- Trust gate (ADR 0032 D-8): a project-tier hook from the repo must be
         explicitly trusted before it can spawn. -->
    <div
      v-if="isProjectScoped && hook.trusted === false"
      class="mb-6 p-3 rounded flex items-start gap-3"
      :style="{ background: t.warningBg, border: `1px solid ${t.warningBorder}` }"
    >
      <ShieldAlert :size="16" :style="{ color: t.warning }" class="flex-shrink-0 mt-0.5" />
      <div class="flex-1 min-w-0">
        <div class="text-[1em] font-medium" :style="{ color: t.warning }">
          {{ tr('hooks.trust.title') }}
        </div>
        <div class="text-[1em] mt-0.5" :style="{ color: t.textMuted }">
          {{
            tr('hooks.trust.desc', { path: isImported ? '.claude/settings.json' : '.awog/hooks' })
          }}
        </div>
        <button
          class="mt-2 px-3 py-1.5 text-[1em] rounded inline-flex items-center gap-1.5 transition"
          :style="{ background: t.warning, color: t.bg }"
          @click="onTrust"
        >
          <ShieldCheck :size="12" />
          {{ tr('hooks.trust.button') }}
        </button>
      </div>
    </div>

    <!-- Quick controls -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
      <ToggleCard
        v-if="!isImported"
        :label="tr('hooks.detail.enabled')"
        :value="hook.enabled"
        @toggle="ws.toggleHook(hook)"
      />
      <KeyValueCard
        v-else
        :label="tr('hooks.detail.source')"
        :value="tr('hooks.detail.readonly_hint', { source: sourceLabel })"
      />
      <KeyValueCard :label="tr('hooks.detail.run_mode')" :value="hook.runMode" />
      <KeyValueCard :label="tr('hooks.detail.timeout')" :value="`${hook.timeoutMs}ms`" />
    </div>

    <!-- Matcher -->
    <Section :title="tr('hooks.detail.matcher')">
      <div
        v-if="Object.keys(hook.matcher).length === 0"
        class="text-[1em]"
        :style="{ color: t.textFaint }"
      >
        {{ tr('hooks.detail.matcher_empty') }}
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
    <Section :title="tr('hooks.detail.command')">
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
        <KeyValueCard :label="tr('hooks.detail.cwd')" :value="hook.cwd" />
        <KeyValueCard
          :label="tr('hooks.detail.env')"
          :value="tr('hooks.detail.env_value', { count: Object.keys(hook.env ?? {}).length })"
        />
      </div>
    </Section>

    <!-- Recent runs -->
    <Section :title="tr('hooks.detail.recent_runs', { count: hook.recentRuns.length })">
      <div v-if="hook.recentRuns.length === 0" class="text-[1em]" :style="{ color: t.textFaint }">
        {{ tr('hooks.detail.no_runs') }}
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
import { Zap, Edit3, Trash2, Play, ShieldAlert, ShieldCheck, Lock } from 'lucide-vue-next'
import type { Hook, HookSource } from '~/types'

const props = defineProps<{ hook: Hook }>()
const emit = defineEmits<{ edit: []; delete: [] }>()

const { t } = useTheme()
const { t: tr } = useI18n()
const ws = useWorkspaceStore()

const isImported = computed(() => props.hook.readOnly === true)
const isProjectScoped = computed(() => props.hook.source === 'project')
const SOURCE_KEY: Record<HookSource, string> = {
  global: 'hooks.source.global',
  project: 'hooks.source.project',
}
const sourceLabel = computed(() => tr(SOURCE_KEY[props.hook.source ?? 'global']))

const onTrust = () => {
  if (props.hook.projectId) ws.trustHooks(props.hook.projectId, [props.hook.id])
}

const modeBadgeStyle = computed(() => ({
  background: props.hook.runMode === 'blocking' ? t.value.warningBg : t.value.bgInput,
  color: props.hook.runMode === 'blocking' ? t.value.warning : t.value.textMuted,
  border: `1px solid ${props.hook.runMode === 'blocking' ? t.value.warningBorder : t.value.border}`,
}))
</script>
