<template>
  <div ref="rootRef" class="asel" :style="{ width }">
    <button
      ref="triggerRef"
      type="button"
      class="aseltrigger"
      :disabled="disabled"
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
        <div v-if="searchable" class="aselsearch" @mousedown.stop>
          <Icon name="search" class="aselsearchic" />
          <input
            ref="searchRef"
            v-model="search"
            class="aselsearchin"
            :placeholder="searchPlaceholder || 'Search…'"
            @keydown.esc.stop="open = false"
            @keydown.enter.prevent="selectFirst"
          />
        </div>
        <div v-if="searchable && !filtered.length" class="aselnone">{{ emptyLabel }}</div>
        <button
          v-for="opt in filtered"
          :key="opt.value"
          type="button"
          class="aselopt"
          :class="{ on: opt.value === model, disabled: opt.disabled }"
          role="option"
          :aria-selected="opt.value === model"
          :aria-disabled="opt.disabled"
          :disabled="opt.disabled"
          @click="select(opt)"
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

export type AppSelectOption = { label: string; value: string; disabled?: boolean }

const props = withDefaults(
  defineProps<{
    options: readonly AppSelectOption[]
    placeholder?: string
    width?: string
    disabled?: boolean
    // Ô tìm kiếm trong menu (combobox) — cho danh sách dài như project/repo.
    searchable?: boolean
    searchPlaceholder?: string
    emptyLabel?: string
  }>(),
  {
    placeholder: '',
    width: 'auto',
    disabled: false,
    searchable: false,
    searchPlaceholder: '',
    emptyLabel: 'No matches',
  },
)

const model = defineModel<string>({ required: true })

const open = ref(false)
const rootRef = useTemplateRef<HTMLElement>('rootRef')
const triggerRef = useTemplateRef<HTMLElement>('triggerRef')
const menuRef = useTemplateRef<HTMLElement>('menuRef')
const searchRef = useTemplateRef<HTMLInputElement>('searchRef')
const menuStyle = ref<Record<string, string>>({})
const search = ref('')

// Searchable: lọc theo label không phân biệt hoa-thường; giữ thứ tự options.
const filtered = computed(() => {
  if (!props.searchable || !search.value.trim()) return props.options
  const q = search.value.trim().toLowerCase()
  return props.options.filter((o) => o.label.toLowerCase().includes(q))
})

function selectFirst() {
  const first = filtered.value.find((o) => !o.disabled)
  if (first) select(first)
}

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
  if (props.disabled) return
  open.value = !open.value
}
function select(opt: AppSelectOption) {
  if (opt.disabled) return
  model.value = opt.value
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
    search.value = ''
    updatePosition()
    window.addEventListener('mousedown', onWindowDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    await nextTick()
    updatePosition()
    // Combobox: đưa caret vào ô tìm kiếm ngay khi mở.
    if (props.searchable) searchRef.value?.focus()
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
  /* When used as a flex child (e.g. label + select in a row), min-width:0 lets
     the control shrink below its content so the value can ellipsize instead of
     overflowing the row. Harmless when standalone. */
  min-width: 0;
}
/* shadcn SelectTrigger: h-9 px-3 border-input, transparent bg, shadow-sm,
   focus-visible ring — cao BẰNG Input/Button default nên đặt cạnh nhau phẳng. */
.aseltrigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  height: var(--ctrl-h); /* token control chung — bằng Input/Button default */
  border: 1px solid var(--input);
  background: transparent;
  border-radius: var(--r-sm); /* rounded-md */
  padding: 0 12px; /* px-3 */
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--foreground);
  cursor: pointer;
  font-family: var(--sans);
  box-shadow: var(--shadow-sm);
}
.aseltrigger:focus-visible {
  outline: none;
  box-shadow: 0 0 0 1px var(--ring);
}
.aseltrigger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.aseltrigger:disabled:hover {
  border-color: var(--input);
  background: transparent;
}
.aselval {
  /* min-width:0 lets this flex child shrink below its content width so the
     ellipsis actually engages — without it a long value (e.g. a deep branch
     ref) overflows the trigger and stretches the control past its container. */
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aselval.ph {
  color: var(--muted-foreground);
}
.aselchev {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  color: var(--muted-foreground);
  transition: transform 0.15s;
}
.aselchev.open {
  transform: rotate(180deg);
}
.aselmenu {
  /* Fixed + teleported to body — top/left/width/max-height set inline by
     updatePosition so the menu escapes overflow-clipping ancestors. z-index must
     sit above every form-modal overlay that can host a select (.ovl = 100,
     SessionGitModal = 120, git sub-modals = 150) yet below top-level alerts
     (confirm / command palette = 200), so it floats over its own modal but a
     confirm still covers it. */
  position: fixed;
  z-index: 160;
  max-height: 280px;
  overflow-y: auto;
  background: var(--popover);
  color: var(--popover-foreground);
  border: 1px solid var(--border);
  border-radius: var(--r-sm); /* rounded-md */
  padding: 4px; /* p-1 */
  /* `--shadow-lg`, không phải `--shadow-md` như `.smenu`/`.pop`: theo chính comment
     z-index ở trên, menu này còn phải nổi TRÊN modal đang chứa nó (git sub-modal
     = 150), mà modal dùng `--shadow-lg`. Lấy `--shadow-md` thì nó chìm vào modal.
     Thay cho `0 8px 24px rgba(0,0,0,.32)` — bóng hardcode chỉ đúng ở theme tối,
     sang theme sáng đọc thành quầng xám đặc, đúng lý do `app-shell.css:1838` đã
     đổi `.smenu`/`.pop` sang ramp. */
  box-shadow: var(--shadow-lg);
}
/* Ô tìm kiếm trong menu (searchable) — sticky trên đầu để luôn nhìn thấy khi
   option list dài cuộn xuống. */
.aselsearch {
  position: sticky;
  top: -4px; /* bù padding p-1 của menu */
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px 6px;
  margin: -4px -4px 4px;
  background: var(--popover);
  border-bottom: 1px solid var(--border);
}
.aselsearchic {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  margin-left: 4px;
  color: var(--muted-foreground);
}
.aselsearchin {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--popover-foreground);
  font-family: var(--sans);
  outline: none;
  padding: 4px 0;
}
.aselsearchin::placeholder {
  color: var(--muted-foreground);
}
.aselnone {
  padding: 10px 8px;
  font-size: var(--fs-sm);
  color: var(--muted-foreground);
  text-align: center;
}
.aselopt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: 28px; /* h-7 */
  border: 0;
  background: transparent;
  border-radius: var(--r-xs); /* rounded-sm */
  padding: 0 8px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--popover-foreground);
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
  background: var(--accent-wash);
  color: var(--accent-foreground);
}
.aselopt.on {
  color: var(--accent-foreground);
  background: var(--accent-wash);
}
.aselopt.disabled {
  color: var(--textFaint);
  cursor: not-allowed;
}
.aselopt.disabled:hover {
  background: transparent;
  color: var(--textFaint);
}
.aseltick {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  color: var(--primary);
}
</style>
