<template>
  <div class="slashint">
    <div class="silabel">{{ t('sessions.composer.slashCommands') }}</div>
    <div class="silist">
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
    <div class="sifoot">{{ t('sessions.composer.slashHint') }}</div>
  </div>
</template>

<script setup lang="ts">
// Slash `/` autocomplete dropdown (§2). Real sources: built-in session commands
// (mode/compact/style — dispatched as actions) + user commands + skills (inserted
// as `/id`, expanded on send) + the Claude CLI's own commands (/goal, /context…,
// sent verbatim for the CLI to run — Claude SDK branch only). The composer owns the
// textarea + arrow-key nav and passes `active` (highlighted index) down; this
// renders + emits select(index)/hover.
import type { SlashItem } from './session-composer-commands'

defineProps<{ items: SlashItem[]; active: number }>()
const emit = defineEmits<{
  select: [i: number]
  hover: [i: number]
}>()
const { t } = useI18n()

// Tag accent per kind: builtin = primary, command = info, skill = violet, Claude
// CLI = warning. Exposed as a `--tagc` custom property so the pill derives both
// text + tinted background from one color (the CSS uses color-mix on it).
const TAG_COLOR: Record<SlashItem['kind'], string> = {
  builtin: 'var(--primary)',
  command: 'var(--info)',
  skill: 'var(--violet)',
  cli: 'var(--warning)',
}
function tagStyle(kind: SlashItem['kind']) {
  return { '--tagc': TAG_COLOR[kind] }
}
</script>

<style scoped>
/* Popover chrome — shadcn tokens: popover surface + hairline border + --radius +
   mid shadow, dense p-1 item padding. Label + footer hint pin outside the scroll
   region; the list itself scrolls (a bare `/` query can run past 80 rows). */
.slashint {
  display: flex;
  flex-direction: column;
  max-height: min(340px, 42vh);
  padding: 4px;
  background: var(--popover);
  border-color: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
}
.silist {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
/* Header label (DropdownMenuLabel tone) + footer hint strip. */
.silabel {
  flex: 0 0 auto;
  padding: 5px 8px 4px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 500;
  color: var(--muted-foreground);
}
.sifoot {
  flex: 0 0 auto;
  margin-top: 2px;
  padding: 5px 8px 3px;
  border-top: 1px solid var(--border);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
/* Three-column grid so name / description / tag align into clean vertical columns
   across every row (the prototype's flex let long names + descriptions wrap, which
   read as ragged). Column 1 is a fixed rem width — scales with the Appearance font
   size — so descriptions start at the same x; longer names truncate (full name in
   the title tooltip). Overrides the prototype .si2 flex. */
.silist .si2 {
  display: grid;
  grid-template-columns: 10.5rem minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 12px;
  padding: 5px 8px;
  border-radius: var(--r-xs);
}
.silist .si2.on {
  background: var(--accent-wash);
}
/* Command name (col 1): single line, truncate with ellipsis past the column. */
.sc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
/* Description (col 2): single line, truncate; matches the name's size so baselines
   line up — hierarchy comes from the muted color, not a smaller font. */
.silist .si2 .sd:not(.sitag) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--muted-foreground);
}
/* Kind tag (col 3): right-aligned pill, text + faint tint from --tagc (set inline).
   Nested under .si2 so the scoped rule beats the global `.slashint .sd` color. */
.silist .si2 .sitag {
  justify-self: end;
  font-size: 12px;
  line-height: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 3px 7px;
  border-radius: var(--r-xs);
  color: var(--tagc);
  background: color-mix(in srgb, var(--tagc) 13%, transparent);
}
</style>
