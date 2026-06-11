<template>
  <EditorShell
    :title="hook?.id ? tr('hooks.editor.edit_title') : tr('hooks.editor.new_title')"
    :dirty="dirty"
    :can-save="!!draft.name && !!draft.command"
    @save="onSave"
    @cancel="emit('cancel')"
  >
    <template #header-actions-extra>
      <button
        class="px-3 py-1.5 text-[1em] rounded inline-flex items-center gap-1.5 transition"
        :style="{ color: t.textMuted, border: `1px solid ${t.border}` }"
        @click="openConfigLlm"
      >
        <Sparkles :size="11" />
        {{ tr('hooks.editor.edit_llm') }}
      </button>
    </template>

    <div class="space-y-4">
      <Field :label="tr('hooks.editor.save_location')">
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="opt in sourceOptions"
            :key="opt.value"
            type="button"
            :disabled="isExistingHook"
            class="text-[1em] px-2 py-1 rounded font-mono transition"
            :style="sourceButtonStyle(opt.value === draft.source)"
            @click="draft.source = opt.value"
          >
            {{ tr(opt.labelKey) }}
          </button>
        </div>
        <div v-if="draft.source === 'project'" class="mt-2">
          <AppSelect v-model="draft.projectId" :disabled="isExistingHook">
            <option value="" disabled>{{ tr('hooks.editor.pick_project') }}</option>
            <option v-for="p in ws.projects" :key="p.id" :value="p.id">
              {{ p.name }} ({{ p.path }})
            </option>
          </AppSelect>
        </div>
        <div class="text-[1em] mt-1.5" :style="{ color: t.textDim }">{{ sourceHint }}</div>
      </Field>

      <Field v-if="!isImported" :label="tr('hooks.editor.name')">
        <input
          v-model="draft.name"
          :placeholder="tr('hooks.editor.name_placeholder')"
          class="w-full rounded px-2 py-1.5 text-[1em]"
          :style="inputStyle"
        />
      </Field>

      <Field v-if="!isImported" :label="tr('hooks.editor.description')">
        <textarea
          v-model="draft.description"
          :rows="2"
          class="w-full rounded px-2 py-1.5 text-[1em] resize-y min-h-[3rem]"
          :style="inputStyle"
        />
      </Field>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field :label="tr('hooks.editor.event')">
          <AppSelect v-model="draft.event" mono :disabled="isImported">
            <option v-for="ev in HOOK_EVENTS" :key="ev" :value="ev">{{ ev }}</option>
          </AppSelect>
        </Field>
        <Field :label="tr('hooks.editor.run_mode')">
          <AppSelect v-model="draft.runMode" :disabled="isImported">
            <option value="blocking">{{ tr('hooks.editor.run_mode_blocking') }}</option>
            <option value="background">{{ tr('hooks.editor.run_mode_background') }}</option>
          </AppSelect>
        </Field>
      </div>

      <KvEditor v-model="matcherEntries" :label="tr('hooks.editor.matcher')" />

      <Field :label="tr('hooks.editor.command')">
        <textarea
          v-model="draft.command"
          :rows="3"
          placeholder="pnpm exec prettier --write {{event.payload.path}}"
          class="w-full rounded px-2 py-1.5 text-[1em] font-mono leading-relaxed resize-y min-h-[4rem]"
          :style="inputStyle"
        />
      </Field>

      <!-- Script file the command runs (e.g. format-after-edit.sh) — edit its
           contents inline. Shown only when the command references a script in a
           recognised hook dir. -->
      <Field v-if="script" :label="tr('hooks.editor.script', { path: script.path })">
        <div class="flex justify-end mb-1.5">
          <button
            class="text-[1em] inline-flex items-center gap-1 px-2 py-0.5 rounded transition"
            :style="{ color: t.textMuted, border: `1px solid ${t.border}` }"
            :title="tr('hooks.editor.script_edit_llm')"
            @click="openScriptLlm"
          >
            <Sparkles :size="10" />
            {{ tr('hooks.editor.script_edit_llm') }}
          </button>
        </div>
        <textarea
          v-model="script.content"
          :rows="14"
          class="w-full rounded px-2 py-1.5 text-[1em] font-mono leading-relaxed resize-y min-h-[16rem]"
          :style="inputStyle"
        />
        <div v-if="!script.exists" class="text-[1em] mt-1" :style="{ color: t.textDim }">
          {{ tr('hooks.editor.script_new') }}
        </div>
      </Field>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field v-if="!isImported" :label="tr('hooks.editor.cwd')">
          <input
            v-model="draft.cwd"
            placeholder="${workspace}"
            class="w-full rounded px-2 py-1.5 text-[1em] font-mono"
            :style="inputStyle"
          />
        </Field>
        <Field :label="tr('hooks.editor.timeout')">
          <input
            v-model.number="draft.timeoutMs"
            type="number"
            class="w-full rounded px-2 py-1.5 text-[1em] font-mono"
            :style="inputStyle"
          />
        </Field>
      </div>

      <KvEditor v-if="!isImported" v-model="envEntries" :label="tr('hooks.editor.env')" />

      <ToggleField v-if="!isImported" v-model="draft.enabled" :label="tr('hooks.editor.enabled')" />
    </div>
  </EditorShell>

  <HookConfigEditModal
    v-if="configLlm"
    :hook="draft as Hook"
    :anchor="configLlmAnchor"
    @apply="onApplyConfig"
    @cancel="configLlm = false"
  />
  <HookScriptEditModal
    v-if="scriptLlm && script"
    :path="script.path"
    :command="draft.command"
    :current-content="script.content"
    :anchor="scriptLlmAnchor"
    @apply="onApplyScript"
    @cancel="scriptLlm = false"
  />
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { Sparkles } from 'lucide-vue-next'
import type { Hook, HookEvent, HookRunMode, HookSource } from '~/types'
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
const { t: tr } = useI18n()
const ws = useWorkspaceStore()

