<template>
  <!-- `asel` / `aseltrigger` giữ làm hook: LogtimeDay, LibraryScopePicker,
       WorkspaceIssueSidebar còn ghi đè bằng `:deep(.asel…)` cho tới khi các file đó
       được chuyển. Không mang style nào ở đây. -->
  <div ref="rootRef" class="asel relative inline-block min-w-0 align-middle" :style="{ width }">
    <!-- Mặc định: ruột là shadcn Select (reka) — tự lo định vị, lật lên trên, bàn
         phím, typeahead, nằm trong Dialog. -->
    <Select
      v-if="!searchable"
      v-model:open="open"
      :model-value="selectValue"
      :disabled="disabled"
      @update:model-value="onSelectValue"
    >
      <SelectTrigger
        class="aseltrigger w-full min-w-0"
        :class="[
          size === 'sm' ? 'h-ctrl-sm! gap-1.5 px-2' : 'h-ctrl!',
          variant === 'ghost' && GHOST_TRIGGER,
        ]"
      >
        <span class="min-w-0 truncate" :class="{ 'text-muted-foreground': !selectedLabel }">
          {{ selectedLabel || placeholder }}
        </span>
      </SelectTrigger>
      <!-- `aselmenu` là hook JS: OVERLAYS (useEmbeddedBrowser.ts), SlackModal và
           SessionSpawnHost dò `.aselmenu` để biết menu đang mở. -->
      <SelectContent
        class="aselmenu max-h-[min(17.5rem,var(--reka-select-content-available-height))] max-w-(--reka-select-content-available-width) shadow-lg"
      >
        <SelectItem
          v-for="opt in options"
          :key="opt.value"
          :value="encode(opt.value)"
          :disabled="opt.disabled"
          class="whitespace-nowrap"
          :class="{ 'bg-accent text-accent-foreground': opt.value === model }"
        >
          {{ opt.label }}
        </SelectItem>
      </SelectContent>
    </Select>

    <!-- Searchable + đang mở: chính ô select thành ô gõ tìm (combobox), không tách
         thêm một ô tìm trong menu. Placeholder = giá trị đang chọn để người dùng vẫn
         thấy mình đang ở đâu khi chưa gõ gì. Select của reka không có chế độ gõ tìm
         nên nhánh này tự dựng trên Input + listbox. -->
    <div
      v-else-if="open"
      class="relative"
      role="combobox"
      :aria-expanded="open"
      aria-haspopup="listbox"
    >
      <Input
        ref="searchRef"
        v-model="search"
        class="w-full min-w-0 pr-8 ring-1 ring-ring"
        :class="size === 'sm' ? 'h-ctrl-sm min-h-0 px-2' : 'h-ctrl'"
        :placeholder="selectedLabel || searchPlaceholder || placeholder"
        :aria-label="searchPlaceholder || placeholder"
        @keydown.esc.stop.prevent="open = false"
        @keydown.enter.prevent="selectActive"
        @keydown.down.prevent="moveActive(1)"
        @keydown.up.prevent="moveActive(-1)"
        @keydown.tab="open = false"
      />
      <ChevronDown
        class="absolute top-1/2 right-3 size-4 -translate-y-1/2 rotate-180 cursor-pointer text-muted-foreground opacity-50"
        @mousedown.prevent="open = false"
      />
    </div>
    <Button
      v-else
      ref="triggerRef"
      variant="outline"
      :size="size === 'sm' ? 'sm' : 'default'"
      class="aseltrigger w-full min-w-0 justify-between gap-2 font-normal"
      :class="[size === 'sm' ? 'px-2 text-sm' : 'px-3', variant === 'ghost' && GHOST_TRIGGER]"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
    >
      <span class="min-w-0 truncate" :class="{ 'text-muted-foreground': !selectedLabel }">
        {{ selectedLabel || placeholder }}
      </span>
      <ChevronDown class="text-muted-foreground opacity-50" />
    </Button>

    <!-- Teleported to body + fixed-positioned so the menu escapes any
         overflow-clipping / scroll ancestor (e.g. a modal body). Trong hộp thoại
         reka (shadcn Dialog) thì teleport vào CHÍNH hộp thoại — xem menuHost.
         z-180 = cùng tầng popper của shadcn: trên mọi modal (.ovl 100 → Dialog 170),
         dưới confirm / command palette (200). -->
    <Teleport v-if="searchable" :to="menuHost">
      <div
        v-if="open"
        ref="menuRef"
        class="aselmenu fixed z-180 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
        role="listbox"
        :style="menuStyle"
      >
        <div v-if="!filtered.length" class="px-2 py-2.5 text-center text-sm text-muted-foreground">
          {{ emptyLabel }}
        </div>
        <!-- raw-ok: hàng option của listbox (cả dòng là vùng bấm); mousedown.prevent giữ focus ở ô tìm -->
        <button
          v-for="(opt, i) in filtered"
          :key="opt.value"
          type="button"
          class="flex min-h-ctrl-xs w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-sm px-2 text-left text-sm whitespace-nowrap hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:text-faint disabled:hover:bg-transparent"
          :class="
            opt.value === model || i === active
              ? 'bg-accent text-accent-foreground'
              : 'text-popover-foreground'
          "
          role="option"
          :aria-selected="opt.value === model"
          :aria-disabled="opt.disabled"
          :disabled="opt.disabled"
          @mousedown.prevent
          @click="select(opt)"
        >
          <span class="min-w-0 truncate">{{ opt.label }}</span>
          <Check v-if="opt.value === model" class="size-3.5 shrink-0 text-primary" />
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
// Dropdown chọn giá trị dùng khắp app — API giữ nguyên từ bản tự viết (v-model =
// value của option; options là { label, value, disabled? }; size / variant /
// searchable / width). Ruột:
//  - mặc định: shadcn `Select` (reka) — reka lo định vị, đóng khi bấm ngoài/Esc,
//    bàn phím, và nằm đúng trong Dialog.
//  - `searchable`: combobox tự dựng (Input ngay trong trigger + listbox teleport),
//    vì Select của reka không có ô gõ tìm.
import { Check, ChevronDown } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'

