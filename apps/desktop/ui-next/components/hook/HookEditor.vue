<template>
  <LibraryEntityModal
    :open="open"
    :title="hook?.id ? t('hooks.editor.editTitle') : t('hooks.editor.newTitle')"
    :width="660"
    @close="emit('cancel')"
  >
    <div class="flex flex-col gap-4">
      <!-- Save location (tier) — locked once a hook exists (moving tiers = a new file). -->
      <div v-if="!isImported" class="flex flex-col gap-1.5">
        <Label class="text-sm font-medium text-foreground">
          {{ t('hooks.editor.saveLocation') }}
        </Label>
        <ToggleGroup
          type="single"
          :spacing="1"
          class="self-start rounded-lg bg-muted p-0.5"
          :model-value="draft.source"
          :disabled="isExisting"
          @update:model-value="(v) => v && (draft.source = v as HookSource)"
        >
          <ToggleGroupItem
            v-for="opt in sourceOptions"
            :key="opt.value"
            :value="opt.value"
            :class="SEG_ITEM"
          >
            {{ opt.label }}
          </ToggleGroupItem>
        </ToggleGroup>
        <div v-if="draft.source === 'project'">
          <AppSelect
            v-model="draft.projectId"
            :options="projectOptions"
            :placeholder="t('hooks.editor.pickProject')"
            width="100%"
          />
        </div>
        <div class="text-xs text-dim">{{ sourceHint }}</div>
      </div>

      <div v-if="!isImported" class="flex flex-col gap-1.5">
        <Label class="text-sm font-medium text-foreground">{{ t('hooks.editor.name') }}</Label>
        <Input v-model="draft.name" :placeholder="t('hooks.editor.namePh')" />
      </div>

      <div v-if="!isImported" class="flex flex-col gap-1.5">
        <Label class="text-sm font-medium text-foreground">
          {{ t('hooks.editor.description') }}
        </Label>
        <Textarea
          v-model="draft.description"
          class="min-h-12 resize-y"
          rows="2"
          :placeholder="t('hooks.editor.descPh')"
        />
      </div>

      <div class="grid grid-cols-2 gap-3.5">
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">{{ t('hooks.editor.event') }}</Label>
          <AppSelect
            v-model="eventModel"
            :options="eventOptions"
            width="100%"
            :placeholder="t('hooks.editor.event')"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">{{ t('hooks.editor.runMode') }}</Label>
          <AppSelect v-model="runModeModel" :options="runModeOptions" width="100%" />
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <LibraryKvEditor v-model="matcherEntries" :label="t('hooks.editor.matcher')" />
      </div>

      <div class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between gap-2">
          <Label class="text-sm font-medium text-foreground">{{ t('hooks.editor.command') }}</Label>
          <Button
            :title="t('hooks.editor.editLlm')"
            variant="outline"
            size="sm"
            @click="emit('edit-config')"
          >
            <Icon name="sparkles" />
            {{ t('hooks.editor.editLlm') }}
          </Button>
        </div>
        <!-- mono-ok: nội dung dạng file/code người dùng sửa như code -->
        <Textarea
          v-model="draft.command"
          class="min-h-12 resize-y font-mono"
          rows="3"
          placeholder="pnpm exec prettier --write {{event.payload.path}}"
        />
      </div>

      <!-- Script file the command runs (e.g. format-after-edit.sh) — edited via a
           Monaco viewer in edit mode. Shown only when the command references a
           recognised script. -->
      <div v-if="script" class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between gap-2">
          <!-- mono-ok: đường dẫn script -->
          <Label class="font-mono text-sm font-medium text-foreground">
            {{ t('hooks.editor.script', { path: script.path }) }}
          </Label>
          <Button
            :title="t('hooks.editor.scriptEditLlm')"
            variant="outline"
            size="sm"
            @click="emit('edit-script')"
          >
            <Icon name="sparkles" />
            {{ t('hooks.editor.scriptEditLlm') }}
          </Button>
        </div>
        <div class="h-70 overflow-hidden rounded-md border">
          <MonacoViewer
            :value="script.content"
            language="shell"
            :read-only="false"
            @change="onScriptChange"
          />
        </div>
        <div v-if="!script.exists" class="text-xs text-dim">{{ t('hooks.editor.scriptNew') }}</div>
      </div>

      <div class="grid grid-cols-2 gap-3.5">
        <div v-if="!isImported" class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">{{ t('hooks.editor.cwd') }}</Label>
          <Input v-model="draft.cwd" placeholder="${workspace}" class="font-mono" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">{{ t('hooks.editor.timeout') }}</Label>
          <Input v-model.number="draft.timeoutMs" type="number" class="font-mono" />
        </div>
      </div>

      <div v-if="!isImported" class="flex flex-col gap-1.5">
        <LibraryKvEditor v-model="envEntries" :label="t('hooks.editor.env')" />
      </div>

      <div v-if="!isImported" class="flex items-center justify-between">
        <span class="text-sm font-medium text-foreground">{{ t('hooks.editor.enabled') }}</span>
        <Switch :checked="draft.enabled" @update:checked="(v: boolean) => (draft.enabled = v)" />
      </div>
    </div>

    <template #footer>
      <Button variant="outline" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
      <Button :disabled="!canSave || saving" variant="default" @click="onSave">
        {{ saving ? t('hooks.editor.saving') : t('hooks.editor.save') }}
      </Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Hook form editor — config + inline script editing inside
