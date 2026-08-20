<template>
  <Transition name="doneflash">
    <div v-if="visible" class="doneflash" role="status" aria-live="polite">
      <AwogMascot :size="16" state="happy" />
      <span>{{ t('sessions.detail.doneFlash') }}</span>
    </div>
  </Transition>
</template>

<script setup lang="ts">
// Cute-family-only "turn finished" celebration (spec §13 — the mascot's one allowed
// appearance beyond the sidebar logo + empty states). Presentation-only: the parent
// (SessionDetail) hands us the session's live status, no store access here. We only
// react to the TRANSITION into 'done' — never on mount (a plain `watch` doesn't fire
// until the value actually changes) and never for any other status.
import { onBeforeUnmount, ref, watch } from 'vue'
import type { SessionStatus } from '~/composables/useSessionsData'

const props = defineProps<{ status: SessionStatus }>()
const { t } = useI18n()

const FLASH_MS = 1400
const visible = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

function clearTimer() {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

watch(
  () => props.status,
  (status, prevStatus) => {
    if (status !== 'done' || prevStatus === 'done') return
    clearTimer() // an overlapping transition restarts the timer instead of stacking
    visible.value = true
    timer = setTimeout(() => {
      visible.value = false
      timer = null
    }, FLASH_MS)
  },
)

onBeforeUnmount(clearTimer)
</script>

<style scoped>
/* Small pill chip, top-centre of the positioned ancestor the parent gives us
   (SessionDetail's `.chat`) — floats over the transcript without shifting layout.
   z-index stays in the "page" band (≤61: SessionDetail's own overlays start at 40/50
   for menus, 60 for the drop overlay) — well below the detail-level 80/81 popovers. */
.doneflash {
  position: absolute;
  top: 8px;
  left: 50%;
  z-index: 55;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--accentSoft, var(--accentDim));
  color: var(--accent);
  border: 1px solid var(--accentBorder);
  border-radius: var(--r-pill, 999px);
  box-shadow: var(--shadow-sm);
  font-weight: 600;
  pointer-events: none;
  transform: translateX(-50%);
}
.doneflash-enter-active,
.doneflash-leave-active {
  transition:
    opacity var(--dur-panel, 190ms) var(--ease),
    transform var(--dur-panel, 190ms) var(--ease);
}
.doneflash-enter-from,
.doneflash-leave-to {
  opacity: 0;
  transform: translate(-50%, -4px);
}
@media (prefers-reduced-motion: reduce) {
  .doneflash-enter-active,
  .doneflash-leave-active {
    transition: none;
  }
}
[data-reduced-motion='1'] .doneflash-enter-active,
[data-reduced-motion='1'] .doneflash-leave-active {
  transition: none;
}
</style>
