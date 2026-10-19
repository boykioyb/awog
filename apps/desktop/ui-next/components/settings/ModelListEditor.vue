<template>
  <div class="flex flex-col gap-1.5">
    <!-- Mỗi model một dòng: ô nhập + nút xoá -->
    <div v-for="(m, i) in models" :key="i" class="flex items-center gap-2">
      <!-- mono-ok: id model -->
      <Input
        :model-value="m"
        :placeholder="placeholder || t('settingsModels.models.idPlaceholder')"
        class="flex-1 font-mono"
        @update:model-value="updateAt(i, $event)"
      />
      <Button
        type="button"
        variant="outline"
        size="iconMd"
        class="text-dim hover:border-destructive hover:bg-transparent hover:text-destructive"
        :title="t('settingsModels.models.remove')"
        :aria-label="t('settingsModels.models.remove')"
        @click="removeAt(i)"
      >
        <Icon name="trash" class="size-3.5" />
      </Button>
    </div>

    <!-- Thêm một dòng rỗng -->
    <Button
      type="button"
      class="self-start border-dashed"
      variant="outline"
      size="sm"
      @click="addRow"
    >
      <Icon name="plus" class="size-3.5" />
      {{ t('settingsModels.models.add') }}
    </Button>

    <!-- Gợi ý thêm nhanh các id chưa có trong danh sách -->
    <div v-if="freshSuggestions.length" class="flex flex-wrap items-center gap-1.5 pt-0.5">
      <span class="text-sm text-dim">{{ t('settingsModels.models.available') }}</span>
      <Button
        v-for="id in freshSuggestions"
        :key="id"
        type="button"
        variant="outline"
        size="xs"
        class="font-normal text-muted-foreground"
        :title="id"
        @click="add(id)"
      >
        {{ id }}
      </Button>
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
