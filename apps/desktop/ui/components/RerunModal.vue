<template>
  <div
    class="absolute inset-0 backdrop-blur-sm flex items-center justify-center z-50 p-3"
    style="background: rgba(0, 0, 0, 0.5)"
    @click="emit('cancel')"
  >
    <div
      class="w-full max-w-[500px] rounded-lg overflow-hidden flex flex-col"
      :style="{
        background: t.bgPanel,
        border: `1px solid ${t.borderStrong}`,
        boxShadow: `0 20px 60px ${t.shadow}`,
      }"
      @click.stop
    >
      <div class="px-4 py-3 flex items-center" :style="{ borderBottom: `1px solid ${t.border}` }">
        <div class="flex items-center gap-2">
          <RotateCcw :size="14" :style="{ color: t.text }" />
          <div class="text-sm font-medium" :style="{ color: t.text }">
            Rerun from {{ agent.name }}
          </div>
        </div>
        <button class="ml-auto" :style="{ color: t.textDim }" @click="emit('cancel')">
          <X :size="15" />
        </button>
      </div>
      <div class="p-4 space-y-4">
        <div
          class="text-[11px] p-2.5 rounded flex items-start gap-2"
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
            All downstream phases will be invalidated and rerun. The current artifacts will be kept
            as v{{ phase.runs.length }} in history.
          </div>
        </div>
        <div>
          <label
            class="text-[10px] uppercase tracking-wider block mb-1.5 font-medium"
            :style="{ color: t.textDim }"
          >
            What needs to change?
          </label>
          <textarea
            v-model="instruction"
            :rows="5"
            autofocus
            placeholder="Example: The implementation doesn't handle the partitioned worker case..."
            class="w-full rounded px-2 py-1.5 text-[12px] resize-none leading-relaxed"
            :style="{
              background: t.bgInput,
              border: `1px solid ${t.border}`,
              color: t.text,
              outline: 'none',
            }"
          />
        </div>
      </div>
      <div class="px-4 py-3 flex justify-end gap-2" :style="{ borderTop: `1px solid ${t.border}` }">
        <button class="px-3 py-1.5 text-xs" :style="{ color: t.textMuted }" @click="emit('cancel')">
          Cancel
        </button>
        <button
          :disabled="!instruction.trim()"
          class="px-3 py-1.5 text-xs rounded font-medium transition disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          :style="{
            background: !instruction.trim() ? t.bgInput : t.accent,
            color: !instruction.trim() ? t.textFaint : t.accentText,
          }"
          @click="emit('confirm', instruction)"
        >
          <RotateCcw :size="11" />
          Rerun phase
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { RotateCcw, X, AlertCircle } from 'lucide-vue-next'
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
