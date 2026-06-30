<template>
  <!-- App-wide terminal dock. Lives in the layout flex column ABOVE the status
       bar, so when open it pushes the page up (a real panel, not an overlay).
       `v-show` (display:none when closed) removes it from the flex flow entirely
       while keeping the inner terminal mounted so its PTY + scrollback survive a
       close → reopen. -->
  <section v-show="isOpen" class="gterm" :style="{ height: `${height}px` }" :aria-hidden="!isOpen">
    <!-- Top-edge resize handle: drag up to grow the dock. -->
    <div
      class="gterm-rsz"
      role="separator"
      aria-orientation="horizontal"
      :title="t('terminalGlobal.resize')"
      @pointerdown="onResize"
    />

    <header class="gterm-head">
      <span class="gterm-title">
        <Icon name="commands" style="width: 13px; height: 13px" />
        {{ t('terminalGlobal.title') }}
      </span>
      <span class="gterm-cwd" :title="t('terminalGlobal.cwdHint')">~</span>
      <button
        class="gterm-close"
        :title="t('terminalGlobal.close')"
        :aria-label="t('terminalGlobal.close')"
        @click="close"
      >
        <X :size="14" />
      </button>
    </header>

    <div class="gterm-body">
      <!-- Mounted once first opened (everOpened) so the PTY persists across
           open/close; cwd is the home dir ("~", expanded by the sidecar). -->
      <WorkspaceTerminal
        v-if="everOpened"
        root="~"
        :ready="sc.available"
        pty-key="global"
        :visible="isOpen"
        :unavailable-label="t('terminalGlobal.unavailable')"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
// Global terminal dock — single app-lifetime mount in the default layout. The
// status bar's always-visible Terminal button toggles it via useGlobalTerminal.
// Decoupled from sessions: cwd = home ("~"), PTY group key "global". The heavy
// PTY + xterm logic is reused from the (now session-agnostic) WorkspaceTerminal.
import { X } from 'lucide-vue-next'
import { useGlobalTerminal } from '~/composables/useGlobalTerminal'
import { useSidecar } from '~/composables/useSidecar'

const { t } = useI18n()
const sc = useSidecar()
const { isOpen, everOpened, height, close, setHeight } = useGlobalTerminal()

// Drag the top edge: moving up (clientY decreases) grows the dock.
function onResize(ev: PointerEvent): void {
  ev.preventDefault()
  const handle = ev.currentTarget as HTMLElement
  handle.setPointerCapture(ev.pointerId)
  const startY = ev.clientY
  const startH = height.value
  const onMove = (e: PointerEvent): void => setHeight(startH + (startY - e.clientY))
  const onUp = (): void => {
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
  }
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
}
</script>

<style scoped>
.gterm {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-top: 1px solid var(--border);
  background: var(--bg);
}
/* Thin grab strip straddling the top border. */
.gterm-rsz {
  position: absolute;
  top: -3px;
  left: 0;
  right: 0;
  height: 7px;
  cursor: ns-resize;
  z-index: 1;
}
.gterm-rsz:hover {
  background: var(--accentDim);
}
.gterm-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 8px 0 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bgPanel);
}
.gterm-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}
.gterm-cwd {
  color: var(--textDim);
  font-family: var(--code);
  font-size: 12px;
  line-height: 1;
}
.gterm-close {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  transition:
    color 0.12s,
    background 0.12s;
}
.gterm-close:hover {
  color: var(--text);
  background: var(--bgHover);
}
.gterm-close:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.gterm-body {
  flex: 1;
  min-height: 0;
}
</style>
