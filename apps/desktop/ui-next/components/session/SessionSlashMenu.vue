<template>
  <div class="slashint">
    <div class="sihead">
      <span>{{ t('sessions.composer.slashCommands') }}</span>
      <span class="sihint">{{ t('sessions.composer.slashHint') }}</span>
    </div>
    <div
      v-for="(c, i) in items"
      :key="c.name"
      class="si2"
      :class="{ on: i === active }"
      @mousedown.prevent="emit('select', c.name)"
      @mouseenter="emit('hover', i)"
    >
      <span class="sc">{{ c.name }}</span>
      <span class="sd">{{ t(c.descKey) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
// Slash `/` autocomplete dropdown (§2). Built-in MOCK command set — there is no
// real command backend here; the composer just inserts the picked `/name`. The
// composer owns the textarea + arrow-key navigation and passes `active` (the
// highlighted index) down; this component only renders + emits select/hover.
import type { SlashCommand } from './session-composer-mocks'

defineProps<{ items: SlashCommand[]; active: number }>()
const emit = defineEmits<{
  select: [name: string]
  hover: [i: number]
}>()
const { t } = useI18n()
</script>

<style scoped>
/* Header strip for the slash dropdown (reuses prototype .slashint frame + .si2/.sc
   /.sd rows from prototype.css; only the header + active highlight are local). */
.sihead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 11px;
  font-size: 0.8462rem;
  color: var(--textDim);
  border-bottom: 1px solid var(--border);
}
.sihint {
  font-style: italic;
  color: var(--textFaint);
}
.si2.on {
  background: var(--bgHover);
}
</style>
