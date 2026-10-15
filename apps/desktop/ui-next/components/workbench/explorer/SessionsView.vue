<template>
  <!-- View "Sessions" của Explorer — danh sách phiên theo project đang mở,
       dùng chung `SessionListItem` (cùng skeleton với cột /sessions: status
       icon · title · unread, meta hàng hai). Toolbar: lọc · + tạo phiên · ▾
       popover quản lý (giữ y nguyên từ SessionStrip: sort theo ctx, clear/
       đóng từng phiên, section "Đã đóng" restore/xoá vĩnh viễn). -->
  <div class="relative flex min-h-0 flex-1 flex-col">
    <div class="flex h-11 flex-none items-center px-2 shadow-[inset_0_-1px_0_var(--border)]">
      <span
        class="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-[var(--r-xs)] border bg-[color:var(--bgInput)] px-2.5 text-[color:var(--textFaint)] transition-colors"
        :class="searching ? 'border-[color:var(--accentBorder)]' : 'border-[color:var(--border)]'"
      >
        <Icon name="search" class="size-4 flex-none" />
        <Input
          ref="searchEl"
          v-model="menuQuery"
          class="h-auto min-w-0 flex-1 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
          type="search"
          :placeholder="t('wb.strip.search')"
          @focus="searchFocused = true"
          @blur="searchFocused = false"
          @keydown.esc.stop="onSearchEsc"
        />
      </span>
      <!-- Cùng hành vi ô "Tìm file…" (FilesView): focus/có chữ ⇒ ô giãn hết bề ngang,
           nhóm nút trượt ẩn; `inert` khi ẩn để Tab không rơi vào nút vô hình. -->
      <div class="sv-actions" :class="{ 'is-hidden': searching }" :inert="searching || undefined">
        <ScmIconBtn class="size-6" type="button" :title="t('wb.strip.new')" @click="create">
          <Icon name="plus" class="size-4" />
        </ScmIconBtn>
        <ScmIconBtn
          class="size-6"
          type="button"
          :title="t('sessions.claudeImport.button')"
          @click="claudeImport.open()"
        >
          <Icon name="download" class="size-4" />
        </ScmIconBtn>
        <ScmIconBtn
          class="size-6"
          type="button"
          data-wb-mgr
          :title="t('wb.strip.manage')"
          :active="menuOpen"
          :aria-expanded="menuOpen"
          @click.stop="toggleMenu"
        >
          <Icon
            name="chev"
            class="size-4 transition-transform"
            :class="{ 'rotate-180': menuOpen }"
          />
        </ScmIconBtn>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-1">
      <div v-if="!filteredRows.length" class="px-2 py-2.5 text-sm text-[var(--textFaint)]">
        {{ t('sessions.list.noMatch') }}
      </div>
      <!-- Row gọn (1 dòng) — panel hẹp nên không dùng SessionListItem (card 2
           dòng, padding 9px). Cùng skeleton với popover ▾ bên dưới. -->
      <div
        v-for="s in filteredRows"
        :key="s.id"
        class="group relative flex h-[30px] cursor-pointer items-center gap-2 rounded-[var(--r-xs)] px-2 hover:bg-[var(--bgHover)]"
        :class="{
          'bg-[var(--accentDim)] text-[var(--text)]': s.id === sessions.activeId,
          'text-[var(--textMuted)]': s.id !== sessions.activeId && !s.unread,
          'row-unread': s.unread && s.id !== sessions.activeId,
          'row-run': s.status === 'streaming',
        }"
        :title="`${s.title} · ${fmtTokens(ctxTokens(s))} ctx${costLabel(s)}`"
        @click="activateRow(s.id)"
        @contextmenu.prevent="onRowCtx(s.id, $event.clientX, $event.clientY)"
      >
        <SessionStateDot :status="s.status" :unread="s.unread" />
        <input
          v-if="renamingId === s.id"
          ref="renameInput"
          v-model="draft"
          class="renamefield"
          type="text"
          :aria-label="t('sessions.item.rename')"
          @click.stop
          @contextmenu.stop
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent.stop="cancelRename"
          @blur="commitRename"
        />
        <span
          v-else
          class="min-w-0 flex-1 truncate"
          :class="{ tgen: sessions.titleGenerating.has(s.id) }"
          @dblclick.stop="startRename(s)"
        >
          {{ s.title }}
        </span>
        <Loader2
          v-if="sessions.titleGenerating.has(s.id) && renamingId !== s.id"
          class="size-3 flex-none animate-spin text-[var(--primary)]"
        />
        <!-- Đã ghim: icon nhỏ ngay sau tên (phiên ghim cũng được đưa lên đầu list). -->
        <span
          v-if="s.pinned"
          class="flex flex-none text-[var(--textFaint)]"
          :title="t('sessions.sidebar.pinned')"
        >
          <Icon name="pin" style="width: var(--icon-xs); height: var(--icon-xs)" />
        </span>
        <!-- Phiên nhập từ Claude Desktop/CLI (docs/features/claude-session-import.md):
             hàng 30px không đủ chỗ cho chip chữ như SessionListItem ⇒ chỉ icon + title. -->
        <span
          v-if="s.importedFrom"
          class="flex flex-none text-[var(--textFaint)]"
          :title="
            s.importedFrom.kind === 'cli'
              ? t('sessions.claudeImport.badge.cli')
              : t('sessions.claudeImport.badge.desktop')
          "
        >
          <Icon name="download" style="width: var(--icon-xs); height: var(--icon-xs)" />
        </span>
        <!-- Chưa đọc đã thể hiện ở chỉ báo bên trái + tiêu đề đậm — không thêm chấm
             thứ hai bên phải (trước đây trùng màu với chấm trạng thái ⇒ khó phân biệt). -->
        <span class="flex-none font-mono text-xs font-normal tabular-nums text-[var(--textFaint)]">
          {{ fmtTokens(ctxTokens(s)) }}
        </span>
        <span
          class="absolute right-1.5 cursor-pointer rounded-[var(--r-xs)] bg-[var(--bgHover)] p-0.5 text-[var(--textFaint)] opacity-0 transition-opacity hover:bg-[var(--bgActive)] hover:text-[var(--text)] group-hover:opacity-100"
          role="button"
          :title="t('wb.strip.close')"
          :aria-label="t('wb.strip.close')"
          @click.stop="closeTab(s)"
        >
          <Icon name="x" class="size-3" />
        </span>
      </div>
    </div>

    <!-- Popover quản lý — `.smenu` giữ tên vì OVERLAYS của browser view dò theo
         class; neo vào mép phải thanh toolbar view (giống strip trước đây). -->
    <div v-if="menuOpen" class="smenu sessview-menu" data-wb-mgr @click.stop>
      <div
        class="flex items-center px-[11px] pb-[5px] pt-[7px] text-xs font-[640] tracking-[0.04em] text-[var(--textFaint)]"
      >
        {{ t('wb.strip.mgrTitle', { n: tabs.length }) }}
        <span class="ml-auto">{{ t('wb.strip.total', { n: fmtTokens(totalCtx) }) }}</span>
      </div>
      <div
        v-for="s in filteredTabs"
        :key="s.id"
        class="group relative flex cursor-pointer items-center gap-2 px-[11px] py-[5px] text-sm text-[var(--textMuted)] hover:bg-[var(--bgHover)] hover:text-[var(--text)]"
        :title="`${s.title}${costLabel(s)}`"
        @click="activateRow(s.id)"
      >
        <SessionStateDot :status="s.status" :unread="s.unread" />
        <span class="min-w-0 flex-1 truncate" :class="{ tgen: sessions.titleGenerating.has(s.id) }">
          {{ s.title }}{{ s.id === sessions.activeId ? ' •' : '' }}
        </span>
        <Loader2
          v-if="sessions.titleGenerating.has(s.id)"
          class="size-3 flex-none animate-spin text-[var(--primary)]"
        />
        <span
          class="h-1 w-[34px] flex-none overflow-hidden rounded-[var(--r-xs)] bg-[var(--bgActive)]"
        >
          <i
            class="block h-full rounded-[var(--r-xs)]"
            :class="sessions.usagePct(s) > 80 ? 'bg-warning' : 'bg-[var(--accent)]'"
            :style="{ width: barW(s) + '%' }"
          />
        </span>
        <span class="flex-none font-mono text-xs text-[var(--textFaint)]">
          {{ fmtTokens(ctxTokens(s)) }}
        </span>
        <span
          class="absolute inset-y-0 right-0 flex items-center gap-0.5 bg-[var(--bgHover)] pl-1 pr-1.5 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <ScmIconBtn
            :size="18"
            hover="active"
            type="button"
            :title="t('wb.strip.clearCtx')"
            :disabled="isRunStatus(s.status)"
            @click.stop="clearCtx(s)"
          >
            <Icon name="revert" class="size-2.5" />
          </ScmIconBtn>
          <ScmIconBtn
            :size="18"
            danger
            type="button"
            :title="t('wb.strip.close')"
            @click.stop="closeTab(s)"
          >
            <Icon name="x" class="size-2.5" />
          </ScmIconBtn>
        </span>
      </div>
      <div
        class="flex items-center gap-2 border-t border-[var(--border)] px-[11px] py-1.5 text-xs text-[var(--textFaint)]"
      >
        {{ t('wb.strip.heaviest', { title: heaviest }) }}
        <Button
          class="ml-auto h-[18px] flex-none rounded-[var(--r-xs)] px-2 text-xs"
          variant="danger"
          size="xs"
          type="button"
          @click="clearAll"
        >
          {{ t('wb.strip.clearAll') }}
        </Button>
      </div>
      <template v-if="filteredArchived.length">
        <div
          class="mt-1 flex items-center border-t border-[var(--border)] px-[11px] pb-[5px] pt-[7px] text-xs font-[640] tracking-[0.04em] text-[var(--textFaint)]"
        >
          {{ t('wb.strip.archived', { n: filteredArchived.length }) }}
        </div>
        <div
          v-for="s in filteredArchived"
          :key="s.id"
          class="group relative flex cursor-pointer items-center gap-2 px-[11px] py-[5px] text-sm text-[var(--textMuted)] hover:bg-[var(--bgHover)] hover:text-[var(--text)]"
          :title="t('wb.strip.reopen')"
          @click="restore(s)"
        >
          <SessionStateDot :status="s.status" />
          <span class="min-w-0 flex-1 truncate text-[var(--textFaint)]">{{ s.title }}</span>
          <span class="flex-none font-mono text-xs text-[var(--textFaint)]">
            {{ fmtTokens(ctxTokens(s)) }}
          </span>
          <span
            class="absolute inset-y-0 right-0 flex items-center gap-0.5 bg-[var(--bgHover)] pl-1 pr-1.5 opacity-0 transition-opacity group-hover:opacity-100"
          >
            <ScmIconBtn
              :size="18"
              danger
              type="button"
              :title="t('wb.strip.deleteForever')"
              @click.stop="removeForever(s)"
            >
              <Icon name="trash" class="size-2.5" />
            </ScmIconBtn>
          </span>
        </div>
      </template>
    </div>

    <SessionRunPicker
      v-if="runPickerFor"
      :session="runPickerFor"
      :sessions="tabs"
      @pick="applyRunPick"
      @close="runPickerFor = null"
    />

    <Teleport to="body">
      <AppContextMenu
        :open="ctx.pos.value !== null"
        :position="ctx.pos.value ?? { x: 0, y: 0 }"
        :items="rowMenuItems"
        @close="ctx.close()"
        @select="onRowMenuSelect"
      />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
