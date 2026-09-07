<template>
  <!-- Chapter divider: the model told us the work moved into a new phase
       (mark_chapter). Reads like the system divider (.sysdiv) on purpose — it is a
       boundary in the transcript, not a message. -->
  <div class="chapmark">
    <span class="chline" />
    <span class="chbody">
      <Icon name="flag" style="width: var(--icon-xs); height: var(--icon-xs)" />
      <span class="chtitle">{{ block.title }}</span>
      <span v-if="block.summary" class="chsum">{{ block.summary }}</span>
    </span>
    <span class="chline" />
  </div>
</template>

<script setup lang="ts">
// One chapter marker in the transcript (#24). Title + optional one-liner, both
// plain text from the model (L1) — rendered as text nodes, never as markup.
import type { ChapterBlock } from '~/composables/useSessionsData'

defineProps<{ block: ChapterBlock }>()
</script>

<style scoped>
.chapmark {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 6px 0;
}
.chline {
  flex: 1;
  height: 1px;
  background: var(--border);
}
.chbody {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  max-width: 70%;
  color: var(--textDim);
}
.chbody .icn {
  align-self: center;
  color: var(--accent);
}
.chtitle {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chsum {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
