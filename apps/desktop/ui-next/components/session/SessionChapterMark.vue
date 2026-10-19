<template>
  <!-- Chapter divider: the model told us the work moved into a new phase
       (mark_chapter). Reads like the system divider on purpose — it is a
       boundary in the transcript, not a message. -->
  <div class="my-1.5 flex items-center gap-2.5">
    <Separator class="flex-1" />
    <span class="inline-flex max-w-[70%] items-baseline gap-2 text-muted-foreground">
      <Icon name="flag" class="size-3 self-center text-primary" />
      <span class="truncate text-sm font-semibold text-foreground">{{ block.title }}</span>
      <span v-if="block.summary" class="truncate text-xs text-muted-foreground">
        {{ block.summary }}
      </span>
    </span>
    <Separator class="flex-1" />
  </div>
</template>

<script setup lang="ts">
// One chapter marker in the transcript (#24). Title + optional one-liner, both
// plain text from the model (L1) — rendered as text nodes, never as markup.
import type { ChapterBlock } from '~/composables/useSessionsData'

defineProps<{ block: ChapterBlock }>()
</script>
