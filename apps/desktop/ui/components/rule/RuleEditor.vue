<template>
  <EditorShell
    :title="rule?.id ? tr('rules.editor.edit_title') : tr('rules.editor.new_title')"
    :dirty="dirty"
    :can-save="canSave"
    @save="onSave"
    @cancel="emit('cancel')"
  >
    <div class="space-y-4">
      <Field :label="tr('rules.editor.save_location')">
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="opt in sourceOptions"
            :key="opt.value"
            type="button"
            :disabled="isExistingRule"
            class="text-[12px] leading-none px-2.5 py-1.5 rounded-full font-mono transition"
            :style="sourceButtonStyle(opt.value === draft.source)"
            @click="draft.source = opt.value"
          >
            {{ tr(opt.labelKey) }}
          </button>
        </div>
        <div v-if="draft.source === 'project'" class="mt-2">
          <AppSelect v-model="draft.projectId" :disabled="isExistingRule">
            <option value="" disabled>{{ tr('rules.editor.pick_project') }}</option>
            <option v-for="p in ws.projects" :key="p.id" :value="p.id">
              {{ p.name }} ({{ p.path }})
            </option>
          </AppSelect>
        </div>
        <div class="text-[1em] mt-1.5" :style="{ color: t.textDim }">{{ sourceHint }}</div>
      </Field>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field :label="tr('rules.editor.slug')">
          <input
            :value="draft.id"
            :disabled="isExistingRule"
            :placeholder="tr('rules.editor.slug_placeholder')"
            class="w-full rounded-lg px-2.5 py-1.5 text-[1em] font-mono"
            :style="inputStyle"
            @input="onSlugInput"
          />
        </Field>
        <Field :label="tr('rules.editor.name')">
          <input
            v-model="draft.name"
            :disabled="isImported"
            :placeholder="tr('rules.editor.name_placeholder')"
            class="w-full rounded-lg px-2.5 py-1.5 text-[1em]"
            :style="inputStyle"
          />
        </Field>
      </div>

      <Field v-if="!isImported" :label="tr('rules.editor.description')">
        <textarea
          v-model="draft.description"
          :rows="2"
          class="w-full rounded-lg px-2.5 py-1.5 text-[1em] resize-y min-h-[3rem]"
          :style="inputStyle"
        />
      </Field>

      <Field v-if="!isImported" :label="tr('rules.editor.globs')">
        <input
          v-model="globsText"
          :placeholder="tr('rules.editor.globs_placeholder')"
          class="w-full rounded-lg px-2.5 py-1.5 text-[1em] font-mono"
          :style="inputStyle"
        />
        <div class="text-[1em] mt-1.5" :style="{ color: t.textDim }">
          {{ tr('rules.editor.globs_hint') }}
        </div>
      </Field>

      <Field :label="tr('rules.editor.body')">
        <textarea
          v-model="draft.body"
          :rows="10"
          :placeholder="tr('rules.editor.body_placeholder')"
          class="w-full rounded-lg px-2.5 py-1.5 text-[1em] font-mono leading-relaxed resize-y min-h-[12rem]"
          :style="inputStyle"
        />
      </Field>

      <ToggleField v-if="!isImported" v-model="draft.enabled" :label="tr('rules.editor.enabled')" />
    </div>
  </EditorShell>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import type { Rule, RuleSource } from '~/types'
import type { RuleDraft } from '~/composables/useRuleGenerator'

const props = defineProps<{ rule: Rule | null; initialDraft?: RuleDraft | null }>()
const emit = defineEmits<{ save: [rule: Rule]; cancel: [] }>()

const { t } = useTheme()
const { t: tr } = useI18n()
const ws = useWorkspaceStore()

type Draft = Omit<Rule, 'source' | 'projectId'> & { source: RuleSource; projectId: string }

const sourceOptions: { value: RuleSource; labelKey: string }[] = [
  { value: 'global', labelKey: 'rules.editor.source_global' },
  { value: 'project', labelKey: 'rules.editor.source_project' },
]
const isExistingRule = computed(() => !!props.rule?.id)
// Imported (claude-*) rule: only the body is editable; save writes it back to
// the Claude Code source file (CLAUDE.md / .claude/rules).
const isImported = computed(() => props.rule?.readOnly === true)

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const makeDefaults = (): Draft => ({
  id: '',
  name: '',
  description: '',
  body: '',
  enabled: true,
  globs: [],
  source: 'global',
  projectId: '',
})

const initDraft = (r: Rule | null, seed?: RuleDraft | null): Draft => {
  if (r) return { ...r, source: r.source ?? 'global', projectId: r.projectId ?? '' }
  if (seed) {
    return {
      ...makeDefaults(),
      id: slugify(seed.name),
      name: seed.name,
      description: seed.description,
      body: seed.body,
    }
  }
  return makeDefaults()
}

const draft = ref<Draft>(initDraft(props.rule, props.initialDraft))
const original = ref<Draft>(initDraft(props.rule, props.initialDraft))

// Glob patterns (ADR 0050) edit as a comma-separated string; stored as string[].
const globsText = computed<string>({
  get: () => (draft.value.globs ?? []).join(', '),
  set: (v) => {
    draft.value.globs = v
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  },
})

// Auto-derive the slug from the name only while creating a fresh rule and the
// user hasn't typed a custom slug.
let slugTouched = false
const onSlugInput = (e: Event) => {
  slugTouched = true
  draft.value.id = slugify((e.target as HTMLInputElement).value)
}
watch(
  () => draft.value.name,
  (name) => {
    if (!isExistingRule.value && !slugTouched) draft.value.id = slugify(name)
  },
)

watch(
  () => props.rule,
  (r) => {
    slugTouched = false
    draft.value = initDraft(r)
    original.value = initDraft(r)
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
  cursor: isExistingRule.value ? 'not-allowed' : 'pointer',
  opacity: isExistingRule.value && !active ? 0.4 : 1,
})

const sourceHint = computed(() =>
  tr(draft.value.source === 'project' ? 'rules.editor.hint_project' : 'rules.editor.hint_global'),
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
  const out = { ...draft.value } as Rule
  // Only the global tier carries no projectId; project + imported (claude-*)
  // keep it so the sidecar can resolve the source file.
  if (out.source === 'global') delete out.projectId
  emit('save', out)
}
</script>
