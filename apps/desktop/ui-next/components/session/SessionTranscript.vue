<template>
  <div class="msgs">
    <SessionWelcome v-if="!messages.length" />
    <SessionMessageItem
      v-for="(m, i) in messages"
      v-else
      :key="i"
      :message="m"
      :fallback-when="fallbackWhen"
    />
  </div>
</template>

<script setup lang="ts">
// Transcript list (renderMsgs ~1490) — .msgs container of message items, or the
// welcome / empty state when the session has no messages yet.
import type { SessionMessage } from '~/composables/useSessionsMock'

defineProps<{ messages: SessionMessage[]; fallbackWhen: string }>()
</script>
