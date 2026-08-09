<template>
  <div class="swin">
    <SessionDetail v-if="session" :key="session.id" :session="session" />
    <div v-else class="swin-miss">
      {{ resolving ? t('sessions.window.loading') : t('sessions.window.missing') }}
    </div>
    <AppGlobalHosts />
  </div>
</template>

<script setup lang="ts">
// Session popout window (docs/features/session-popout-window.md) — the SPA route an
// Electron popout loads (electron/src/session-window.ts). No app chrome: the same
// <SessionDetail> the main window renders fills the whole window, so there is ONE
// session implementation.
//
// The session arrives as a QUERY PARAM (its engine id), not in-memory state: a popout
// is a fresh renderer with its own store and its own numeric client ids, so the stable
// engine id is the only thing that can be handed over.
//
// Ownership: activateWindowSession binds this renderer to the session, which makes it
// the ONLY one that applies its engine events — the main window swaps to a hand-off
// placeholder for as long as this window lives (and re-reads the transcript when it
// closes). AppGlobalHosts brings the modal/toast/preview hosts the app shell normally
// mounts, so confirm/preview/export/"Run as task" behave exactly as in the main window.
import { computed, onMounted, ref, watch } from 'vue'
import { useSessionsStore } from '~/stores/sessions'

definePageMeta({ layout: false, keepalive: false })
defineOptions({ name: 'SessionWindowPage' })

const { t } = useI18n()
const route = useRoute()
const store = useSessionsStore()

// Query values are single strings here; an array (?id=a&id=b) is treated as absent.
const engineId = computed<string>(() => (typeof route.query.id === 'string' ? route.query.id : ''))

const resolving = ref(true)
const session = computed(() => store.active)

// Open on mount, and again if the URL is ever re-pointed at another session (main
// reuses one window per session, so this is a safety net rather than a normal flow).
async function openRequested(): Promise<void> {
  if (!engineId.value) {
    resolving.value = false
    return
  }
  resolving.value = true
  try {
    await store.activateWindowSession(engineId.value)
  } finally {
    resolving.value = false
  }
}
onMounted(openRequested)
watch(engineId, openRequested)

// Native window title = the session title (it follows a rename / auto-title), so
// several popouts are tellable apart in the window list.
useHead({
  title: computed(() => (session.value ? `${session.value.title} — AWOG` : 'AWOG')),
})
</script>

<style scoped>
/* Pin to the whole window: the detail pane owns its own internal scrolling, so the
   window body itself must never scroll. */
.swin {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
  overflow: hidden;
}
/* Only reachable when the window was opened for a session that no longer exists
   (deleted from the main window) or without an id (a malformed URL). */
.swin-miss {
  display: grid;
  place-items: center;
  height: 100vh;
  color: var(--textFaint);
}
</style>