// Dùng chung controller của strip cũ (logic không đổi — chỉ khác layout) +
// row 1 dòng. List dùng `menuQuery` của popover làm ô lọc luôn: cùng một query,
// cùng một nguồn phiên. Menu chuột phải = thao tác trên phiên (useSessionActions,
// dùng chung với cột /sessions) + thao tác tab (đóng / đóng các tab khác / clear ctx…).
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import SessionStateDot from '~/components/session/SessionStateDot.vue'
import ScmIconBtn from './ScmIconBtn.vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import AppContextMenu from '~/components/common/AppContextMenu.vue'
import SessionRunPicker from '~/components/session/SessionRunPicker.vue'
import type { Session } from '~/composables/useSessionsData'
import type { MenuItem } from '~/composables/useContextMenu'
import { useSessionStrip } from '~/composables/useSessionStrip'
import { useSessionActions } from '~/composables/useSessionActions'
import { useClaudeImportModal } from '~/composables/useClaudeImportModal'

const claudeImport = useClaudeImportModal()
const {
  sessions,
  ctx,
  ctxItems,
  onCtxSelect,
  tabs,
  menuQuery,
  filteredArchived,
  create,
  closeTab,
  menuOpen,
  toggleMenu,
  filteredTabs,
  ctxTokens,
  fmtTokens,
  costLabel,
  totalCtx,
  heaviest,
  barW,
  activateRow,
  clearCtx,
  clearAll,
  restore,
  removeForever,
  isRunStatus,
  t,
} = useSessionStrip()