export type AppSelectOption = { label: string; value: string; disabled?: boolean }

const props = withDefaults(
  defineProps<{
    options: readonly AppSelectOption[]
    placeholder?: string
    width?: string
    disabled?: boolean
    // 'sm' = trigger cao `--ctrl-h-sm` (hàng toolbar dày đặc); mặc định giữ `--ctrl-h`.
    size?: 'default' | 'sm'
    // 'ghost' = không viền/bóng, chỉ nền nhạt khi hover — cho ô chọn nằm lẫn trong dòng
    // chữ (vd project trên dòng phụ header thread Slack), nơi viền làm rối mắt.
    variant?: 'default' | 'ghost'
    // Ô tìm kiếm trong menu (combobox) — cho danh sách dài như project/repo.
    searchable?: boolean
    searchPlaceholder?: string
    emptyLabel?: string
  }>(),
  {
    placeholder: '',
    width: 'auto',
    disabled: false,
    size: 'default',
    variant: 'default',
    searchable: false,
    searchPlaceholder: '',
    emptyLabel: 'No matches',
  },
)

const model = defineModel<string>({ required: true })

// Biến thể ghost: bỏ viền + bóng + nền tối của trigger shadcn, chỉ wash khi hover.
const GHOST_TRIGGER =
  'border-transparent bg-transparent text-inherit shadow-none hover:bg-accent dark:bg-transparent dark:hover:bg-accent'

// reka cấm SelectItem có value '' (dành cho "xoá chọn"), nhưng nhiều nơi gọi dùng ''
// cho lựa chọn "không / kế thừa". Mã hoá '' thành một sentinel khi đưa vào reka và
// giải mã lại khi phát ra.
const EMPTY_VALUE = '__app-select-empty__'
const encode = (v: string) => (v === '' ? EMPTY_VALUE : v)
const decode = (v: string) => (v === EMPTY_VALUE ? '' : v)

const selectValue = computed(() => encode(model.value))
function onSelectValue(v: unknown) {
  if (typeof v !== 'string') return
  model.value = decode(v)
}

const open = ref(false)
const rootRef = useTemplateRef<HTMLElement>('rootRef')
const triggerRef = useTemplateRef<{ $el: HTMLElement }>('triggerRef')
const menuRef = useTemplateRef<HTMLElement>('menuRef')
const searchRef = useTemplateRef<{ focus: () => void }>('searchRef')
const menuStyle = ref<Record<string, string>>({})
const search = ref('')

// Nơi gắn menu (nhánh searchable). Hộp thoại reka ở chế độ modal khoá focus trong nó
// và đặt `body { pointer-events: none }` — menu gắn ở <body> thì bấm vào ô tìm /
// option bị tính là "ngoài hộp thoại" (không gõ được, click xuyên xuống). Nên khi
// trigger nằm trong một hộp thoại reka đang mở, gắn menu vào chính hộp thoại đó. Hộp
// thoại căn giữa bằng transform ⇒ nó là containing block của `position: fixed`, toạ
// độ menu phải trừ gốc của nó (xem updatePosition).
const menuHost = ref<HTMLElement | 'body'>('body')
function resolveMenuHost(): HTMLElement | 'body' {
  return rootRef.value?.closest<HTMLElement>('[role="dialog"][data-state="open"]') ?? 'body'
}
// Gốc toạ độ của containing block cho `position: fixed` (viewport, hoặc phần tử có
// transform/filter/contain). Trả cả kích thước để tính `bottom` khi lật menu lên trên.
function fixedOrigin(): { x: number; y: number; h: number } {
  const host = menuHost.value
  if (host !== 'body') {
    const cs = getComputedStyle(host)
    const isContaining =
      cs.transform !== 'none' ||
      cs.filter !== 'none' ||
      /paint|layout|strict|content/.test(cs.contain)
    if (isContaining) {
      const b = host.getBoundingClientRect()
      return { x: b.left + host.clientLeft, y: b.top + host.clientTop, h: host.clientHeight }
    }
  }
  return { x: 0, y: 0, h: window.innerHeight }
}

