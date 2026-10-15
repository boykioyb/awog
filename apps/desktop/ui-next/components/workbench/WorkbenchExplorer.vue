<template>
  <!-- Explorer panel của Workbench (ADR 0098, slice B): 4 view theo segmented
       strip phía trên (danh sách ở explorer-views.ts) — sessions (phiên của
       project), files (cây project + changed files), scm (git stage/commit), gh
       (PR/issue). Bấm icon đang chọn = đóng panel.
       v-show giữ state từng view (scroll, input, list) khi đổi view. -->
  <div class="exp flex h-full min-h-0 flex-col">
    <div class="flex flex-none items-center gap-0.5 border-b border-[var(--border)] px-1.5 py-1">
      <Button
        v-for="v in views"
        :key="v.id"
        variant="ghost"
        size="iconSm"
        class="sv relative size-[22px] rounded-[var(--r-xs)] p-0"
        :class="{ on: wb.sideView === v.id }"
        :title="v.title"
        @click="onViewClick(v.id)"
      >
        <!-- eslint-disable-next-line vue/no-v-html -- icon là SVG constant hardcode trong `views`, không phải input -->
        <span class="sv-ico" v-html="v.icon" />
        <span v-if="v.badge" class="sv-bdg" :style="v.badgeStyle">{{ v.badge }}</span>
      </Button>
      <span class="flex-1" />
      <Button
        variant="ghost"
        size="iconSm"
        class="sv relative size-[22px] rounded-[var(--r-xs)] p-0"
        title="Đóng panel ⌘B"
        @click="wb.toggleSide()"
      >
        <X :size="14" />
      </Button>
    </div>
    <FilesView v-show="wb.sideView === 'files'" class="min-h-0" />
    <SessionsView v-show="wb.sideView === 'sessions'" class="min-h-0" />
    <SourceControlView v-show="wb.sideView === 'scm'" class="min-h-0" />
    <GithubView v-show="wb.sideView === 'gh'" class="min-h-0" />
    <WbExplorerCtxMenu />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { X } from 'lucide-vue-next'
import { useWorkbenchExplorer } from '~/composables/useWorkbenchExplorer'
import { useWorkbenchStore } from '~/stores/workbench'
import { useSessionsStore } from '~/stores/sessions'
import { useGitStore } from '~/stores/git'
import { isBoardSession } from '~/composables/useSessionsData'
import FilesView from './explorer/FilesView.vue'
import GithubView from './explorer/GithubView.vue'
import SourceControlView from './explorer/SourceControlView.vue'
import SessionsView from './explorer/SessionsView.vue'
import { EXPLORER_VIEWS, type ExplorerView, type ExplorerViewId } from './explorer-views'

const wb = useWorkbenchStore()
const git = useGitStore()
const exp = useWorkbenchExplorer()
const sessions = useSessionsStore()

type SegView = ExplorerView & {
  badge?: string
  badgeStyle?: string
}
const scmBadge = computed(() => {
  const n = git.staged.length + git.unstaged.length + git.conflicted.length
  return n ? String(n) : undefined
})
// Badge = số phiên cần bạn để ý trong list đang hiện: chưa đọc HOẶC đang chờ trả lời
// (cùng luật với badge tab project ở useSessionTabs). Trước đây đếm TỔNG số phiên mà
// vẫn tô màu nhấn ⇒ trông như báo chưa đọc trong khi không phải.
const sessionsBadge = computed(() => {
  const n = sessions.tabSessions.filter(
    (s) =>
      !sessions.isArchived(s.id) && !isBoardSession(s) && (s.unread || s.status === 'awaiting'),
  ).length
  return n ? String(n) : undefined
})
// Badge chỉ ở dải chọn view của panel; danh sách view lấy từ EXPLORER_VIEWS (dùng
// chung với rail mini khi panel thu gọn).
const BADGES: Partial<Record<ExplorerViewId, () => Pick<SegView, 'badge' | 'badgeStyle'>>> = {
  sessions: () => ({
    badge: sessionsBadge.value,
    badgeStyle: 'background:var(--accent);color:var(--bg)',
  }),
  scm: () => ({ badge: scmBadge.value, badgeStyle: 'background:var(--amber);color:var(--bg)' }),
}
const views = computed<SegView[]>(() =>
  EXPLORER_VIEWS.map((v) => ({ ...v, ...(BADGES[v.id]?.() ?? {}) })),
)
function onViewClick(id: SegView['id']) {
  if (wb.sideView === id && !wb.sideClosed) wb.toggleSide()
  else wb.setView(id)
}

onMounted(() => {
  // Init một lần: scope git theo project tab, fs.watch + nạp root dir.
  void exp.init()
})
</script>

<style scoped>
/* Màu + font giữ scoped (token theme); layout/spacing đã chuyển sang Tailwind
   ở template. `.sv` giữ tên ngắn vì `.on` là marker trạng thái. */
.exp {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.sv {
  color: var(--textDim);
}
.sv:hover {
  color: var(--text);
  background: var(--bgHover);
}
.sv.on {
  color: var(--accent);
  background: var(--accentDim);
}
/* Icon nằm trong v-html ⇒ ép cỡ qua :deep() — 16px (--icon-md), chuẩn codicon
   VS Code; 14px trước đây quá bé trong nút 22px. */
.sv-ico {
  display: flex;
}
.sv-ico :deep(svg) {
  width: var(--icon-md);
  height: var(--icon-md);
}
/* Badge SCM: bubble cảnh báo chồng góc nút, box-shadow cắt theo nền panel. */
.sv-bdg {
  position: absolute;
  bottom: -3px;
  right: -4px;
  z-index: 10;
  min-width: 12px;
  min-height: 11px;
  padding: 0 4px 1px;
  border-radius: var(--r-pill);
  font-size: 8.5px; /* design-token-ok: badge đếm dưới thang --fs-* */
  line-height: 10px;
  font-family: var(--code, ui-monospace, monospace); /* mono-ok: badge đếm */
  display: grid;
  place-items: center;
  box-shadow: 0 0 0 2px var(--bgPanel);
}
</style>