// List chính = `tabs` (thứ tự store: mới nhất trước, pinned trước) lọc theo
// cùng `menuQuery`. `filteredTabs` (sort theo ctx) chỉ dành cho popover ▾.
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const filteredRows = computed(() => {
  const q = menuQuery.value.trim()
  if (!q) return tabs.value
  return tabs.value.filter((s) => norm(s.title).includes(norm(q)))
})

// Ô tìm giãn khi đang gõ hoặc còn chữ (giống FilesView). Esc: còn chữ ⇒ xoá, hết chữ ⇒
// rời ô (nhóm nút hiện lại).
const searchFocused = ref(false)
const searching = computed(() => searchFocused.value || menuQuery.value.trim() !== '')
const searchEl = useTemplateRef<{ blur: () => void }>('searchEl')
function onSearchEsc(): void {
  if (menuQuery.value) menuQuery.value = ''
  else searchEl.value?.blur()
}

// ── Rename inline (hàng 30px): Enter lưu · Esc huỷ · blur lưu — cùng action
// `sessions.rename` với SessionListItem.
const renamingId = ref<number | null>(null)
const draft = ref('')
// `ref` trong v-for ⇒ mảng; chỉ một hàng ở chế độ sửa nên lấy phần tử đầu.
const renameInput = useTemplateRef<HTMLInputElement[]>('renameInput')

