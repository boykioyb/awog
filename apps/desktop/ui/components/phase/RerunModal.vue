<template>
  <BaseModal :open="true" size="md" @close="emit('cancel')">
    <template #header>
      <div class="flex items-center gap-2">
        <RotateCcw :size="14" :style="{ color: t.text }" />
        <div class="text-[1em] font-medium" :style="{ color: t.text }">
          Rerun from {{ agent.name }}
        </div>
      </div>
    </template>

    <div class="p-4 space-y-4">
      <div
        class="text-[1em] p-2.5 rounded-lg flex items-start gap-2"
        :style="{
          background: t.warningBg,
          border: `1px solid ${t.warningBorder}`,
          color: t.textMuted,
        }"
      >
        <AlertCircle
          :size="12"
          class="flex-shrink-0"
          :style="{ color: t.warning, marginTop: '1px' }"
        />
        <div>
          All downstream phases will be invalidated and rerun. The current artifacts will be kept as
          v{{ phase.runs.length }} in history.
        </div>
      </div>
      <Field label="What needs to change?">
        <!-- Single-purpose modal input → resize-none per UI patterns. -->
        <textarea
          v-model="instruction"
          :rows="5"
          autofocus
          placeholder="Example: The implementation doesn't handle the partitioned worker case..."
          class="w-full rounded-lg px-2.5 py-1.5 text-[1em] resize-none leading-relaxed"
          :style="{
            background: t.bgInput,
            border: `1px solid ${t.border}`,
            color: t.text,
            outline: 'none',
          }"
        />
      </Field>
    </div>

    <template #footer>
      <AppButton variant="ghost" @click="emit('cancel')">Cancel</AppButton>
      <AppButton :disabled="!instruction.trim()" @click="emit('confirm', instruction)">
        <RotateCcw :size="11" />
        Rerun phase
      </AppButton>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { RotateCcw, AlertCircle } from 'lucide-vue-next'
import type { Phase, Agent } from '~/types'

defineProps<{
  phase: Phase
  agent: Agent
}>()

const emit = defineEmits<{
  confirm: [instruction: string]
  cancel: []
}>()

const { t } = useTheme()

const instruction = ref('')
</script>
