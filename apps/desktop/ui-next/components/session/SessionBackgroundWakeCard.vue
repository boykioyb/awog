<template>
  <!-- Reactive wake, notify-only path (ADR 0066 P2). When a background command
       finishes while auto-continue is OFF, this card offers a one-click resume.
       Hidden under auto-continue (the store fires the turn itself when idle). -->
  <div v-if="visible" class="bgwake">
    <Icon name="zap" class="bgwake-ic" style="width: var(--icon-sm); height: var(--icon-sm)" />
    <div class="bgwake-body">
      <div class="bgwake-title">{{ title }}</div>
      <div class="bgwake-sub" :title="lastCommand">{{ subtitle }}</div>
    </div>
    <Button size="xs" @click="onContinue">
      <Icon name="play" style="width: var(--icon-xs); height: var(--icon-xs)" />
      <span>{{ t('sessions.bg.wake.continue') }}</span>
    </Button>
    <Button
      variant="ghost"
      size="iconSm"
      class="bgwake-x"
      :title="t('sessions.bg.wake.dismiss')"
      @click="onDismiss"
    >
      <Icon name="x" style="width: var(--icon-xs); height: var(--icon-xs)" />
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

<style scoped>
/* Wake card — primary-tinted alert strip (card shape, primary accent edge),
   muted mono subtitle, primary "continue" + ghost dismiss actions. */
.bgwake {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 6px 12px 0;
  padding: 6px 10px;
  border-radius: var(--radius);
  border: 1px solid color-mix(in srgb, var(--primary) 40%, var(--border));
  background: color-mix(in srgb, var(--primary) 8%, transparent);
  color: var(--foreground);
}
.bgwake-ic {
  color: var(--primary);
  flex: none;
}
.bgwake-body {
  min-width: 0;
  flex: 1;
}
.bgwake-title {
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
}
.bgwake-sub {
  font-size: 12px;
  line-height: 18px;
  color: var(--muted-foreground);
  font-family: var(--code, monospace);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Ghost dismiss — quieter than the default ghost text until hovered. */
.bgwake-x {
  color: var(--muted-foreground);
}
.bgwake-x:hover {
  color: var(--foreground);
}
</style>
