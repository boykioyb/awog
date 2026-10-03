<template>
  <div
    :class="[
      'flex w-full cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors',
      flash ? 'border-primary bg-primary/10' : 'border-border hover:border-ring hover:bg-accent',
      lead ? 'border-dashed bg-transparent' : 'bg-muted',
    ]"
    :data-member="m.engineId"
    @click="emit('open', m.id)"
  >
    <span
      class="mt-1.5 size-2 shrink-0 rounded-full"
      :style="{ background: STATUS_COLOR[m.status] }"
    />
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 flex-wrap items-center gap-1.5">
        <span class="truncate font-medium text-foreground">{{ m.title }}</span>
        <span
          v-if="roleLabel"
          class="shrink-0 rounded-full border border-ring px-1.5 py-px text-[10px] leading-4 text-primary"
        >
          {{ roleLabel }}
        </span>
        <!-- Agent "vai có thật" — bấm để gắn/đổi (menu do WorkspaceRoster giữ). -->
        <button
          :class="[
            'inline-flex max-w-[55%] shrink-0 items-center gap-1 truncate rounded-full border px-1.5 py-px text-[10px] leading-4 transition-colors hover:border-ring hover:text-primary',
            m.agent
              ? 'border-border text-muted-foreground'
              : 'border-dashed border-border text-faint',
          ]"
          :title="t('sessions.workspace.group.agentPick')"
          @click.stop="emit('pickAgent', m, $event)"
        >
          <Users class="size-3 shrink-0" />
          {{ m.agent?.id ?? t('sessions.workspace.group.agent') }}
        </button>
      </div>
      <div class="flex min-w-0 items-center gap-1.5 text-xs text-dim">
        <span>{{ t(`sessions.status.${m.status}`) }}</span>
        <span>·</span>
        <span>{{ m.updatedAt ? relativeTime(m.updatedAt, now) : m.when }}</span>
        <!-- Branch riêng của member + diff stat (nạp lười qua memberDiff). -->
        <template v-if="!lead && m.worktree?.branch">
          <span>·</span>
          <span
            class="inline-flex min-w-0 items-center gap-1 truncate text-muted-foreground"
            :title="m.worktree.branch"
          >
            <GitBranch class="size-3 shrink-0" />
            {{ branchShort }}{{ diffLabel }}
          </span>
        </template>
      </div>
      <!-- Tin hộp thư bị park vì nhóm chạm trần tự giao — nút là giao THỦ CÔNG
           (escape hatch, tin bình thường tự chạy không qua đây). -->
      <div v-if="pending" class="mt-1.5 flex items-center gap-1.5 text-xs text-warning">
        <Bell class="size-3 shrink-0" />
        <span>{{ t('sessions.workspace.group.pending', { n: pending }) }}</span>
        <Button
          variant="outline"
          class="h-auto p-0 rounded-full border border-warning/40 px-2 py-px text-warning transition-colors hover:bg-warning/10 disabled:opacity-45"
          :disabled="!canDeliver"
          :title="canDeliver ? t('sessionsInbox.capped') : t('sessionsInbox.waiting')"
          @click.stop="deliver"
        >
          {{ t('sessionsInbox.deliver') }}
        </Button>
      </div>
      <!-- Merge + lỗi inline — component riêng (merge là hành động của NGƯỜI
           DÙNG, chỉ khi member có branch + item in_review/changes được giao). -->
      <WorkspaceMemberMerge v-if="!lead" :m="m" :project-id="projectId" />
    </div>
  </div>
</template>

<script setup lang="ts">
// Một hàng roster của cockpit (session-teams §8) — dùng cho cả LEAD (lead=true:
// chỉ dot + title + agent chip, không branch/merge/hộp thư) lẫn member. Diff của
// member nạp LƯỜI: chỉ hỏi `sessions.memberDiff` khi có worktree và store chưa
// có kết quả (diffFor === undefined), một lần mỗi engineId.
import { computed, onMounted } from 'vue'
import { Bell, GitBranch, Users } from 'lucide-vue-next'
import { useI18n } from '~/composables/useI18n'
import { useNow } from '~/composables/useNow'
import { useSessionsStore } from '~/stores/sessions'
import { useBoardStore } from '~/stores/board'
import { useSessionsData, type Session } from '~/composables/useSessionsData'
import { relativeTime } from '~/utils/relative-time'
import WorkspaceMemberMerge from './WorkspaceMemberMerge.vue'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  m: Session
  // Hàng LEAD của nhóm — giữ cây chính (không worktree) nên giấu branch/merge.
  lead?: boolean
  flash?: boolean
  // projectId để tra board item đang in_review của member ('' = chưa gắn).
  projectId: string
}>()
const emit = defineEmits<{
  open: [id: number]
  pickAgent: [session: Session, e: MouseEvent]
}>()

const { t } = useI18n()
const store = useSessionsStore()
const board = useBoardStore()
const { STATUS_COLOR } = useSessionsData()
const now = useNow()

const roleLabel = computed(() =>
  props.lead ? t('sessions.workspace.group.lead') : (props.m.teamRole ?? ''),
)

// ── Hộp thư chờ giao (giữ nguyên từ WorkspaceTeam cũ) ──
const pending = computed(() =>
  !props.lead && props.m.engineId ? store.pendingInboxFor(props.m.engineId).length : 0,
)
const canDeliver = computed(
  () => !!props.m.engineId && pending.value > 0 && store.canDeliverInbox(props.m.engineId),
)
function deliver() {
  if (props.m.engineId) store.deliverInbox(props.m.engineId)
}

// ── Branch chip + diff stat ──
const branchShort = computed(() => props.m.worktree?.branch.split('/').pop() ?? '')

// "±n files" từ memberDiff — `stat` có thể là object đếm hoặc chuỗi tóm tắt.
const diffLabel = computed(() => {
  const eid = props.m.engineId
  if (!eid) return ''
  const d = board.diffFor(eid)
  if (!d) return ''
  if (typeof d.stat === 'string' && d.stat) return ` · ${d.stat}`
  const files = d.files?.length ?? (typeof d.stat === 'object' ? d.stat?.files : undefined)
  const adds = typeof d.stat === 'object' ? d.stat?.additions : undefined
  const dels = typeof d.stat === 'object' ? d.stat?.deletions : undefined
  const parts: string[] = []
  if (typeof files === 'number') parts.push(t('sessions.workspace.group.diffFiles', { n: files }))
  if (typeof adds === 'number' || typeof dels === 'number')
    parts.push(`+${adds ?? 0} −${dels ?? 0}`)
  return parts.length ? ` · ${parts.join(' ')}` : ''
})

// Nạp lười diff — một lần mỗi engineId (diffFor trả undefined chỉ khi chưa hỏi).
onMounted(() => {
  const eid = props.m.engineId
  if (!props.lead && props.m.worktree?.branch && eid && board.diffFor(eid) === undefined) {
    void board.memberDiff(eid)
  }
})
</script>
