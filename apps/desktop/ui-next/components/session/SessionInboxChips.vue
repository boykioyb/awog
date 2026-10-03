<template>
  <!-- Hộp thư của phiên — escape hatch của đường TỰ GIAO. Mọi tin đến (phiên khác
       nhắn sang, cập nhật CI, lời nhắc agent tự hẹn) được tự xếp vào queue và chạy;
       card này chỉ hiện cho những tin bị park vì nhóm chạm trần chi phí an toàn
       (xem withinDeliverCap trong stores/sessions.ts). Nút giao là đường thủ công
       duy nhất còn lại. -->
  <div v-if="msgs.length" class="inbx">
    <div class="inbx-hd">
      <Icon name="bell" style="width: var(--icon-sm); height: var(--icon-sm)" />
      <span class="inbx-title">{{ title }}</span>
      <span style="flex: 1" />
      <button
        class="inbx-x"
        :title="t('sessionsInbox.dismissAll')"
        @click="store.dismissInbox(engineId)"
      >
        <Icon name="x" style="width: var(--icon-xs); height: var(--icon-xs)" />
      </button>
    </div>

    <div v-for="m in msgs" :key="m.id" class="inbx-row">
      <span class="inbx-org" :class="`is-${m.origin}`">{{ orgLabel(m) }}</span>
      <!-- preview do sidecar dựng (đã khử bí mật, một dòng). Text node, không v-html. -->
      <span class="inbx-prev">{{ m.preview }}</span>
      <button
        class="inbx-x"
        :title="t('sessionsInbox.dismiss')"
        @click="store.dismissInboxMessage(engineId, m.id)"
      >
        <Icon name="x" style="width: var(--icon-xs); height: var(--icon-xs)" />
      </button>
    </div>

    <p class="inbx-note">{{ untrustedNote }}</p>

    <div class="inbx-foot">
      <span class="inbx-wait">
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
  </div>
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

<style scoped>
/* Card hộp thư — shadcn popover/card idiom: card surface + hairline border +
   --radius + --shadow-sm, muted meta text, ghost dismiss buttons. */
.inbx {
  margin: 6px 12px 0;
  padding: 8px 10px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.inbx-hd {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--muted-foreground);
}
.inbx-title {
  font-weight: 600;
  color: var(--foreground);
}
.inbx-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.inbx-org {
  flex: none;
  padding: 1px 6px;
  border: 1px solid color-mix(in srgb, var(--primary) 45%, var(--border));
  color: var(--primary);
  border-radius: var(--r-xs);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
/* Nguồn ngoài tô amber: người lạ viết ra, đáng ngờ nhất trong ba loại. */
.inbx-org.is-external {
  border-color: color-mix(in srgb, var(--warning) 45%, var(--border));
  color: var(--warning);
}
.inbx-prev {
  flex: 1;
  color: var(--muted-foreground);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.inbx-note {
  margin: 0;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.inbx-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}
.inbx-wait {
  flex: 1;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
/* Nút bỏ qua — ghost icon: muted, accent-wash hover, foreground khi hover. */
.inbx-x {
  flex: none;
  color: var(--muted-foreground);
  padding: 1.5px;
  border-radius: var(--r-xs);
  background: transparent;
  border: 0;
  cursor: pointer;
  transition:
    color 0.12s var(--ease, ease),
    background 0.12s var(--ease, ease);
}
.inbx-x:hover {
  background: var(--accent-wash);
  color: var(--foreground);
}
</style>
