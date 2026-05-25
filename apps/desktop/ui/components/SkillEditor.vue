<template>
  <div class="p-4 md:p-6 max-w-3xl">
    <div class="flex items-center justify-between mb-6">
      <div class="text-sm font-medium" :style="{ color: t.text }">
        {{ skill?.id ? 'Edit Skill' : 'New Skill' }}
      </div>
      <div class="flex gap-2">
        <button class="px-3 py-1.5 text-xs" :style="{ color: t.textMuted }" @click="emit('cancel')">
          Cancel
        </button>
        <button
          class="px-3 py-1.5 text-xs rounded font-medium"
          :disabled="!draft.name"
          :style="{
            background: !draft.name ? t.bgInput : t.accent,
            color: !draft.name ? t.textFaint : t.accentText,
          }"
          @click="onSave"
        >
          <span class="inline-flex items-center gap-1.5">
            <Save :size="11" />
            Save
          </span>
        </button>
      </div>
    </div>

    <div class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label
            class="text-[10px] uppercase tracking-wider block mb-1.5 font-medium"
            :style="{ color: t.textDim }"
          >
            Name
          </label>
          <input
            :value="draft.name"
            placeholder="e.g. analyze_pricing"
            class="w-full rounded px-2 py-1.5 text-xs font-mono"
            :style="inputStyle"
            @input="
              (e: Event) =>
                (draft.name = (e.target as HTMLInputElement).value
                  .replace(/\s/g, '_')
                  .toLowerCase())
            "
          />
        </div>
        <div>
          <label
            class="text-[10px] uppercase tracking-wider block mb-1.5 font-medium"
            :style="{ color: t.textDim }"
          >
            Category
          </label>
          <input
            v-model="draft.category"
            class="w-full rounded px-2 py-1.5 text-xs"
            :style="inputStyle"
          />
        </div>
      </div>

      <div>
        <label
          class="text-[10px] uppercase tracking-wider block mb-1.5 font-medium"
          :style="{ color: t.textDim }"
        >
          Description
        </label>
        <textarea
          v-model="draft.description"
          :rows="2"
          placeholder="What does this skill do?"
          class="w-full rounded px-2 py-1.5 text-[12px] resize-none"
          :style="inputStyle"
        />
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label
            class="text-[10px] uppercase tracking-wider block mb-1.5 font-medium"
            :style="{ color: t.textDim }"
          >
            Inputs
          </label>
          <div class="space-y-1">
            <div v-for="(inp, i) in draft.inputs" :key="i" class="flex items-center gap-1">
              <input
                :value="inp"
                class="flex-1 rounded px-2 py-1 text-[11px] font-mono"
                :style="inputStyle"
                @input="(e: Event) => (draft.inputs[i] = (e.target as HTMLInputElement).value)"
              />
              <button
                :style="{ color: t.textDim }"
                @click="draft.inputs = draft.inputs.filter((_, j) => j !== i)"
              >
                <X :size="11" />
              </button>
            </div>
            <button
              class="text-[11px] flex items-center gap-1"
              :style="{ color: t.textDim }"
              @click="draft.inputs = [...draft.inputs, 'input']"
            >
              <Plus :size="11" />
              Add input
            </button>
          </div>
        </div>
        <div>
          <label
            class="text-[10px] uppercase tracking-wider block mb-1.5 font-medium"
            :style="{ color: t.textDim }"
          >
            Outputs
          </label>
          <div class="space-y-1">
            <div v-for="(out, i) in draft.outputs" :key="i" class="flex items-center gap-1">
              <input
                :value="out"
                class="flex-1 rounded px-2 py-1 text-[11px] font-mono"
                :style="inputStyle"
                @input="(e: Event) => (draft.outputs[i] = (e.target as HTMLInputElement).value)"
              />
              <button
                :style="{ color: t.textDim }"
                @click="draft.outputs = draft.outputs.filter((_, j) => j !== i)"
              >
                <X :size="11" />
              </button>
            </div>
            <button
              class="text-[11px] flex items-center gap-1"
              :style="{ color: t.textDim }"
              @click="draft.outputs = [...draft.outputs, 'output.md']"
            >
              <Plus :size="11" />
              Add output
            </button>
          </div>
        </div>
      </div>

      <div>
        <label
          class="text-[10px] uppercase tracking-wider block mb-1.5 font-medium"
          :style="{ color: t.textDim }"
        >
          Prompt Template
        </label>
        <textarea
          v-model="draft.promptTemplate"
          :rows="8"
          placeholder="Use {input_name} placeholders to reference inputs"
          class="w-full rounded px-2 py-1.5 text-[11px] font-mono leading-relaxed resize-none"
          :style="inputStyle"
        />
      </div>

      <div>
        <label
          class="text-[10px] uppercase tracking-wider block mb-1.5 font-medium"
          :style="{ color: t.textDim }"
        >
          Tags
        </label>
        <div class="flex flex-wrap gap-1 mb-1.5">
          <span
            v-for="tag in draft.tags"
            :key="tag"
            class="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
            :style="{
              background: t.bgInput,
              color: t.textMuted,
              border: `1px solid ${t.border}`,
            }"
          >
            #{{ tag }}
            <button
              :style="{ color: t.textDim }"
              @click="draft.tags = draft.tags.filter((x) => x !== tag)"
            >
              <X :size="9" />
            </button>
          </span>
        </div>
        <input
          v-model="tagInput"
          placeholder="Type a tag and press Enter"
          class="w-full rounded px-2 py-1.5 text-[11px]"
          :style="inputStyle"
          @keydown.enter.prevent="addTag"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Save, Plus, X } from 'lucide-vue-next'
import type { Skill, SkillCategory } from '~/types'
import type { SkillDraft as GeneratedSkillDraft } from '~/composables/useSkillGenerator'

const props = defineProps<{
  skill: Skill | null
  initialDraft?: GeneratedSkillDraft | null
}>()

const emit = defineEmits<{
  save: [skill: Skill]
  cancel: []
}>()

const { t } = useTheme()

type SkillDraft = Omit<Skill, 'id'> & { id?: string }

const makeDefaults = (): SkillDraft => ({
  name: '',
  category: 'Development' as SkillCategory,
  description: '',
  inputs: ['input'],
  outputs: ['output.md'],
  promptTemplate: '',
  tags: [],
})

const cloneDraft = (d: GeneratedSkillDraft): SkillDraft => ({
  ...d,
  inputs: [...d.inputs],
  outputs: [...d.outputs],
  tags: [...d.tags],
})

const initDraft = (s: Skill | null, seed: GeneratedSkillDraft | null | undefined): SkillDraft => {
  if (s) {
    return {
      ...s,
      inputs: [...s.inputs],
      outputs: [...s.outputs],
      tags: [...s.tags],
    }
  }
  return seed ? cloneDraft(seed) : makeDefaults()
}

const draft = ref<SkillDraft>(initDraft(props.skill, props.initialDraft))
const tagInput = ref('')

watch(
  () => props.skill,
  (s) => {
    draft.value = initDraft(s, props.initialDraft)
    tagInput.value = ''
  },
)

const inputStyle = computed(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none',
}))

const addTag = () => {
  const v = tagInput.value.trim()
  if (!v) return
  if (!draft.value.tags.includes(v)) {
    draft.value.tags = [...draft.value.tags, v]
  }
  tagInput.value = ''
}

const onSave = () => {
  if (!draft.value.name) return
  emit('save', { ...(draft.value as Skill) })
}
</script>
