<template>
  <!-- One app-lifetime host (mounted in the layout) that runs the quota guard
       (useQuotaGuard owns the watcher + actions) and renders its warning toasts.
       Reuses the prototype `.toast` surface; amber border = warning. Stacked in a
       fixed bottom-centre column so several warnings don't overlap. -->
  <div class="quota-toasts">
    <div
      v-for="tt in toasts"
      :key="tt.id"
      class="toast"
      :style="{ borderColor: 'var(--amber)' }"
      @click="dismissQuotaToast(tt.id)"
    >
      <Icon
        name="alert"
        style="width: var(--icon-md); height: var(--icon-md); color: var(--amber)"
      />
      <span>{{ tt.text }}</span>
      <!-- One-click "switch to an under-quota account & retry" (create block only). -->
      <button v-if="tt.action" type="button" class="q-act" @click.stop="runAction(tt)">
        {{ t('sessions.quota.switchTo', { account: tt.action.label }) }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useQuotaGuard, dismissQuotaToast, type QuotaToast } from '~/composables/useQuotaGuard'

const { t } = useI18n()
const { toasts } = useQuotaGuard()

// Run the toast's action (moves the default account + creates the session) then clear
// the toast — it never auto-dismissed, so we retire it here.
function runAction(tt: QuotaToast) {
  tt.action?.run()
  dismissQuotaToast(tt.id)
}
</script>

<style scoped>
/* Stack toasts upward from the bottom-centre so multiple warnings don't pile on
   the same fixed slot. Each `.toast` keeps its own surface from prototype.css. */
.quota-toasts {
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column-reverse;
  gap: 10px;
  z-index: 140;
}
.quota-toasts .toast {
  position: static;
  left: auto;
  bottom: auto;
  transform: none;
  cursor: pointer;
}
/* Inline "switch account & retry" action — accent-tinted pill so it reads as the
   primary way out of the block, distinct from the amber warning surface. */
.q-act {
  flex: 0 0 auto;
  padding: 3px 10px;
  border: 1px solid var(--accent);
  border-radius: var(--r-pill);
  background: var(--accentDim);
  color: var(--accent);
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background 0.12s,
    color 0.12s;
}
.q-act:hover {
  background: var(--accent);
  color: var(--accentText);
}
.q-act:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
