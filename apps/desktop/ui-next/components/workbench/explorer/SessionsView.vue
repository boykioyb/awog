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
        <!-- Sắp xếp list — cùng lựa chọn với cột /sessions (useSessionSort), mặc định
             "cập nhật gần nhất". -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <ScmIconBtn
              class="size-6"
              type="button"
              :title="`${t('sessions.filter.sortBy')}: ${t(`sessions.sort.${sortBy}`)}`"
            >
              <ArrowDownUp class="size-4" />
            </ScmIconBtn>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-48">
            <DropdownMenuLabel class="text-xs font-normal text-muted-foreground">
              {{ t('sessions.filter.sortBy') }}
            </DropdownMenuLabel>
            <DropdownMenuItem v-for="opt in sortOptions" :key="opt" @click="sortBy = opt">
              {{ t(`sessions.sort.${opt}`) }}
              <Icon v-if="opt === sortBy" name="check" class="ml-auto text-primary" />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
      <!-- Hàng 2 dòng: dòng 1 = chấm trạng thái + tiêu đề (đủ chỗ đọc) + ghim; dòng 2 =
           meta nhỏ, mờ — thời gian · status issue · token · nguồn nhập. Trước đây cả sáu
           thứ dồn vào MỘT hàng 30px của panel hẹp: tiêu đề bị cắt cụt, một cột "0" vô
           nghĩa, icon nhập lẫn với status — rối và khó đọc. Dòng 2 luôn có thời gian nên
           mọi hàng cao bằng nhau. -->
      <div
        v-for="s in filteredRows"
        :key="s.id"
        class="srow group relative flex cursor-pointer gap-2 rounded-[var(--r-xs)] px-2 py-1.5 hover:bg-[var(--bgHover)]"
        :class="{
          on: s.id === sessions.activeId,
          'text-[var(--textMuted)]': s.id !== sessions.activeId && !s.unread,
          'row-unread': s.unread && s.id !== sessions.activeId,
          'row-run': s.status === 'streaming',
        }"
        :title="`${s.title} · ${fmtTokens(ctxTokens(s))} ctx${costLabel(s)}`"
        @click="activateRow(s.id)"
        @contextmenu.prevent="onRowCtx(s.id, $event.clientX, $event.clientY)"
      >
        <span class="flex h-5 flex-none items-center">
          <SessionStateDot :status="s.status" :unread="s.unread" />
        </span>
        <div class="flex min-w-0 flex-1 flex-col">
          <div class="flex h-5 min-w-0 items-center gap-1.5">
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
            <!-- Ghim: icon nhỏ cuối dòng tiêu đề (phiên ghim cũng nổi lên đầu list). -->
            <span
              v-if="s.pinned"
              class="flex flex-none text-[var(--textFaint)]"
              :title="t('sessions.sidebar.pinned')"
            >
              <Icon name="pin" style="width: var(--icon-xs); height: var(--icon-xs)" />
            </span>
          </div>
          <div class="smeta flex min-w-0 items-center gap-1.5">
            <span class="flex-none tabular-nums">{{ whenOf(s) }}</span>
            <span v-if="ctxTokens(s) > 0" class="flex-none tabular-nums">
              · {{ fmtTokens(ctxTokens(s)) }}
            </span>
            <!-- Nguồn nhập (Claude Desktop/CLI) CỐ Ý không hiện ở hàng — người dùng thấy
                 nhiễu (2026-10-16). -->
            <!-- Status issue (docs/features/session-issue-tracking.md) — dồn về mép PHẢI
                 cho cân: trái là thông tin "khi nào / bao nhiêu", phải là "đang ở đâu".
                 Chỉ khi việc KHÔNG còn chạy bình thường (tạm dừng / chặn / review / xong). -->
            <span
              v-if="issueFlags.get(s.id)"
              class="schip ml-auto"
              :style="{ '--st': statusColor(issueFlags.get(s.id)!) }"
            >
              {{ statusLabel(issueFlags.get(s.id)!) }}
            </span>
          </div>
        </div>
        <span
          class="absolute right-1.5 top-1.5 cursor-pointer rounded-[var(--r-xs)] bg-[var(--bgHover)] p-0.5 text-[var(--textFaint)] opacity-0 transition-opacity hover:bg-[var(--bgActive)] hover:text-[var(--text)] group-hover:opacity-100"
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
import { ArrowDownUp, Loader2 } from 'lucide-vue-next'
import DropdownMenu from '~/components/ui/dropdown-menu/DropdownMenu.vue'
import DropdownMenuContent from '~/components/ui/dropdown-menu/DropdownMenuContent.vue'
import DropdownMenuItem from '~/components/ui/dropdown-menu/DropdownMenuItem.vue'
import DropdownMenuLabel from '~/components/ui/dropdown-menu/DropdownMenuLabel.vue'
import DropdownMenuTrigger from '~/components/ui/dropdown-menu/DropdownMenuTrigger.vue'
import SessionStateDot from '~/components/session/SessionStateDot.vue'
import ScmIconBtn from './ScmIconBtn.vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import AppContextMenu from '~/components/common/AppContextMenu.vue'
import SessionRunPicker from '~/components/session/SessionRunPicker.vue'
import type { Session } from '~/composables/useSessionsData'
import { useBoardStore, type BoardItemStatus } from '~/stores/board'
import type { MenuItem } from '~/composables/useContextMenu'
import { useSessionStrip } from '~/composables/useSessionStrip'
import { useSessionActions } from '~/composables/useSessionActions'
import { useClaudeImportModal } from '~/composables/useClaudeImportModal'
import { relativeTime } from '~/utils/relative-time'

