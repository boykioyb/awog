<template>
  <!-- Link ngược phiên → thread Slack (docs/features/slack-threads.md). Cùng khuôn chip
       của SessionContextStrip: phiên không gắn thread thì VẮNG MẶT khỏi DOM. Chỉ một
       hành động (mở cửa sổ Slack tới thread) nên bấm thẳng, không popover. -->
  <Button
    v-if="thread"
    type="button"
    variant="outline"
    size="xs"
    class="h-5.5 min-w-0 shrink gap-1.5 rounded-md px-2.5 font-normal text-dim shadow-none hover:text-foreground [&_svg]:size-3"
    :title="t('slackSession.chip.title')"
    @click="openThread"
  >
    <Icon name="message" />
    <!-- Nhãn tự cắt để chip nhường chỗ khi hàng chật. -->
    <span class="min-w-0 truncate text-foreground">
      {{ t('slackSession.chip.label', { title: label }) }}
    </span>
    <span v-if="hasNew" class="flex-none text-faint">· {{ t('slackSession.chip.new') }}</span>
  </Button>
</template>

<script setup lang="ts">
import type { Session } from '~/composables/useSessionsData'
import { useSlackSession } from '~/composables/useSlackSession'
import { useSlackModal } from '~/composables/useSlackModal'
import { useSlackStore } from '~/stores/slack'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const slack = useSlackStore()
const slackModal = useSlackModal()
const { hasNewForSession } = useSlackSession()

// Thread gắn với phiên này (khoá là engineId — `SlackThread.sessionId`).
const thread = computed(() =>
  props.session.engineId
    ? slack.threads.find((th) => th.sessionId === props.session.engineId)
    : undefined,
)
const label = computed(() => thread.value?.title || thread.value?.firstLine || '')
const hasNew = computed(() => (thread.value ? hasNewForSession(thread.value) : false))

// Chấm "có mới" so `lastReplyTs` mà chỉ poll mới dời — vốn chỉ chạy khi trang Slack mở.
// Hỏi Slack về RIÊNG thread này khi chip hiện ra (mount, hoặc phiên được kích hoạt lại
// dưới KeepAlive); có đổi thì sidecar phát `slack.changed` và store tự đọc lại danh
// sách. Trần POLL_GAP_MS mỗi chip để mount + activate liền nhau chỉ thành một lần gọi
// (sidecar còn chống poll dày riêng). Lỗi bỏ qua: chấm chỉ là báo hiệu, không chặn gì.
const POLL_GAP_MS = 15_000
let lastPoll: { id: string; at: number } | null = null
function refreshThread(): void {
  const id = thread.value?.id
  if (!id) return
  if (lastPoll?.id === id && Date.now() - lastPoll.at < POLL_GAP_MS) return
  lastPoll = { id, at: Date.now() }
  slack.poll([id]).catch(() => {})
}
watch(() => thread.value?.id, refreshThread, { immediate: true })
onActivated(refreshThread)

// Mặc định Slack là modal trong cửa sổ chính; muốn tách ra cửa sổ riêng thì bấm nút
// "Mở cửa sổ riêng" trên header modal.
function openThread(): void {
  const th = thread.value
  if (th) slackModal.open(th.id)
}
</script>
