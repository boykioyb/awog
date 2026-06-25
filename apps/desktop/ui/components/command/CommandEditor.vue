<template>
  <EditorShell
    :title="command?.id ? tr('commands.editor.edit_title') : tr('commands.editor.new_title')"
    :dirty="dirty"
    :can-save="canSave"
    @save="onSave"
    @cancel="emit('cancel')"
  >
    <div class="space-y-4">
      <Field :label="tr('commands.editor.save_location')">
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="opt in sourceOptions"
            :key="opt.value"
            type="button"
            :disabled="isExisting"
            class="text-[1em] px-3 py-1.5 rounded-lg font-mono transition"
            :style="sourceButtonStyle(opt.value === draft.source)"
            @click="draft.source = opt.value"
          >
            {{ tr(opt.labelKey) }}
          </button>
        </div>
        <div v-if="draft.source === 'project'" class="mt-2">
          <AppSelect v-model="draft.projectId" :disabled="isExisting">
            <option value="" disabled>{{ tr('commands.editor.pick_project') }}</option>
            <option v-for="p in ws.projects" :key="p.id" :value="p.id">
              {{ p.name }} ({{ p.path }})
            </option>
          </AppSelect>
        </div>
        <div class="text-[1em] mt-1.5" :style="{ color: t.textDim }">{{ sourceHint }}</div>
      </Field>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field :label="tr('commands.editor.slug')">
          <div class="flex items-center gap-1">
            <span class="font-mono text-[1em]" :style="{ color: t.textDim }">/</span>
            <input
              :value="draft.id"
              :disabled="isExisting"
              :placeholder="tr('commands.editor.slug_placeholder')"
              class="flex-1 rounded-lg px-2 py-1.5 text-[1em] font-mono"
              :style="inputStyle"
              @input="onSlugInput"
            />
          </div>
        </Field>
        <Field :label="tr('commands.editor.name')">
          <input
            v-model="draft.name"
            :disabled="isImported"
            :placeholder="tr('commands.editor.name_placeholder')"
            class="w-full rounded-lg px-2 py-1.5 text-[1em]"
            :style="inputStyle"
          />
        </Field>
      </div>

      <Field :label="tr('commands.editor.description')">
        <textarea
          v-model="draft.description"
          :rows="2"
          class="w-full rounded-lg px-2 py-1.5 text-[1em] resize-y min-h-[3rem]"
          :style="inputStyle"
        />
      </Field>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field :label="tr('commands.editor.argument_hint')">
          <input
            v-model="draft.argumentHint"
            :placeholder="tr('commands.editor.argument_hint_placeholder')"
            class="w-full rounded-lg px-2 py-1.5 text-[1em] font-mono"
            :style="inputStyle"
          />
        </Field>
        <Field :label="tr('commands.editor.model')">
          <input
            v-model="draft.model"
            :placeholder="tr('commands.editor.model_placeholder')"
            class="w-full rounded-lg px-2 py-1.5 text-[1em] font-mono"
            :style="inputStyle"
          />
        </Field>
      </div>

      <Field :label="tr('commands.editor.allowed_tools')">
        <input
          v-model="draft.allowedTools"
          :placeholder="tr('commands.editor.allowed_tools_placeholder')"
          class="w-full rounded-lg px-2 py-1.5 text-[1em] font-mono"
          :style="inputStyle"
        />
      </Field>

      <Field :label="tr('commands.editor.template')">
        <textarea
          v-model="draft.body"
          :rows="8"
          :placeholder="tr('commands.editor.template_placeholder')"
          class="w-full rounded-lg px-2 py-1.5 text-[1em] font-mono leading-relaxed resize-y min-h-[10rem]"
          :style="inputStyle"
        />
        <div class="text-[1em] mt-1" :style="{ color: t.textFaint }">
          {{ tr('commands.editor.template_hint') }}
        </div>
      </Field>

      <ToggleField
        v-if="!isImported"
        v-model="draft.enabled"
        :label="tr('commands.editor.enabled')"
      />
    </div>
  </EditorShell>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import type { Command, CommandSource } from '~/types'
import type { CommandDraft } from '~/composables/useCommandGenerator'

const props = defineProps<{ command: Command | null; initialDraft?: CommandDraft | null }>()
const emit = defineEmits<{ save: [command: Command]; cancel: [] }>()

const { t } = useTheme()
const { t: tr } = useI18n()
const ws = useWorkspaceStore()

type Draft = Omit<Command, 'source' | 'projectId'> & { source: CommandSource; projectId: string }

const sourceOptions: { value: CommandSource; labelKey: string }[] = [
  { value: 'global', labelKey: 'commands.editor.source_global' },
  { value: 'project', labelKey: 'commands.editor.source_project' },
]
const isExisting = computed(() => !!props.command?.id)
// Imported (claude-*) command: identity is fixed by the source file; only the
// content fields are editable. Save writes back to the Claude Code source file.
const isImported = computed(() => props.command?.readOnly === true)

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9:]+/g, '-')
    .replace(/^-+|-+$/g, '')

const makeDefaults = (): Draft => ({
  id: '',
  name: '',
  description: '',
  body: '',
  argumentHint: '',
  allowedTools: '',
  model: '',
  enabled: true,
  source: 'global',
  projectId: '',
})

const initDraft = (c: Command | null, seed?: CommandDraft | null): Draft => {
  if (c) {
    return {
      ...makeDefaults(),
      ...c,
      source: c.source ?? 'global',
      projectId: c.projectId ?? '',
    }
  }
  if (seed) {
    return {
      ...makeDefaults(),
      id: slugify(seed.name),
      name: seed.name,
      description: seed.description,
      argumentHint: seed.argumentHint,
      body: seed.body,
    }
  }
  return makeDefaults()
}

const draft = ref<Draft>(initDraft(props.command, props.initialDraft))
const original = ref<Draft>(initDraft(props.command, props.initialDraft))

// Auto-derive the slug from the name only while creating a fresh command and the
// user hasn't typed a custom slug.
let slugTouched = false
const onSlugInput = (e: Event) => {
  slugTouched = true
  draft.value.id = slugify((e.target as HTMLInputElement).value)
}
watch(
  () => draft.value.name,
  (name) => {
    if (!isExisting.value && !slugTouched) draft.value.id = slugify(name)
  },
)

watch(
  () => props.command,
  (c) => {
    slugTouched = false
    draft.value = initDraft(c)
    original.value = initDraft(c)
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
  cursor: isExisting.value ? 'not-allowed' : 'pointer',
  opacity: isExisting.value && !active ? 0.4 : 1,
})

const sourceHint = computed(() =>
  tr(
    draft.value.source === 'project'
      ? 'commands.editor.hint_project'
      : 'commands.editor.hint_global',
  ),
)

const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(original.value))
const canSave = computed(
  () =>
    !!draft.value.name &&
    !!draft.value.id &&
    !!draft.value.body &&
    (draft.value.source !== 'project' || !!draft.value.projectId),
)

const onSave = () => {
  if (!canSave.value) return
  const out = { ...draft.value } as Command
  // Only the global tier carries no projectId; project + imported (claude-*)
  // keep it so the sidecar can resolve the source file.
  if (out.source === 'global') delete out.projectId
  emit('save', out)
}
</script>
