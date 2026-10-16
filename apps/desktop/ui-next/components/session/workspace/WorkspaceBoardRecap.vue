<template>
  <!-- Recap + các phiên đã làm issue (docs/features/session-issue-tracking.md) —
       tab Chung của modal issue. Người dùng quay lại việc sau nhiều ngày đọc ở đây
       "đang ở đâu", rồi mở lại phiên cũ hoặc tiếp tục trong một phiên mới. -->
  <div class="flex flex-col gap-2 rounded-md border border-border p-3">
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs text-muted-foreground">
        {{
          item.recap
            ? t('sessions.issue.recapAt', { when: fmtAt(item.recap.at) })
            : t('sessions.issue.recap')
        }}
      </span>
      <Button variant="ghost" size="sm" :disabled="recapping" @click="recap()">
        {{
          recapping
            ? t('sessions.issue.recapRunning')
            : item.recap
              ? t('sessions.issue.recapRefresh')
              : t('sessions.issue.recapRun')
        }}
      </Button>
    </div>
    <IssueRecapView v-if="item.recap" :text="item.recap.text" />
    <p v-else class="m-0 text-xs text-muted-foreground">{{ t('sessions.issue.recapEmpty') }}</p>

    <div class="mt-1 flex flex-col gap-1 border-t border-dashed border-border pt-2">
      <span class="text-xs text-muted-foreground">{{ t('sessions.issue.sessions') }}</span>
      <button
        v-for="s in executors"
        :key="s.id"
        type="button"
        class="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-accent-wash"
        @click="openSession(s.engineId!)"
      >
        <SessionStateDot :status="s.status" :unread="!!s.unread" />
        <span class="min-w-0 flex-1 truncate">{{ s.title }}</span>
        <span class="shrink-0 text-faint">{{ s.updatedAt ? fmtAt(s.updatedAt) : '' }}</span>
      </button>
      <p v-if="!executors.length" class="m-0 text-xs text-faint">
        {{ t('sessions.issue.noSessions') }}
      </p>
      <Button variant="outline" size="sm" class="self-start" @click="continueNew">
        {{ t('sessions.issue.continueNew') }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { BoardItem } from '~/stores/board'

const props = defineProps<{ item: BoardItem }>()
const emit = defineEmits<{ navigated: [] }>()

const { t } = useI18n()
const board = useBoardStore()
const sessions = useSessionsStore()
const settings = useSettingsStore()
const toast = useToast()
const { openSession: openByEngineId } = useSessionTaskLink()

const recapping = computed(() => !!board.recapping[`${props.item.projectId}:${props.item.id}`])

// Phiên đã làm issue = phiên trỏ issueId về nó + người đang cầm (team/agent). Mới
// nhất lên đầu — phiên gần đây nhất là chỗ nối việc tự nhiên nhất.
const executors = computed(() =>
  sessions.sessions
    .filter(
      (s) =>
        !!s.engineId &&
        (s.issueId === props.item.id || s.engineId === props.item.assigneeSessionId),
    )
    .sort((a, b) => ((a.updatedAt ?? '') < (b.updatedAt ?? '') ? 1 : -1)),
)

async function recap(): Promise<void> {
  try {
    await board.recapItem(props.item.projectId, props.item.id, settings.resolveAuthoringLlm())
  } catch (err) {
    toast.add({
      title: t('sessions.issue.recapFailed'),
      description: sidecarErrorText(err),
      color: 'error',
    })
  }
}

async function openSession(engineId: string): Promise<void> {
  emit('navigated')
  await openByEngineId(engineId)
}

async function continueNew(): Promise<void> {
  emit('navigated')
  sessions.createForIssue(props.item.id, props.item.projectId, props.item.title)
  await navigateTo('/workbench')
}

const fmtAt = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}
</script>
