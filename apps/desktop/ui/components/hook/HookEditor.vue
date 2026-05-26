<template>
  <div class="p-4 md:p-6 max-w-3xl">
    <div class="flex items-center justify-between mb-6">
      <div class="text-sm font-medium" :style="{ color: t.text }">
        {{ hook?.id ? 'Edit Hook' : 'New Hook' }}
      </div>
      <div class="flex gap-2">
        <button class="px-3 py-1.5 text-xs" :style="{ color: t.textMuted }" @click="emit('cancel')">
          Cancel
        </button>
        <button
          class="px-3 py-1.5 text-xs rounded font-medium inline-flex items-center gap-1.5"
          :disabled="!draft.name || !draft.command"
          :style="{
            background: !draft.name || !draft.command ? t.bgInput : t.accent,
            color: !draft.name || !draft.command ? t.textFaint : t.accentText,
          }"
          @click="onSave"
        >
          <Save :size="11" />
          Save
        </button>
      </div>
    </div>

    <div class="space-y-4">
      <Field label="Name">
        <input
          v-model="draft.name"
          placeholder="e.g. Prettier on TS files"
          class="w-full rounded px-2 py-1.5 text-xs"
          :style="inputStyle"
        />
      </Field>

      <Field label="Description">
        <textarea
          v-model="draft.description"
          :rows="2"
          class="w-full rounded px-2 py-1.5 text-[12px] resize-none"
          :style="inputStyle"
        />
      </Field>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Event">
          <select
            v-model="draft.event"
            class="w-full rounded px-2 py-1.5 text-xs font-mono"
            :style="inputStyle"
          >
            <option v-for="ev in HOOK_EVENTS" :key="ev" :value="ev">{{ ev }}</option>
          </select>
        </Field>
        <Field label="Run mode">
          <select
            v-model="draft.runMode"
            class="w-full rounded px-2 py-1.5 text-xs"
            :style="inputStyle"
          >
            <option value="blocking">blocking (chờ exit)</option>
            <option value="background">background (fire-and-forget)</option>
          </select>
        </Field>
      </div>

      <KvEditor v-model="matcherEntries" label="Matcher (JSON path → value/glob)" />

      <Field label="Command">
        <textarea
          v-model="draft.command"
          :rows="3"
          placeholder="pnpm exec prettier --write {{event.payload.path}}"
          class="w-full rounded px-2 py-1.5 text-[11px] font-mono leading-relaxed resize-none"
          :style="inputStyle"
        />
      </Field>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="cwd">
          <input
            v-model="draft.cwd"
            placeholder="${workspace}"
            class="w-full rounded px-2 py-1.5 text-xs font-mono"
            :style="inputStyle"
          />
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

      <KvEditor v-model="envEntries" label="Env vars" />

      <ToggleField v-model="draft.enabled" label="Enabled" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Save } from 'lucide-vue-next'
import type { Hook, HookEvent, HookRunMode } from '~/types'
import type { HookDraft } from '~/composables/useHookGenerator'

const HOOK_EVENTS: HookEvent[] = [
  'task.before-start',
  'task.after-complete',
  'phase.before-run',
  'phase.after-run',
  'phase.before-approve',
  'phase.after-approve',
  'artifact.before-write',
  'artifact.after-write',
  'agent.before-prompt',
  'agent.after-response',
  'tool.before-call',
  'tool.after-call',
  'mcp.server-error',
  'session.reset',
]

const props = defineProps<{ hook: Hook | null; initialDraft?: HookDraft | null }>()
const emit = defineEmits<{ save: [hook: Hook]; cancel: [] }>()

const { t } = useTheme()

type Draft = Omit<Hook, 'recentRuns'> & { recentRuns: Hook['recentRuns'] }

const makeDefaults = (): Draft => ({
  id: '',
  name: '',
  description: '',
  event: 'artifact.after-write' as HookEvent,
  matcher: {},
  command: '',
  // eslint-disable-next-line no-template-curly-in-string
  cwd: '${workspace}',
  timeoutMs: 30000,
  runMode: 'background' as HookRunMode,
  enabled: true,
  env: {},
  recentRuns: [],
})

const cloneDraft = (d: HookDraft): Draft => ({
  ...d,
  matcher: { ...d.matcher },
  env: { ...(d.env ?? {}) },
  recentRuns: [...d.recentRuns],
})

const initDraft = (h: Hook | null, seed: HookDraft | null | undefined): Draft => {
  if (h) {
    return {
      ...h,
      matcher: { ...h.matcher },
      env: { ...(h.env ?? {}) },
      recentRuns: [...h.recentRuns],
    }
  }
  return seed ? cloneDraft(seed) : makeDefaults()
}

const draft = ref<Draft>(initDraft(props.hook, props.initialDraft))

const matcherEntries = ref<Array<{ key: string; value: string }>>(
  Object.entries(draft.value.matcher).map(([key, value]) => ({ key, value })),
)
watch(
  matcherEntries,
  (entries) => {
    draft.value.matcher = Object.fromEntries(
      entries.filter((e) => e.key.length > 0).map((e) => [e.key, e.value]),
    )
  },
  { deep: true },
)

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

watch(
  () => props.hook,
  (h) => {
    draft.value = initDraft(h, props.initialDraft)
    matcherEntries.value = Object.entries(draft.value.matcher).map(([key, value]) => ({
      key,
      value,
    }))
    envEntries.value = Object.entries(draft.value.env ?? {}).map(([key, value]) => ({
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

const onSave = () => {
  if (!draft.value.name || !draft.value.command) return
  emit('save', { ...draft.value } as Hook)
}
</script>
