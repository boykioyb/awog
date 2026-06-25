<template>
  <div class="slashint">
    <div class="sihead">
      <span>{{ t('sessions.composer.mentionTitle') }}</span>
      <span class="sihint">{{ t('sessions.composer.mentionHint') }}</span>
    </div>
    <div
      v-for="(m, i) in items"
      :key="m.key"
      class="si2"
      :class="{ on: i === active }"
      @mousedown.prevent="emit('select', i)"
      @mouseenter="emit('hover', i)"
    >
      <span class="sc" :style="m.kind === 'agent' ? { color: 'var(--violet)' } : undefined">@</span>
      <span class="sd mlabel">{{ m.label }}</span>
      <span v-if="m.hint" class="sd mhint">{{ m.hint }}</span>
      <span class="sd mtag">
        {{
          m.kind === 'agent'
            ? t('sessions.composer.mentionAgent')
            : t('sessions.composer.mentionFile')
        }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
// `@`-mention dropdown (§2). Real sources: enabled session agents (agents.list)
// + the workspace file index (fs.listFiles, .gitignore-aware). The composer owns
// the textarea + arrow-key nav and passes `active` down; this renders + emits
// select(index)/hover only. Insert token = `@<insert>` (agent handle / file path).
import type { MentionRow } from './session-composer-commands'

defineProps<{ items: MentionRow[]; active: number }>()
const emit = defineEmits<{
  select: [i: number]
  hover: [i: number]
}>()
const { t } = useI18n()
</script>

<style scoped>
/* Bound the dropdown height so a long list (agents + the whole workspace file
   index when the query is empty) scrolls inside the menu instead of growing tall
   enough to cover the screen. Overrides the prototype's overflow:hidden on
   .slashint; the header stays pinned while the rows scroll. */
.slashint {
  max-height: min(340px, 42vh);
  overflow-y: auto;
}
/* Header strip + active highlight (reuses prototype .slashint/.si2/.sc/.sd). */
.sihead {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 11px;
  font-size: 0.8462rem;
  color: var(--textDim);
  background: var(--bgEl);
  border-bottom: 1px solid var(--border);
}
.sihint {
  font-style: italic;
  color: var(--textFaint);
}
.si2.on {
  background: var(--bgHover);
}
/* The agent name / file basename takes the row; path hint + kind tag pin right. */
.mlabel {
  color: var(--text);
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mhint {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--textFaint);
  font-family: var(--code);
  font-size: 12px;
}
.mtag {
  flex: 0 0 auto;
  color: var(--textFaint);
}
</style>
