<template>
  <!-- Reactive wake, notify-only path (ADR 0066 P2). When a background command
       finishes while auto-continue is OFF, this card offers a one-click resume.
       Hidden under auto-continue (the store fires the turn itself when idle).
       Dải cảnh báo tô primary: phụ đề mono mờ, nút "tiếp tục" primary + nút bỏ ghost. -->
  <div
    v-if="visible"
    class="mx-3 mt-1.5 flex items-center gap-2.5 rounded-lg border border-primary/40 bg-primary/8 px-2.5 py-1.5 text-foreground"
  >
    <Icon name="zap" class="size-3.5 shrink-0 text-primary" />
    <div class="min-w-0 flex-1">
      <div class="text-sm font-semibold">{{ title }}</div>
      <!-- mono: lệnh shell vừa chạy -->
      <div class="truncate font-mono text-sm text-muted-foreground" :title="lastCommand">
        {{ subtitle }}
      </div>
    </div>
    <Button size="xs" @click="onContinue">
      <Icon name="play" class="size-3" />
      <span>{{ t('sessions.bg.wake.continue') }}</span>
    </Button>
    <Button
      variant="ghost"
      size="iconSm"
      class="text-muted-foreground hover:text-foreground"
      :title="t('sessions.bg.wake.dismiss')"
      :aria-label="t('sessions.bg.wake.dismiss')"
      @click="onDismiss"
    >
      <Icon name="x" class="size-3" />
    </Button>
  </div>
</template>

<script setup lang="ts">
// Wake card for the active session. Reads the store's pending-wake list (fed by
// session.background-done) and drives the normal turn path on "Continue".
import type { Session } from '~/composables/useSessionsData'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const store = useSessionsStore()
const settings = useSettingsStore()

const wakes = computed(() =>
  props.session.engineId ? store.pendingWakesFor(props.session.engineId) : [],
)
// Hidden under auto-continue — the store resumes on its own; a "Continue" button
// would be redundant/confusing during the brief busy window.
const visible = computed(
  () => !settings.sessions.autoContinueOnBackground && wakes.value.length > 0,
)

const lastCommand = computed(() => wakes.value[wakes.value.length - 1]?.command ?? '')
const title = computed(() =>
  wakes.value.length > 1
    ? t('sessions.bg.wake.titleN', { n: wakes.value.length })
    : t('sessions.bg.wake.title'),
)
const subtitle = computed(() => {
  const one = lastCommand.value.replace(/\s+/g, ' ').trim()
  return one.length > 64 ? `${one.slice(0, 63)}…` : one
})

function onContinue(): void {
  if (props.session.engineId) store.continueFromBackground(props.session.engineId)
}
function onDismiss(): void {
  if (props.session.engineId) store.dismissBackgroundWakes(props.session.engineId)
}
</script>
