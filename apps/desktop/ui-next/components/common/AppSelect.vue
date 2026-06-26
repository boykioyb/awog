<template>
  <div ref="rootRef" class="asel" :style="{ width }">
    <button
      ref="triggerRef"
      type="button"
      class="aseltrigger"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
    >
      <span class="aselval" :class="{ ph: !selectedLabel }">
        {{ selectedLabel || placeholder }}
      </span>
      <Icon name="chev" class="aselchev" :class="{ open }" />
    </button>
    <!-- Teleported to body + fixed-positioned so the menu escapes any
         overflow-clipping / scroll ancestor (e.g. a modal body). -->
    <Teleport to="body">
      <div v-if="open" ref="menuRef" class="aselmenu" role="listbox" :style="menuStyle">
        <button
          v-for="opt in options"
          :key="opt.value"
          type="button"
          class="aselopt"
          :class="{ on: opt.value === model }"
          role="option"
          :aria-selected="opt.value === model"
          @click="select(opt.value)"
        >
          <span class="aseloptlbl">{{ opt.label }}</span>
          <Icon v-if="opt.value === model" name="check" class="aseltick" />
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
// Theme-token dropdown — replaces the native <select> (which WKWebView/Chromium
// render with non-themable chrome). v-model carries the option value; options are
// { label, value }. Closes on outside click (window mousedown) + Escape. Keeps the
// prototype's input/seg visual vocabulary (bgInput surface, accent active row).
// The menu is teleported to <body> and fixed-positioned (anchored to the trigger)
// so it escapes overflow-clipping / scroll ancestors such as a modal body.
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'

export type AppSelectOption = { label: string; value: string }

const props = withDefaults(
  defineProps<{
    options: readonly AppSelectOption[]
    placeholder?: string
    width?: string
  }>(),
  { placeholder: '', width: 'auto' },
)

const model = defineModel<string>({ required: true })

const open = ref(false)
const rootRef = useTemplateRef<HTMLElement>('rootRef')
const triggerRef = useTemplateRef<HTMLElement>('triggerRef')
const menuRef = useTemplateRef<HTMLElement>('menuRef')
const menuStyle = ref<Record<string, string>>({})

const selectedLabel = computed(
  () => props.options.find((o) => o.value === model.value)?.label ?? '',
)

// Position the teleported menu under (or above, when there isn't room) the
// trigger, matching its width and clamping the height to the available space.
const GAP = 4
const MAX_H = 280
function updatePosition() {
  const trigger = triggerRef.value
  if (!trigger) return
  const r = trigger.getBoundingClientRect()
  const vh = window.innerHeight
  const spaceBelow = vh - r.bottom - GAP
  const spaceAbove = r.top - GAP
  const menuH = menuRef.value?.scrollHeight ?? 0
  const flipUp = spaceBelow < Math.min(menuH || MAX_H, MAX_H) && spaceAbove > spaceBelow
  const maxH = Math.max(120, Math.min(MAX_H, flipUp ? spaceAbove : spaceBelow))
  // Width: at least the trigger, but grow to fit the longest option (so long
  // values — e.g. a repo slug — aren't truncated/scrolled), capped so it never
  // runs past the right viewport edge.
  const vw = window.innerWidth
  menuStyle.value = {
    left: `${Math.round(r.left)}px`,
    minWidth: `${Math.round(r.width)}px`,
    width: 'max-content',
    maxWidth: `${Math.round(Math.max(r.width, vw - r.left - 12))}px`,
    maxHeight: `${Math.round(maxH)}px`,
    ...(flipUp
      ? { bottom: `${Math.round(vh - r.top + GAP)}px` }
      : { top: `${Math.round(r.bottom + GAP)}px` }),
  }
}

function toggle() {
  open.value = !open.value
}
function select(value: string) {
  model.value = value
  open.value = false
}

function onWindowDown(e: MouseEvent) {
  if (!open.value) return
  const target = e.target as Node
  // Keep open for clicks on the trigger (toggle handles it) or inside the
  // teleported menu (select handles it); close for anything else.
  if (rootRef.value?.contains(target) || menuRef.value?.contains(target)) return
  open.value = false
}
function onKey(e: KeyboardEvent) {
  if (open.value && e.key === 'Escape') open.value = false
}
function onReposition() {
  if (open.value) updatePosition()
}

// Open/close drives the global listeners + initial positioning. The second
// updatePosition (after the menu mounts) refines the flip decision with the
// menu's real height.
watch(open, async (isOpen) => {
  if (isOpen) {
    updatePosition()
    window.addEventListener('mousedown', onWindowDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    await nextTick()
    updatePosition()
  } else {
    window.removeEventListener('mousedown', onWindowDown)
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('resize', onReposition)
    window.removeEventListener('scroll', onReposition, true)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onWindowDown)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onReposition)
  window.removeEventListener('scroll', onReposition, true)
})
</script>

<style scoped>
.asel {
  position: relative;
  display: inline-block;
}
.aseltrigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  border: 1px solid var(--border);
  background: var(--bgInput);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 0.9615rem;
  color: var(--text);
  cursor: pointer;
  font-family: var(--sans);
}
.aseltrigger:hover {
  border-color: var(--borderStrong);
}
.aselval {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aselval.ph {
  color: var(--textDim);
}
.aselchev {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  color: var(--textDim);
  transition: transform 0.15s;
}
.aselchev.open {
  transform: rotate(180deg);
}
.aselmenu {
  /* Fixed + teleported to body — top/left/width/max-height set inline by
     updatePosition so the menu escapes overflow-clipping ancestors. z-index sits
     above the modal overlay (.ovl = 100), matching the floating-menu layer. */
  position: fixed;
  z-index: 130;
  max-height: 280px;
  overflow-y: auto;
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
}
.aselopt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  border: 0;
  background: transparent;
  border-radius: 6px;
  padding: 6px 9px;
  font-size: 0.9615rem;
  color: var(--textMuted);
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  min-width: 0;
}
.aseloptlbl {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.aselopt:hover {
  background: var(--bgHover);
  color: var(--text);
}
.aselopt.on {
  color: var(--text);
  background: var(--bgActive);
}
.aseltick {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  color: var(--accent);
}
</style>
