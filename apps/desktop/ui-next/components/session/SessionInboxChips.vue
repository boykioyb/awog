<template>
  <!-- Hộp thư của phiên — escape hatch của đường TỰ GIAO. Mọi tin đến (phiên khác
       nhắn sang, cập nhật CI, lời nhắc agent tự hẹn) được tự xếp vào queue và chạy;
       card này chỉ hiện cho những tin bị park vì nhóm chạm trần chi phí an toàn
       (xem withinDeliverCap trong stores/sessions.ts). Nút giao là đường thủ công
       duy nhất còn lại. -->
  <Card
    v-if="msgs.length"
    class="mx-3 mt-1.5 flex flex-col gap-1.5 rounded-lg px-2.5 py-2 shadow-sm"
  >
    <div class="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Icon name="bell" class="size-3.5" />
      <span class="flex-1 font-semibold text-foreground">{{ title }}</span>
      <Button
        variant="ghost"
        size="iconSm"
        class="size-4 rounded-sm text-muted-foreground hover:text-foreground"
        :title="t('sessionsInbox.dismissAll')"
        :aria-label="t('sessionsInbox.dismissAll')"
        @click="store.dismissInbox(engineId)"
      >
        <Icon name="x" class="size-3" />
      </Button>
    </div>

    <div v-for="m in msgs" :key="m.id" class="flex min-w-0 items-center gap-1.5">
      <!-- Nguồn ngoài tô amber: người lạ viết ra, đáng ngờ nhất trong ba loại. -->
      <Badge
        variant="outline"
        class="shrink-0 rounded-sm px-1.5 py-px font-normal"
        :class="
          m.origin === 'external'
            ? 'border-warning/45 text-warning'
            : 'border-primary/45 text-primary'
        "
      >
        {{ orgLabel(m) }}
      </Badge>
      <!-- preview do sidecar dựng (đã khử bí mật, một dòng). Text node, không v-html. -->
      <span class="min-w-0 flex-1 truncate text-sm text-muted-foreground">{{ m.preview }}</span>
      <Button
        variant="ghost"
        size="iconSm"
        class="size-4 rounded-sm text-muted-foreground hover:text-foreground"
        :title="t('sessionsInbox.dismiss')"
        :aria-label="t('sessionsInbox.dismiss')"
        @click="store.dismissInboxMessage(engineId, m.id)"
      >
        <Icon name="x" class="size-3" />
      </Button>
    </div>

    <p class="m-0 text-xs text-faint">{{ untrustedNote }}</p>

    <div class="flex items-center gap-2">
      <span class="flex-1 text-xs text-faint">
        {{ canDeliver ? t('sessionsInbox.capped') : t('sessionsInbox.waiting') }}
      </span>
      <Button
        size="sm"
        :disabled="!canDeliver"
        :title="t('sessionsInbox.deliverHint')"
        @click="store.deliverInbox(engineId)"
      >
        {{ t('sessionsInbox.deliver') }}
      </Button>
    </div>
  </Card>
</template>

<script setup lang="ts">
// Chip hộp thư, đặt ngay trên composer cạnh chip việc nền.
//
// Tin hộp thư được TỰ GIAO — card này là escape hatch cho tin bị park khi nhóm
// chạm trần chi phí tự giao (MAX_AUTO_DELIVERS_PER_GROUP/30 phút). Nút "giao" là
// giao THỦ CÔNG khi phiên đang rảnh; đang bận thì tin cứ chờ tới khi trần mở lại
// hoặc phiên rảnh để bấm.
import { computed } from 'vue'
import { useSessionsStore, type InboxOrigin } from '~/stores/sessions'
import type { Session } from '~/composables/useSessionsData'

const props = defineProps<{ session: Session }>()

const { t } = useI18n()
const store = useSessionsStore()

// `engineId` chỉ có sau khi phiên được hydrate; chưa có thì chưa thể có tin nào
// gửi tới nó, nên chuỗi rỗng cho ra danh sách rỗng và cả khối tự ẩn.
const engineId = computed(() => props.session.engineId ?? '')
const msgs = computed(() => (engineId.value ? store.pendingInboxFor(engineId.value) : []))
const canDeliver = computed(() => engineId.value !== '' && store.canDeliverInbox(engineId.value))

// Nguồn nào đang chiếm đa số quyết định tiêu đề. Trộn nhiều nguồn ⇒ nói số lượng
// thay vì chọn bừa một nhãn — gọi một cập nhật CI là "tin từ phiên khác" là sai.
const origins = computed(() => new Set(msgs.value.map((m) => m.origin)))
const title = computed(() => {
  if (origins.value.size > 1) return t('sessionsInbox.titleMixed', { n: msgs.value.length })
  const only = [...origins.value][0]
  if (only === 'external') return t('sessionsInbox.titleExternal')
  if (msgs.value.length > 1) return t('sessionsInbox.titleMany', { n: msgs.value.length })
  return t('sessionsInbox.title')
})

// Lời cảnh báo tin cậy đi theo NGUỒN, không theo `fromSessionId === null` — đó
// chính là chỗ suy ngược từng gán nhãn "bạn chuyển tiếp" cho log CI của người lạ.
const untrustedNote = computed(() => {
  if (origins.value.size > 1) return t('sessionsInbox.untrusted')
  const only = [...origins.value][0]
  if (only === 'external') return t('sessionsInbox.untrustedExternal')
  if (only === 'user') return t('sessionsInbox.untrustedUser')
  return t('sessionsInbox.untrusted')
})

function orgLabel(m: { origin: InboxOrigin; fromTitle: string }): string {
  if (m.origin === 'user') return t('sessionsInbox.fromUser')
  if (m.origin === 'external') return t('sessionsInbox.fromExternal', { name: m.fromTitle })
  return t('sessionsInbox.from', { name: m.fromTitle })
}
</script>
