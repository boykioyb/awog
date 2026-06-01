<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-40" @click="emit('close')" />
    <div
      v-if="open"
      class="fixed z-50 rounded-md shadow-lg overflow-hidden py-1 min-w-[230px]"
      :style="{
        background: t.bgPanel,
        border: `1px solid ${t.borderStrong}`,
        boxShadow: `0 8px 24px ${t.shadow}`,
        top: `${anchor.top}px`,
        left: `${anchor.left}px`,
      }"
    >
      <button
        v-for="tool in WORKSPACE_TOOLS"
        :key="tool.id"
        type="button"
        class="w-full text-left px-3 py-1.5 flex items-center gap-2 text-[1em] transition"
        :style="{
          color: active === tool.id ? t.accent : t.text,
          background: active === tool.id ? t.bgSubtle : 'transparent',
        }"
        @click="emit('select', tool.id)"
      >
        <component :is="tool.icon" :size="13" :style="{ color: t.textDim }" />
        <span class="flex-1">{{ tr(tool.labelKey) }}</span>
        <span
          v-if="tool.shortcutHint"
          class="font-mono text-[12px] leading-none"
          :style="{ color: t.textFaint }"
        >
          {{ tool.shortcutHint }}
        </span>
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { WorkspaceTab } from '~/types'
import { WORKSPACE_TOOLS } from '~/utils/workspace-tools'

defineProps<{
  open: boolean
  anchor: { top: number; left: number }
  active: WorkspaceTab | null
}>()

const emit = defineEmits<{
  select: [tab: WorkspaceTab]
  close: []
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
</script>
