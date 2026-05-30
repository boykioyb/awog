<template>
  <template v-for="(p, pi) in parts" :key="pi">
    <strong v-if="p.type === 'bold'" :style="{ color: t.syntax.bold, fontWeight: 600 }">
      {{ p.text }}
    </strong>
    <em v-else-if="p.type === 'italic'" :style="{ color: t.syntax.italic }">{{ p.text }}</em>
    <code
      v-else-if="p.type === 'code'"
      class="px-1 py-0.5 rounded font-mono text-[0.86em]"
      :style="{ background: t.bgInput, color: t.syntax.code, border: `1px solid ${t.border}` }"
    >
      {{ p.text }}
    </code>
    <a
      v-else-if="p.type === 'link'"
      :href="p.href"
      class="underline"
      :style="{ color: t.syntax.link }"
    >
      {{ p.text }}
    </a>
    <span v-else>{{ p.text }}</span>
  </template>
</template>

<script setup lang="ts">
import type { InlinePart } from '~/utils/markdown-parse'

defineProps<{ parts: InlinePart[] }>()
const { t } = useTheme()
</script>
