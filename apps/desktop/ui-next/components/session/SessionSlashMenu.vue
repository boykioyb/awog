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
      <span class="sc" :title="`/${c.label}`">/{{ c.label }}</span>
      <span class="sd" :title="c.desc">{{ c.desc }}</span>
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

// Tag accent per kind: builtin = accent, command = blue, skill = violet. Exposed
// as a `--tagc` custom property so the pill derives both text + tinted background
// from one color (the CSS uses color-mix on it).
function tagStyle(kind: SlashItem['kind']) {
  const color =
    kind === 'builtin' ? 'var(--accent)' : kind === 'command' ? 'var(--blue)' : 'var(--violet)'
  return { '--tagc': color }
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
  font-size: var(--fs-xs);
  color: var(--textDim);
  background: var(--bgEl);
  border-bottom: 1px solid var(--border);
}
.sihint {
  font-style: italic;
  color: var(--textFaint);
}
/* Three-column grid so name / description / tag align into clean vertical columns
   across every row (the prototype's flex let long names + descriptions wrap, which
   read as ragged). Column 1 is a fixed rem width — scales with the Appearance font
   size — so descriptions start at the same x; longer names truncate (full name in
   the title tooltip). Overrides the prototype .si2 flex. */
.si2 {
  display: grid;
  grid-template-columns: 10.5rem minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 12px;
}
.si2.on {
  background: var(--bgHover);
  box-shadow: inset 2px 0 0 var(--accent);
}
/* Command name (col 1): single line, truncate with ellipsis past the column. */
.sc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
}
/* Description (col 2): single line, truncate; matches the name's size so baselines
   line up — hierarchy comes from the dim color, not a smaller font. */
.si2 .sd:not(.sitag) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
  color: var(--textDim);
}
/* Kind tag (col 3): right-aligned pill, text + faint tint from --tagc (set inline). */
.sitag {
  justify-self: end;
  font-size: 12px;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 3px 7px;
  border-radius: var(--r-xs);
  color: var(--tagc);
  background: color-mix(in srgb, var(--tagc) 13%, transparent);
}
</style>