const claudeImport = useClaudeImportModal()
// Thời gian cập nhật dạng tương đối ("5 phút", "2 giờ") — tính từ `updatedAt`, rơi về
// `when` (chuỗi chụp lúc hydrate) cho phiên chưa có mốc.
// `now` là đồng hồ chạy chung (useNow) — nhãn tự trôi "vừa xong" → "1m" → "2m"….
const now = useNow()
const whenOf = (s: Session): string => (s.updatedAt ? relativeTime(s.updatedAt, now.value) : s.when)
const board = useBoardStore()
const { statusLabel, statusColor } = useIssueStatus()
const FLAG_STATUSES = new Set<BoardItemStatus>(['pending', 'blocked', 'in_review', 'done'])
// Một lượt tính cho cả list (không gọi lặp trong template mỗi hàng).
const issueFlags = computed(() => {
  const out = new Map<number, BoardItemStatus>()
  for (const s of filteredRows.value) {
    if (!s.issueId) continue
    const st = board.itemsFor(s.project).find((i) => i.id === s.issueId)?.status
    if (st && FLAG_STATUSES.has(st)) out.set(s.id, st)
  }
  return out
})
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

// List chính = `tabs` lọc theo cùng `menuQuery`, rồi sắp theo lựa chọn chung của
// useSessionSort (ghim trước; mặc định cập nhật gần nhất). `filteredTabs` (sort theo
// ctx) chỉ dành cho popover ▾.
const { sortBy, sortOptions, sortSessions } = useSessionSort()
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const filteredRows = computed(() => {
  const q = menuQuery.value.trim()
  const rows = q ? tabs.value.filter((s) => norm(s.title).includes(norm(q))) : tabs.value
  return sortSessions(rows)
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
/* Hàng đang chọn = accent-tint + thanh accent 2px (luật selection của app). */
.srow.on {
  background: var(--accentDim);
  color: var(--text);
  box-shadow: inset 2px 0 0 var(--accent);
}
/* Dòng meta: nhỏ, mờ, không đậm theo hàng chưa đọc. */
.smeta {
  height: 16px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 400;
  color: var(--textFaint);
  white-space: nowrap;
}
/* Chip status issue: chấm màu + chữ cùng màu status, nền rất nhạt. */
.schip {
  flex: none;
  padding: 0 5px;
  border-radius: var(--r-xs);
  color: var(--st);
  background: color-mix(in srgb, var(--st) 12%, transparent);
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
