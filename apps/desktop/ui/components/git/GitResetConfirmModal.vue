<template>
  <BaseModal :open="open" size="sm" @close="emit('close')">
    <template #header>
      <div class="flex items-center gap-2">
        <AlertCircle :size="14" :style="{ color: t.danger }" />
        <div class="text-sm font-medium" :style="{ color: t.text }">
          Reset '{{ currentBranch }}' to here?
        </div>
      </div>
    </template>

    <div class="p-4 space-y-3">
      <div class="text-[0.86em] leading-relaxed" :style="{ color: t.textMuted }">
        HEAD của
        <span class="font-mono" :style="{ color: t.text }">{{ currentBranch }}</span>
        sẽ chuyển về commit
        <span class="font-mono" :style="{ color: t.accent }">{{ targetSha7 }}</span>
        . Chế độ reset quyết định working tree + index có giữ nguyên hay không.
      </div>

      <div class="flex flex-col gap-2">
        <label
          v-for="opt in MODES"
          :key="opt.value"
          class="flex gap-2 items-start cursor-pointer rounded px-2 py-1.5 transition"
          :style="rowStyle(opt.value)"
        >
          <input
            v-model="selected"
            type="radio"
            :value="opt.value"
            class="cursor-pointer mt-0.5"
            :style="{ accentColor: opt.value === 'hard' ? t.danger : t.accent }"
          />
          <div class="flex-1 min-w-0">
            <div class="text-xs font-medium" :style="{ color: textColor(opt.value) }">
              {{ opt.label }}
            </div>
            <div class="text-[0.71em] leading-snug" :style="{ color: t.textDim }">
              {{ opt.description }}
            </div>
          </div>
        </label>
      </div>

      <label
        v-if="selected === 'hard'"
        class="flex items-center gap-2 text-[0.79em] cursor-pointer select-none px-2 py-1.5 rounded"
        :style="{
          color: t.danger,
          background: t.dangerBg,
          border: `1px solid ${t.dangerBorder}`,
        }"
      >
        <input
          v-model="ackHard"
          type="checkbox"
          class="cursor-pointer"
          :style="{ accentColor: t.danger }"
        />
        <span>I understand this will destroy uncommitted changes</span>
      </label>
    </div>

    <template #footer>
      <button
        class="px-3 py-1.5 text-xs rounded transition"
        :style="{ color: t.textMuted }"
        @click="emit('close')"
      >
        Cancel
      </button>
      <button
        class="px-3 py-1.5 text-xs rounded font-medium transition"
        :style="{
          background: selected === 'hard' ? t.danger : t.accent,
          color: t.onAccent,
          opacity: canConfirm ? 1 : 0.6,
          cursor: canConfirm ? 'pointer' : 'not-allowed',
        }"
        :disabled="!canConfirm"
        @click="onConfirm"
      >
        Reset
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { AlertCircle } from 'lucide-vue-next'

type ResetMode = 'soft' | 'mixed' | 'hard'

type Props = {
  open: boolean
  targetSha7: string
  currentBranch: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: []
  submit: [mode: ResetMode]
}>()

const { t } = useTheme()

const MODES: ReadonlyArray<{ value: ResetMode; label: string; description: string }> = [
  {
    value: 'soft',
    label: 'Soft',
    description: 'Move HEAD only. Index + working tree giữ nguyên — staged changes ở lại.',
  },
  {
    value: 'mixed',
    label: 'Mixed (default)',
    description: 'Move HEAD + reset index. Working tree giữ nguyên — changes về dạng unstaged.',
  },
  {
    value: 'hard',
    label: 'Hard',
    description: 'DESTROY uncommitted changes. Working tree + index = target commit.',
  },
]

const selected = ref<ResetMode>('mixed')
const ackHard = ref(false)

// Reset state on each open so a fresh dialog never carries the prior selection.
watch(
  () => props.open,
  (next) => {
    if (next) {
      selected.value = 'mixed'
      ackHard.value = false
    }
  },
)

const canConfirm = computed(() => {
  if (selected.value === 'hard') return ackHard.value
  return true
})

const rowStyle = (mode: ResetMode) => {
  const active = selected.value === mode
  return {
    background: active ? t.value.bgHover : 'transparent',
    border: `1px solid ${active ? t.value.border : 'transparent'}`,
  }
}

const textColor = (mode: ResetMode): string => {
  if (mode === 'hard') return t.value.danger
  return t.value.text
}

const onConfirm = () => {
  if (!canConfirm.value) return
  emit('submit', selected.value)
}
</script>