// projectId/source are required (non-undefined) on the draft so the AppSelect /
// button picker bind cleanly; onSave strips projectId for the global tier.
type Draft = Omit<Hook, 'recentRuns' | 'projectId' | 'source'> & {
  recentRuns: Hook['recentRuns']
  source: HookSource
  projectId: string
}

// Save-location picker (ADR 0032 D-3): global (~/.awog/hooks) or project
// ({project}/.awog/hooks). Tier can't be moved on an existing hook.
const sourceOptions: { value: HookSource; labelKey: string }[] = [
  { value: 'global', labelKey: 'hooks.editor.source_global' },
  { value: 'project', labelKey: 'hooks.editor.source_project' },
]
const isExistingHook = computed(() => !!props.hook?.id)
// Imported (claude-*) hook: only command/matcher/timeout are editable; save
// patches the Claude Code settings.json entry.
const isImported = computed(() => props.hook?.readOnly === true)

const makeDefaults = (): Draft => ({
  id: '',
  name: '',
  description: '',
  event: 'artifact.after-write' as HookEvent,
  matcher: {},
  command: '',

  cwd: '${workspace}',
  timeoutMs: 30000,
  runMode: 'background' as HookRunMode,
  enabled: true,
  env: {},
  source: 'global',
  projectId: '',
  recentRuns: [],
})

const cloneDraft = (d: HookDraft): Draft => ({
  ...d,
  matcher: { ...d.matcher },
  env: { ...(d.env ?? {}) },
  source: d.source ?? 'global',
  projectId: d.projectId ?? '',
  recentRuns: [...d.recentRuns],
})

const initDraft = (h: Hook | null, seed: HookDraft | null | undefined): Draft => {
  if (h) {
    return {
      ...h,
      matcher: { ...h.matcher },
      env: { ...(h.env ?? {}) },
      source: h.source ?? 'global',
      projectId: h.projectId ?? '',
      recentRuns: [...h.recentRuns],
    }
  }
  return seed ? cloneDraft(seed) : makeDefaults()
}

const draft = ref<Draft>(initDraft(props.hook, props.initialDraft))
const original = ref<Draft>(initDraft(props.hook, props.initialDraft))

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
    original.value = initDraft(h, props.initialDraft)
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

