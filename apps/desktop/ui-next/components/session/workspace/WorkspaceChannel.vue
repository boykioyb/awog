<template>
  <section class="mt-3">
    <Button
      variant="ghost"
      class="h-auto p-0 flex w-full items-center gap-1.5 py-0.5 text-left font-sans text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
      type="button"
      @click="open = !open"
    >
      <ChevronDown class="size-3 shrink-0 transition-transform" :class="{ 'rotate-180': open }" />
      <span>{{ t('sessions.workspace.group.channel') }}</span>
      <span class="font-normal text-faint">{{ entries.length }}</span>
    </Button>

    <div v-if="open" class="mt-2 flex flex-col gap-2">
      <div ref="feedEl" class="flex max-h-[220px] flex-col gap-1.5 overflow-y-auto">
        <div v-if="!entries.length" class="px-0.5 py-1.5 text-xs text-faint">
          {{ t('sessions.workspace.group.channelEmpty') }}
        </div>
        <div
          v-for="e in entries"
          :key="e.id"
          :class="['rounded-md border px-2.5 py-1.5', msgClass(e.kind)]"
        >
          <div class="flex min-w-0 items-center gap-1.5">
            <span
              class="truncate text-xs font-semibold"
              :class="e.kind === 'system' ? 'text-dim' : 'text-muted-foreground'"
            >
              {{ e.fromTitle }}
            </span>
            <span
              v-if="e.kind !== 'chat'"
              class="shrink-0 rounded-full border px-1.5 text-[10px] leading-4"
              :class="kindClass(e.kind)"
            >
              {{ kindLabel(e.kind) }}
            </span>
            <span class="ml-auto shrink-0 text-[10px] leading-4 text-faint">
              {{ relativeTime(e.at, now) }}
            </span>
          </div>
          <div
            class="mt-0.5 whitespace-pre-wrap break-words text-sm"
            :class="e.kind === 'system' ? 'text-dim' : 'text-foreground'"
          >
            {{ e.text }}
          </div>
        </div>
      </div>

      <WorkspaceChannelComposer
        :root-id="rootId"
        :members="members"
        :lead="lead"
        @sent="scrollBottom"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
// Channel của nhóm (session-teams §8): timeline JSONL append-only của GỐC nhóm
// (~/.awog/groups/<rootId>/channel.jsonl) — trao đổi ê-kíp, khác hộp thư 1-1.
// Feed cập nhật live qua event `channel.appended` (board store); composer tách
// sang WorkspaceChannelComposer (input + @mention tối giản).
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { useI18n } from '~/composables/useI18n'
import { useNow } from '~/composables/useNow'
import { useBoardStore, type TeamChannelKind } from '~/stores/board'
import type { Session } from '~/composables/useSessionsData'
import { relativeTime } from '~/utils/relative-time'
import WorkspaceChannelComposer from './WorkspaceChannelComposer.vue'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  // engineId của phiên GỐC nhóm — khoá của file channel.
  rootId: string
  // Member trực tiếp + lead — chuyển tiếp cho composer làm danh bạ @mention.
  members: Session[]
  lead: Session
}>()

const { t } = useI18n()
const board = useBoardStore()
const now = useNow()

const open = ref(true)
const feedEl = ref<HTMLElement | null>(null)

const entries = computed(() => board.channelFor(props.rootId))

const KIND_KEYS: Record<TeamChannelKind, string> = {
  chat: '',
  status: 'sessions.workspace.group.kind.status',
  note: 'sessions.workspace.group.kind.note',
  eval: 'sessions.workspace.group.kind.eval',
  system: 'sessions.workspace.group.kind.system',
}
const kindLabel = (k: TeamChannelKind): string => (KIND_KEYS[k] ? t(KIND_KEYS[k]) : k)

// Màu theo kind: status/eval là tín hiệu làm việc, note là ghi chú người dùng,
// system là thông báo máy — mỗi loại một độ yên tĩnh khác nhau.
function msgClass(k: TeamChannelKind): string {
  if (k === 'status') return 'border-ring bg-muted'
  if (k === 'system') return 'border-dashed border-border bg-transparent'
  return 'border-border bg-muted'
}
function kindClass(k: TeamChannelKind): string {
  if (k === 'status') return 'border-ring text-primary'
  if (k === 'eval') return 'border-warning/40 text-warning'
  if (k === 'note') return 'border-border text-muted-foreground'
  return 'border-border text-faint'
}

// Cuộn xuống đuôi khi mở section / có entry mới / vừa gửi xong — feed đọc theo
// thời gian, tin mới nhất nằm đáy.
async function scrollBottom() {
  await nextTick()
  const el = feedEl.value
  if (el) el.scrollTop = el.scrollHeight
}
watch(
  () => entries.value.length,
  () => void scrollBottom(),
)
watch(open, (v) => {
  if (v) void scrollBottom()
})

onMounted(async () => {
  await board.listChannel(props.rootId)
  void scrollBottom()
})
watch(
  () => props.rootId,
  (id) => {
    if (id) void board.listChannel(id).then(scrollBottom)
  },
)
</script>