function startRename(s: Session) {
  draft.value = s.title
  renamingId.value = s.id
  void nextTick(() => {
    const el = renameInput.value?.[0]
    el?.focus()
    el?.select()
  })
}
function commitRename() {
  const id = renamingId.value
  if (id === null) return
  renamingId.value = null // trước store.rename: blur bắn lại sau Enter/Esc
  sessions.rename(id, draft.value)
}
function cancelRename() {
  renamingId.value = null
}

// Hộp chọn nhóm (cha/vai) — đóng NGAY khi chọn, như SessionList.
const runPickerFor = ref<Session | null>(null)
function applyRunPick(parentClientId: number | null, role: string | null) {
  const s = runPickerFor.value
  runPickerFor.value = null
  if (s) void sessions.setRunMembership(s.id, parentClientId, role)
}

// "Close" của tab đã là archive ⇒ bỏ mục Archive; Workbench không có UI chọn nhiều
// ⇒ bỏ mục Select. Mọi mục còn lại giống menu cũ của cột /sessions.
const actions = useSessionActions({
  open: (s) => activateRow(s.id),
  rename: startRename,
  group: (s) => {
    runPickerFor.value = s
  },
})
const rowMenuItems = computed<MenuItem[]>(() => {
  const s = ctx.target.value
  if (!s) return []
  return [...actions.items(s, { archive: false }), { separator: true }, ...ctxItems.value]
})
async function onRowMenuSelect(id: string) {
  const s = ctx.target.value
  if (!s) return
  ctx.close() // đóng menu trước khi dialog confirm mở
  if (!(await actions.run(id, s))) await onCtxSelect(id, s)
}

function onRowCtx(id: number, x: number, y: number) {
  const s = tabs.value.find((x2) => x2.id === id)
  if (s) ctx.open(new MouseEvent('contextmenu', { clientX: x, clientY: y }), s)
}
</script>

<style scoped>
/* Nhóm nút cạnh ô tìm — cùng thông số trượt với `.fv-actions` của FilesView. */
.sv-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
  max-width: 120px;
  margin-left: 4px;
  overflow: hidden;
  transition:
    max-width 0.18s ease,
    opacity 0.14s ease,
    margin-left 0.18s ease;
}
.sv-actions.is-hidden {
  max-width: 0;
  margin-left: 0;
  opacity: 0;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .sv-actions {
    transition: none;
  }
}
/* Neo popover dưới toolbar của view (h-8 = 32px). Trải hết bề rộng panel trừ lề
   (left+right) rồi trần 300px dồn về mép phải ⇒ panel hẹp hơn 304px thì popover co
   lại theo panel thay vì tràn qua mép trái và bị NavRail che. */
.sessview-menu {
  position: absolute;
  top: 45px;
  right: 4px;
  left: 4px;
  z-index: 50;
  max-width: 300px;
  margin-left: auto;
  max-height: 60vh;
  overflow-y: auto;
}
/* Ô đổi tên inline — nền/chữ theo token, vừa hàng 30px. */
.renamefield {
  min-width: 0;
  flex: 1;
  height: 22px;
  padding: 0 6px;
  border: 1px solid var(--accent);
  border-radius: var(--r-xs);
  background: var(--bgInput);
  color: var(--text);
  font: inherit;
  outline: none;
}
/* Chưa đọc: tiêu đề đậm + màu chữ đầy đủ, phiên đã đọc giữ màu nhạt. */
.row-unread {
  color: var(--text);
  font-weight: 600;
}
/* Đang chạy: vệt sáng chạy dọc chân hàng (progress bất định). */
.row-run::after {
  content: '';
  position: absolute;
  right: 8px;
  bottom: 2px;
  left: 8px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent) no-repeat;
  background-size: 40% 100%;
  opacity: 0.8;
  animation: row-run 1.4s ease-in-out infinite;
  pointer-events: none;
}
@keyframes row-run {
  0% {
    background-position: -70% 0;
  }
  100% {
    background-position: 170% 0;
  }
}
/* Title shimmer while the model is regenerating it — same sheen as
   SessionListItem (accent sweep on transparent-clipped text). */
.tgen {
  color: transparent;
  background-image: linear-gradient(
    90deg,
    var(--textMuted) 0%,
    var(--primary) 50%,
    var(--textMuted) 100%
  );
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  animation: ttlshimmer 1.4s linear infinite;
}
@keyframes ttlshimmer {
  to {
    background-position: -200% 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .row-run::after {
    animation: none;
    background-size: 100% 100%;
    opacity: 0.4;
  }
}
</style>
