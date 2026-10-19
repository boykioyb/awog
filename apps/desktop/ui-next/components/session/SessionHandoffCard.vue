<template>
  <!-- hook-ok: `.detail` — app-shell.css `[data-page='sessions'] .md > .detail` chừa chỗ dock terminal -->
  <div class="detail" :class="ROOT_CLASS">
    <div class="flex flex-1 flex-col items-center justify-center gap-3 text-center text-dim">
      <span class="grid size-12 place-items-center rounded-xl border bg-muted text-dim">
        <Icon name="external" class="size-5" />
      </span>
      <div class="text-lg text-muted-foreground">
        {{ t('sessions.window.handedOff.title') }}
        <br />
        <span class="font-medium text-foreground">{{ session.title }}</span>
      </div>
      <div class="flex items-center gap-2">
        <Button @click="focusWindow">
          <Icon name="external" />
          {{ t('sessions.window.handedOff.focus') }}
        </Button>
        <Button variant="outline" @click="bringBack">
          {{ t('sessions.window.handedOff.bringBack') }}
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Hand-off placeholder (docs/features/session-popout-window.md): what the main window
// shows in place of the transcript while a session lives in its own OS window. The
// session has exactly ONE live view at a time, so this window renders no transcript
// and applies none of its events — it offers the two ways back instead: focus that
// window, or close it (which hands the session back here and reloads it).
import type { Session } from '~/composables/useSessionsData'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const store = useSessionsStore()

// Re-opening an already-open session focuses its window (main keeps one window per
// session), so "Focus" is the same call as "Open in its own window".
const focusWindow = () => void store.openInWindow(props.session.id)
const bringBack = () => void store.closeWindowFor(props.session.id)

// Cột chi tiết: lấp phần còn lại, nền content (thay skin `.detail` cũ — tên class giữ làm hook).
const ROOT_CLASS = 'flex min-w-0 flex-1 flex-col overflow-hidden bg-background'
</script>