// LibraryEntityModal. Save-location tier is locked once the hook exists.
// References the script file the command runs (e.g. format-after-edit.sh) and
// edits it in a Monaco viewer; persists the script content on save when the
// command (hence the resolved path) is unchanged. The LLM config/script edit
// buttons emit anchors up to the page, which owns those creator panels.
import { computed, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import MonacoViewer from '~/components/common/MonacoViewer.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import LibraryKvEditor, { type KvEntry } from '~/components/library/LibraryKvEditor.vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import {
  useHooksStore,
  type Hook,
  type HookConfig,
  type HookEvent,
  type HookRunMode,
  type HookSource,
} from '~/stores/hooks'

const props = defineProps<{
  open: boolean
  hook: Hook | null
  projects: { id: string; name: string }[]
  // A pre-filled draft to seed a NEW hook (creator "Edit details" handoff). Unlike
  // `hook`, this keeps the tier picker editable (it's still unsaved).
  initialDraft?: Hook | null
  // An LLM-proposed config to merge into the draft (applied when it changes).
  pendingConfig?: HookConfig | null
  // An LLM-proposed script content to apply to the editor (applied when changed).
  pendingScript?: string | null
}>()

const emit = defineEmits<{
  save: [hook: Hook]
  cancel: []
  'edit-config': []
  'edit-script': []
}>()

const { t } = useI18n()
const store = useHooksStore()

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

// Segmented control chọn tier (cùng kiểu LibraryMarkdownBody).
const SEG_ITEM =
  'h-6 px-2 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm'

const sourceOptions: { value: HookSource; label: string }[] = [
  { value: 'global', label: '~/.awog/hooks' },
  { value: 'project', label: 'project · .awog/hooks' },
]

const eventOptions = computed<AppSelectOption[]>(() =>
  HOOK_EVENTS.map((ev) => ({ value: ev, label: ev })),
)
const runModeOptions = computed<AppSelectOption[]>(() => [
  { value: 'blocking', label: t('hooks.editor.runModeBlocking') },
  { value: 'background', label: t('hooks.editor.runModeBackground') },
])

type Draft = {
  id: string
  name: string
  description: string
  event: HookEvent
  matcher: Record<string, string>
  command: string
  cwd: string
  timeoutMs: number
  runMode: HookRunMode
  enabled: boolean
  env: Record<string, string>
  source: HookSource
  projectId: string
  trusted?: boolean
  readOnly?: boolean
  recentRuns: Hook['recentRuns']
}

const makeDefaults = (): Draft => ({
  id: '',
  name: '',
  description: '',
  event: 'artifact.after-write',
  matcher: {},
  command: '',
  cwd: '${workspace}',
  timeoutMs: 30000,
  runMode: 'background',
  enabled: true,
  env: {},
  source: 'global',
  projectId: '',
  recentRuns: [],
})

const fromHook = (h: Hook): Draft => ({
  id: h.id,
  name: h.name,
  description: h.description,
  event: h.event,
  matcher: { ...h.matcher },
  command: h.command,
  cwd: h.cwd,
  timeoutMs: h.timeoutMs,
  runMode: h.runMode,
  enabled: h.enabled,
  env: { ...(h.env ?? {}) },
  source: h.source ?? 'global',
  projectId: h.projectId ?? '',
  trusted: h.trusted,
  readOnly: h.readOnly,
  recentRuns: [...h.recentRuns],
})

// Seed priority: an existing hook (edit) → a creator-handoff draft (new, tier
// still editable) → blank defaults.
const initDraft = (h: Hook | null, seed: Hook | null | undefined): Draft => {
  if (h) return fromHook(h)
  if (seed) return { ...fromHook(seed), id: '' }
  return makeDefaults()
}

const draft = ref<Draft>(initDraft(props.hook, props.initialDraft))

// AppSelect requires a plain string model; bridge to the typed draft fields.
const eventModel = computed<string>({
  get: () => draft.value.event,
  set: (v) => (draft.value.event = v as HookEvent),
})
const runModeModel = computed<string>({
  get: () => draft.value.runMode,
  set: (v) => (draft.value.runMode = v as HookRunMode),
})

const isExisting = computed(() => !!props.hook)
const isImported = computed(() => props.hook?.readOnly === true)

// Matcher + env round-trip through the shared KvEditor (array of {key,value}).
const matcherEntries = ref<KvEntry[]>([])
const envEntries = ref<KvEntry[]>([])
watch(
  matcherEntries,
  (entries) => {
    draft.value.matcher = Object.fromEntries(
      entries.filter((e) => e.key.length > 0).map((e) => [e.key, e.value]),
    )
  },
  { deep: true },
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

// Referenced script file (e.g. format-after-edit.sh). Loaded from the hook's
// command; edited inline; written back on save when the command (hence the
// resolved path) is unchanged.
const script = ref<{ path: string; content: string; exists: boolean } | null>(null)
let scriptOriginal = ''
let scriptCommand = ''

const onScriptChange = (value: string) => {
  if (script.value) script.value.content = value
}

const loadScript = async () => {
  const command = props.hook?.command ?? draft.value.command
  if (!command) {
    script.value = null
    return
  }
  const info = await store.readHookScript({
    command,
    source: draft.value.source,
    ...(draft.value.projectId ? { projectId: draft.value.projectId } : {}),
  })
  script.value = info
  scriptOriginal = info?.content ?? ''
  scriptCommand = command
}

// Re-seed the draft each time the modal opens or the target hook changes.
watch(
  () => [props.open, props.hook, props.initialDraft] as const,
  ([isOpen]) => {
    if (!isOpen) return
    draft.value = initDraft(props.hook, props.initialDraft)
    matcherEntries.value = Object.entries(draft.value.matcher).map(([key, value]) => ({
      key,
      value,
    }))
    envEntries.value = Object.entries(draft.value.env).map(([key, value]) => ({ key, value }))
    void loadScript()
  },
  { immediate: true },
)

// Pre-fill the first project when switching to the project tier.
watch(
  () => draft.value.source,
  (source) => {
    if (source === 'project' && !draft.value.projectId) {
      draft.value.projectId = props.projects[0]?.id ?? ''
    }
  },
)

// Merge an LLM-proposed config draft into the editing draft (user still Saves).
watch(
  () => props.pendingConfig,
  (cfg) => {
    if (!cfg) return
    draft.value.name = cfg.name
    draft.value.description = cfg.description
    draft.value.event = cfg.event
    draft.value.matcher = { ...cfg.matcher }
    draft.value.command = cfg.command
    draft.value.cwd = cfg.cwd
    draft.value.timeoutMs = cfg.timeoutMs
    draft.value.runMode = cfg.runMode
    matcherEntries.value = Object.entries(draft.value.matcher).map(([key, value]) => ({
      key,
      value,
    }))
  },
)

// Apply an LLM-proposed script content into the editor (user still Saves).
watch(
  () => props.pendingScript,
  (content) => {
    if (content === null || content === undefined) return
    if (script.value) script.value.content = content
  },
)

const isProjectMissing = computed(() => draft.value.source === 'project' && !draft.value.projectId)

const canSave = computed(() => {
  if (isImported.value) return !!draft.value.command.trim()
  if (!draft.value.name.trim()) return false
  if (!draft.value.command.trim()) return false
  if (isProjectMissing.value) return false
  return true
})

const projectOptions = computed<AppSelectOption[]>(() =>
  props.projects.map((p) => ({ value: p.id, label: p.name })),
)

const sourceHint = computed(() => {
  if (draft.value.source === 'global') return t('hooks.editor.globalHint')
  const project = props.projects.find((p) => p.id === draft.value.projectId)
  if (!project) return t('hooks.editor.projectHintNone')
  return t('hooks.editor.projectHint', { name: project.name })
})

// In-flight guard: onSave awaits an inline writeHookScript IPC write before
// emitting `save`. Without this, a double-click fires two concurrent script
// writes + save emits. Also drives the button's disabled state.
const saving = ref(false)

const onSave = async () => {
  if (!canSave.value || saving.value) return
  saving.value = true
  try {
    await doSave()
  } finally {
    saving.value = false
  }
}

const doSave = async () => {
  // Derive a stable slug for a brand-new hook from the name.
  const id =
    draft.value.id ||
    draft.value.name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join('-') ||
    'new-hook'

  const out: Hook = {
    id,
    name: draft.value.name.trim() || id,
    description: draft.value.description.trim(),
    event: draft.value.event,
    matcher: { ...draft.value.matcher },
    command: draft.value.command,
    cwd: draft.value.cwd || '${workspace}',
    timeoutMs: draft.value.timeoutMs || 30000,
    runMode: draft.value.runMode,
    enabled: draft.value.enabled,
    source: draft.value.source,
    recentRuns: draft.value.recentRuns,
  }
  if (Object.keys(draft.value.env).length > 0) out.env = { ...draft.value.env }
  // Only the global tier carries no projectId; project + imported keep it.
  if (draft.value.source === 'project' && draft.value.projectId)
    out.projectId = draft.value.projectId
  if (draft.value.trusted !== undefined) out.trusted = draft.value.trusted
  if (draft.value.readOnly) out.readOnly = draft.value.readOnly

  // Persist the referenced script content if it changed and the command (hence
  // the resolved path) is unchanged.
  if (
    script.value &&
    script.value.content !== scriptOriginal &&
    draft.value.command === scriptCommand
  ) {
    try {
      await store.writeHookScript(
        {
          command: scriptCommand,
          source: out.source,
          ...(out.projectId ? { projectId: out.projectId } : {}),
        },
        script.value.content,
      )
      scriptOriginal = script.value.content
    } catch (err) {
      console.warn('[hooks] write script on save failed', err)
    }
  }
  emit('save', out)
}

// Expose the current draft + script context so the page can seed the LLM panels.
defineExpose({
  draftHook: computed<Hook>(() => ({
    id: draft.value.id,
    name: draft.value.name,
    description: draft.value.description,
    event: draft.value.event,
    matcher: { ...draft.value.matcher },
    command: draft.value.command,
    cwd: draft.value.cwd,
    timeoutMs: draft.value.timeoutMs,
    runMode: draft.value.runMode,
    enabled: draft.value.enabled,
    env: { ...draft.value.env },
    source: draft.value.source,
    recentRuns: draft.value.recentRuns,
  })),
  scriptPath: computed(() => script.value?.path ?? ''),
  scriptContent: computed(() => script.value?.content ?? ''),
})
</script>
