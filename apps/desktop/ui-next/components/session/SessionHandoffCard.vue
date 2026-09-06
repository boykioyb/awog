<template>
  <div class="detail">
    <div class="empty">
      <span class="ei"><Icon name="external" style="width: 22px; height: 22px" /></span>
      <div class="et">
        {{ t('sessions.window.handedOff.title') }}
        <br />
        <span class="ho-title">{{ session.title }}</span>
      </div>
      <div class="ho-actions">
        <button class="btn pri" @click="focusWindow">
          <Icon name="external" />
          {{ t('sessions.window.handedOff.focus') }}
        </button>
        <button class="btn" @click="bringBack">
          {{ t('sessions.window.handedOff.bringBack') }}
        </button>
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
</script>

<style scoped>
.ho-title {
  color: var(--text);
  font-weight: 550;
}
.ho-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
