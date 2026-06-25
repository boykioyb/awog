<template>
  <div
    class="rounded-xl select-none relative overflow-hidden"
    :style="{
      width: '210px',
      background: t.bgElevated,
      border: `1px solid ${selected ? t.accent : t.border}`,
      boxShadow: selected
        ? `0 0 0 1px ${t.accent}, 0 8px 24px -8px ${t.shadow}`
        : `0 2px 8px -4px ${t.shadow}`,
    }"
  >
    <Handle type="target" :position="Position.Top" :style="handleStyle" />
    <Handle type="target" :position="Position.Left" :style="handleStyle" />

    <div class="px-3 py-2.5 flex items-center gap-2">
      <RoleBadge v-if="data.agent" :role="agentRoleLabel(data.agent)" />
      <div class="min-w-0 flex-1">
        <div class="text-[1em] font-semibold truncate" :style="{ color: t.text }">
          {{ data.agent?.name ?? tr('workflows.node.unknown_agent') }}
        </div>
        <div class="text-[12px] font-mono leading-none truncate mt-1" :style="{ color: t.textDim }">
          {{ data.skill?.name || tr('workflows.no_skill') }}
        </div>
      </div>
    </div>
    <div
      class="px-3 py-1.5 text-[12px] flex items-center justify-between gap-2"
      :style="{ borderTop: `1px solid ${t.border}`, background: t.bgSubtle, color: t.textDim }"
    >
      <div class="flex items-center gap-1.5 truncate font-mono leading-none">
        <FileText :size="11" :style="{ color: t.textFaint }" />
        <span class="truncate">{{ data.outputs?.[0] ?? '' }}</span>
      </div>
      <AlertCircle
        v-if="data.approval"
        :size="12"
        :style="{ color: t.warning }"
        :title="tr('workflows.node.approval_gate')"
      />
    </div>

    <Handle type="source" :position="Position.Bottom" :style="handleStyle" />
    <Handle type="source" :position="Position.Right" :style="handleStyle" />

    <button
      v-if="selected"
      class="absolute top-1.5 right-1.5 w-5 h-5 rounded-lg flex items-center justify-center transition z-10"
      :style="{
        background: t.bgElevated,
        border: `1px solid ${t.borderStrong}`,
        color: t.textMuted,
      }"
      @click.stop="emit('delete', id)"
      @mouseenter="
        (e) => {
          const el = e.currentTarget as HTMLElement
          el.style.background = t.dangerBg
          el.style.color = t.danger
        }
      "
      @mouseleave="
        (e) => {
          const el = e.currentTarget as HTMLElement
          el.style.background = t.bgElevated
          el.style.color = t.textMuted
        }
      "
    >
      <Trash2 :size="11" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { AlertCircle, FileText, Trash2 } from 'lucide-vue-next'
import type { Agent, Skill } from '~/types'
import { agentRoleLabel } from '~/utils/agent-role'

interface NodeData {
  agent?: Agent
  skill?: Skill
  outputs: string[]
  approval: boolean
}

defineProps<{
  id: string
  data: NodeData
  selected: boolean
}>()

const emit = defineEmits<{
  delete: [id: string]
}>()

const { t } = useTheme()
const { t: tr } = useI18n()

const handleStyle = computed(() => ({
  background: t.value.borderStrong,
  border: `2px solid ${t.value.bgCanvas}`,
  width: '10px',
  height: '10px',
}))
</script>
