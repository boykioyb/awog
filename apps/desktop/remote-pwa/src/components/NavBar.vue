<script setup lang="ts">
import { ChevronLeft } from 'lucide-vue-next'

// iOS-style navigation bar: a translucent blurred strip with borderless
// accent-tinted buttons and a centred compact title. With `large` the compact
// title stays hidden until the view's scrolling `.big` title passes under the
// bar — that is what the `collapsed` prop reports.
withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    back?: boolean
    large?: boolean
    collapsed?: boolean
  }>(),
  { back: false, large: false, collapsed: false },
)
const emit = defineEmits<{ (e: 'back'): void; (e: 'title'): void }>()
</script>

<template>
  <header class="nav" :class="{ collapsed, large }">
    <div class="side">
      <button
        v-if="back"
        class="navbtn"
        title="Quay lại"
        aria-label="Quay lại"
        @click="emit('back')"
      >
        <ChevronLeft class="icn-xl" />
      </button>
      <slot name="leading" />
    </div>
    <button class="mid" @click="emit('title')">
      <span class="t">{{ title }}</span>
      <span v-if="subtitle" class="s">{{ subtitle }}</span>
    </button>
    <div class="side right">
      <slot name="trailing" />
    </div>
  </header>
</template>

<style scoped>
.nav {
  flex: 0 0 auto;
  position: relative;
  display: flex;
  align-items: center;
  min-height: var(--tap);
  padding: 2px 6px;
  /* Translucent + blur is the iOS bar material — the scrolling content peeks
     through instead of hitting a hard edge. */
  background: color-mix(in srgb, var(--bg) 78%, transparent);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  z-index: 3;
}
/* The hairline separator only appears once content scrolls under the bar —
   at rest the large title flows straight into the bar area, as on iOS. */
.nav::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background: var(--border);
  opacity: 0;
  transition: opacity 0.15s;
}
.nav.collapsed::after {
  opacity: 1;
}
.side {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: var(--tap);
  z-index: 1;
}
.side.right {
  margin-left: auto;
  justify-content: flex-end;
}
.mid {
  position: absolute;
  /* Both sides keep a 52px margin clear of the button columns, so a long
     title ellipsizes before it can sit on top of a button. */
  left: 52px;
  right: 52px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: var(--tap);
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text);
  transition: opacity 0.15s;
}
.nav.large:not(.collapsed) .mid {
  opacity: 0;
  pointer-events: none;
}
.mid:active {
  opacity: 0.55;
}
.t {
  max-width: 100%;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.s {
  max-width: 100%;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Bar buttons are borderless and accent-tinted — the boxed `.icon` button is
   the desktop-toolbar look this bar replaces. `navbtn` is also the class views
   put on their slot buttons; it lives in style.css because scoped styles here
   cannot reach slot content. */
</style>
