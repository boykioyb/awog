<template>
  <BaseModal :open="open" :title="title" size="sm" @close="emit('close')">
    <div class="p-4 flex flex-col gap-2">
      <div v-if="fromLabel" class="text-[1em]" :style="{ color: t.textDim }">
        From:
        <span class="font-mono">{{ fromLabel }}</span>
      </div>
      <input
        v-model="localValue"
        :placeholder="placeholder"
        class="w-full rounded text-[1em] px-2 py-1.5"
        :style="{
          background: t.bgInput,
          color: t.text,
          border: `1px solid ${t.border}`,
          outline: 'none',
        }"
        @keydown.enter="emit('submit', localValue)"
      />
    </div>
    <template #footer>
      <AppButton variant="ghost" @click="emit('close')">Cancel</AppButton>
      <AppButton @click="emit('submit', localValue)">
        {{ submitLabel }}
      </AppButton>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
type Props = {
  open: boolean
  title: string
  submitLabel: string
  modelValue: string
  placeholder?: string
  fromLabel?: string
}

const props = withDefaults(defineProps<Props>(), { placeholder: '', fromLabel: '' })

const emit = defineEmits<{
  close: []
  'update:modelValue': [value: string]
  submit: [value: string]
}>()

const { t } = useTheme()

// Two-way binding qua computed proxy để không mutate prop trực tiếp.
const localValue = computed({
  get: () => props.modelValue,
  set: (v: string) => emit('update:modelValue', v),
})
</script>
