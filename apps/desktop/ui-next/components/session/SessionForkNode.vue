<template>
  <div
    class="w-47 cursor-pointer rounded-lg border px-3 py-2 transition-colors"
    :class="data.isCurrent ? 'border-ring bg-accent' : 'bg-card hover:border-input hover:bg-accent'"
    :title="data.title"
  >
    <Handle type="target" :position="Position.Left" :connectable="false" />
    <div class="truncate font-semibold text-foreground">{{ data.title }}</div>
    <div class="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
      <Icon name="fork" class="size-2.5" />
      {{ data.when }}
      <span v-if="data.isCurrent" class="ml-auto text-primary">
        {{ t('sessions.fork.current') }}
      </span>
    </div>
    <Handle type="source" :position="Position.Right" :connectable="false" />
  </div>
</template>

<script setup lang="ts">
// One node in the session fork-tree graph (SessionForkGraph). Read-only: handles
// are non-connectable (the graph is a viewer, not an editor). Click navigation is
// wired at the graph level via @node-click.
import { Handle, Position } from '@vue-flow/core'

defineProps<{
  data: { title: string; when: string; isCurrent: boolean; clientId: number }
}>()
const { t } = useI18n()
</script>
