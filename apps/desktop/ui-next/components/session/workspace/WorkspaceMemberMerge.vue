<template>
  <!-- Hàng merge của một member (session-teams §5): merge là hành động của
       NGƯỜI DÙNG — chỉ hiện khi member có branch + một board item đang
       in_review/changes được giao cho nó. Lỗi conflict hiện inline, không toast. -->
  <div>
    <div v-if="mergeErr" class="mt-1.5 whitespace-pre-wrap break-words text-xs text-destructive">
      {{ mergeErr }}
    </div>
    <div v-if="reviewItem" class="mt-1.5 flex min-w-0 items-center gap-2">
      <Button
        variant="outline"
        class="h-auto p-0 inline-flex items-center gap-1 rounded-full border border-primary/40 px-2.5 py-0.5 text-xs text-primary transition-colors hover:bg-primary/10 disabled:opacity-45"
        :disabled="merging"
        @click.stop="merge"
      >
        <GitMerge class="size-3" />
        {{ t('sessions.workspace.group.merge') }}
      </Button>
      <span class="min-w-0 truncate text-xs text-muted-foreground">{{ reviewItem.title }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
// Nút Merge + lỗi inline của MỘT member (tách khỏi WorkspaceRosterMember để mỗi
// file giữ một mối lo). `sessions.integrateMember` merge branch của member về
// baseRef; itemId gửi kèm để sidecar đánh dấu item đã merge.
import { GitMerge } from 'lucide-vue-next'
import { useBoardStore, type BoardItem } from '~/stores/board'
import type { Session } from '~/composables/useSessionsData'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  m: Session
  // projectId để tra board item đang chờ review của member ('' = chưa gắn).
  projectId: string
}>()

const { t } = useI18n()
const board = useBoardStore()

const mergeErr = ref('')
// mergingSession của store là slot ĐƠN — một merge đang chạy khoá mọi nút Merge
// khác (hai integrateMember đồng thời sẽ đạp nhau ở finally của nhau).
const merging = computed(() => board.mergingSession !== null)

// Item đang in_review/changes được giao cho member này — điều kiện hiện nút.
const reviewItem = computed<BoardItem | undefined>(() => {
  const eid = props.m.engineId
  if (!eid || !props.m.worktree?.branch || !props.projectId) return undefined
  return board
    .itemsFor(props.projectId)
    .find(
      (i) => i.assigneeSessionId === eid && (i.status === 'in_review' || i.status === 'changes'),
    )
})

async function merge() {
  const eid = props.m.engineId
  if (!eid || merging.value) return
  mergeErr.value = ''
  const res = await board.integrateMember(eid, reviewItem.value?.id)
  if (!res.merged) mergeErr.value = res.error ?? t('sessions.workspace.group.mergeFail')
  else if (props.projectId) void board.listBoard(props.projectId)
}
</script>
