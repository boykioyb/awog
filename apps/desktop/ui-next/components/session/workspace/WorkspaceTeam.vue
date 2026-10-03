<template>
  <div class="p-2.5 text-sm text-foreground">
    <!-- Thanh "Cần bạn quyết" (session-teams §8): gom mọi thứ lead không thể tự
         giải — member lỗi, work-item chờ review/bị chặn. Bấm một entry để nhảy
         tới đúng hàng roster / card board. -->
    <section
      v-if="decisions.length"
      class="mb-1 rounded-md border border-warning/40 bg-warning/10 p-1.5"
    >
      <div
        class="flex items-center gap-1.5 px-0.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-warning"
      >
        {{ t('sessions.workspace.group.decide') }}
        <span class="font-bold">{{ decisions.length }}</span>
      </div>
      <Button
        v-for="d in decisions"
        :key="d.key"
        variant="ghost"
        class="h-auto p-0 flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left transition-colors hover:bg-accent"
        @click="d.go()"
      >
        <component
          :is="d.icon"
          class="size-3 shrink-0"
          :class="d.sev === 'err' ? 'text-destructive' : 'text-warning'"
        />
        <span class="min-w-0 flex-1 truncate text-xs text-foreground">{{ d.label }}</span>
        <span class="shrink-0 text-xs text-faint">{{ d.kind }}</span>
      </Button>
    </section>

    <!-- Roster: phiên con trực tiếp + agent/branch/diff/merge + hộp thư chờ giao. -->
    <WorkspaceRoster ref="rosterEl" :lead="session" :members="members" :project-id="projectId" />

    <!-- Board + channel sống trên PROJECT — chỉ render khi phiên gắn project. -->
    <template v-if="projectId">
      <WorkspaceBoard ref="boardEl" :project-id="projectId" :members="members" :lead="session" />
      <WorkspaceChannel v-if="rootId" :root-id="rootId" :members="members" :lead="session" />
    </template>
  </div>
</template>

<script setup lang="ts">
// Cockpit "Nhóm" của phiên gốc (session-teams §7–8). Tách ba phần (roster /
// board / channel) sang sub-component riêng; file này giữ thanh hành động
// "Cần bạn quyết" + wiring nhảy-chéo giữa các section.
import { computed, ref, type Component } from 'vue'
import { AlertTriangle, Eye } from 'lucide-vue-next'
import type { Session } from '~/composables/useSessionsData'
import { useSessionsStore } from '~/stores/sessions'
import { useBoardStore } from '~/stores/board'
import WorkspaceRoster from './WorkspaceRoster.vue'
import WorkspaceBoard from './WorkspaceBoard.vue'
import WorkspaceChannel from './WorkspaceChannel.vue'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{ session: Session }>()

const { t } = useI18n()
const store = useSessionsStore()
const board = useBoardStore()

const rosterEl = ref<InstanceType<typeof WorkspaceRoster> | null>(null)
const boardEl = ref<InstanceType<typeof WorkspaceBoard> | null>(null)

// Con TRỰC TIẾP của phiên này — `teamRunId` lưu engineId của CHA (khuôn
// bảng Nhóm cũ). Cháu không lên bảng này: chúng thuộc cockpit của cha chúng.
const members = computed<Session[]>(() => {
  const eid = props.session.engineId
  if (!eid) return []
  return store.sessions.filter((s) => s.teamRunId === eid)
})
// `Session.project` mang projectId của phiên (summaryToSession map dto.projectId
// vào nó) — board/channel sống trên project nên đây là khoá của cả hai.
const projectId = computed(() => props.session.project ?? '')
// Khoá channel là engineId của GỐC nhóm — file nhóm gắn ở gốc, không theo con.
const rootId = computed(() => props.session.engineId ?? '')

// Mở phiên con trong cột chi tiết — giữ hành vi click của bảng Nhóm cũ.
function openSession(id: number) {
  store.setActive(id)
}

type Decision = {
  key: string
  icon: Component
  sev: 'err' | 'warn'
  label: string
  kind: string
  go: () => void
}

const decisions = computed<Decision[]>(() => {
  const out: Decision[] = []
  // Member đang lỗi — mở detail của nó + flash hàng roster.
  for (const m of members.value) {
    if (m.status === 'error') {
      out.push({
        key: `m:${m.id}`,
        icon: AlertTriangle,
        sev: 'err',
        label: m.title,
        kind: t(`sessions.status.${m.status}`),
        go: () => {
          openSession(m.id)
          void rosterEl.value?.scrollToMember(m.engineId ?? '')
        },
      })
    }
  }
  // Work-item cần người quyết — mở editor của board.
  if (projectId.value) {
    for (const it of board.itemsFor(projectId.value)) {
      if (it.status === 'in_review' || it.status === 'blocked') {
        out.push({
          key: `b:${it.id}`,
          icon: it.status === 'blocked' ? AlertTriangle : Eye,
          sev: it.status === 'blocked' ? 'err' : 'warn',
          label: it.title,
          kind: t(
            `sessions.workspace.group.st.${it.status === 'in_review' ? 'inReview' : 'blocked'}`,
          ),
          go: () => void boardEl.value?.openItem(it.id),
        })
      }
    }
  }
  return out
})
</script>
