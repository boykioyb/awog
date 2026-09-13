<template>
  <!-- The app's ONE toast surface (useToast). Mounted in AppGlobalHosts so both the
       main window and a session popout get it, and so a toast is never rendered
       inside a transformed ancestor — the reason the old code needed a second,
       separate toast system for the composer.

       Built on Reka UI's Toast primitives: ToastRoot owns the dismiss timer, which
       is what buys pause-on-hover, pause-on-window-blur, swipe-to-dismiss and the
       F8 "jump to notifications" landmark. -->
  <ToastProvider :duration="DEFAULT_DURATION" :swipe-direction="swipeDirection">
    <ToastRoot
      v-for="tt in toasts"
      :key="tt.id"
      v-model:open="tt.open"
      :duration="tt.duration"
      :type="tt.type ?? 'foreground'"
      class="tst"
      :class="[`tst-${tt.color ?? 'neutral'}`, { 'tst-click': !!tt.onClick }]"
      @update:open="(open: boolean) => !open && retire(tt.id)"
      @click="onRootClick(tt)"
    >
      <template #default="{ remaining, duration }">
        <Icon :name="tt.icon ?? iconFor(tt.color)" class="tsticn" />

        <div class="tstbody">
          <ToastTitle class="tsttl">{{ tt.title }}</ToastTitle>
          <!-- Wraps, unlike the title: a git error is several lines and the old
               single-line ellipsis cut it off mid-message. -->
          <ToastDescription v-if="tt.description" class="tstdesc">
            {{ tt.description }}
          </ToastDescription>

          <div v-if="tt.actions?.length" class="tstacts">
            <ToastAction
              v-for="(act, i) in tt.actions"
              :key="i"
              :alt-text="act.label"
              class="tstact"
              @click.stop="act.onClick?.($event)"
            >
              <Icon v-if="act.icon" :name="act.icon" class="tstacticn" />
              {{ act.label }}
            </ToastAction>
          </div>
        </div>

        <!-- Affordance for the whole-toast click-through (GitHub notification). -->
        <Icon v-if="tt.onClick && !tt.close" name="chev-right" class="tstgo" />

        <ToastClose v-if="tt.close" class="tstx" :aria-label="t('common.close')" @click.stop>
          <Icon name="x" class="tstxicn" />
        </ToastClose>

        <!-- Time left, in the semantic colour — this is where the colour lives now
             that the card itself is neutral. ToastRoot computes `remaining` and
             freezes it while the timer is paused (hover / window blur), so the bar
             stops with it. A toast with no timer (duration 0) has no bar. -->
        <div
          v-if="duration > 0"
          class="tstbar"
          :style="{ transform: `scaleX(${remaining / duration})` }"
        />
      </template>
    </ToastRoot>

    <ToastViewport class="tstvp" :style="viewportStyle" :label="t('common.toast.landmark')" />
  </ToastProvider>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastRoot,
  ToastTitle,
  ToastViewport,
} from 'reka-ui'
import { useToast, type ToastColor } from '~/composables/useToast'
import { useSettingsStore } from '~/stores/settings'

const { t } = useI18n()
const { toasts, remove } = useToast()
const settings = useSettingsStore()

const DEFAULT_DURATION = 5000

// Default glyph per semantic color. Callers override with `icon`.
function iconFor(color: ToastColor | undefined): string {
  if (color === 'success') return 'check'
  if (color === 'error' || color === 'warning') return 'alert'
  return 'info'
}

// Anchor + stacking direction per corner (Settings → Notifications → toast
// position). Bottom anchors stack upward so the newest toast stays nearest the
// edge; top anchors stack downward. Top clears the 44px app top bar so a toast
// never lands on the window chrome.
const EDGE = '28px'
const TOP_EDGE = '56px'

const corner = computed(() => {
  const [vertical, horizontal] = settings.notifications.toastPosition.split('-') as [
    'top' | 'bottom',
    'left' | 'center' | 'right',
  ]
  return { vertical, horizontal }
})

// Swipe away from the screen centre, so the gesture matches where the stack sits.
const swipeDirection = computed(() => {
  const { horizontal, vertical } = corner.value
  if (horizontal === 'left') return 'left' as const
  if (horizontal === 'right') return 'right' as const
  return vertical === 'top' ? ('up' as const) : ('down' as const)
})

