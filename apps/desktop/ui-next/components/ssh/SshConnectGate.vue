<template>
  <div class="flex shrink-0 items-center gap-2.5 rounded-lg border bg-card px-3.5 py-3">
    <Icon name="conn" class="size-4 shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1 text-sm text-muted-foreground">
      {{ t('ssh.conn.needConnect') }}
    </span>
    <Button variant="default" size="sm" @click="emit('connect')">
      <Icon name="play" />
      {{ t('ssh.detail.connect') }}
    </Button>
    <Button
      variant="ghost"
      size="iconSm"
      class="text-muted-foreground"
      :title="t('ssh.panel.close')"
      :aria-label="t('ssh.panel.close')"
      @click="emit('close')"
    >
      <Icon name="x" />
    </Button>
  </div>
</template>

<script setup lang="ts">
import Button from '~/components/ui/button/Button.vue'

// Shown in the detail body when SFTP / forward is opened for a host that isn't
// connected yet (ADR 0063) — SFTP + forwards run over a live connection, so this
// prompts Connect (opens the terminal → establishes the connId) or closes.
const emit = defineEmits<{ connect: []; close: [] }>()
const { t } = useI18n()
</script>
