<template>
  <Card
    class="relative w-42 cursor-pointer gap-0 rounded-lg px-3 py-2.5 shadow-md"
    :class="{ 'border-primary ring-1 ring-primary': selected }"
  >
    <Handle type="target" :position="Position.Left" />

    <div class="flex items-center gap-2">
      <span
        class="grid size-4.5 shrink-0 place-items-center rounded-sm bg-selected text-xs font-semibold text-primary"
      >
        {{ roleBadge }}
      </span>
      <div class="truncate text-sm font-semibold text-foreground">
        {{ data.agent?.name ?? t('workflow.node.unknownAgent') }}
      </div>
    </div>
    <div class="mt-1 truncate text-xs text-dim">
      {{ data.skill?.name || t('workflow.node.noSkill') }}
    </div>

    <div class="mt-2 flex items-center justify-between gap-2 border-t pt-2">
      <span class="flex min-w-0 items-center gap-1.5 font-mono text-xs text-dim">
        <Icon name="folder" class="size-3 shrink-0" />
        <span class="truncate">{{ data.outputs?.[0] ?? '' }}</span>
      </span>
      <Icon
        v-if="data.isGate"
        name="refresh"
        class="size-3 shrink-0 text-primary"
        :title="t('workflow.node.qualityGate')"
      />
      <Icon
        v-if="data.approval"
        name="shield"
        class="size-3 shrink-0 text-warning"
        :title="t('workflow.node.approvalGate')"
      />
    </div>

    <Handle type="source" :position="Position.Right" />

    <Button
      v-if="selected"
      variant="outline"
      size="iconSm"
      class="absolute top-1.5 right-1.5 size-5 bg-card text-muted-foreground hover:border-transparent hover:bg-destructive/10 hover:text-destructive"
      :title="t('common.delete')"
      @click.stop="onDelete"
    >
      <Icon name="trash" class="size-3" />
    </Button>
  </Card>
</template>

<script setup lang="ts">
// One agent node rendered inside the VueFlow canvas. Receives VueFlow's node
// props (id/data/selected). `data` carries the resolved agent/skill slices +
// outputs/approval + an onDelete callback (VueFlow custom nodes can't emit to
// the canvas, so the delete handler is threaded through node.data).
import { Handle, Position } from '@vue-flow/core'
import { computed } from 'vue'
import Button from '~/components/ui/button/Button.vue'
import Card from '~/components/ui/card/Card.vue'
import type { WorkflowAgent, WorkflowSkill } from '~/composables/useWorkflowGen'

type NodeData = {
  agent?: WorkflowAgent
  skill?: WorkflowSkill
  outputs: string[]
  approval: boolean
  // True when the node has a gate config (ADR 0056) — shows the loop indicator.
  isGate?: boolean
  onDelete?: (id: string) => void
}

const props = defineProps<{ id: string; data: NodeData; selected: boolean }>()

const { t } = useI18n()

// Role abbreviation (the agent's `role` field, e.g. TL/DV/QA) or the first two
// letters of the name as a fallback.
const roleBadge = computed(() => {
  const r = props.data.agent?.role?.trim()
  if (r) return r.slice(0, 2).toUpperCase()
  return (props.data.agent?.name ?? '?').slice(0, 2).toUpperCase()
})

const onDelete = () => props.data.onDelete?.(props.id)
</script>
