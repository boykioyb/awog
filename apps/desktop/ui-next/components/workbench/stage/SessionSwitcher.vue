<template>
  <!-- ⌘K quick-switch (proto `.cmdk`, ADR 0098 §L-2): overlay lọc mọi phiên mọi
       project — nhóm "Đang mở — <project>" trước, rồi từng project khác kèm đếm
       running; ↑↓ chọn, Enter nhảy (project khác = đổi activeTab + activate),
       Esc/nền đóng. Mở bằng ⌘K — listener capture trên window, gated route
       /workbench để không đè palette toàn cục ở trang khác. -->
  <Teleport to="body">
    <!-- hook-ok: `.cmdk-ovl` nằm trong OVERLAYS (useEmbeddedBrowser.ts) -->
    <div
      v-if="isOpen"
      class="cmdk-ovl fixed inset-0 z-200 flex items-start justify-center bg-black/50 pt-[14vh] [-webkit-app-region:no-drag]"
      @click.self="close"
    >
      <div
        class="flex max-h-[60vh] w-120 max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
        role="dialog"
        aria-modal="true"
      >
        <Input
          ref="inputEl"
          v-model="q"
          unstyled
          class="h-10 flex-none border-b border-border bg-transparent px-4 font-sans text-lg text-foreground outline-hidden placeholder:text-faint"
          :placeholder="t('wb.switch.placeholder')"
          autocomplete="off"
          spellcheck="false"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="go"
        />
        <div class="min-h-0 overflow-y-auto py-1.5">
          <div v-if="!flat.length" class="p-4.5 text-sm text-faint">
            {{ t('wb.switch.empty') }}
          </div>
          <template v-for="(it, i) in flat" :key="it.row.id">
            <div v-if="it.first" class="px-3.5 pb-1 pt-1.5 text-xs font-semibold text-dim">
              {{ it.label }}
            </div>
            <div
              class="flex cursor-pointer items-center gap-2 px-3.5 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground data-sel:bg-accent data-sel:text-foreground"
              :data-sel="i === sel ? '' : undefined"
              @click="pick(it.row)"
              @mouseenter="sel = i"
            >
              <SessionStateDot :status="it.row.status" />
              <span class="min-w-0 truncate">{{ it.row.title }}</span>
              <span class="ml-auto flex-none text-xs text-faint">
                {{ it.row.projectName }}
              </span>
              <span class="min-w-13 flex-none text-right text-xs" :class="sttClass(it.row.status)">
                {{ sttLabel(it.row.status) }}
              </span>
            </div>
          </template>
        </div>
        <div class="flex flex-none gap-3.5 border-t border-border px-3.5 py-1.5 text-xs text-faint">
          <span>
            <b class="font-semibold text-dim">↑↓</b>
            {{ t('wb.switch.hintNav') }}
          </span>
          <span>
            <b class="font-semibold text-dim">Enter</b>
            {{ t('wb.switch.hintEnter') }}
          </span>
          <span>
            <b class="font-semibold text-dim">Esc</b>
            {{ t('wb.switch.hintEsc') }}
          </span>
          <span class="ml-auto">⌘K</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useSessionsStore } from '~/stores/sessions'
import { useI18n } from '~/composables/useI18n'
import type { Session } from '~/composables/useSessionsData'
import SessionStateDot from '~/components/session/SessionStateDot.vue'
import {
  allSessions,
  installSettleToast,
  jumpTo,
  uninstallSettleToast,
  useSessionSwitcher,
  type SwitcherRow,
} from '~/composables/useSessionSwitcher'

const sessions = useSessionsStore()
const { t } = useI18n()
const route = useRoute()
const { isOpen, close, toggle } = useSessionSwitcher()

const q = ref('')
const sel = ref(0)
// Template ref trên <Input> trả instance (không phải element) — expose của
// component có sẵn focus()/blur() nên watcher mở/đóng dưới không đổi.
const inputEl = ref<{ focus: () => void; blur: () => void } | null>(null)

// Lọc theo "title + tên project" (proto: r.t + ' ' + r.p) rồi dàn phẳng thành
// đúng thứ tự render — mỗi phần tử mang cờ "đầu nhóm" + nhãn group, nên sel là
// index thẳng vào đây và header chỉ là phần tử đầu của mỗi nhóm.
const flat = computed(() => {
  const needle = q.value.toLowerCase().trim()
  const out: { row: SwitcherRow; first: boolean; label: string }[] = []
  for (const g of allSessions()) {
    const rows = needle
      ? g.rows.filter((r) => `${r.title} ${r.projectName}`.toLowerCase().includes(needle))
      : g.rows
    if (!rows.length) continue
    const label =
      g.project === sessions.activeTab
        ? t('wb.switch.open', { name: g.name })
        : g.name + (g.running ? ` · ${t('wb.switch.running', { n: g.running })}` : '')
    rows.forEach((row, i) => out.push({ row, first: i === 0, label }))
  }
  return out
})

function move(delta: 1 | -1) {
  const n = flat.value.length
  if (!n) return
  sel.value = (sel.value + delta + n) % n
}

function pick(r: SwitcherRow) {
  // jumpTo theo id — an toàn hơn resolve lại theo title khi hai phiên trùng tên.
  jumpTo(r.id)
  close()
}
function go() {
  const it = flat.value[sel.value]
  if (it) pick(it.row)
}

const STT_CLASS: Record<Session['status'], string> = {
  streaming: 'text-primary',
  awaiting: 'text-warning',
  done: 'text-faint',
  error: 'text-destructive',
  idle: 'text-faint',
}
const STT_KEY: Record<Session['status'], string> = {
  streaming: 'wb.status.run',
  awaiting: 'wb.status.wait',
  done: 'wb.status.done',
  error: 'wb.status.error',
  idle: 'wb.status.idle',
}
function sttClass(status: Session['status']): string {
  return STT_CLASS[status]
}
function sttLabel(status: Session['status']): string {
  return t(STT_KEY[status])
}

// Mở → reset filter + con trỏ, focus input; đóng → blur để phím về lại app.
watch(isOpen, async (on) => {
  if (!on) {
    inputEl.value?.blur()
    return
  }
  q.value = ''
  sel.value = 0
  await nextTick()
  inputEl.value?.focus()
})
// Query thay đổi → con trỏ về đầu; list co lại → clamp.
watch(q, () => {
  sel.value = 0
})
watch(flat, (rows) => {
  if (sel.value >= rows.length) sel.value = Math.max(0, rows.length - 1)
})
// Giữ hàng đang chọn trong viewport khi điều hướng bằng phím.
watch(sel, async () => {
  await nextTick()
  document.querySelector('.cmdk-ovl [data-sel]')?.scrollIntoView({ block: 'nearest' })
})

// ⌘K mở/đóng — listener CAPTURE trên window: bắt trước listener bubble của
// useGlobalShortcuts (palette toàn cục) rồi nuốt sự kiện. Gated theo route để
// component vẫn mount (listener sống) mà không chiếm ⌘K ở trang khác — kể cả
// khi KeepAlive chỉ deactivate chứ không unmount. Esc cùng listener đóng
// overlay bất kể focus đang ở đâu; preventDefault để layout không thấy cú Esc
// này hai lần.
function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
    if (route.path !== '/workbench') return
    e.preventDefault()
    e.stopImmediatePropagation()
    toggle()
    return
  }
  if (e.key === 'Escape' && isOpen.value) {
    e.preventDefault()
    close()
  }
}
onMounted(() => {
  window.addEventListener('keydown', onKey, true)
  installSettleToast()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  uninstallSettleToast()
})
</script>
