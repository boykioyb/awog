<template>
  <!-- View "Sessions" của Explorer — danh sách phiên theo project đang mở,
       dùng chung `SessionListItem` (cùng skeleton với cột /sessions: status
       icon · title · unread, meta hàng hai). Toolbar: lọc · + tạo phiên · ▾
       popover quản lý (giữ y nguyên từ SessionStrip: sort theo ctx, clear/
       đóng từng phiên, section "Đã đóng" restore/xoá vĩnh viễn). -->
  <div class="relative flex min-h-0 flex-1 flex-col">
    <div class="flex h-11 flex-none items-center px-2 shadow-[inset_0_-1px_0_var(--border)]">
      <span
        class="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-sm border bg-muted px-2.5 text-faint transition-colors"
        :class="searching ? 'border-selected-border' : 'border-border'"
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
      <div
        class="flex flex-none items-center gap-1 overflow-hidden transition-[max-width,opacity,margin-left] duration-200 motion-reduce:transition-none"
        :class="searching ? 'pointer-events-none ml-0 max-w-0 opacity-0' : 'ml-1 max-w-30'"
        :inert="searching || undefined"
      >
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
      <div
        v-if="!filteredRows.length && !archivedHits.length"
        class="px-2 py-2.5 text-sm text-faint"
      >
        {{ t('sessions.list.noMatch') }}
      </div>
      <!-- List kiểu Linear: nhóm theo thời gian (Đã ghim · Hôm nay · Hôm qua · 7 ngày qua
           · Cũ hơn; sắp theo tên thì không nhóm). Hàng 2 dòng:
             1 = icon trạng thái (issue: hình + màu nói luôn "đang ở đâu"; phiên đang
                 chạy / chưa đọc thì chấm trạng thái phiên) · tiêu đề · thời gian bên phải;
             2 = token · tên trạng thái issue — chữ màu nhỏ, KHÔNG chip nền (chip cũ độ dài
                 lệch nhau, kéo mắt sang mép phải từng hàng). -->
      <template v-for="g in rowGroups" :key="g.key">
        <div
          v-if="g.label"
          class="flex items-center px-2 pb-1 pt-2.5 text-xs font-medium text-muted-foreground first:pt-1"
        >
          {{ g.label }}
        </div>
        <div
          v-for="s in g.rows"
          :key="s.id"
          class="group relative flex cursor-pointer gap-2.5 rounded-md px-2 py-1.5 text-foreground"
          :class="{
            'bg-selected shadow-[inset_2px_0_0_var(--color-primary)]': s.id === sessions.activeId,
            'hover:bg-accent': s.id !== sessions.activeId,
            'row-run': s.status === 'streaming',
          }"
          :title="`${s.title} · ${fmtTokens(ctxTokens(s))} ctx${costLabel(s)}`"
          @click="activateRow(s.id)"
          @contextmenu.prevent="onRowCtx(s.id, $event.clientX, $event.clientY)"
        >
          <!-- Icon căn theo dòng tiêu đề (cao bằng line-height của text-base). -->
          <span class="flex h-(--lh-md) flex-none items-center">
            <IssueStatusIcon
              v-if="issueFlags.get(s.id) && s.status !== 'streaming' && !s.unread"
              :status="issueFlags.get(s.id)!"
            />
            <SessionStateDot v-else :status="s.status" :unread="s.unread" />
          </span>
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <div class="flex min-w-0 items-center gap-1.5">
              <!-- Ô đổi tên inline. -->
              <Input
                v-if="renamingId === s.id"
                ref="renameInput"
                v-model="draft"
                class="h-5.5 min-w-0 flex-1 rounded-sm border-primary bg-muted px-1.5 [font:inherit] focus-visible:ring-0"
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
                class="min-w-0 flex-1 truncate text-base"
                :class="[
                  s.unread || s.id === sessions.activeId ? 'font-semibold' : 'font-normal',
                  { tgen: sessions.titleGenerating.has(s.id) },
                ]"
                @dblclick.stop="startRename(s)"
              >
                {{ s.title }}
              </span>
              <Loader2
                v-if="sessions.titleGenerating.has(s.id) && renamingId !== s.id"
                class="size-3 flex-none animate-spin text-primary"
              />
              <!-- Thời gian ở mép phải dòng 1; hover thì nhường chỗ cho nút đóng. -->
              <span
                v-if="renamingId !== s.id"
                class="flex-none text-xs text-faint tabular-nums group-hover:invisible"
              >
                {{ whenOf(s) }}
              </span>
            </div>
            <div
              v-if="ctxTokens(s) > 0 || issueFlags.get(s.id)"
              class="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs text-faint"
            >
              <span v-if="ctxTokens(s) > 0" class="flex-none tabular-nums">
                {{ fmtTokens(ctxTokens(s)) }}
              </span>
              <span v-if="ctxTokens(s) > 0 && issueFlags.get(s.id)" aria-hidden="true">·</span>
              <!-- Tên trạng thái issue cùng màu icon (docs/features/session-issue-tracking.md). -->
              <span
                v-if="issueFlags.get(s.id)"
                class="min-w-0 truncate"
                :style="{ color: statusColor(issueFlags.get(s.id)!) }"
              >
                {{ statusLabel(issueFlags.get(s.id)!) }}
              </span>
            </div>
          </div>
          <span
            class="absolute right-1.5 top-1.5 cursor-pointer rounded-sm p-0.5 text-faint opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
            role="button"
            :title="t('wb.strip.close')"
            :aria-label="t('wb.strip.close')"
            @click.stop="closeTab(s)"
          >
            <Icon name="x" class="size-3" />
          </span>
        </div>
      </template>
      <!-- Đang tìm ⇒ tìm cả phiên ĐÃ ĐÓNG (không thì không có đường nào tìm lại chúng
           ngoài cuộn popover ▾). Bấm = mở lại. Không tìm thì ẩn — 200+ phiên đóng sẽ
           nhấn chìm list. Trần ARCHIVED_HITS_MAX kết quả. -->
      <template v-if="archivedHits.length">
        <div
          class="mt-2 flex items-center gap-2 px-2 pb-1 text-xs font-medium text-muted-foreground"
        >
          {{ t('wb.strip.archived', { n: filteredArchived.length }) }}
        </div>
        <div
          v-for="s in archivedHits"
          :key="`a-${s.id}`"
          class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          :title="t('wb.strip.reopen')"
          @click="restore(s)"
        >
          <SessionStateDot :status="s.status" />
          <span class="min-w-0 flex-1 truncate text-base">{{ s.title }}</span>
          <RotateCcw class="size-3.5 flex-none text-faint" />
        </div>
      </template>
    </div>

    <!-- Popover quản lý — `.wbm` để OVERLAYS của browser view dò thấy; neo dưới
         toolbar của view (top 45px). Trải hết bề rộng panel trừ lề rồi trần 300px dồn
         về mép phải ⇒ panel hẹp thì popover co theo panel thay vì tràn sang NavRail. -->
    <div
      v-if="menuOpen"
      class="wbm absolute left-1 right-1 top-11.25 z-50 ml-auto max-h-[60vh] max-w-75 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
      data-wb-mgr
      @click.stop
    >
      <div class="flex items-center px-2.5 pb-1 pt-1.5 text-xs font-semibold text-faint">
        {{ t('wb.strip.mgrTitle', { n: tabs.length }) }}
        <span class="ml-auto">{{ t('wb.strip.total', { n: fmtTokens(totalCtx) }) }}</span>
      </div>
      <div
        v-for="s in filteredTabs"
        :key="s.id"
        class="group relative flex cursor-pointer items-center gap-2 px-2.5 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        :title="`${s.title}${costLabel(s)}`"
        @click="activateRow(s.id)"
      >
        <SessionStateDot :status="s.status" :unread="s.unread" />
        <span class="min-w-0 flex-1 truncate" :class="{ tgen: sessions.titleGenerating.has(s.id) }">
          {{ s.title }}{{ s.id === sessions.activeId ? ' •' : '' }}
        </span>
        <Loader2
          v-if="sessions.titleGenerating.has(s.id)"
          class="size-3 flex-none animate-spin text-primary"
        />
        <span class="h-1 w-8.5 flex-none overflow-hidden rounded-sm bg-muted">
          <i
            class="block h-full rounded-sm"
            :class="sessions.usagePct(s) > 80 ? 'bg-warning' : 'bg-primary'"
            :style="{ width: barW(s) + '%' }"
          />
        </span>
        <span class="flex-none font-mono text-xs text-faint">
          {{ fmtTokens(ctxTokens(s)) }}
        </span>
        <span
          class="absolute inset-y-0 right-0 flex items-center gap-0.5 bg-accent pl-1 pr-1.5 opacity-0 transition-opacity group-hover:opacity-100"
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
      <div class="flex items-center gap-2 border-t border-border px-2.5 py-1.5 text-xs text-faint">
        {{ t('wb.strip.heaviest', { title: heaviest }) }}
        <Button
          class="ml-auto h-4.5 flex-none rounded-sm px-2 text-xs"
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
          class="mt-1 flex items-center gap-2 border-t border-border px-2.5 pb-1 pt-1.5 text-xs font-semibold text-faint"
        >
          {{ t('wb.strip.archived', { n: filteredArchived.length }) }}
          <!-- Xoá vĩnh viễn mọi phiên đã đóng đang hiện (theo ô tìm nếu có chữ). -->
          <Button
            class="ml-auto h-4.5 flex-none rounded-sm px-2 text-xs"
            variant="danger"
            size="xs"
            type="button"
            @click="removeAllArchived"
          >
            {{ t('wb.strip.deleteAllArchived') }}
          </Button>
        </div>
        <div
          v-for="s in filteredArchived"
          :key="s.id"
          class="group relative flex cursor-pointer items-center gap-2 px-2.5 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          :title="t('wb.strip.reopen')"
          @click="restore(s)"
        >
          <SessionStateDot :status="s.status" />
          <span class="min-w-0 flex-1 truncate text-faint">{{ s.title }}</span>
          <span class="flex-none font-mono text-xs text-faint">
            {{ fmtTokens(ctxTokens(s)) }}
          </span>
          <span
            class="absolute inset-y-0 right-0 flex items-center gap-0.5 bg-accent pl-1 pr-1.5 opacity-0 transition-opacity group-hover:opacity-100"
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
import { ArrowDownUp, Loader2, RotateCcw } from 'lucide-vue-next'
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
// Một lượt tính cho cả list (không gọi lặp trong template mỗi hàng).
const issueFlags = computed(() => {
  const out = new Map<number, BoardItemStatus>()
  for (const s of filteredRows.value) {
    if (!s.issueId) continue
    const st = board.itemsFor(s.project).find((i) => i.id === s.issueId)?.status
    if (st) out.set(s.id, st)
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
  removeAllArchived,
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
// Nhóm theo thời gian kiểu Linear. Chỉ khi sắp theo thời gian (cập nhật / tạo) —
// sắp theo tên thì nhóm ngày vô nghĩa. Phiên ghim luôn đứng nhóm đầu.
type RowGroup = { key: string; label: string; rows: Session[] }
const DAY = 86_400_000
const rowGroups = computed<RowGroup[]>(() => {
  const rows = filteredRows.value
  if (sortBy.value === 'title') return [{ key: 'all', label: '', rows }]
  const field = sortBy.value === 'created' ? 'createdAt' : 'updatedAt'
  const startOfToday = new Date(now.value).setHours(0, 0, 0, 0)
  const buckets: RowGroup[] = [
    { key: 'pinned', label: t('sessions.sidebar.pinned'), rows: [] },
    { key: 'today', label: t('wb.sessions.group.today'), rows: [] },
    { key: 'yesterday', label: t('wb.sessions.group.yesterday'), rows: [] },
    { key: 'week', label: t('wb.sessions.group.week'), rows: [] },
    { key: 'older', label: t('wb.sessions.group.older'), rows: [] },
  ]
  for (const s of rows) {
    const raw = s[field]
    const ts = raw ? Date.parse(raw) : Number.NaN
    let i = 4
    if (s.pinned) i = 0
    else if (Number.isFinite(ts) && ts >= startOfToday) i = 1
    else if (Number.isFinite(ts) && ts >= startOfToday - DAY) i = 2
    else if (Number.isFinite(ts) && ts >= startOfToday - 6 * DAY) i = 3
    buckets[i]!.rows.push(s)
  }
  return buckets.filter((b) => b.rows.length > 0)
})

// Phiên đã đóng khớp ô tìm — chỉ khi đang có chữ (xem template).
const ARCHIVED_HITS_MAX = 50
const archivedHits = computed(() =>
  menuQuery.value.trim() ? filteredArchived.value.slice(0, ARCHIVED_HITS_MAX) : [],
)
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
// Instance `Input` (expose focus/select), không phải element thô.
const renameInput = useTemplateRef<{ focus: () => void; select: () => void }[]>('renameInput')

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
/* style-ok: hai hiệu ứng có @keyframes riêng (không có trong tw-animate-css) — vệt sáng
   chạy dọc chân hàng đang chạy và shimmer tiêu đề lúc model đặt lại tên. Scoped nên tên
   keyframes bị Vue băm, phải khai `animation` cùng block. */
/* Đang chạy: vệt sáng chạy dọc chân hàng (progress bất định). */
.row-run::after {
  content: '';
  position: absolute;
  right: 8px;
  bottom: 2px;
  left: 8px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--primary), transparent) no-repeat;
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
    var(--muted-foreground) 0%,
    var(--primary) 50%,
    var(--muted-foreground) 100%
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
