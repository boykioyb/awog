<template>
  <div class="slashint">
    <div class="sihead">
      <span>{{ t('sessions.composer.mentionTitle') }}</span>
      <span class="sihint">{{ t('sessions.composer.mentionHint') }}</span>
    </div>
    <div
      v-for="(m, i) in items"
      :key="m.kind + ':' + m.value"
      class="si2"
      :class="{ on: i === active }"
      @mousedown.prevent="emit('select', m.value)"
      @mouseenter="emit('hover', i)"
    >
      <span class="sc" :style="m.kind === 'agent' ? { color: 'var(--violet)' } : undefined">@</span>
      <span class="sd mlabel">{{ m.value }}</span>
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
// `@`-mention dropdown (§2). MOCK source — a small local list of agents + files
// (see session-composer-mocks); there is no real workspace index behind it. The
// composer owns the textarea + arrow-key navigation and passes `active` down; this
// component renders + emits select/hover only. Insert token = `@<value>`.
import type { MentionItem } from './session-composer-mocks'

defineProps<{ items: MentionItem[]; active: number }>()
const emit = defineEmits<{
  select: [value: string]
  hover: [i: number]
}>()
const { t } = useI18n()
</script>

<style scoped>
/* Header strip + active highlight (reuses prototype .slashint/.si2/.sc/.sd). */
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
/* The mentioned path/name takes the row; the kind tag pins to the right. */
.mlabel {
  color: var(--text);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mtag {
  flex: 0 0 auto;
  color: var(--textFaint);
}
</style>
