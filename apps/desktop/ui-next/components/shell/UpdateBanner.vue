<template>
  <!-- Global auto-update banner (ADR 0028). Single app-lifetime mount in the
       layout, between the top bar and the page body so it pushes content down
       (full width) instead of overlaying it. Renders nothing unless the update
       store says there's something worth surfacing. -->
  <div v-if="update.bannerVisible" class="upd-banner" :class="{ error: isError }">
    <Icon :name="leadIcon" class="upd-ic" />

    <div class="upd-body">
      <div class="upd-msg">{{ message }}</div>
      <div v-if="update.status === 'downloading'" class="upd-track">
        <div class="upd-bar" :style="{ width: `${update.progressPercent}%` }" />
      </div>
    </div>

    <div class="upd-actions">
      <button
        v-if="action"
        class="btn sm pri"
        :disabled="update.actionBusy"
        @click="update.runPrimaryAction()"
      >
        <Icon :name="action.icon" :class="{ uaspin: update.actionBusy }" />
        {{ action.label }}
      </button>
      <button v-if="showDismiss" class="btn sm" @click="update.dismiss()">
        {{ dismissLabel }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useUpdateStore } from '~/stores/update'

const { t } = useI18n()
const update = useUpdateStore()
const { action } = useUpdateAction()

const isError = computed(() => update.status === 'error')

const message = computed(() => {
  switch (update.status) {
    case 'available':
      return t('update.banner.available', { version: update.newVersion ?? '' })
    case 'downloading':
      return t('update.banner.downloading', { percent: update.progressPercent })
    case 'downloaded':
      return t('update.banner.downloaded', { version: update.newVersion ?? '' })
    case 'error':
      return t('update.banner.error')
    default:
      return ''
  }
})

const leadIcon = computed(() => {
  if (update.status === 'error') return 'alert'
  if (update.status === 'downloaded') return 'check'
  return 'download'
})

// No dismiss mid-download (no cancel — let it finish).
const showDismiss = computed(() => update.status !== 'downloading')
const dismissLabel = computed(() =>
  update.status === 'downloaded' ? t('update.dismiss.later') : t('update.dismiss.dismiss'),
)
</script>

<style scoped>
/* Accent-tinted notice (not a gray fill) for the update lifecycle; danger tint
   for an error. Colours come from theme CSS vars so dark/light both hold. */
.upd-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: var(--accentDim);
  border-bottom: 1px solid var(--accentBorder);
}
.upd-banner.error {
  background: var(--dangerDim);
  border-bottom-color: var(--danger);
}
.upd-ic {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  color: var(--accent);
}
.upd-banner.error .upd-ic {
  color: var(--danger);
}
.upd-body {
  flex: 1;
  min-width: 0;
}
.upd-msg {
  font-size: 1em;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.upd-track {
  margin-top: 4px;
  height: 4px;
  border-radius: var(--r-pill);
  overflow: hidden;
  background: var(--border);
}
.upd-bar {
  height: 100%;
  border-radius: var(--r-pill);
  background: var(--accent);
  transition: width 0.2s;
}
.upd-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
/* Spinner for the in-flight primary action (no rotate keyframe in prototype.css). */
.uaspin {
  animation: uaspin 0.8s linear infinite;
}
@keyframes uaspin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .uaspin {
    animation: none;
  }
}
</style>