const viewportStyle = computed(() => {
  const { vertical, horizontal } = corner.value
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

// Whole-toast click-through: run, then dismiss. Actions and the close button stop
// propagation, so this only fires on the toast body.
function onRootClick(tt: { id: string; onClick?: () => void }): void {
  if (!tt.onClick) return
  tt.onClick()
  retire(tt.id)
}

// `open` is already false by the time we get here (v-model wrote it), so ToastRoot
// is playing its exit. Dropping the row from the queue NOW would unmount the
// v-for item mid-animation, so hold it for the length of `tst-out` first.
const EXIT_MS = 140
function retire(id: string): void {
  setTimeout(() => remove(id), EXIT_MS)
}
</script>

<style>
/* NOT scoped. Reka UI's ToastViewport/ToastRoot render through `Primitive`, whose
   root is a fragment at compile time, so Vue cannot stamp this component's scope id
   onto them — a `<style scoped>` block here matches nothing and the toaster renders
   as an unstyled <ol> at the bottom of the document (measured). The class names are
   unique to the toaster, and theme-cute.css already targets `.tst` from a global
   sheet, so global is also the consistent choice.

   Anchor + direction come from viewportStyle (the user's corner); everything here
   is corner-agnostic. z 141 keeps toasts above overlays (.ovl, z 100) and menus
   (.smenu/.pop, z 130), matching where the old `.toast` sat. */
.tstvp {
  position: fixed;
  display: flex;
  gap: 10px;
  z-index: 141;
  width: min(460px, 90vw);
  list-style: none;
  margin: 0;
  padding: 0;
  outline: none;
  /* The viewport is always mounted and is as wide as its widest toast could be, so
     it must not eat clicks in that corner when empty (or beside a narrow toast).
     Only the toasts themselves are interactive. */
  pointer-events: none;
}

.tst {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  /* Shrink to content (so a short toast doesn't render as a 460px slab) but never
     past the viewport's width. */
  width: max-content;
  max-width: 100%;
  pointer-events: auto;
  background: var(--bgEl);
  /* Neutral surface. The semantic colour rides the ICON (and the progress bar),
     not the border: a full bright ring around the whole card is the loudest thing
     on screen for a message that is usually just an acknowledgement. This is also
     what Nuxt UI's toast does — the old `.toast` tinted its border per kind and it
     read as an alert box every time something succeeded. */
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  padding: 11px 13px;
  /* Containing block + clip for .tstbar, which rides the bottom edge. */
  position: relative;
  overflow: hidden;
  /* The shared elevation ramp, not the prototype's dark-only rgba(0,0,0,.5) —
     that one reads as a heavy grey slab on the light theme (app-shell.css §ramp). */
  box-shadow: var(--shadow-md);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
}

/* Semantic color → AWOG theme token. Never a hex, so theme-cute.css can restyle
   the whole family by redefining the tokens. Consumed by the icon + progress bar. */
.tst-success {
  --tstAccent: var(--green);
}
.tst-error {
  --tstAccent: var(--danger);
}
.tst-warning {
  --tstAccent: var(--amber);
}
.tst-primary {
  --tstAccent: var(--accent);
}
.tst-info {
  --tstAccent: var(--blue);
}
.tst-neutral {
  --tstAccent: var(--borderStrong);
}

.tst-click {
  cursor: pointer;
}
.tst-click:hover {
  border-color: var(--borderStrong);
}

.tsticn {
  width: var(--icon-md);
  height: var(--icon-md);
  flex-shrink: 0;
  color: var(--tstAccent, var(--textDim));
  /* Optical: line up with the title's cap height rather than its line box top. */
  margin-top: 1px;
}

.tstbody {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

/* One line, truncated — the headline stays scannable. Detail belongs in
   .tstdesc, which wraps. */
.tsttl {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.tstdesc {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  /* Wraps, and breaks long unbroken tokens (a path, a SHA) instead of forcing the
     toast wider than its max-width. `pre-wrap` keeps the source's own line breaks:
     git's stderr is written as lines ("error: …" / "hint: …") and collapsing them
     into one paragraph is what made it unreadable. */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  /* Cap runaway detail; the full text stays available in the source surface. */
  max-height: 120px;
  overflow-y: auto;
}

.tstacts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.tstact {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  padding: 3px 9px;
  color: var(--text);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
  transition:
    background 0.12s,
    border-color 0.12s;
}
.tstact:hover {
  background: var(--accentDim);
  border-color: var(--accentBorder);
}
.tstacticn {
  width: var(--icon-xs);
  height: var(--icon-xs);
}

/* Drains left-to-right with the dismiss timer. 2px so it reads as a hairline of
   colour, not a second border. */
.tstbar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--tstAccent, var(--borderStrong));
  transform-origin: left;
  opacity: 0.7;
}

.tstgo {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex-shrink: 0;
  color: var(--textDim);
  margin-top: 2px;
}

.tstx {
  flex-shrink: 0;
  background: transparent;
  border: 0;
  border-radius: var(--r-xs);
  padding: 2px;
  color: var(--textDim);
  cursor: pointer;
  transition:
    background 0.12s,
    color 0.12s;
}
.tstx:hover {
  background: var(--bgHover);
  color: var(--text);
}
.tstxicn {
  width: var(--icon-sm);
  height: var(--icon-sm);
  display: block;
}

/* Swipe feedback: follow the pointer while swiping, snap back on cancel, slide
   out on end. Reka UI sets --reka-toast-swipe-move-x/y and the data-swipe state. */
.tst[data-swipe='move'] {
  transform: translate(var(--reka-toast-swipe-move-x, 0), var(--reka-toast-swipe-move-y, 0));
}
.tst[data-swipe='cancel'] {
  transform: translate(0, 0);
  transition: transform 0.16s ease-out;
}

.tst[data-state='open'] {
  animation: tst-in 0.16s ease-out;
}
.tst[data-state='closed'] {
  animation: tst-out 0.12s ease-in;
}

@keyframes tst-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
@keyframes tst-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
    transform: scale(0.97);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tst[data-state='open'],
  .tst[data-state='closed'] {
    animation: none;
  }
  .tst[data-swipe='cancel'] {
    transition: none;
  }
}
</style>
