<template>
  <div class="flex min-w-56 items-center gap-2">
    <Input
      :class="inputFont"
      :type="revealed ? 'text' : 'password'"
      :placeholder="placeholder"
      :readonly="readonly"
      :model-value="model"
      class="flex-1"
      @update:model-value="model = $event"
    />
    <Button
      variant="ghost"
      size="iconSm"
      :title="revealed ? t('settingsModels.form.hide') : t('settingsModels.form.show')"
      :aria-label="revealed ? t('settingsModels.form.hide') : t('settingsModels.form.show')"
      @click="revealed = !revealed"
    >
      <Icon :name="revealed ? 'eye-off' : 'eye'" />
    </Button>
  </div>
</template>

<script setup lang="ts">
// Ô nhập API key có nút hiện/ẩn. v-model; bấm mắt đổi password <-> text. `readonly`
// hiển thị giá trị đã lưu (đã che) cho xem nhưng không sửa.
const props = withDefaults(
  defineProps<{
    placeholder?: string
    readonly?: boolean
    mono?: boolean
  }>(),
  { placeholder: '', readonly: false, mono: false },
)

const { t } = useI18n()
const model = defineModel<string>({ default: '' })
const revealed = ref(false)
const inputFont = computed(() => (props.mono ? 'font-mono' : ''))
</script>