const sourceButtonStyle = (active: boolean): CSSProperties => ({
  background: active ? t.value.accent : t.value.bgInput,
  color: active ? t.value.accentText : t.value.textMuted,
  border: `1px solid ${active ? t.value.accent : t.value.border}`,
  cursor: isExistingHook.value ? 'not-allowed' : 'pointer',
  opacity: isExistingHook.value && !active ? 0.4 : 1,
})

const sourceHint = computed(() =>
  tr(draft.value.source === 'project' ? 'hooks.editor.hint_project' : 'hooks.editor.hint_global'),
)

// Referenced script file (e.g. format-after-edit.sh). Loaded from the hook's
// command; edited inline; written back on save. `scriptCommand` is the command
// the script was resolved for — we only write when the command is unchanged
// (else the path would no longer match what the user sees).
const script = ref<{ path: string; content: string; exists: boolean } | null>(null)
let scriptOriginal = ''
let scriptCommand = ''

const loadScript = async () => {
  const command = props.hook?.command ?? draft.value.command
  if (!command) {
    script.value = null
    return
  }
  const info = await ws.readHookScript({
    command,
    source: draft.value.source,
    ...(draft.value.projectId ? { projectId: draft.value.projectId } : {}),
  })
  script.value = info
  scriptOriginal = info?.content ?? ''
  scriptCommand = command
}

onMounted(loadScript)
watch(
  () => props.hook,
  () => {
    void loadScript()
  },
)

const scriptDirty = computed(() => !!script.value && script.value.content !== scriptOriginal)

const dirty = computed(
  () => JSON.stringify(draft.value) !== JSON.stringify(original.value) || scriptDirty.value,
)

const onSave = async () => {
  if (!draft.value.name || !draft.value.command) return
  if (draft.value.source === 'project' && !draft.value.projectId) return
  const out = { ...draft.value } as Hook
  // Only the global tier carries no projectId; project + imported (claude-*)
  // keep it so the sidecar can resolve the settings.json file.
  if (out.source === 'global') delete out.projectId
  // Persist the referenced script content if it changed and the command (hence
  // the resolved script path) is unchanged.
  if (script.value && scriptDirty.value && draft.value.command === scriptCommand) {
    await ws.writeHookScript(
      {
        command: scriptCommand,
        source: out.source,
        ...(out.projectId ? { projectId: out.projectId } : {}),
      },
      script.value.content,
    )
    scriptOriginal = script.value.content
  }
  emit('save', out)
}

// ─── LLM-assisted edit (config + script) ─────────────────────────────────────
const configLlm = ref(false)
const configLlmAnchor = ref<{ top: number; left: number } | null>(null)
const scriptLlm = ref(false)
const scriptLlmAnchor = ref<{ top: number; left: number } | null>(null)

const anchorFrom = (e: MouseEvent): { top: number; left: number } => {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  return { top: r.bottom + 8, left: Math.max(8, r.right - 380) }
}

const openConfigLlm = (e: MouseEvent) => {
  configLlmAnchor.value = anchorFrom(e)
  configLlm.value = true
}
const openScriptLlm = (e: MouseEvent) => {
  scriptLlmAnchor.value = anchorFrom(e)
  scriptLlm.value = true
}

// Merge an LLM-proposed config draft into the editing draft (user still Saves).
const onApplyConfig = (d: HookDraft) => {
  draft.value.name = d.name
  draft.value.description = d.description
  draft.value.event = d.event
  draft.value.matcher = { ...d.matcher }
  draft.value.command = d.command
  draft.value.cwd = d.cwd
  draft.value.timeoutMs = d.timeoutMs
  draft.value.runMode = d.runMode
  // Resync the KvEditor rows from the new matcher.
  matcherEntries.value = Object.entries(draft.value.matcher).map(([key, value]) => ({ key, value }))
  configLlm.value = false
}

const onApplyScript = (content: string) => {
  if (script.value) script.value.content = content
  scriptLlm.value = false
}
</script>
