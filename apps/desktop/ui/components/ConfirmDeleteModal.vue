<template>
  <BaseModal :open="true" size="sm" @close="emit('cancel')">
    <template #header>
      <div class="flex items-center gap-2">
        <AlertCircle :size="14" :style="{ color: kind === 'danger' ? t.danger : t.accent }" />
        <div class="text-sm font-medium" :style="{ color: t.text }">{{ title }}</div>
      </div>
    </template>

    <div class="p-4 space-y-3">
      <div class="text-[0.86em] leading-relaxed" :style="{ color: t.textMuted }">
        {{ description }}
      </div>
      <slot name="extra" />
    </div>

    <template #footer>
      <button
        class="px-3 py-1.5 text-xs rounded transition"
        :style="{ color: t.textMuted }"
        @click="emit('cancel')"
      >
        {{ cancelLabel ?? 'Cancel' }}
      </button>
      <button
        class="px-3 py-1.5 text-xs rounded font-medium transition"
        :style="{ background: confirmBg, color: t.onAccent }"
        @click="emit('confirm')"
      >
        {{ confirmLabel ?? (kind === 'danger' ? 'Delete' : 'Confirm') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { AlertCircle } from 'lucide-vue-next'

// `kind` controls the icon color, default confirm-button label, and confirm
// background. Defaults to 'danger' so existing call sites stay red-Delete.
// Non-destructive flows (checkout, cherry-pick, …) should pass `kind="primary"`
// or override `confirmLabel`.
const props = withDefaults(
  defineProps<{
    title: string
    description: string
    kind?: 'danger' | 'primary'
    confirmLabel?: string
    cancelLabel?: string
  }>(),
  { kind: 'danger' },
)

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const { t } = useTheme()

const confirmBg = computed(() => (props.kind === 'danger' ? t.value.danger : t.value.accent))
</script>
