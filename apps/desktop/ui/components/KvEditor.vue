<template>
  <div>
    <label
      class="text-[10px] uppercase tracking-wider block mb-1.5 font-medium"
      :style="{ color: t.textDim }"
    >
      {{ label }}
    </label>
    <div class="space-y-1.5">
      <div v-for="(entry, i) in modelValue" :key="i" class="flex items-center gap-1.5">
        <input
          :value="entry.key"
          placeholder="key"
          class="rounded px-2 py-1 text-[11px] font-mono"
          :style="{ ...inputStyle, width: '38%' }"
          @input="(e: Event) => updateKey(i, (e.target as HTMLInputElement).value)"
        />
        <input
          :value="entry.value"
          placeholder="value (supports ${secret:name})"
          class="flex-1 rounded px-2 py-1 text-[11px] font-mono"
          :style="inputStyle"
          @input="(e: Event) => updateVal(i, (e.target as HTMLInputElement).value)"
        />
        <button :style="{ color: t.textDim }" @click="remove(i)">
          <X :size="11" />
        </button>
      </div>
      <button
        class="text-[11px] flex items-center gap-1"
        :style="{ color: t.textDim }"
        @click="add"
      >
        <Plus :size="11" />
        Add entry
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Plus, X } from 'lucide-vue-next'

interface KvEntry {
  key: string
  value: string
}

const props = defineProps<{ modelValue: KvEntry[]; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: KvEntry[]] }>()
const { t } = useTheme()

const inputStyle = computed(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none',
}))

const add = () => emit('update:modelValue', [...props.modelValue, { key: '', value: '' }])
const remove = (i: number) =>
  emit(
    'update:modelValue',
    props.modelValue.filter((_, idx) => idx !== i),
  )
const updateKey = (i: number, k: string) => {
  const next = props.modelValue.map((e, idx) => (idx === i ? { ...e, key: k } : e))
  emit('update:modelValue', next)
}
const updateVal = (i: number, v: string) => {
  const next = props.modelValue.map((e, idx) => (idx === i ? { ...e, value: v } : e))
  emit('update:modelValue', next)
}
</script>
