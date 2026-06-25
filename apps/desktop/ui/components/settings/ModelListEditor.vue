<template>
  <div class="space-y-1.5">
    <!-- One editable row per model: text input + delete button -->
    <div v-for="(m, i) in models" :key="i" class="flex items-center gap-2">
      <input
        :value="m"
        class="flex-1 rounded-lg px-2.5 py-2 text-[1em] font-mono"
        :style="inputStyle"
        :placeholder="placeholder"
        @input="updateAt(i, ($event.target as HTMLInputElement).value)"
      />
      <button
        type="button"
        class="p-2 rounded-lg transition flex items-center shrink-0"
        :style="dangerBtnStyle"
        title="Remove model"
        @click="removeAt(i)"
      >
        <Trash2 :size="13" />
      </button>
    </div>

    <!-- Append a new (empty) row -->
    <button
      type="button"
      class="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg text-[1em] transition"
      :style="addBtnStyle"
      @click="addRow"
    >
      <Plus :size="13" />
      {{ addLabel }}
    </button>

    <!-- Quick-add suggestions not already in the list -->
    <div v-if="freshSuggestions.length" class="flex flex-wrap items-center gap-1 pt-0.5">
      <span class="text-[1em]" :style="{ color: t.textDim }">Available:</span>
      <button
        v-for="id in freshSuggestions"
        :key="id"
        type="button"
        class="px-1.5 py-0.5 rounded-md font-mono text-[12px] leading-none transition"
        :style="{ background: t.bgInput, color: t.textDim, border: `1px solid ${t.border}` }"
        title="Add this model"
        @click="add(id)"
      >
        {{ id }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Plus, Trash2 } from 'lucide-vue-next'

// Repeating editable list of model ids. v-model binds the string[]; each id is
// its own input row with a delete button, plus an Add button to append a row.
const models = defineModel<string[]>({ required: true })

const props = withDefaults(
  defineProps<{
    suggestions?: string[]
    placeholder?: string
    addLabel?: string
  }>(),
  {
    suggestions: () => [],
    placeholder: 'model-id',
    addLabel: 'Add model',
  },
)

const { t } = useTheme()

const inputStyle = computed(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none' as const,
}))

const addBtnStyle = computed(() => ({
  color: t.value.text,
  border: `1px dashed ${t.value.border}`,
  background: 'transparent',
}))

const dangerBtnStyle = computed(() => ({
  color: t.value.textDim,
  border: `1px solid ${t.value.borderStrong}`,
  background: 'transparent',
}))

const freshSuggestions = computed(() =>
  props.suggestions.filter((id) => !models.value.includes(id)),
)

const updateAt = (i: number, value: string) => {
  const next = [...models.value]
  next[i] = value
  models.value = next
}

const addRow = () => {
  models.value = [...models.value, '']
}

const removeAt = (i: number) => {
  models.value = models.value.filter((_, idx) => idx !== i)
}

const add = (id: string) => {
  const v = id.trim()
  if (!v || models.value.includes(v)) return
  models.value = [...models.value, v]
}
</script>
