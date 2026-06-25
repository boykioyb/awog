<template>
  <div class="slashint">
    <div class="sihead">
      <span>{{ t('sessions.composer.slashCommands') }}</span>
      <span class="sihint">{{ t('sessions.composer.slashHint') }}</span>
    </div>
    <div
      v-for="(c, i) in items"
      :key="c.key"
      class="si2"
      :class="{ on: i === active }"
      @mousedown.prevent="emit('select', i)"
      @mouseenter="emit('hover', i)"
    >
      <span class="sc">/{{ c.label }}</span>
      <span class="sd">{{ c.desc }}</span>
      <span class="sd sitag" :style="tagStyle(c.kind)">
        {{ t(`sessions.composer.kind.${c.kind}`) }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
// Slash `/` autocomplete dropdown (§2). Real sources: built-in session commands
// (mode/compact/style — dispatched as actions) + user commands + skills (inserted
// as `/id`, expanded on send). The composer owns the textarea + arrow-key nav and
// passes `active` (highlighted index) down; this renders + emits select(index)/hover.
import type { SlashItem } from './session-composer-commands'

defineProps<{ items: SlashItem[]; active: number }>()
const emit = defineEmits<{
  select: [i: number]
  hover: [i: number]
}>()
const { t } = useI18n()

// Tag accent per kind: builtin = accent, command = blue, skill = violet.
function tagStyle(kind: SlashItem['kind']) {
  const color =
    kind === 'builtin' ? 'var(--accent)' : kind === 'command' ? 'var(--blue)' : 'var(--violet)'
  return { color }
}
</script>

<style scoped>
/* Bound the dropdown height so a long catalog (all built-ins + commands + skills,
   shown when the query is empty) scrolls inside the menu instead of growing tall
   enough to cover the screen. Overrides the prototype's overflow:hidden on
   .slashint; the header stays pinned while the rows scroll. */
.slashint {
  max-height: min(340px, 42vh);
  overflow-y: auto;
}
/* Header strip for the slash dropdown (reuses prototype .slashint frame + .si2/.sc
   /.sd rows from prototype.css; only the header + active highlight are local). */
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
/* The description takes the row; the kind tag pins to the right. */
.si2 .sd:first-of-type {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sitag {
  flex: 0 0 auto;
  font-family: var(--code);
  font-size: 12px;
}
</style>
