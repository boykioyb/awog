<template>
  <!-- Explorer panel của Workbench (ADR 0098, slice B): 5 view theo segmented
       strip phía trên (danh sách ở explorer-views.ts) — sessions (phiên của
       project), issues (việc trên board theo status), files (cây project + changed files), scm (git stage/commit), gh
       (PR/issue). Bấm icon đang chọn = đóng panel.
       v-show giữ state từng view (scroll, input, list) khi đổi view. -->
  <div class="flex h-full min-h-0 flex-col text-sm">
    <div class="flex flex-none items-center gap-0.5 border-b border-border px-1.5 py-1">
      <Button
        v-for="v in views"
        :key="v.id"
        variant="ghost"
        :class="[VIEW_BTN, wb.sideView === v.id && VIEW_BTN_ACTIVE]"
        :title="v.title"
        @click="onViewClick(v.id)"
      >
        <!-- eslint-disable-next-line vue/no-v-html -- icon là SVG constant hardcode trong `views`, không phải input -->
        <span class="flex" v-html="v.icon" />
        <CountBadge v-if="v.badge" :class="[v.badgeClass, 'text-background']">
          {{ v.badge }}
        </CountBadge>
      </Button>
      <span class="flex-1" />
      <Button variant="ghost" :class="VIEW_BTN" title="Đóng panel ⌘B" @click="wb.toggleSide()">
        <X />
      </Button>
    </div>
    <FilesView v-show="wb.sideView === 'files'" class="min-h-0" />
    <SessionsView v-show="wb.sideView === 'sessions'" class="min-h-0" />
    <IssuesView v-show="wb.sideView === 'issues'" class="min-h-0" />
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
import IssuesView from './explorer/IssuesView.vue'
import { useBoardStore } from '~/stores/board'
import {
  EXPLORER_VIEWS,
  VIEW_BTN,
  VIEW_BTN_ACTIVE,
  type ExplorerView,
  type ExplorerViewId,
} from './explorer-views'

const wb = useWorkbenchStore()
const git = useGitStore()
const exp = useWorkbenchExplorer()
const sessions = useSessionsStore()
const board = useBoardStore()

type SegView = ExplorerView & {
  badge?: string
  badgeClass?: string
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
// Badge Issues = số issue BỊ CHẶN của project đang mở — thứ duy nhất cần người dùng
// ra tay ngay (đang làm / tạm dừng là trạng thái bình thường, đếm chúng thành nhiễu).
const issuesBadge = computed(() => {
  const n = board.itemsFor(sessions.activeTab).filter((i) => i.status === 'blocked').length
  return n ? String(n) : undefined
})
// Badge chỉ ở dải chọn view của panel; danh sách view lấy từ EXPLORER_VIEWS (dùng
// chung với rail mini khi panel thu gọn).
const BADGES: Partial<Record<ExplorerViewId, () => Pick<SegView, 'badge' | 'badgeClass'>>> = {
  sessions: () => ({
    badge: sessionsBadge.value,
    badgeClass: 'bg-primary',
  }),
  issues: () => ({
    badge: issuesBadge.value,
    badgeClass: 'bg-destructive',
  }),
  scm: () => ({ badge: scmBadge.value, badgeClass: 'bg-warning' }),
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
