<template>
  <div class="mle">
    <!-- One editable row per model: text input + delete button -->
    <div v-for="(m, i) in models" :key="i" class="mlerow">
      <input
        class="keyinp mono"
        :value="m"
        :placeholder="placeholder || t('settingsModels.models.idPlaceholder')"
        @input="updateAt(i, ($event.target as HTMLInputElement).value)"
      />
      <button
        class="mledel"
        type="button"
        :title="t('settingsModels.models.remove')"
        @click="removeAt(i)"
      >
        <Icon name="trash" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
    </div>

    <!-- Append a new (empty) row -->
    <button class="btn sm mleadd" type="button" @click="addRow">
      <Icon name="plus" style="width: var(--icon-sm); height: var(--icon-sm)" />
      {{ t('settingsModels.models.add') }}
    </button>

    <!-- Quick-add suggestions not already in the list -->
    <div v-if="freshSuggestions.length" class="mlesugg">
      <span class="fd">{{ t('settingsModels.models.available') }}</span>
      <button
        v-for="id in freshSuggestions"
        :key="id"
        class="chip mlechip"
        type="button"
        :title="id"
        @click="add(id)"
      >
        {{ id }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Repeating editable list of model ids. v-model binds the string[]; each id is its
// own input row with a delete button, plus an Add button to append a row and
// quick-add suggestion chips. Ports legacy ModelListEditor.vue into ui-next style.
const models = defineModel<string[]>({ required: true })

const props = withDefaults(
  defineProps<{
    suggestions?: string[]
    placeholder?: string
  }>(),
  { suggestions: () => [], placeholder: '' },
)

const { t } = useI18n()

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

<style scoped>
.mle {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mlerow {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mledel {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: var(--r-sm);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.mledel:hover {
  border-color: var(--danger);
  color: var(--danger);
}
.mleadd {
  align-self: flex-start;
  border-style: dashed;
}
.mlesugg {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding-top: 2px;
}
.mlechip {
  cursor: pointer;
}
.mlechip:hover {
  border-color: var(--borderStrong);
  color: var(--text);
}
</style>
