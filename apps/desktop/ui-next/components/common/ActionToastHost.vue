<template>
  <!-- One app-lifetime host (mounted at the layout root) that renders one-shot
       action toasts (useActionToasts singleton). Mounting at the root keeps the
       fixed positioning viewport-relative. The corner is a user preference
       (Settings → Notifications → toast position); toasts always stack AWAY from
       their edge so the newest one sits closest to it. -->
  <div class="action-toasts" :style="hostStyle">
    <div
      v-for="tt in toasts"
      :key="tt.id"
      class="toast"
      :class="{ actionable: !!tt.action }"
      :style="{ borderColor: actionToastColor(tt.kind) }"
      @click="onClick(tt)"
    >
      <Icon
        :name="tt.icon ?? (tt.kind === 'success' ? 'check' : 'alert')"
        style="width: var(--icon-md); height: var(--icon-md); flex-shrink: 0"
        :style="{ color: actionToastColor(tt.kind) }"
      />
      <span>{{ tt.text }}</span>
      <!-- Affordance: this toast goes somewhere when clicked. -->
      <Icon
        v-if="tt.action"
        name="chev-right"
        style="width: var(--icon-sm); height: var(--icon-sm); flex-shrink: 0; color: var(--textDim)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  useActionToasts,
  dismissActionToast,
  actionToastColor,
  type ActionToast,
} from '~/composables/useActionToasts'
import { useSettingsStore } from '~/stores/settings'

const { toasts } = useActionToasts()
const settings = useSettingsStore()

// Anchor + stacking direction per corner. Bottom anchors stack upward
// (column-reverse) so the newest toast stays nearest the edge; top anchors stack
// downward. Centre variants ride the 50% + translate trick.
const EDGE = '28px'
// Top anchors clear the 44px app top bar (prototype.css `.top`) so a toast never
// lands on the window chrome.
const TOP_EDGE = '56px'
const hostStyle = computed(() => {
  const pos = settings.notifications.toastPosition
  const [vertical, horizontal] = pos.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']
  const style: Record<string, string> = {
    flexDirection: vertical === 'bottom' ? 'column-reverse' : 'column',
    alignItems:
      horizontal === 'right' ? 'flex-end' : horizontal === 'left' ? 'flex-start' : 'center',
  }
  style[vertical] = vertical === 'top' ? TOP_EDGE : EDGE
  if (horizontal === 'center') {
    style.left = '50%'
    style.transform = 'translateX(-50%)'
  } else {
    style[horizontal] = EDGE
  }
  return style
})

// A toast with an action routes somewhere (and dismisses); one without is just an
// acknowledgement, so clicking only dismisses it.
function onClick(toast: ActionToast): void {
  dismissActionToast(toast.id)
  toast.action?.()
}
</script>

<style scoped>
/* Anchor + direction come from hostStyle (the user's corner); everything here is
   corner-agnostic. Sits just above the quota toasts (z 140) so both remain
   legible if they ever co-show. */
.action-toasts {
  position: fixed;
  display: flex;
  gap: 10px;
  z-index: 141;
}
.action-toasts .toast {
  position: static;
  left: auto;
  bottom: auto;
  transform: none;
  cursor: pointer;
  max-width: min(460px, 90vw);
}
/* Actionable toast: reads as a target, not just a notice. */
.action-toasts .toast.actionable:hover {
  border-color: var(--accent);
}
.action-toasts .toast span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