// Searchable: lọc theo label không phân biệt hoa-thường; giữ thứ tự options.
const filtered = computed(() => {
  if (!props.searchable || !search.value.trim()) return props.options
  const q = search.value.trim().toLowerCase()
  return props.options.filter((o) => o.label.toLowerCase().includes(q))
})

// Dòng đang được chọn bằng phím ↑/↓ (combobox). Reset về option đầu bật được mỗi
// khi lọc lại, để Enter ngay sau khi gõ chọn kết quả khớp đầu tiên.
const active = ref(0)
function firstEnabled(): number {
  const i = filtered.value.findIndex((o) => !o.disabled)
  return i < 0 ? 0 : i
}
watch(filtered, () => {
  active.value = firstEnabled()
})
function moveActive(step: 1 | -1) {
  const list = filtered.value
  if (!list.length) return
  let i = active.value
  for (let n = 0; n < list.length; n++) {
    i = (i + step + list.length) % list.length
    if (!list[i]?.disabled) break
  }
  active.value = i
  void nextTick(() => {
    menuRef.value
      ?.querySelectorAll<HTMLElement>('[role="option"]')
      [i]?.scrollIntoView({ block: 'nearest' })
  })
}
function selectActive() {
  const opt = filtered.value[active.value]
  if (opt && !opt.disabled) select(opt)
}

const selectedLabel = computed(
  () => props.options.find((o) => o.value === model.value)?.label ?? '',
)

// Position the teleported menu (searchable) under (or above, when there isn't room)
// the trigger, matching its width and clamping the height to the available space.
const GAP = 4
const MAX_H = 280
function updatePosition() {
  // Lúc mở, nút trigger đã nhường chỗ cho ô tìm ⇒ đo khung gốc (cùng kích thước).
  const trigger = rootRef.value
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
  const o = fixedOrigin()
  menuStyle.value = {
    left: `${Math.round(r.left - o.x)}px`,
    minWidth: `${Math.round(r.width)}px`,
    width: 'max-content',
    maxWidth: `${Math.round(Math.max(r.width, vw - r.left - 12))}px`,
    maxHeight: `${Math.round(maxH)}px`,
    ...(flipUp
      ? { bottom: `${Math.round(o.y + o.h - r.top + GAP)}px` }
      : { top: `${Math.round(r.bottom + GAP - o.y)}px` }),
  }
}

function toggle() {
  if (props.disabled) return
  if (!open.value) menuHost.value = resolveMenuHost()
  open.value = !open.value
}
function select(opt: AppSelectOption) {
  if (opt.disabled) return
  model.value = opt.value
  open.value = false
  // Ô gõ tìm vừa bị gỡ (combobox về lại nút) ⇒ trả focus cho nút để Tab/phím tiếp tục.
  void nextTick(() => triggerRef.value?.$el?.focus())
}

function onWindowDown(e: MouseEvent) {
  if (!open.value) return
  const target = e.target as Node
  // Keep open for clicks on the trigger or inside the teleported menu (select
  // handles it); close for anything else.
  if (rootRef.value?.contains(target) || menuRef.value?.contains(target)) return
  open.value = false
}
function onKey(e: KeyboardEvent) {
  if (open.value && e.key === 'Escape') open.value = false
}
function onReposition() {
  if (open.value) updatePosition()
}
function removeListeners() {
  window.removeEventListener('mousedown', onWindowDown)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onReposition)
  window.removeEventListener('scroll', onReposition, true)
}

// Nhánh searchable: open/close lái listener toàn cục + định vị. Lần updatePosition
// thứ hai (sau khi menu mount) tinh lại quyết định lật theo chiều cao thật.
// Nhánh Select thì reka tự lo hết — không gắn gì.
watch(open, async (isOpen) => {
  if (!props.searchable) return
  if (isOpen) {
    search.value = ''
    active.value = firstEnabled()
    updatePosition()
    window.addEventListener('mousedown', onWindowDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    await nextTick()
    updatePosition()
    // Combobox: đưa caret vào ô tìm kiếm ngay khi mở.
    searchRef.value?.focus()
  } else {
    removeListeners()
  }
})

onBeforeUnmount(removeListeners)
</script>
